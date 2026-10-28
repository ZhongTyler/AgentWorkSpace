import {afterReviewedCommit} from '../../query/retrieval-maintenance.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {safe,sha} from './raw-quality.mjs';
import {readJson,writeJson,consolidated,ownedPaths,inputIdentity} from './ingest-execution-state.mjs';
import {pipeline,dispatchMessage} from './ingest-pipeline.mjs';
import {prepareWriter,assembleRaw} from './assemble-raw.mjs';
import {splitRaw} from './ingest-review-support.mjs';
import {prepareBundle} from './review-bundle-input.mjs';
import {reviewRow} from './ingest-batch.mjs';
import {consumptionInventory,bindRiskReview,diagnoseConsumption,consumptionCandidates} from './wiki-consumption.mjs';
import {prepareStage3,stagePaths} from './ingest-stage3-prepare.mjs';
import {closePlan,committedParent} from './ingest-close-plan.mjs';
import {findReviewerLog} from './ingest-runtime-contract.mjs';
import {taskDispatch} from './ingest-agent-routing.mjs';
import {postRereadPath,preparePostReread,advancePostReread} from './ingest-post-reread.mjs';
import {scoreRows} from './ingest-score-check.mjs';
import {commitMessage,verifyWorkspaceClosure} from './ingest-git-commit.mjs';
import {syncSkippedSources} from './ingest-skipped-sources.mjs';
import {verifyStructureRequests} from './ingest-structure-verify.mjs';
import {capacityRows,recordCapacityDecision} from './ingest-capacity-decision.mjs';
import {streamlined,wikiPaths,sourceDecision,scoringSources,coverageReuse,requirePresentation,reviewedRawSemantic,aggregatePresentation,projectAggregate,gateProjection} from './ingest-semantic-reuse.mjs';

const checks='system/maintenance/checklists/';
const emptySemantic=()=>({summary:'',rows:[],semantic_exceptions:[],unresolved_risks:[],structure_change_requests:[],micro_failures:[]});
const nonempty=x=>typeof x==='string'&&x.trim();

// Internal implementation of ingest-control advance. No second run ledger.
export function advance(root,args){
  root=fs.realpathSync(root);
  const runPath=path.relative(root,safe(root,args.run)).split(path.sep).join('/'),dir=path.posix.dirname(runPath);
  const read=p=>readJson(root,p),exists=p=>fs.existsSync(safe(root,p,false));
  const shell=args.shell??(process.platform==='win32'?path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh');
  const env={...process.env};for(const k of Object.keys(env))if(k.toLowerCase()==='psmodulepath')delete env[k];
  const exec=(cmd,argv)=>execFileSync(cmd,argv,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024,env,stdio:['ignore','pipe','pipe']}).trim();
  const ps=(file,argv)=>exec(shell,['-NoProfile','-File',safe(root,checks+file),...argv]);
  const control=(action,argv=[])=>ps('ingest-control.ps1',['-Action',action,'-RunPath',runPath,...argv]);
  const node=(file,argv)=>exec(process.execPath,[safe(root,checks+file),...argv]);
  const git=(...argv)=>exec('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-c','core.excludesFile=','-c','core.quotepath=false','-C',root,...argv]);
  const saveState=change=>{const r=read(runPath);r.execution_control.advance??={};change(r.execution_control.advance,r);writeJson(root,runPath,r);};
  const activity=category=>{
    const r=read(runPath);if(['completed','abandoned','awaiting_final_review'].includes(r.status))return;
    if(r.execution_control.advance?.cost_events?.at(-1)?.category===category)return;
    saveState(s=>{s.cost_events??=[{at:r.execution_control.cost_window_start??r.started_at,category:'normal_ingest'}];if(s.cost_events.at(-1).category!==category)s.cost_events.push({at:new Date().toISOString(),category});});
  };
  const output=(type,id,detail={})=>{
    if(type!=='blocked')activity(detail.cost_category??(/repair/.test(id)?'content_repair':'normal_ingest'));
    return {type,task_id:id,run:runPath,status:read(runPath).status,...detail};
  };
  const local=p=>{const f=safe(root,p,false);if(!f.startsWith(safe(root,dir,false)+path.sep))throw Error('Execution slot must be run-local');return p;};
  const track=p=>saveState(s=>{s.outputs??=[];if(!s.outputs.includes(p))s.outputs.push(p);});
  const put=(p,value)=>{writeJson(root,local(p),value);track(p);return p;};
  function slot(id,inputs,payload,instruction,type='needs_review'){
    const identity=inputIdentity(root,inputs),file=`${dir}/work/${id}-${identity.slice(0,16)}.json`;
    if(!exists(file))put(file,{state:'pending',payload});
    const form=read(file);
    if(form.state!=='ready')return {wait:output(type,id,{input_identity:identity,inputs,response_path:file,instruction})};
    return {value:form.payload,file,identity};
  }
  function materialize(stage,payload){return put(`${dir}/semantic-${stage}.json`,payload);}
  function seal(stage,semantic){
    const r=read(runPath),section=read(r.package_data.path).sections[stage],packagePath=`${dir}/package-${stage}.md`;
    if(section.status!=='sealed')control('seal-package-section',['-Package',stage,'-SemanticDataPath',semantic]);
    if(!exists(packagePath))control('render-package',['-Package',stage,'-OutputPath',packagePath]);
    if(!read(runPath).packages[stage])control('record-package',['-Package',stage,'-PackagePath',packagePath]);
    track(packagePath);
  }
  function checkpoint(stage,paths){
    paths=[...new Set(paths)].filter(exists);
    const staged=git('diff','--cached','--name-only','-z').split('\0').filter(Boolean);
    if(staged.some(p=>!paths.includes(p)))throw Error('Unrelated index entries; preserve them and isolate the task commit');
    if(paths.length)git('add','--',...paths);
    if(git('diff','--cached','--name-only').trim())commitMessage(root,`feat(knowledge): ${read(runPath).batch_id} ${stage}`,exec,shell);
    return git('rev-parse','HEAD');
  }
  function task(stage,outputs,instructions){
    const key=sha(JSON.stringify([stage,outputs,instructions])).slice(0,16),p=`${dir}/tasks/${key}.json`;
    if(!exists(p))put(p,{stage,outputs,instructions});return p;
  }
  function send(taskPath,writer){
    const run=read(runPath),s=run.execution_control;
    const existing=s.dispatches.find(d=>d.task===taskPath);
    // A repair may become ready while the same writer is on the next article.
    // Keep one active host turn; never interrupt it or enqueue a second prompt.
    const active=s.dispatches.filter(d=>d.agent_id===writer.agent_id&&!s.deliveries.some(x=>x.dispatch_id===d.id)&&exists(`${dir}/work/host-${d.id}.json`)&&!read(`${dir}/work/host-${d.id}.json`).payload.completed);
    if(active.length>1)throw Error('Multiple outstanding writer turns; reconcile actual host completion before dispatch');
    if(active.length&&active[0].task!==taskPath)return send(active[0].task,writer);
    const dispatch=existing??pipeline(root,'dispatch',{run:runPath,agent:writer.agent_id,task:taskPath});
    if(s.deliveries?.some(d=>d.dispatch_id===dispatch.id))return null;
    const responsePath=`${dir}/work/host-${dispatch.id}.json`;
    if(!exists(responsePath))put(responsePath,{state:'pending',payload:{sent:false,completed:false}});
    const event=read(responsePath).payload;
    if(event.completed===true)return dispatch;
    const preflight=dispatch.preflight??['node',safe(root,checks+'ingest-runtime-contract.mjs'),'agent-preflight','--run',safe(root,runPath),'--agent',writer.agent_id,'--turn-started-at',dispatch.dispatched_at];
    const prompt=dispatch.prompt??`Read task ${safe(root,taskPath)}. Run the supplied preflight first. Write only assigned outputs; finish this turn and return exact paths.`;
    const message=dispatchMessage(preflight,prompt);
    return {wait:output(event.sent?'waiting_agent':'needs_agent',dispatch.id,{
      agent_id:writer.agent_id,inputs:[taskPath],response_path:responsePath,
      preflight,prompt,message,host_dispatch:taskDispatch(s.task_session_bindings?.writer,s.writer_config,message),cost_category:read(taskPath).repair_of?'content_repair':'normal_ingest',
      instruction:'Send message verbatim exactly once, set sent=true after host acknowledgement; use bounded host wait. Set completed=true only after host completion. Do not interrupt for elapsed time or unchanged output files; interrupt only for concrete wrong direction, scope violation or host failure. Do not end the parent task merely because the child is running.'})};
  }
  function writerFor(run){return run.execution_control.agent_sessions.find(s=>s.role==='content_writer'&&s.status==='active');}
  function repair(stage,target,evidence,writer,semantic,item){
    const choice=slot('repair-'+sha(evidence).slice(0,12),[evidence],{action:'',instructions:''},'Read the complete findings once. Choose content (original writer repairs), ledger (Raw review evidence only; not content), or dispute (needs further decision); explain every required correction.','needs_decision');
    if(choice.wait)return choice.wait;
    if(!nonempty(choice.value.instructions))throw Error('Repair requires concrete findings and scope');
    if(choice.value.action==='ledger'&&stage==='stage1')return null;
    if(choice.value.action!=='content')return output('needs_decision','unresolved-review',{inputs:[evidence],response_path:choice.file,instruction:'Resolve the remaining semantic dispute without fabricating PASS. Further authority is required for any escalation outside the agreed scope.'});
    const key=sha(evidence).slice(0,16),p=`${dir}/tasks/repair-${key}.json`;
    if(!exists(p)){
      const previous=read(runPath).execution_control.dispatches.filter(d=>d.outputs.includes(target)&&read(d.task).repair_of);
      if(previous.length>=2)return output('needs_decision','repair-limit',{inputs:[evidence],instruction:'Two substantive repairs exhausted; retain evidence and resolve the remaining disagreement.'});
      if(!writer)throw Error('Repair requires the original active content writer');
      const backup=`${dir}/repairs/${key}.md`,bytes=fs.readFileSync(safe(root,target));
      fs.mkdirSync(path.dirname(safe(root,backup,false)),{recursive:true});
      if(!exists(backup))fs.writeFileSync(safe(root,backup,false),bytes,{flag:'wx'});track(backup);
      put(p,{stage,outputs:[target],repair_of:evidence,prior_sha256:sha(bytes),backup,instructions:`Repair only ${item?item.body:target}. Read source and findings ${evidence}. ${choice.value.instructions} Preserve all correct content and source boundaries. Do not write review decisions or state.`});
    }
    const sent=send(p,writer);if(sent?.wait)return sent.wait;
    if(sent){if(item)assembleRaw(root,{...item,source:item.source,repairExpectedSha256:read(p).prior_sha256});pipeline(root,'deliver',{run:runPath,agent:writer.agent_id,dispatch:sent.id,semantic,shell,sessions:args.sessions});}
    return null;
  }
  let operation='inspect';
  const failurePaths=()=>[...new Set([...ownedPaths(root,runPath),...read(runPath).items,...(read(runPath).artifacts??[]).filter(a=>a.path).map(a=>a.path),...fs.readdirSync(safe(root,checks,false)).filter(p=>/\.(mjs|ps1)$/.test(p)).map(p=>checks+p),...fs.readdirSync(safe(root,'wiki',false)).filter(p=>p.endsWith('.md')).map(p=>'wiki/'+p)])];
  const failureIdentity=()=>sha(JSON.stringify([inputIdentity(root,failurePaths()),git('rev-parse','HEAD'),git('diff','--cached','--raw'),args.sessions??'',args.shell??'']));
  try{
    let run=read(runPath);
    if(!consolidated(run))return output('blocked','profile',{reason:'advance requires the explicit consolidated-v1 execution profile; historical runs use their original entry point'});
    if(run.review_policy!=='deferred')return output('blocked','review-policy',{reason:'This execution profile is for automatic deferred batches; standard interactive gates retain their original contract'});
    if(run.status==='abandoned')return output('blocked','terminal',{reason:'Abandoned history is read-only'});
    const failureFile=`${dir}/advance-error.json`;
    if(exists(failureFile)&&!args.retry&&!['completed','awaiting_final_review'].includes(run.status)){
      const failure=read(failureFile);
      if(failure.input_identity===failureIdentity())return output('blocked',failure.operation,{reason:failure.error,log_path:failureFile,retry_suppressed:true,next_action:'The same inputs already failed. Diagnose and change the affected input; after an environment-only repair pass -Reason with the actual repair before retrying.'});
    }
    if(run.status==='awaiting_final_review'){
      operation='final-approval';
      if(!args.approved){control('verify-final-review');return output('awaiting_final_review','approval',{report:run.final_review.path,sha256:run.final_review.sha256});}
      if(!/^[0-9a-f]{64}$/i.test(args.approved))throw Error('Exact user-approved SHA256 required');
      ps('finalize-ingest-stage3.ps1',['-Phase','Finish','-RunPath',runPath,'-ApprovedHash',args.approved,'-ParentSessionId',run.execution_control.parent_reviewer.agent_id,...(args.sessions?['-HostSessionRoot',args.sessions]:[])]);
      run=read(runPath);
    }
    if(run.status==='completed'){
      const rereadState=run.execution_control.post_ingest_reread?.enabled?postRereadPath(run):null;
      if(rereadState&&exists(rereadState))return advancePostReread(root,{state:rereadState,parent:args.parent,sessions:args.sessions});
      operation='closure';
      let plan=closePlan(root,runPath);
      // Persist the authorized exit scope BEFORE committing. A resumed closure
      // has no dirty paths; deriving scope from that empty list loses evidence.
      const exitScope=[...new Set([runPath,`${dir}/final-review.md`,`${dir}/final-review-content.json`,`${dir}/diffs`,`${dir}/lifecycle-timing.json`,`${dir}/cost-final.json`,'system/maintenance/ingest-runs/index.json','system/registry/ingest-auto-review-state.json','NOW.md','system/registry/KNOWLEDGE_STATUS.md',...(run.execution_control.advance?.exit_scope??[]),...plan.stage_paths])];
      if(plan.stage_paths.length){saveState(s=>{s.exit_scope=exitScope;});plan=closePlan(root,runPath);}
      if(plan.stage_paths.length)checkpoint('close',plan.stage_paths);
      const retrievalMaintenance=afterReviewedCommit(root,{run:runPath});
      // One task-specific edge per direct parent; unrelated index entries stop only closure.
      let child=root,parent=committedParent(child);
      const chain=[{path:root,scope:exitScope,gitlink_path:parent?.gitlink_path}];
      while(parent){
        const pg=(...a)=>exec('git',['-c',`safe.directory=${parent.path.replaceAll('\\','/')}`,'-c','core.excludesFile=','-C',parent.path,...a]);
        const actual=exec('git',['-c',`safe.directory=${child.replaceAll('\\','/')}`,'-C',child,'rev-parse','HEAD']);
        if(parent.committed_child!==actual){
          const staged=pg('diff','--cached','--name-only','-z').split('\0').filter(Boolean);
          if(staged.some(p=>p!==parent.gitlink_path))throw Error('Unrelated parent index entries; task gitlink closure is pending');
          pg('add','--',parent.gitlink_path);commitMessage(parent.path,`chore(knowledge): close ${run.batch_id} gitlink`,exec,shell);
          if(committedParent(child)?.committed_child!==actual)throw Error('Parent committed edge mismatch');
        }
        const link=parent.gitlink_path;
        child=parent.path;parent=committedParent(child);chain.push({path:child,scope:[link],gitlink_path:parent?.gitlink_path});
      }
      plan=closePlan(root,runPath);
      if(!plan.git_closed)throw Error('Content completed but Git closure remains pending: '+JSON.stringify({stage_paths:plan.stage_paths,unclassified_run_paths:plan.unclassified_run_paths,parent:plan.parent}));
      const closure=verifyWorkspaceClosure(root,chain,exec,shell);
      const cost=ps('finalize-ingest-stage3.ps1',['-Phase','CostsSnapshot','-RunPath',runPath,...(args.sessions?['-HostSessionRoot',args.sessions]:[])]);
      if(rereadState)return {...preparePostReread(root,{run:runPath,parent:args.parent,sessions:args.sessions}),ingest_closed:true,original_workspace_closure:closure,cost_snapshot:JSON.parse(cost)};
      return output('closed','closed',{head:plan.head,parent:plan.parent,workspace_closure:closure,retrieval_maintenance:retrievalMaintenance,cost_snapshot:JSON.parse(cost)});
    }
    if(!run.execution_control.parent_reviewer){operation='bind-parent';pipeline(root,'bind-parent',{run:runPath,parent:args.parent,sessions:args.sessions});run=read(runPath);}
    if(run.semantic_review_mode&&run.semantic_review_mode!=='disabled')return output('needs_decision','precision',{instruction:'This batch explicitly requests additional precision review. Complete that existing review contract; advance never disables it.'});
    for(let iteration=0;iteration<64;iteration++){
      run=read(runPath);const state=run.execution_control,data=read(run.package_data.path);
      if(run.status==='stage2_planned'&&data.sections.stage3.status==='sealed'){
        // A successful Seal may already have been committed before Review failed.
        // Reuse that exact checkpoint only when its worktree/index scope is clean
        // and the recorded maintenance receipt verifies against HEAD.
        operation='resume-sealed';
        const paths=stagePaths(root,runPath,data.sections.stage3.semantic);
        const staged=git('diff','--cached','--name-only','-z').split('\0').filter(Boolean);
        const dirty=git('status','--porcelain','-z','--',...paths).split('\0').filter(Boolean);
        let revision=null;
        const head=git('rev-parse','HEAD');
        if(!staged.length&&!dirty.length&&head!==run.commits.stage1&&run.packages.stage3&&run.packages.gate_audit&&run.packages.maintenance){
          git('merge-base','--is-ancestor',run.commits.stage1,head);
          node('ingest-maintenance-scope.mjs',['--root',root,'--receipt',run.packages.maintenance.path,'--revision',head]);
          revision=head;
        }
        if(!revision){
          const sealArgs=['-Phase','Seal','-RunPath',runPath,'-Stage1Revision',run.commits.stage1,'-Stage3SemanticPath',state.advance.current_semantic,'-GateAuditSemanticPath',`${dir}/semantic-gate-audit.json`,'-ParentSessionId',state.parent_reviewer.agent_id];
          if(run.packages.maintenance?.path)sealArgs.push('-MaintenancePath',run.packages.maintenance.path);
          if(args.sessions)sealArgs.push('-HostSessionRoot',args.sessions);
          ps('finalize-ingest-stage3.ps1',sealArgs);
          revision=checkpoint('wiki checkpoint',paths);
        }
        ps('finalize-ingest-stage3.ps1',['-Phase','Review','-RunPath',runPath,'-Stage3Revision',revision,...(args.sessions?['-HostSessionRoot',args.sessions]:[])]);
        const ready=read(runPath);return output('awaiting_final_review','approval',{report:ready.final_review.path,sha256:ready.final_review.sha256});
      }
      if(run.status==='running_scoring'){
        operation='scoring';
        if(!run.packages.scoring){
          const template={...emptySemantic(),rows:run.items.map(source=>({source,A1:null,A2:null,A3:null,B1:null,B2:null,decision:'',confidence:'',evidence:'',...(streamlined(run)?{source_decision:sourceDecision(source),wiki_coverage:{summary:'',candidates:[]}}:{})}))};
          const choice=slot('scoring',[...run.items,'system/protocols/SCORING_SYSTEM.md',...(streamlined(run)?[...wikiPaths(root),'system/registry/raw-list.md','system/registry/quick-reference.md']:[])],template,'Read complete sources, scoring rules and actual candidate Wiki sections. Fill evidence, component scores and decision. '+(streamlined(run)?'In this same response choose ingest/conditional/skip, fill source_decision once and wiki_coverage {summary,candidates:[{path,heading,assessment}]} with existing/new/uncertain coverage. Totals, disposition and verdict are generated; this is not Raw approval. ':'')+'Set state=ready; total is generated.');if(choice.wait)return choice.wait;
          for(const row of choice.value.rows){if([row.A1,row.A2,row.A3,row.B1,row.B2].some(x=>x===null||x===''||!Number.isFinite(Number(x))))throw Error('Scoring components require real judgments');row.total=String(Math.round(((+row.A1 + +row.A2)*+row.A3 + +row.B1 + +row.B2+Number.EPSILON)*10)/10);}
          if(streamlined(run)){const sources=scoringSources(root,run,choice.value);saveState(s=>{s.scored_sources=sources;});}
          seal('scoring',materialize('scoring',choice.value));continue;
        }
        operation='source-registration';
        if(!state.advance?.sources){
          const bodyRows=prepareWriter(root,runPath).outputs;
          const payload=run.items.map(source=>({source,disposition:'',raw_name:'',type:'',ingest_verdict:'',domains:[],registration:{category:'',source:'',keywords:'',summary:'',unconsumed:''},content_summary:'',skip_reason:''}));
          const answer=streamlined(run)?{value:state.advance?.scored_sources}:slot('source-decisions',[...run.items,run.packages.scoring.path],payload,'Confirm ingested/skipped, exact existing domains and one registration description per source. For every skipped source provide its publisher/source and concrete skip_reason based on scoring. Preserve source metadata. This does not approve Raw content.','needs_decision');if(answer.wait)return answer.wait;
          if(!Array.isArray(answer.value))throw Error('Bound scoring/source decision missing; do not invent a replacement');
          if(answer.value.length!==run.items.length||run.items.some(p=>answer.value.filter(r=>r.source===p).length!==1))throw Error('Source decisions must cover exact inputs once');
          const sources=answer.value.map((r,i)=>{
            if(!['ingested','skipped'].includes(r.disposition))throw Error('Explicit ingested/skipped source decision required');
            const n=String(run.items.indexOf(r.source)+1).padStart(2,'0'),output='raw-sources/'+r.raw_name,header=`${dir}/raw-headers/${n}.md`,manifest=`${dir}/source-manifests/${n}.json`;
            const body=path.relative(root,bodyRows.find(x=>x.source===safe(root,r.source)).body).split(path.sep).join('/');
            if(r.disposition==='ingested'){
              if(!/^[^<>:"/\\|?*]+\.md$/.test(r.raw_name??'')||/^README\.md$/i.test(r.raw_name)||/\.template\.md$/i.test(r.raw_name))throw Error('Choose a Raw basename using the source title, publisher and date naming contract');
              if(exists(output))throw Error('Raw output already exists; resolve source identity before dispatch: '+output);
              if(!r.domains?.length)throw Error('Exact domain choices required');
              for(const d of r.domains)if(typeof d!=='string'||!exists(`domains/${d}.md`)||d==='README')throw Error('Unknown domain before writing: '+d);
              const original=splitRaw(fs.readFileSync(safe(root,r.source),'utf8'));
              const fields=Object.values(original.fields);if(!original.fields.domains)fields.push('domains: '+JSON.stringify(r.domains));
              if(!original.fields.source_url){
                if(!original.fields.source)throw Error('Source URL is absent from clipping: '+r.source);
                fields.push(original.fields.source.replace(/^source:/,'source_url:'));
              }
              if(!original.fields.date){
                const published=fs.readFileSync(safe(root,r.source),'utf8').match(/\*(\d{4})年(\d{1,2})月(\d{1,2})日\s+\d{1,2}:\d{2}\*/);
                if(!published)throw Error('Published date requires a source-backed decision: '+r.source);
                fields.push(`date: ${published[1]}-${published[2].padStart(2,'0')}-${published[3].padStart(2,'0')}`);
              }
              if(!original.fields.source_clipping)fields.push('source_clipping: '+JSON.stringify(`[[${r.source.slice(0,-3)}]]`));
              if(!original.fields.type){if(!['article','video','paper','book'].includes(r.type))throw Error('Source type requires a semantic choice');fields.push('type: '+r.type);}
              if(!original.fields.ingest_verdict){if(!['pass','conditional'].includes(r.ingest_verdict))throw Error('Explicit pass/conditional ingest verdict required');fields.push('ingest_verdict: '+r.ingest_verdict);}
              if(!original.fields.ingest_score){const scored=data.sections.scoring.semantic.rows.find(s=>s.source===r.source),total=scoreRows(data.sections.scoring.semantic).find(s=>s.source===r.source);fields.push(`ingest_score:\n  info_density: ${Number(scored.A1)}\n  argument_quality: ${Number(scored.A2)}\n  time_resistance: ${Number(scored.A3)}\n  intrinsic_total: ${total.intrinsic_total}`);}
              if(!exists(manifest))ps('source-content-audit.ps1',['-Action','manifest','-SourcePath',r.source,'-ManifestPath',manifest]);track(manifest);
              const bytes='---\n'+fields.join('\n')+'\n---\n';fs.mkdirSync(path.dirname(safe(root,header,false)),{recursive:true});
              if(exists(header)&&fs.readFileSync(safe(root,header),'utf8')!==bytes)throw Error('Header draft differs; explicit correction required');
              if(!exists(header))fs.writeFileSync(safe(root,header,false),bytes,{flag:'wx'});track(header);track(body);
            }
            return {...r,output,header,body,manifest};
          });
          saveState(a=>{a.sources=sources;});continue;
        }
        const sources=state.advance.sources;
        if(sources.some(s=>s.disposition==='skipped'))syncSkippedSources(root,run,sources);
        const context=`${dir}/context-stage1.json`;
        if(!exists(context)){control('prepare-context',['-Package','stage1','-OutputPath',context]);track(context);}
        for(const [i,item] of sources.entries())if(!run.artifacts.some(a=>a.kind==='input'&&a.input_item===item.source))control('record-artifact',['-ArtifactKind','input','-Disposition',item.disposition,'-InputItemIndex',String(run.items.indexOf(item.source))]);
        const rows=sources.filter(s=>s.disposition==='ingested');
        if(!rows.length)return output('needs_decision','all-skipped',{instruction:'All sources are skipped. Preserve scoring; use the explicit no-ingest/abandon contract, not fabricated Raw output.'});
        let writer=writerFor(read(runPath));
        if(!writer){
          operation='writer-binding';const key='content-writer';
          let reservation=read(runPath).execution_control.agent_sessions.find(x=>x.session_key===key);
          const writerConfig=run.execution_control.writer_config??{model:'gpt-5.6-luna',reasoning_effort:'max'};
          if(!reservation){control('reserve-agent-session',['-SessionKey',key,'-AgentRole','content_writer','-Model',writerConfig.model,'-ReasoningEffort',writerConfig.reasoning_effort,'-Purpose','Write assigned Raw and Wiki prose only']);reservation=read(runPath).execution_control.agent_sessions.find(x=>x.session_key===key);}
          if(reservation.status!=='reserved')throw Error('Writer is terminal; explicit writer recovery required, do not create an untracked replacement');
          const bound=run.execution_control.task_session_bindings?.writer;
          if(bound){control('bind-agent-session',['-SessionKey',key,'-AgentId',bound.thread_id]);continue;}
          const bind=slot('writer-identity',[],{agent_id:''},`Create exactly one ${writerConfig.model}/${writerConfig.reasoning_effort} content writer without full parent history. Return the actual host agent ID; do not invent it.`,'needs_agent');if(bind.wait)return bind.wait;
          control('bind-agent-session',['-SessionKey',key,'-AgentId',bind.value.agent_id]);continue;
        }
        // Dispatch the next unstarted article before reviewing the preceding delivery.
        for(const item of rows){
          const p=task('stage1',[item.output],`Read complete ${item.source}, source/media inventory ${item.manifest}, and the writing rules/style sample listed in ${context}. Reliably inspect required media or disclose unreadable information; never invent image contents. Write ONLY ${item.body}; preserve full reasoning and source locators. Do not edit headers, Raw, state or reports.`);
          if(!read(runPath).execution_control.dispatches.some(d=>d.task===p)){
            operation='raw-dispatch';const dispatched=send(p,writer);return dispatched.wait;
          }
          const d=read(runPath).execution_control.dispatches.find(d=>d.task===p);
          if(!read(runPath).execution_control.deliveries.some(x=>x.dispatch_id===d.id)){
            const event=read(`${dir}/work/host-${d.id}.json`).payload;
            if(!event.completed)break;
            operation='raw-delivery';assembleRaw(root,{...item,source:item.source,reuse:true});
            if(!read(runPath).artifacts.some(a=>a.kind==='raw'&&a.path===item.output))control('record-artifact',['-ArtifactKind','raw','-Disposition','ingested','-ArtifactPath',item.output]);
            pipeline(root,'deliver',{run:runPath,agent:writer.agent_id,dispatch:d.id,sessions:args.sessions});
          }
        }
        for(const item of rows){
          run=read(runPath);
          if(run.content_audits.some(a=>a.raw_path===item.output))continue;
          if(!run.execution_control.deliveries.some(d=>d.outputs.some(o=>o.path===item.output)))continue;
          operation='raw-review';
          let attempt=run.execution_control.core_review_attempts?.find(a=>a.raw_path===item.output);
          if(attempt?.status==='failed'&&attempt.raw_sha256===sha(fs.readFileSync(safe(root,item.output)))){
            const pending=repair('stage1',item.output,attempt.receipt_path,writer,null,item);if(pending)return pending;
          }
          const bundle=`${dir}/raw-review-${sha(item.output).slice(0,12)}-${inputIdentity(root,[item.source,item.output]).slice(0,12)}-${attempt?.status==='failed'?(attempt.round??1):0}.json`;
          if(!exists(bundle)){prepareBundle(root,{run:runPath,source:item.source,raw:item.output,agent:state.parent_reviewer.agent_id,output:bundle});track(bundle);}
          const answer=slot('review-'+sha(bundle).slice(0,12),[item.source,item.output],{completed:false},`Read complete source first and derive its necessary argument skeleton before checking the writer prose. Then read complete Raw in both directions, independently look for ledger-external omissions and unsupported additions; compare numbers with objects/units/conditions, quantifier strength, attribution, and each necessary case's mechanism and argumentative role. Fill ${bundle} claims, source_selection/raw_selection {start_line,end_line} on one-based inclusive full-file lines and decisions; compiler extracts exact evidence. ${streamlined(run)?'Fill presentation with the actual reviewed summary, writing skeleton, coverage, boundary and disposition during this same read. ':''}Legacy exact quotes also work. Then set completed=true and state=ready. Never substitute a summary or automatic PASS.`);if(answer.wait)return {...answer.wait,review_path:bundle};
          if(!answer.value.completed)throw Error('Actual Raw review completion required');
          if(streamlined(run)){
            requirePresentation(read(bundle).presentation);
            saveState(s=>{s.raw_presentations??={};s.raw_presentations[item.output]={bundle,bundle_sha256:sha(fs.readFileSync(safe(root,bundle)))};});
          }
          try{reviewRow(root,runPath,{bundle,agent:state.parent_reviewer.agent_id,log:findReviewerLog(state.parent_reviewer.agent_id,args.sessions)});}
          catch(error){const failed=read(runPath).execution_control.core_review_attempts?.find(a=>a.raw_path===item.output);if(failed?.status!=='failed')throw error;const pending=repair('stage1',item.output,failed.receipt_path,writer,null,item);if(pending)return pending;continue;}
        }
        run=read(runPath);
        if(rows.some(r=>!run.content_audits.some(a=>a.raw_path===r.output))){
          const d=run.execution_control.dispatches.find(d=>!run.execution_control.deliveries.some(x=>x.dispatch_id===d.id));return send(d.task,writer).wait;
        }
        operation='stage1-package';
        const answer=streamlined(run)?{value:reviewedRawSemantic(root,run,rows)}:slot('stage1-summary',rows.map(r=>r.output),{...emptySemantic(),rows:rows.map(r=>({raw:r.output,content_summary:r.content_summary,writing_skeleton:'',coverage:'',boundary:'',disposition:''}))},'Describe actual reviewed Raw content and source boundaries; do not re-review unchanged source. Set state=ready.');if(answer.wait)return answer.wait;
        if(!read(runPath).execution_control.writer_stages.stage1)control('record-writer-stage',['-Package','stage1','-AgentIds',writer.agent_id]);
        seal('stage1',materialize('stage1',answer.value));
        for(const source of run.items)if(!exists(source))throw Error('Missing Stage1 source: '+source);
        const revision=checkpoint('raw checkpoint',[...ownedPaths(root,runPath),...run.items,...rows.map(r=>r.output),...(sources.some(s=>s.disposition==='skipped')?['system/registry/skipped-sources.md']:[]),'system/registry/ingest-auto-review-state.json']);
        control('check-stage1',['-Stage1Revision',revision]);continue;
      }
      if(run.status==='stage1_committed'){
        operation='wiki-plan';const inventory=consumptionInventory(root,run);
        const reuse=streamlined(run)?coverageReuse(root,state.advance.sources):[];
        const answer=slot('wiki-plan',[...run.artifacts.filter(a=>a.kind==='raw').map(a=>a.path),...(streamlined(run)?[...reuse.flatMap(r=>r.candidates.map(c=>c.path)),...run.content_audits.map(a=>a.path),run.packages.scoring.path,'system/registry/quick-reference.md']:[])],{...emptySemantic(),consumption:inventory.map(i=>({raw:i.raw,ledger:i.ledger,risks:[],coverage_reason:'',decisions:i.units.map(u=>({claim_ids:[u.id],disposition:'',reason:'',must_preserve:[],destinations:[]}))}))},(streamlined(run)?'Reuse the accepted complete Raw review and unchanged B1 Wiki coverage below; reread changed/new sections and any missing necessary context, not every unchanged input. The source-derived ledger is not an upper bound on omissions. ':'Read complete Raw and candidate Wiki context. ')+'Map every claim to planned/existing/deferred/not_applicable with exact headings, reasons and must_preserve. No page quota. Structural changes require their separate authority.');if(answer.wait)return {...answer.wait,inventory,...(streamlined(run)?{coverage_reuse:reuse}:{})};
        seal('stage2',materialize('stage2',answer.value));control('check-stage2');continue;
      }
      if(run.status==='stage2_planned'){
        operation='wiki-work';
        let semanticPath=state.advance?.current_semantic;
        if(!semanticPath){
          const planned=structuredClone(data.sections.stage2.semantic),pages=[...new Set(planned.consumption.flatMap(r=>r.decisions.filter(d=>d.disposition==='planned').flatMap(d=>d.destinations.map(t=>t.path))))].sort();
          const semantic={...planned,rows:pages.map(artifact=>({artifact,knowledge_summary:'',source_boundary:'',disposition:'',verification:''})),splits:planned.splits??[]};
          semanticPath=materialize('stage3',semantic);saveState(s=>{s.current_semantic=semanticPath;});
        }
        let semantic=read(semanticPath);
        // Proposals and Group Candidates are reportable observations, not writes
        // or authority. Only actual non-Wiki outputs require another adapter.
        if(semantic.rows.some(r=>!r.artifact.startsWith('wiki/')))return output('needs_decision','structure-contract',{inputs:[semanticPath,'system/maintenance/checklists/ingest-stage-gates.md'],instruction:'Apply the explicit Domain/structure authorization and review contract before returning. This is not a normal Wiki-only delivery; advance does not approve structural changes.'});
        for(const request of semantic.structure_change_requests??[]){
          if(['proposed','candidate','deferred'].includes(request.status))continue;
          if(request.status!=='approved'||request.kind!=='wiki_split')return output('needs_decision','structure-contract',{inputs:[semanticPath,'system/integrations/DOMAIN_PRINCIPLES.md'],instruction:'An approved Domain, shared-principle or Group structural write needs its separate authorization and review contract. Resolve it explicitly; do not present a Wiki-only PASS as execution.'});
          if(!nonempty(request.authorization)||!nonempty(request.plan_path)||!request.plan_path.startsWith(dir+'/')||!exists(request.plan_path))return output('needs_decision','split-plan',{inputs:[semanticPath,'system/maintenance/checklists/verify-wiki-split.ps1'],instruction:'Approved split requires the user authorization reference and an actual run-local split plan before writing.'});
        }
        const writer=writerFor(run);
        for(const row of semantic.rows){
          const affected=semantic.consumption.filter(r=>r.decisions.some(d=>d.destinations?.some(t=>t.path===row.artifact)));
          const p=task('stage3',[row.artifact],`Read complete related Raw ${affected.map(r=>r.raw).join(', ')} and existing target ${row.artifact}. Apply only approved plan in ${run.package_data.path} to this page. Preserve must_preserve and attribution. Do not edit other pages, reports or state.`);
          const dispatch=read(runPath).execution_control.dispatches.find(d=>d.task===p);
          if(!dispatch){if(!writer)throw Error('Same content writer must remain active');return send(p,writer).wait;}
          if(!read(runPath).execution_control.deliveries.some(d=>d.dispatch_id===dispatch.id)){
            const event=read(`${dir}/work/host-${dispatch.id}.json`).payload;if(!event.completed)break;
            if(!writer)throw Error('Writer inactive before delivery');
            pipeline(root,'deliver',{run:runPath,agent:writer.agent_id,dispatch:dispatch.id,semantic:semanticPath,shell,sessions:args.sessions});
          }
        }
        run=read(runPath);
        const outstanding=[...new Map(run.execution_control.page_reviews.map(t=>[t.page,t])).values()].filter(t=>t.status==='pending');
        for(const review of outstanding){
          const report=read(review.report_path);
          if(report.status==='failed'){
            const pending=repair('stage3',review.page,review.report_path,writer,semanticPath);if(pending)return pending;
            return output('needs_review','repaired-page',{response_paths:read(runPath).execution_control.page_reviews.filter(t=>t.page===review.page&&t.report_path!==review.report_path&&t.status==='pending').map(t=>t.report_path),instruction:'Read the repaired page and original findings; fill the current blank report, never copy the old PASS.'});
          }
          if(report.status!=='passed')return output('needs_review','page-'+sha(review.page).slice(0,12),{inputs:report.input_hashes.map(x=>x.path),response_path:review.report_path,instruction:report.instruction});
          pipeline(root,'record-page-review',{run:runPath,semantic:semanticPath,report:review.report_path});
        }
        run=read(runPath);
        const waiting=run.execution_control.dispatches.find(d=>d.stage==='stage3'&&!run.execution_control.deliveries.some(x=>x.dispatch_id===d.id));if(waiting)return send(waiting.task,writer).wait;
        operation='final-consumption';
        const candidates=consumptionCandidates(root,run,semantic);
        const finalize=streamlined(run)?{file:'generated-consumption-candidates-v2',value:candidates.semantic}:slot('consumption-final',[...semantic.rows.map(r=>r.artifact),...semantic.consumption.map(r=>r.raw),...run.execution_control.page_reviews.map(r=>r.report_path)],candidates.semantic,'Valid page reviews prefill absorbed candidates only. Check cross-page omissions, all remaining exceptions, and actual page summaries/boundaries once. Do not retype per-claim status or evidence already valid. No automatic aggregate PASS. Set state=ready.');if(finalize.wait)return {...finalize.wait,exceptions:candidates.exceptions};
        const canonical=`${dir}/semantic-stage3-final.json`;
        if(!exists(canonical)||read(runPath).execution_control.advance.final_slot!==finalize.file){put(canonical,finalize.value);saveState(s=>{s.current_semantic=canonical;s.final_slot=finalize.file;});semanticPath=canonical;}
        else semanticPath=canonical;
        const registration=`${dir}/registration.json`;
        if(!exists(registration))put(registration,{rows:(state.advance.sources??[]).filter(s=>s.disposition==='ingested').map(s=>({raw:s.output,...s.registration}))});
        operation='stage3-prepare';const prepared=prepareStage3(root,{run:runPath,semantic:semanticPath,shell,registration});
        if(prepared.status!=='prepared')return output('needs_decision','registration',{response_path:registration,...prepared});
        semanticPath=prepared.semantic_path;
        if(prepared.pending_reports.length)return output('needs_review','affected-pages',{response_paths:prepared.pending_reports,instruction:'Review only these current pages; set actual report status and evidence. advance records them.'});
        const diagnosis=diagnoseConsumption(root,read(runPath),read(semanticPath),'stage3',{requireReview:false});
        if(diagnosis.status==='failed')return output('needs_decision','consumption-errors',{response_path:canonical,errors:diagnosis.errors,instruction:'Correct actual semantic decisions; do not change hashes or mark checks passed.'});
        operation='capacity-decision';
        const currentRisks=capacityRows(root,read(semanticPath).rows.map(row=>row.artifact));
        const capacityIdentity=inputIdentity(root,currentRisks.map(row=>row.page));
        if(currentRisks.length&&read(runPath).execution_control.advance.capacity_identity!==capacityIdentity){
          const answer=slot('capacity',[...currentRisks.map(row=>row.page),'wiki/README.md'],{rows:currentRisks.map(row=>({...row,action:'',reason:'',review_when:'',conditions_unchanged:null,rules_and_trigger_checked:null,context_check:''}))},'Use already reviewed changed prose and previous_defer. Reuse only if current rules, prior review_when (including dates/new-source triggers), and topic boundaries are still satisfied: action=reuse, conditions_unchanged=true, rules_and_trigger_checked=true, context_check explains the delta. Never reinterpret an already-triggered condition as unchanged. Otherwise expand to full relevant page and decide defer/split with a concrete reason and review_when. Reuse retains the capacity risk; split still requires authorization and approved plan. Set state=ready.','needs_decision');
          if(answer.wait)return answer.wait;
          recordCapacityDecision(root,currentRisks,answer.value.rows,read(semanticPath));
          ps('sync-capacity-risks.ps1',['-Mode','Sync']);
          saveState(state=>{state.capacity_identity=capacityIdentity;state.capacity_slot=answer.file;});
        }
        operation='structure-verify';
        const structural=verifyStructureRequests(root,read(runPath),read(semanticPath),{shell});
        if(structural.status!=='passed')return output('needs_decision','structure-contract',{inputs:[semanticPath],...structural});
        if(structural.reports.length){
          const verified=read(semanticPath);
          for(const report of structural.reports){
            const request=verified.structure_change_requests.find(r=>r.plan_path===report.plan_path);
            request.verification_receipt=report.receipt;
            track(report.plan_path);track(report.receipt);
          }
          put(semanticPath,verified);
        }
        operation='aggregate';
        const pagesPath=put(`${dir}/page-reports.json`,prepared.reused_reports);
        const aggregateKey=sha(JSON.stringify([read(semanticPath).consumption,inputIdentity(root,prepared.reused_reports)]));
        const aggregate=`${dir}/aggregate-${aggregateKey.slice(0,16)}.json`;
        if(!exists(aggregate)){
          node('wiki-consumption.mjs',['prepare-review','--root',root,'--run',runPath,'--semantic',semanticPath,'--agent',state.parent_reviewer.agent_id,'--pages',pagesPath,'--output',aggregate]);track(aggregate);
          if(streamlined(run))put(aggregate,{...read(aggregate),...aggregatePresentation(read(semanticPath))});
        }
        if(read(aggregate).status!=='passed')return output('needs_review','aggregate',{inputs:[...new Set([canonical,semanticPath,...prepared.reused_reports])],response_path:aggregate,semantic_response_path:canonical,instruction:'Judge cross-page coverage, ledger-external omissions and exclusions once. Page PASS does not imply batch PASS. '+(streamlined(run)?'This is the sole final semantic entry: also fill page_summaries, exceptions and risks here. Consumption candidates are bookkeeping, not approval. To correct a disposition edit semantic_response_path (not the generated prepared semantic), then advance for a newly bound pending report. ':'')+'Fill actual status, findings and coverage_summary.'});
        const reviewed=streamlined(run)?projectAggregate(read(semanticPath),read(aggregate)):read(semanticPath);
        const bound=bindRiskReview(root,read(runPath),reviewed,aggregate,{log:findReviewerLog(state.parent_reviewer.agent_id,args.sessions)});put(canonical,bound);semanticPath=canonical;
        operation='backtests';
        const count=fs.readdirSync(safe(root,'raw-sources',false)).filter(p=>p.endsWith('.md')&&p!=='README.md'&&!p.endsWith('.template.md')).length;
        const anchors=JSON.parse(control('plan-backtests',['-BeforeCount',String(run.counts.before),'-AfterCount',String(count)]));
        const required=anchors.required_backtest_anchors??[];
        for(const anchor of required){
          if(!read(runPath).backtests.some(b=>b.anchor===anchor)){
            const receipt=`${dir}/backtest-${anchor}.json`;
            if(!exists(receipt))return output('needs_decision',`backtest-${anchor}`,{anchor,inputs:['system/maintenance/checklists/ingest-stage-gates.md','system/maintenance/checklists/ingest-local-execution.md'],response_path:receipt,instruction:'Complete the existing 30/6 backtest contract. First gather all six independent baseline findings, then give the writer one consolidated per-Raw repair brief; after actual changes use a different reviewer for bounded cross-targeted recheck and verify affected Wiki. For any resumed/replacement writer, verify the new turn with agent-preflight before editing; resume_agent cannot pin the model. Put the actual receipt at response_path; advance registers and validates it, never fabricates it.'});
            control('record-backtest',['-Anchor',String(anchor),'-EvidencePath',receipt]);
          }
        }
        const backtestInputs=[...read(runPath).backtests.map(b=>b.path??b.evidence_path).filter(Boolean),checks+'ingest-control.ps1'];
        const backtestIdentity=sha(JSON.stringify([run.counts.before,count,read(runPath).backtests,inputIdentity(root,backtestInputs)]));
        if(read(runPath).execution_control.advance.backtest_check!==backtestIdentity){
          control('check-backtests',['-AfterCount',String(count)]);
          saveState(s=>{s.backtest_check=backtestIdentity;});
        }
        operation='gate-summary';
        const gate=streamlined(run)?{value:gateProjection(read(canonical))}:slot('gate-summary',[canonical],emptySemantic(),'Record actual exceptions and unresolved risks only; do not manually copy counts/backtest outcomes. Set state=ready.');if(gate.wait)return gate.wait;
        const gatePath=materialize('gate-audit',gate.value);
        if(writer)control('close-agent-session',['-SessionKey',writer.session_key,'-SessionStatus','completed','-WorkOutcome','succeeded']);
        operation='seal';
        ps('finalize-ingest-stage3.ps1',['-Phase','Seal','-RunPath',runPath,'-Stage1Revision',run.commits.stage1,'-Stage3SemanticPath',canonical,'-GateAuditSemanticPath',gatePath,'-ParentSessionId',state.parent_reviewer.agent_id,...(args.sessions?['-HostSessionRoot',args.sessions]:[]),'-AgentIds',[...new Set(read(runPath).execution_control.deliveries.filter(d=>d.stage==='stage3').map(d=>d.agent_id))].join('|')]);
        const revision=checkpoint('wiki checkpoint',stagePaths(root,runPath,bound));
        ps('finalize-ingest-stage3.ps1',['-Phase','Review','-RunPath',runPath,'-Stage3Revision',revision,...(args.sessions?['-HostSessionRoot',args.sessions]:[])]);
        const done=read(runPath);return output('awaiting_final_review','approval',{report:done.final_review.path,sha256:done.final_review.sha256});
      }
      if(run.status==='stage3_completed'){
        ps('finalize-ingest-stage3.ps1',['-Phase','Review','-RunPath',runPath,...(args.sessions?['-HostSessionRoot',args.sessions]:[])]);
        const ready=read(runPath);return output('awaiting_final_review','approval',{report:ready.final_review.path,sha256:ready.final_review.sha256});
      }
      throw Error('Unsupported current state: '+run.status);
    }
    throw Error('No bounded progress; inspect state instead of looping');
  }catch(error){
    const detail=error.stderr?.toString()||error.message;
    const p=`${dir}/advance-error.json`;
    // Diagnostics are deliberately not auto-staged. Historical terminal runs stay read-only.
    if(!['completed','abandoned','awaiting_final_review'].includes(read(runPath).status)){
      activity('workflow_recovery');
      let identity;try{identity=failureIdentity();}catch{/* original error remains authoritative */}
      writeJson(root,p,{operation,error:detail,input_identity:identity});
    }
    return output('blocked',operation,{reason:detail,log_path:exists(p)?p:null,next_action:'Do not repeat unchanged failing inputs. Diagnose this operation; preserve valid work and resume the same run.'});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].slice(2)]=process.argv[i+1];const result=advance(args.root,args);console.log(JSON.stringify(result));if(result.type==='blocked')process.exitCode=2;}
  catch(error){console.error(error.message);process.exitCode=2;}
}
