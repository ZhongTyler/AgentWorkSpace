/** Optional post-Finish maintenance. Original run/approval evidence stays immutable. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {safe,sha,sourcePaths,styleCheck} from './raw-quality.mjs';
import {readJson,writeJson} from './ingest-execution-state.mjs';
import {agentPolicy,taskDispatch} from './ingest-agent-routing.mjs';
import {agentConfiguration,findReviewerLog} from './ingest-runtime-contract.mjs';
import {committedParent} from './ingest-close-plan.mjs';
import {collectSessionCost} from './ingest-session-cost.mjs';
const checklist='system/maintenance/checklists/';
const nonempty=x=>typeof x==='string'&&x.trim();
const hash=(root,p)=>sha(fs.readFileSync(safe(root,p)));
const git=(root,...args)=>execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const frontmatter=text=>text.replace(/^\uFEFF/,'').match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]??'';
export function postRereadPath(run){return `system/maintenance/post-ingest-rereads/${sha(run.batch_id+'\0'+run.final_review.sha256).slice(0,20)}/state.json`;}
function unchanged(root,state){for(const row of [...state.baseline,...(state.auxiliary??[])]){if(hash(root,row.path)!==row.sha256)throw Error('Post-reread baseline drift: '+row.path);if(hash(root,path.posix.dirname(state.worker_report)+'/before/'+row.path)!==row.sha256)throw Error('Preserved approval bytes changed: '+row.path);}}
function ledger(root,projection,pages,{registryOnly=false}={}){
 const env={...process.env};for(const k of Object.keys(env))if(k.toLowerCase()==='psmodulepath')delete env[k];
 const shell=process.platform==='win32'?path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
 return JSON.parse(execFileSync(shell,['-NoProfile','-File',safe(root,checklist+'sync-wiki-source-ledgers.ps1'),'-Mode','Sync','-ProjectRoot',projection,'-PathsCsv',pages.join('|'),...(registryOnly?['-RegistryOnly']:[])],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']}));
}
function workerRun(state){return {execution_control:{task_session_bindings:state.binding?{host:'codex',post_ingest_reread:state.binding}:null,agent_sessions:[{agent_id:state.agent_id,role:'content_writer',started_at:state.dispatched_at,...state.config}]}};}
function assertWorker(root,state,args){
 if(!state.agent_id||state.agent_id===state.parent_id||state.original_authors.includes(state.agent_id))throw Error('Full reread requires a separate non-author worker');
 return agentConfiguration({run:workerRun(state),agent:state.agent_id,log:args.log??findReviewerLog(state.agent_id,args.sessions),turnStartedAt:state.dispatched_at});
}
export function preparePostReread(root,args){
 root=fs.realpathSync(root);const run=readJson(root,args.run);
 if(!args.enabled&&!run.execution_control?.post_ingest_reread?.enabled)return {type:'disabled',reason:'Post-ingest full reread is opt-in',writes:false};
 const policy=agentPolicy(root);
 if(run.status!=='completed'||!run.final_review?.sha256||run.final_review.approved_sha256!==run.final_review.sha256)throw Error('Finish and exact original approval are required before post-reread');
 const statePath=postRereadPath(run);if(fs.existsSync(safe(root,statePath,false)))return advancePostReread(root,{...args,state:statePath});
 if(hash(root,run.final_review.path)!==run.final_review.sha256)throw Error('Original approved report drifted');
 if(!run.final_review.content_manifest||hash(root,run.final_review.content_manifest)!==run.final_review.content_manifest_sha256)throw Error('Exact original approved content manifest required');
 const approved=readJson(root,run.final_review.content_manifest);
 if(approved.batch_id!==run.batch_id||approved.review_sha256!==run.final_review.sha256)throw Error('Original approved content identity mismatch');
 const parent=args.parent??process.env.CODEX_THREAD_ID??run.execution_control?.parent_reviewer?.agent_id;
 if(!nonempty(parent))throw Error('Actual main reviewer identity required');
 if(process.env.CODEX_THREAD_ID&&parent!==process.env.CODEX_THREAD_ID)throw Error('Use the actual calling main reviewer');
 const raws=[...new Set(run.artifacts.filter(a=>a.kind==='raw'&&a.disposition==='ingested').map(a=>a.path))];
 if(!raws.length)throw Error('No ingested Raw scope');
 const read=p=>fs.readFileSync(safe(root,p),'utf8');
 const resolveSource=p=>fs.existsSync(safe(root,p,false))?p:!p.includes('/')&&fs.existsSync(safe(root,'Clippings/'+p,false))?'Clippings/'+p:p;
 const sources=[...new Set(raws.flatMap(p=>sourcePaths(read(p))).map(resolveSource))];
 if(!sources.length||raws.some(p=>!sourcePaths(read(p)).length))throw Error('Complete declared source set required; missing sources cannot pass');
 const wikis=fs.readdirSync(path.join(root,'wiki')).filter(n=>n.endsWith('.md')&&n!=='README.md'&&!n.endsWith('.template.md')).map(n=>'wiki/'+n).filter(p=>raws.some(raw=>read(p).includes(raw)||read(p).includes(raw.replace(/\.md$/,''))));
 const media=[];
 for(const p of sources)for(const match of read(p).matchAll(/!\[[^\]]*\]\(([^)]+)\)|!\[\[([^\]]+)\]\]|<(?:img|video|iframe|embed)\b[^>]*(?:src)=["']([^"']+)/g))media.push({source:p,locator:match[1]??match[2]??match[3],status:'requires_actual_read_or_explicit_material_limit'});
 const files=[...new Set([...sources,...raws,...wikis])];
 const baseline=files.map(p=>({path:p,sha256:hash(root,p),kind:raws.includes(p)?'raw':sources.includes(p)?'source':'wiki'}));
 for(const row of baseline){
  const bound=approved.files.find(f=>f.path===row.path);
  if(bound){if(!bound.exists||bound.sha256!==row.sha256)throw Error('Approved content drift before reread: '+row.path);}
  else if(row.kind!=='wiki')throw Error('Original approved source/Raw version not bound: '+row.path);
  else if(sha(execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'show',`HEAD:${row.path}`]))!==row.sha256)throw Error('Related Wiki has overlapping uncommitted work: '+row.path);
 }
 const baseDir=path.posix.dirname(statePath),config=run.execution_control.post_ingest_reread??policy.post_ingest_reread;
 const binding=run.execution_control.task_session_bindings?.post_ingest_reread??policy.task_session_bindings?.post_ingest_reread??null;
 const originalAuthors=[...new Set(Object.values(run.execution_control.artifact_authors??{}).map(x=>x.agent_id).filter(Boolean))];
 if(originalAuthors.includes(parent))throw Error('Original content author cannot be the main reviewer');
 if(binding&&[parent,...originalAuthors].includes(binding.thread_id))throw Error('Reread task session must differ from original authors and main reviewer');
 // Preserve exactly the old approved bytes before any candidate repair is written.
 for(const row of baseline){const dest=safe(root,`${baseDir}/before/${row.path}`,false);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,fs.readFileSync(safe(root,row.path)),{flag:'wx'});}
 const state={schema_version:1,kind:'post_ingest_full_reread',status:'pending',original_run:args.run,original_run_sha256:hash(root,args.run),original_approval:run.final_review.sha256,baseline_revision:git(root,'rev-parse','HEAD'),parent_id:parent,original_authors:originalAuthors,config:{model:config.model,reasoning_effort:config.reasoning_effort},binding,agent_id:binding?.thread_id??null,baseline,raw_sources:Object.fromEntries(raws.map(p=>[p,sourcePaths(read(p)).map(resolveSource)])),media_candidates:media,worker_report:`${baseDir}/worker-report.json`,main_review:`${baseDir}/main-review.json`,host_event:`${baseDir}/host-event.json`,dispatched_at:new Date().toISOString()};
 state.started_at=state.dispatched_at;
 state.auxiliary=[];if(fs.existsSync(safe(root,'system/registry/raw-list.md',false))){const row={path:'system/registry/raw-list.md',sha256:hash(root,'system/registry/raw-list.md')};if(sha(execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'show',`HEAD:${row.path}`]))!==row.sha256)throw Error('Registry has overlapping uncommitted work');state.auxiliary.push(row);const dest=safe(root,baseDir+'/before/'+row.path,false);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(safe(root,row.path),dest);}
 writeJson(root,state.worker_report,{schema_version:1,baseline:sha(JSON.stringify(baseline)),full_reads:baseline.map(x=>({...x,read:false})),rows:raws.map(raw=>({raw,checks:{source_to_raw:false,raw_to_source:false,numbers_conditions_attribution_cases:false,raw_to_wiki:false,wiki_to_raw:false},findings:[],media:{status:'pending',basis:'',limitations:[]},scope_expansion_requests:[]})),candidates:[],exceptions:[],summary:''});
 writeJson(root,state.host_event,{agent_id:state.agent_id,sent:false,completed:false});writeJson(root,statePath,state);
 return advancePostReread(root,{...args,state:statePath});
}
export function advancePostReread(root,args){
 root=fs.realpathSync(root);const state=readJson(root,args.state),save=()=>writeJson(root,args.state,state);
 if(state.kind!=='post_ingest_full_reread')throw Error('Unsupported post-reread state');
 if(hash(root,state.original_run)!==state.original_run_sha256)throw Error('Original approved run changed');
 const original=readJson(root,state.original_run).final_review;
 if(hash(root,original.path)!==original.sha256||hash(root,original.content_manifest)!==original.content_manifest_sha256)throw Error('Original approval evidence changed');
 if(args.action==='expand'){
  const pages=[...new Set((args.paths??'').split('|').filter(Boolean))];
  if(!pages.length||pages.some(p=>!/^wiki\/[^/\\]+\.md$/.test(p)||p==='wiki/README.md')||!nonempty(args.reason))throw Error('Scope expansion requires specific existing Wiki paths and concrete findings');
  const extra=pages.filter(p=>!state.baseline.some(row=>row.path===p));if(!extra.length)throw Error('Requested scope already exists');
  const rows=extra.map(p=>{const bytes=fs.readFileSync(safe(root,p));if(sha(execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'show',`HEAD:${p}`]))!==sha(bytes))throw Error('New Wiki has overlapping work: '+p);return {path:p,sha256:sha(bytes),kind:'wiki'};});
  advancePostReread(root,{...args,action:'revise',reason:'Expand affected Wiki scope: '+args.reason});
  const next=readJson(root,args.state);next.baseline.push(...rows);next.scope_expansions??=[];next.scope_expansions.push({paths:extra,reason:args.reason,at:new Date().toISOString()});
  for(const row of rows){const dest=safe(root,path.posix.dirname(args.state)+'/before/'+row.path,false);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(safe(root,row.path),dest);}
  const report=readJson(root,next.worker_report);report.baseline=sha(JSON.stringify(next.baseline));report.full_reads.push(...rows.map(row=>({...row,read:false})));for(const row of report.rows){row.checks.raw_to_wiki=false;row.checks.wiki_to_raw=false;}
  writeJson(root,next.worker_report,report);writeJson(root,args.state,next);return advancePostReread(root,{...args,action:'advance'});
 }
 if(args.action==='revise'){
  if(state.status==='applied'||!nonempty(args.reason)||(state.repair_rounds??0)>=2)throw Error('Targeted revision needs concrete findings and at most two substantive repair rounds before application');
  if(process.env.CODEX_THREAD_ID&&process.env.CODEX_THREAD_ID!==state.parent_id)throw Error('Only the actual main reviewer can request revisions');
  unchanged(root,state);const round=(state.repair_rounds??0)+1,revision=path.posix.dirname(args.state)+'/revisions/'+round;
  state.history??=[];
  for(const p of [state.worker_report,state.main_review])if(fs.existsSync(safe(root,p,false))){const preserved=revision+'/'+path.posix.basename(p);writeJson(root,preserved,readJson(root,p));state.history.push(preserved);}
  for(const c of readJson(root,state.worker_report).candidates??[]){const saved=revision+'/candidates/'+c.path;const dest=safe(root,saved,false);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(safe(root,c.candidate),dest);state.history.push(saved);}
  if(fs.existsSync(safe(root,state.main_review,false))){const target=revision+'/main-review.original.json';fs.renameSync(safe(root,state.main_review),safe(root,target,false));state.history.push(target);}
  state.repair_rounds=round;state.repair_instructions=args.reason;state.dispatched_at=new Date().toISOString();writeJson(root,state.host_event,{agent_id:state.agent_id,sent:false,completed:false});save();
  return advancePostReread(root,{...args,action:'advance'});
 }
 if(args.action==='preflight'){if(args.agent!==state.agent_id||args.started!==state.dispatched_at)throw Error('Use exact registered worker and dispatch time');unchanged(root,state);return assertWorker(root,state,args);}
 if(args.action==='prepare-candidates'){
  if(state.status==='applied'||process.env.CODEX_THREAD_ID&&process.env.CODEX_THREAD_ID!==state.parent_id)throw Error('Candidate preparation belongs to the main reviewer before application');
  unchanged(root,state);const report=readJson(root,state.worker_report),candidates=report.candidates.filter(c=>state.baseline.some(b=>b.path===c.path&&b.kind==='wiki'));
  if(!candidates.length)throw Error('No assigned Wiki candidates');
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'post-reread-ledger-'));
  try{
   fs.mkdirSync(path.join(temp,'wiki'),{recursive:true});fs.mkdirSync(path.join(temp,'raw-sources'),{recursive:true});fs.mkdirSync(path.join(temp,'system/registry'),{recursive:true});fs.writeFileSync(path.join(temp,'system/registry/raw-list.md'),'# Projection only\n');
   for(const c of candidates){
    if(c.candidate!==path.posix.dirname(args.state)+'/candidates/'+c.path)throw Error('Unexpected candidate path');
    const text=fs.readFileSync(safe(root,c.candidate),'utf8'),before=frontmatter(fs.readFileSync(safe(root,c.path),'utf8')),previous=state.prepared_outputs?.find(o=>o.path===c.path);
    if(frontmatter(text)!==before&&sha(frontmatter(text))!==previous?.metadata_sha256)throw Error('Worker cannot change Wiki metadata');fs.copyFileSync(safe(root,c.candidate),path.join(temp,c.path));
   }
   const result=ledger(root,temp,candidates.map(c=>c.path));
   for(const row of result.changes)if(row.added_to_frontmatter.some(p=>!state.baseline.some(b=>b.kind==='raw'&&b.path===p)))throw Error('New Wiki source outside the actual reviewed Raw scope');
   state.prepared_outputs=candidates.map(c=>{fs.copyFileSync(path.join(temp,c.path),safe(root,c.candidate));return {path:c.path,sha256:hash(root,c.candidate),metadata_sha256:sha(frontmatter(fs.readFileSync(safe(root,c.candidate),'utf8')))};});
   state.mechanical_preparation={tool:checklist+'sync-wiki-source-ledgers.ps1',tool_sha256:hash(root,checklist+'sync-wiki-source-ledgers.ps1'),result};save();
  }finally{const full=fs.realpathSync(temp);if(path.dirname(full)!==fs.realpathSync(os.tmpdir())||!path.basename(full).startsWith('post-reread-ledger-'))throw Error('Unsafe projection cleanup');fs.rmSync(full,{recursive:true,force:true});}
  return advancePostReread(root,{...args,action:'advance'});
 }
 if(state.status==='applied'){
  if(hash(root,state.main_review)!==state.main_review_sha256||hash(root,state.worker_report)!==state.worker_report_sha256)throw Error('Accepted maintenance review changed');
  for(const row of state.baseline)if(hash(root,path.posix.dirname(state.worker_report)+'/before/'+row.path)!==row.sha256)throw Error('Preserved approval bytes changed');
  const expected=[...state.baseline.map(r=>({path:r.path,sha256:r.sha256})),...(state.auxiliary??[]),...state.applied_outputs];
  for(const row of expected.filter((x,i,a)=>a.findLastIndex(y=>y.path===x.path)===i)){
   if(hash(root,row.path)!==row.sha256)throw Error('Applied repair drifted: '+row.path);
   if(sha(execFileSync('git',['-c',`safe.directory=${root.replaceAll('\\','/')}`,'-C',root,'show',`HEAD:${row.path}`]))!==row.sha256) return {type:'needs_closure',state:args.state,stage_paths:state.commit_scope,instruction:'Commit only the reviewed maintenance scope, close every direct parent gitlink and rerun this entry. Do not re-Finish or rewrite the original run.'};
  }
  for(const p of state.commit_scope)if(!git(root,'ls-tree','HEAD','--',p))return {type:'needs_closure',stage_paths:state.commit_scope,state:args.state};
  let child=root,parent=committedParent(child);while(parent){if(parent.committed_child!==git(child,'rev-parse','HEAD'))return {type:'needs_closure',state:args.state,stage_paths:state.commit_scope,instruction:'Close the actual direct parent gitlink'};child=parent.path;parent=committedParent(child);}
  return {type:'closed',state:args.state,disposition:state.disposition,original_approval_unchanged:true,full_media_certified:state.full_media_certified,head:git(root,'rev-parse','HEAD')};
 }
 unchanged(root,state);
 const event=readJson(root,state.host_event);
 if(!state.agent_id){if(!nonempty(event.agent_id))return {type:'needs_agent',state:args.state,response_path:state.host_event,spawn_options:{model:state.config.model,reasoning_effort:state.config.reasoning_effort,fork_context:false},instruction:'Create one bounded reread/repair worker, record actual ID; main reviewer and original writers are ineligible.'};state.agent_id=event.agent_id;save();}
 if(state.agent_id===state.parent_id||state.original_authors.includes(state.agent_id))throw Error('Author or main reviewer cannot run the independent reread');
 if(!event.sent){
  const command=`node "${path.join(root,checklist+'ingest-post-reread.mjs')}" preflight --root "${root}" --state "${args.state}" --agent "${state.agent_id}" --started "${state.dispatched_at}"`;
  const message=`Work in ${root}. This is optional post-Finish full reread/repair, not ingestion or approval. First run ${command}; stop on nonzero exit. Read system/maintenance/checklists/ingest-post-reread.md and the bound state ${args.state}. ${state.repair_instructions?'Targeted revision after main review: '+state.repair_instructions+'. Reuse prior unchanged full-reading evidence; reread all affected propositions and necessary neighboring context.':'Independently read EVERY full source, Raw and in-scope Wiki.'} Check source→Raw and Raw→source, Raw→Wiki and Wiki→Raw, all sources in compilations, metadata identity, definitions, reasoning, quantifiers, numbers with conditions, meaningful cases, attribution and necessary media. Do not treat ledger or old PASS as completeness limits. Batch all findings per article. Inspect necessary media; explicitly retain missing/inaccessible/contradictory evidence. Fill ${state.worker_report} and write complete candidate files only under ${path.posix.dirname(args.state)}/candidates/<original-path>. Preserve frontmatter, source identities and correct existing prose. Do not edit live sources/Raw/Wiki, main-review, state, approvals or Git. List scope/metadata/structural exceptions together; do not guess. Your report and repairs are not formal approval. Finish the turn and return report/candidate paths; wait for main review.`;
  return {type:'needs_agent',state:args.state,agent_id:state.agent_id,response_path:state.host_event,message,host_dispatch:taskDispatch(state.binding,state.config,message),instruction:'Dispatch once with explicit pinned model/effort, acknowledge sent only after host confirmation; never interrupt another active task session.'};
 }
 if(!event.completed)return {type:'waiting_agent',state:args.state,agent_id:state.agent_id,response_path:state.host_event,instruction:'Use bounded host wait; completion signal resumes this same task. Do not infer completion from a report file.'};
 assertWorker(root,state,args);
 const report=readJson(root,state.worker_report);
 if(report.baseline!==sha(JSON.stringify(state.baseline))||!nonempty(report.summary)||!Array.isArray(report.exceptions)||!Array.isArray(report.candidates))throw Error('Reread report must bind the full baseline and actual summary');
 if(report.full_reads.length!==state.baseline.length||state.baseline.some(b=>!report.full_reads.some(r=>r.path===b.path&&r.sha256===b.sha256&&r.read===true)))throw Error('Complete source/Raw/Wiki reading required');
 const raws=state.baseline.filter(r=>r.kind==='raw');
 if(report.rows.length!==raws.length||raws.some(b=>!report.rows.some(r=>r.raw===b.path)))throw Error('Reread must cover every selected Raw exactly once');
 for(const row of report.rows){if(!['source_to_raw','raw_to_source','numbers_conditions_attribution_cases','raw_to_wiki','wiki_to_raw'].every(k=>row.checks?.[k]===true)||!Array.isArray(row.findings)||!['read','not_necessary','material_limited'].includes(row.media?.status)||!nonempty(row.media.basis)||!Array.isArray(row.media.limitations)||!Array.isArray(row.scope_expansion_requests))throw Error('Missing actual bidirectional/media/consumer disposition');}
 const outputs=[];
 for(const c of report.candidates){
  if(outputs.some(o=>o.path===c.path)||!state.baseline.some(b=>b.path===c.path&&b.kind!=='source'))throw Error('Candidate outside approved Raw/Wiki scope');
  const expected=path.posix.dirname(args.state)+'/candidates/'+c.path;if(c.candidate!==expected)throw Error('Candidate must use its fixed maintenance path');
  const old=fs.readFileSync(safe(root,c.path),'utf8'),next=fs.readFileSync(safe(root,c.candidate),'utf8');
  const prepared=state.prepared_outputs?.find(o=>o.path===c.path&&o.sha256===hash(root,c.candidate));
  if(c.path.startsWith('wiki/')&&!prepared)return {type:'needs_preparation',state:args.state,instruction:'Main runs prepare-candidates before reviewing Wiki; the existing ledger tool derives source fields in an isolated projection, not live pages.'};
  if(frontmatter(old)!==frontmatter(next)&&!prepared)throw Error('Metadata correction requires separate authority; collect as exception');
  if(c.path.startsWith('raw-sources/')&&styleCheck(next).status!=='passed')throw Error('Raw candidate violates existing RAW_STANDARD_V2 format');
  if(!next.trim())throw Error('Empty repair candidate');outputs.push({path:c.path,candidate:c.candidate,sha256:hash(root,c.candidate)});
 }
 const workerHash=hash(root,state.worker_report);
 if(!fs.existsSync(safe(root,state.main_review,false)))writeJson(root,state.main_review,{state:'pending',reviewer_id:state.parent_id,worker_report_sha256:workerHash,reviewed_outputs:outputs,full_readback:state.baseline.map(b=>({path:b.path,sha256:outputs.find(o=>o.path===b.path)?.sha256??b.sha256,reviewed:false})),decision:'pending',findings_resolved:false,exceptions_disposition:'',limitations:[],summary:''});
 const main=readJson(root,state.main_review);
 if(main.state!=='ready')return {type:'needs_review',state:args.state,response_path:state.main_review,inputs:[...state.baseline.map(b=>b.path),state.worker_report,...outputs.map(o=>o.candidate)],instruction:'Main reviewer rereads full source, Raw and Wiki/candidates with necessary context. Verify all repairs and extra omissions, media limits and exceptions; fill this exact version-bound report. Worker cannot approve its own edits. Then call apply; original approval remains historical.'};
 if(main.reviewer_id!==state.parent_id||main.reviewer_id===state.agent_id||state.original_authors.includes(main.reviewer_id)||main.worker_report_sha256!==workerHash||JSON.stringify(main.reviewed_outputs)!==JSON.stringify(outputs))throw Error('Main review identity or exact repair version mismatch');
 if(!['passed','limited'].includes(main.decision)||main.findings_resolved!==true||!nonempty(main.summary)||!nonempty(main.exceptions_disposition)||!Array.isArray(main.limitations)||main.full_readback.length!==state.baseline.length||state.baseline.some(b=>!main.full_readback.some(r=>r.path===b.path&&r.sha256===(outputs.find(o=>o.path===b.path)?.sha256??b.sha256)&&r.reviewed===true)))throw Error('Main full reread/review is incomplete; no automatic PASS');
 const limited=report.rows.some(r=>r.media.status==='material_limited'||r.scope_expansion_requests.length)||report.exceptions.length||main.limitations.length;
 if(limited&&main.decision!=='limited')throw Error('Material limits and exceptions cannot be certified as passed');
 if(args.action!=='apply')return {type:'ready_to_apply',state:args.state,outputs,instruction:'Apply only after actual main review; run apply with the current state'};
 if(process.env.CODEX_THREAD_ID&&process.env.CODEX_THREAD_ID!==state.parent_id)throw Error('Only the actual main task can apply approved repairs');
 const changedWiki=outputs.filter(o=>o.path.startsWith('wiki/')).map(o=>o.path);
 if(changedWiki.length&&!state.auxiliary?.some(row=>row.path==='system/registry/raw-list.md'))throw Error('Missing original registry baseline');
 // All checks above run before the first live file changes; old bytes remain in before/ and Git.
 try{
  for(const o of outputs)fs.writeFileSync(safe(root,o.path),fs.readFileSync(safe(root,o.candidate)));
  if(changedWiki.length){state.registry_preparation=ledger(root,root,changedWiki,{registryOnly:true});if(hash(root,'system/registry/raw-list.md')!==state.auxiliary.find(r=>r.path==='system/registry/raw-list.md').sha256)outputs.push({path:'system/registry/raw-list.md',sha256:hash(root,'system/registry/raw-list.md')});}
 }catch(error){for(const o of outputs)if(hash(root,o.path)===o.sha256)fs.copyFileSync(safe(root,path.posix.dirname(args.state)+'/before/'+o.path),safe(root,o.path));throw error;}
 state.status='applied';state.applied_outputs=outputs.map(({candidate,...o})=>o);state.main_review_sha256=hash(root,state.main_review);state.worker_report_sha256=hash(root,state.worker_report);state.disposition=limited?'completed_with_limits':outputs.length?'repaired':'no_increment';state.full_media_certified=false;
 state.finished_at=new Date().toISOString();
 const textReview=path.posix.dirname(args.state)+'/text-review.json';
 writeJson(root,textReview,{schema_version:1,kind:'raw_text_review',entries:raws.map(row=>({scope:'complete_raw_and_local_source_text',outcome:outputs.some(o=>o.path===row.path)?'accepted_text':'no_change_text',reviewer:{kind:'host_direct_analysis',session_id:state.parent_id},raw_path:row.path,raw_sha256:hash(root,row.path),source_fingerprints:state.raw_sources[row.path].map(p=>({path:p,sha256:hash(root,p)})),decision_path:state.main_review,decision_sha256:state.main_review_sha256,limitations:['Full source/Raw/Wiki text review; media necessity/reading/limitations remain separately scoped in the worker and main reports',...main.limitations],full_media_certified:false}))});
 state.commit_scope=[...new Set([args.state,state.worker_report,state.main_review,state.host_event,textReview,...(state.history??[]),...[...state.baseline,...(state.auxiliary??[])].map(row=>path.posix.dirname(args.state)+'/before/'+row.path),...outputs.map(o=>o.candidate).filter(Boolean),...outputs.map(o=>o.path)])];save();
 return {type:'needs_closure',state:args.state,stage_paths:state.commit_scope,disposition:state.disposition,instruction:'Run affected Raw/Wiki validators, preserve any failure, commit this maintenance scope and close direct parent gitlinks. Do not update the old approval hash or claim full-media PASS with limitations.'};
}
export async function postRereadCost(root,args){
 const state=readJson(root,args.state),run={batch_id:'post-reread-'+sha(state.original_run).slice(0,16),started_at:state.started_at,execution_control:{agent_sessions:state.agent_id?[{agent_id:state.agent_id,role:'post_ingest_reread',started_at:state.started_at,ended_at:state.finished_at??null,...state.config}]:[],execution_conditions:{fast:'unknown',parent_context:'bound_task_session_or_explicit_worker',cost_scope:'post_ingest_full_reread_only'}}};
 try{
  const result=await collectSessionCost({run,parent:state.parent_id,sessions:args.sessions,start:state.started_at,end:state.finished_at??new Date().toISOString()});
  for(const row of result.sessions)if(!row.first_token_at){row.usage=null;row.usage_status='no_measured_token_event';}
  const aggregate=rows=>{const measured=rows.filter(r=>r.usage);return {status:rows.every(r=>r.usage_status==='available')?'complete':measured.length?'partial':'unknown',known_usage:measured.length?measured.reduce((sum,r)=>{for(const k of ['input_tokens','cached_input_tokens','output_tokens'])sum[k]+=r.usage[k];return sum;},{input_tokens:0,cached_input_tokens:0,output_tokens:0}):null,missing_session_ids:rows.filter(r=>r.usage_status!=='available').map(r=>r.id)};};
  result.parent=aggregate(result.sessions.filter(r=>r.role==='parent'));result.children=aggregate(result.sessions.filter(r=>r.role!=='parent'));result.total=aggregate(result.sessions);for(const phase of result.phases)if(result.total.status!=='complete')phase.status='partial';return result;
 }
 catch(e){return {schema_version:1,status:'unavailable',reason:e.message,window:{start:state.started_at,end:state.finished_at??null},total:{status:'unknown',known_usage:null},accounting_boundary:'Missing host evidence, not zero cost or a billing statement'};}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const [action,...rest]=process.argv.slice(2),args={action};for(let i=0;i<rest.length;i+=2)args[rest[i].slice(2)]=rest[i+1];if(!['prepare','advance','preflight','apply','revise','expand','cost','prepare-candidates'].includes(action))throw Error('Expected prepare|advance|preflight|apply|revise|expand|cost|prepare-candidates');const root=path.resolve(args.root??path.join(import.meta.dirname,'../../..'));const result=action==='prepare'?preparePostReread(root,{...args,enabled:args.enabled==='true'}):action==='cost'?await postRereadCost(root,args):advancePostReread(root,args);console.log(JSON.stringify(result));}
 catch(e){console.error(JSON.stringify({type:'blocked',reason:e.message}));process.exitCode=2;}
}
