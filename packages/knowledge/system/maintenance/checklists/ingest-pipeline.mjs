import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe, sha} from './raw-quality.mjs';
import {findReviewerLog, agentConfiguration} from './ingest-runtime-contract.mjs';
import {parentReview} from './reviewer-route.mjs';
import {preparePageReview, verifyPageReview, compilePageSelections} from './ingest-page-review.mjs';
import {consolidated,writeJson} from './ingest-execution-state.mjs';
import {preparePages} from './ingest-page-prepare.mjs';

export function dispatchMessage(preflight,prompt){
  const command='& '+preflight.map(x=>"'"+String(x).replaceAll("'","''")+"'").join(' ');
  return `${prompt}\n\nExecute this exact PowerShell command first (stop on nonzero exit):\n${command}\nif ($LASTEXITCODE -ne 0) { throw 'Writer preflight failed' }\nDo not substitute the dispatch time. Report concrete errors; elapsed time alone is not a blocker.`;
}

// One run owns assignments, dispatch clocks and delivery versions. No parallel ledger.
export function parentBatchStart(events,startedAt){
  let activeStart=null;
  for(const event of events){
    if(Date.parse(event.timestamp)>Date.parse(startedAt))continue;
    if(event.type==='event_msg'&&event.payload.type==='task_started')activeStart=event.timestamp;
    if(event.type==='event_msg'&&['task_complete','task_completed','turn_aborted'].includes(event.payload.type))activeStart=null;
  }
  return {start:activeStart??startedAt,basis:activeStart?'observed_parent_task_start':'run_creation_only_startup_unavailable'};
}
export function pipeline(root, action, args) {
  root = fs.realpathSync(root);
  const runPath = safe(root, args.run), read = p => JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
  const run = read(runPath), state = run.execution_control;
  if (!parentReview(run)) throw Error('Pipeline requires new reviewer route v3; historical runs are unchanged');
  const mutable = () => { if (['completed','abandoned','awaiting_final_review'].includes(run.status)) throw Error('Run is sealed or terminal'); };
  const save = () => { run.updated_at = new Date().toISOString(); writeJson(root,args.run,run); };
  const local = p => { const f = safe(root,p); if(!f.startsWith(path.dirname(runPath)+path.sep))throw Error('Task must be run-local');return f; };
  const relative = p => path.relative(root,safe(root,p)).split(path.sep).join('/');
  const writer = () => {
    const s = state.agent_sessions.find(x=>x.agent_id===args.agent);
    if (!s || s.status!=='active' || !['raw_writer','wiki_writer','content_writer'].includes(s.role)) throw Error('Bound active content writer required');
    const expected=state.writer_config??{model:'gpt-5.6-luna',reasoning_effort:'max'};
    if(s.model!==expected.model||s.reasoning_effort!==expected.reasoning_effort)throw Error(`This route requires its pinned ${expected.model}/${expected.reasoning_effort} content writer`);
    if (s.agent_id===state.parent_reviewer?.agent_id) throw Error('Parent reviewer cannot be the writer');
    return s;
  };
  if (action==='bind-parent') {
    mutable();
    const id = args.parent || process.env.CODEX_THREAD_ID;
    if (!id || (process.env.CODEX_THREAD_ID && id!==process.env.CODEX_THREAD_ID)) throw Error('Use actual calling parent identity');
    if(state.parent_reviewer){
      if(state.parent_reviewer.agent_id!==id)throw Error('Different parent already bound; explicit recovery required');
      agentConfiguration({run,agent:id,log:findReviewerLog(id,args.sessions)});
      return {status:'reused',parent:state.parent_reviewer,child_session_added:false};
    }
    if (state.agent_sessions.some(x=>x.agent_id===id)) throw Error('Parent must not count as a child session');
    const log=findReviewerLog(id,args.sessions), events=fs.readFileSync(log,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
    const current=events.filter(x=>x.type==='turn_context'&&x.payload.model).at(-1);
    if (!current || !events.some(x=>x.type==='session_meta'&&x.payload.id===id)) throw Error('Parent runtime not observed');
    const config={model:current.payload.model,reasoning_effort:current.payload.effort??current.payload.reasoning_effort};
    if(!config.reasoning_effort)throw Error('Parent reasoning configuration unavailable');
    state.parent_reviewer={agent_id:id,session_key:'parent-reviewer',role:'core_reviewer',status:'active',started_at:current.timestamp,...config,review_mode:'parent_non_author',log};
    state.execution_conditions={fast:args.fast??'unknown',parent_context:args.context??'unknown',evidence:'explicit caller values; runtime model from turn_context'};
    // Include initialization in this batch, but never cross a completed earlier task.
    const boundary=parentBatchStart(events,run.started_at);
    state.cost_window_start??=boundary.start;
    state.cost_start_basis??=boundary.basis;
    state.pipeline_version=2;state.artifact_authors={};state.dispatches=[];state.deliveries=[];
    if(state.page_review_queue_version===1)state.page_reviews=[];
    save();return {status:'bound',parent:state.parent_reviewer,child_session_added:false};
  }
  if (action==='dispatch') {
    mutable();const actor=writer(),task=read(local(args.task));
    if (!['stage1','stage3'].includes(task.stage) || !Array.isArray(task.outputs) || !task.outputs.length || typeof task.instructions!=='string') throw Error('Task needs stage, outputs and instructions');
    if(task.stage==='stage3'&&(!run.commits.stage1||run.status!=='stage2_planned'))throw Error('Wiki writing requires Stage1 checkpoint and Stage2 plan');
    if(task.stage==='stage1'&&!['running_scoring','scoring_approved'].includes(run.status))throw Error('Raw writing phase is closed');
    if(new Set(task.outputs).size!==task.outputs.length)throw Error('Duplicate outputs');
    if(consolidated(run)){
      const prior=state.dispatches.find(d=>d.task===args.task&&d.task_sha256===sha(fs.readFileSync(local(args.task))));
      if(prior)return {status:'dispatch_reused',...prior,next_action:'Use the existing dispatch; do not launch another writer or resend without confirming delivery.'};
    }
    for(const p of task.outputs){safe(root,p,false);if(!(task.stage==='stage1'?/^raw-sources\/.+\.md$/:/^wiki\/.+\.md$/).test(p))throw Error('Invalid output: '+p);}
    const record={id:'dispatch-'+(state.dispatches.length+1),agent_id:actor.agent_id,stage:task.stage,task:args.task,task_sha256:sha(fs.readFileSync(local(args.task))),outputs:task.outputs,dispatched_at:new Date().toISOString()};
    for(const p of task.outputs){
      const previous=state.artifact_authors[p];
      if(previous&&previous.agent_id!==actor.agent_id){
        const prior=state.agent_sessions.find(x=>x.agent_id===previous.agent_id);
        if(!args.reason?.trim()||!prior||prior.status==='active'||prior.status==='reserved')throw Error('Reassignment requires terminal previous writer and explicit --reason: '+p);
        state.author_reassignments??=[];
        state.author_reassignments.push({path:p,previous:{...previous},next_agent_id:actor.agent_id,reason:args.reason,at:record.dispatched_at});
      }
      state.artifact_authors[p]={agent_id:actor.agent_id,stage:task.stage,dispatch_id:record.id};
    }
    state.dispatches.push(record);save();
    const preflight=['node',path.join(root,'system/maintenance/checklists/ingest-runtime-contract.mjs'),'agent-preflight','--run',runPath,'--agent',actor.agent_id,'--turn-started-at',record.dispatched_at];
    return {status:'dispatch_ready',...record,preflight,prompt:`Work in ${root}. First execute the supplied preflight with the exact dispatch time, never a clock sampled inside your turn. Read task ${local(args.task)}. ${task.instructions} Deliver only this task, report exact paths, then finish the turn so the parent receives a completion signal. The parent will send the next task before reviewing this output. Keep the same session for Raw and Wiki; do not edit previously delivered outputs unless explicitly assigned for repair.`,next_action:'Send this prompt and preflight to the bound writer now; do not run parent preflight before child turn starts'};
  }
  if (action==='deliver') {
    mutable();const actor=writer(),dispatch=state.dispatches.find(x=>x.id===args.dispatch&&x.agent_id===actor.agent_id);
    if(!dispatch)throw Error('Unknown dispatch');
    if(sha(fs.readFileSync(local(dispatch.task)))!==dispatch.task_sha256)throw Error('Dispatched task changed; create a new dispatch');
    if(dispatch.outputs.some(p=>state.artifact_authors[p]?.dispatch_id!==dispatch.id))throw Error('Delivery superseded by a newer assignment');
    agentConfiguration({run,agent:actor.agent_id,log:findReviewerLog(actor.agent_id,args.sessions),turnStartedAt:dispatch.dispatched_at});
    const prior=state.deliveries.find(x=>x.dispatch_id===dispatch.id);
    if(consolidated(run)&&dispatch.stage==='stage3'&&!prior){
      if(!args.semantic)throw Error('Stage3 delivery requires current semantic before mechanical preparation');
      read(local(args.semantic));
      preparePages(root,dispatch.outputs,{shell:args.shell});
    }
    const outputs=dispatch.outputs.map(p=>({path:p,sha256:sha(fs.readFileSync(safe(root,p)))}));
    if(prior){if(JSON.stringify(prior.outputs)!==JSON.stringify(outputs))throw Error('Delivered output changed; create a repair dispatch');return {status:'reused',delivery:prior,review_tasks:(state.page_reviews??[]).filter(t=>t.dispatch_id===dispatch.id)};}
    const delivery={dispatch_id:dispatch.id,agent_id:actor.agent_id,stage:dispatch.stage,outputs,delivered_at:new Date().toISOString()};
    state.deliveries.push(delivery);
    const reviewTasks=[];
    if(dispatch.stage==='stage3'&&state.page_review_queue_version===1){
      if(!args.semantic)throw Error('Stage3 delivery requires --semantic so page review can start immediately');
      const semantic=read(local(args.semantic));
      // Validate the complete group before writing any template. A failed second
      // page must not leave an unregistered first template that blocks retry.
      const prepared=outputs.map((output,index)=>{
        const reportPath=path.posix.join(path.posix.dirname(relative(args.run)),`page-review-${dispatch.id}-${String(index+1).padStart(2,'0')}.json`);
        const report=preparePageReview(root,run,semantic,output.path,{verifyRuntime:false});
        return {output,reportPath,report};
      });
      for(const {output,reportPath,report} of prepared){
        const file=safe(root,reportPath,false),serialized=JSON.stringify(report,null,2)+'\n';
        if(fs.existsSync(file)){if(fs.readFileSync(file,'utf8')!==serialized)throw Error('Unregistered page template differs: '+reportPath);}
        else fs.writeFileSync(file,serialized,{flag:'wx'});
        const task={dispatch_id:dispatch.id,page:output.path,report_path:reportPath,prepared_at:new Date().toISOString(),status:'pending'};
        state.page_reviews.push(task);reviewTasks.push(task);
      }
    }
    save();return {status:'ready_for_review',delivery,review_tasks:reviewTasks,next_action:reviewTasks.length?'Dispatch the next writing task, then read this delivered page group, fill each generated report, and record-page-review before the batch Seal.':'Dispatch next ready writing task first, then review these exact outputs; no automatic semantic PASS'};
  }
  if(action==='record-page-review'){
    mutable();
    if(state.page_review_queue_version!==1)throw Error('Page review queue is not enabled for this run');
    if(!args.semantic||!args.report)throw Error('record-page-review requires --semantic and --report');
    const reportPath=relative(args.report);
    const task=state.page_reviews.find(x=>x.report_path===reportPath);
    if(!task)throw Error('Unknown generated page review: '+reportPath);
    const semanticPath=local(args.semantic),reportFull=local(reportPath);
    const semantic=read(semanticPath);
    if(task.status==='pending'){
      const original=read(reportFull),compiled=compilePageSelections(root,original);
      if(JSON.stringify(original)!==JSON.stringify(compiled))fs.writeFileSync(reportFull,JSON.stringify(compiled,null,2)+'\n');
    }
    const ref={path:reportPath,sha256:sha(fs.readFileSync(reportFull))};
    const report=verifyPageReview(root,run,semantic.consumption,ref,state.parent_reviewer.agent_id);
    if(report.page!==task.page)throw Error('Page review queue target changed');
    task.status='passed';task.report_sha256=ref.sha256;task.completed_at=new Date().toISOString();task.semantic_path=args.semantic;task.semantic_sha256=sha(fs.readFileSync(semanticPath));
    save();return {status:'passed',page:task.page,report:task.report_path,completed_at:task.completed_at};
  }
  if(action==='refresh-page-reviews'){
    mutable();
    if(state.page_review_queue_version!==1||!args.semantic)throw Error('Refresh needs the page review queue and --semantic');
    const semantic=read(local(args.semantic));
    const pages=[...new Set(semantic.consumption.flatMap(r=>r.decisions.flatMap(d=>(d.destinations??[]).map(t=>t.path))))].sort();
    const reused=[],pending=[],generated=[];
    for(const page of pages){
      const dispatch=state.artifact_authors?.[page]?.dispatch_id??'existing';
      const tasks=(state.page_reviews??[]).filter(t=>t.page===page&&t.dispatch_id===dispatch);
      let valid=null;
      for(const task of [...tasks].reverse()){
        if(task.status!=='passed')continue;
        try{verifyPageReview(root,run,semantic.consumption,{path:task.report_path,sha256:task.report_sha256},state.parent_reviewer.agent_id);valid=task;break;}catch{/* changed inputs need an empty report, never copied PASS */}
      }
      if(valid){reused.push(valid.report_path);continue;}
      const report=preparePageReview(root,run,semantic,page,{verifyRuntime:false});
      const identity=sha(JSON.stringify([page,report.scope_sha256,report.input_hashes])).slice(0,20);
      const reportPath=path.posix.join(path.posix.dirname(relative(args.run)),`page-review-refresh-${identity}.json`);
      const task=tasks.find(t=>t.report_path===reportPath&&t.status==='pending');
      if(task){pending.push(reportPath);continue;}
      const file=safe(root,reportPath,false),serialized=JSON.stringify(report,null,2)+'\n';
      if(fs.existsSync(file)){
        // An interrupted generation is recoverable only while it is still the
        // exact empty template. Never adopt an unregistered approval.
        if(fs.readFileSync(file,'utf8')!==serialized)throw Error('Unregistered review differs: '+reportPath);
      }
      generated.push({file,serialized,task:{dispatch_id:dispatch,page,report_path:reportPath,status:'pending',prepared_at:new Date().toISOString()}});
      pending.push(reportPath);
    }
    for(const g of generated){if(!fs.existsSync(g.file))fs.writeFileSync(g.file,g.serialized,{flag:'wx'});state.page_reviews.push(g.task);}
    if(generated.length)save();
    return {status:pending.length?'pending':'passed',reused_reports:reused,pending_reports:pending,generated:generated.length,next_action:pending.length?'Read affected inputs, fill only these pending reports, then record-page-review.':'Reuse these exact report paths for aggregate review; no new page judgment required.'};
  }
  if(action==='check-page-reviews'){
    if(state.page_review_queue_version!==1)return {status:'legacy_not_required',reviewed_pages:[]};
    if(!args.semantic)throw Error('check-page-reviews requires --semantic');
    const semantic=read(local(args.semantic)),expected=[...new Set(state.deliveries.filter(d=>d.stage==='stage3').flatMap(d=>d.outputs.filter(o=>state.artifact_authors[o.path]?.dispatch_id===d.dispatch_id).map(o=>o.path)))].sort();
    const passed=[];
    for(const page of expected){
      const author=state.artifact_authors[page],task=[...state.page_reviews].reverse().find(x=>x.page===page&&x.dispatch_id===author.dispatch_id&&x.status==='passed');
      if(!task)throw Error('Delivered Wiki page lacks recorded parent review: '+page);
      const bytes=fs.readFileSync(local(task.report_path));
      if(sha(bytes)!==task.report_sha256)throw Error('Recorded page review changed: '+task.report_path);
      verifyPageReview(root,run,semantic.consumption,{path:task.report_path,sha256:task.report_sha256},state.parent_reviewer.agent_id);passed.push(page);
    }
    return {status:'passed',reviewed_pages:passed};
  }
  if(action==='status'){
    const latest=new Map((state.page_reviews??[]).filter(t=>t.dispatch_id===(state.artifact_authors?.[t.page]?.dispatch_id??'existing')).map(t=>[t.page,t]));
    return {status:run.status,parent:state.parent_reviewer?.agent_id,dispatch_count:state.dispatches?.length??0,delivery_count:state.deliveries?.length??0,latest_delivery:state.deliveries?.at(-1),pending_reviews:[...latest.values()].filter(t=>t.status!=='passed').map(t=>({page:t.page,report_path:t.report_path})),evidence_path:relative(args.run),next_action:run.status==='stage2_planned'?'Continue page-group writing and parent review':'Continue per-article writing and parent review'};
  }
  throw Error('Actions: bind-parent, dispatch, deliver, record-page-review, refresh-page-reviews, check-page-reviews, status');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const [action,...argv]=process.argv.slice(2),a={};for(let i=0;i<argv.length;i+=2)a[argv[i].replace(/^--/,'')]=argv[i+1];console.log(JSON.stringify(pipeline(a.root,action,a),null,2));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
