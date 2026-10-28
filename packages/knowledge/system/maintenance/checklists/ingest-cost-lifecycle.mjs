import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectSessionCost, usageDelta} from './ingest-session-cost.mjs';

export function costSummary(cost) {
  return {window:cost.window,total:cost.total,parent:cost.parent,children:cost.children,timing:cost.timing,lifecycle:cost.lifecycle,phases:cost.phases,execution_conditions:cost.execution_conditions,
    sessions:cost.sessions.map(s=>({id:s.id,role:s.role,usage_status:s.usage_status,usage:s.usage,noncached_input_tokens:s.usage?s.usage.input_tokens-s.usage.cached_input_tokens:null,model_usage:s.model_usage,paired_seconds:s.turn_timing?.paired_elapsed_seconds??null})),
    scope:'Counter deltas through explicit cutoff. Cached input is included in input; paired time includes waits, open turns are partial. Not a bill or proof of optimization.'};
}

export function lifecycleWindows(start, timing, end) {
  const values=[start,timing?.review_ready_at,timing?.finish_started_at,timing?.finish_completed_at,end];
  if(values.some(x=>typeof x!=='string' || !/(Z|[+-]\d\d:\d\d)$/.test(x) || !Number.isFinite(Date.parse(x)))) return {status:'unavailable',reason:'Missing explicit lifecycle timestamps; updated_at is not a phase boundary.'};
  if(values.some((x,i)=>i && Date.parse(x)<Date.parse(values[i-1]))) throw Error('Lifecycle timestamps are out of order');
  const seconds=(a,b)=>(Date.parse(b)-Date.parse(a))/1000;
  return {status:'available',pre_review_seconds:seconds(start,values[1]),approval_interval_seconds:seconds(values[1],values[2]),post_approval_seconds:seconds(values[2],end),elapsed_seconds:seconds(start,end),
    boundary:'Approval interval includes any activity between report readiness and Finish invocation; it is not measured human waiting or active compute time.'};
}

export function phaseWindows(run,timing,start,end){
  const valid=t=>typeof t==='string'&&/(Z|[+-]\d\d:\d\d)$/.test(t)&&Number.isFinite(Date.parse(t));
  if(!valid(start)||!valid(end)||Date.parse(end)<Date.parse(start))throw Error('Invalid phase window');
  const events=run.execution_control?.advance?.cost_events??[];
  const marks=[{at:start,category:events.length?'normal_ingest':'pre_review_unclassified'}];
  for(const e of events){
    if(!valid(e.at)||!['normal_ingest','content_repair','workflow_recovery'].includes(e.category))throw Error('Invalid recorded cost event');
    if(Date.parse(e.at)>=Date.parse(start)&&(!timing?.review_ready_at||Date.parse(e.at)<Date.parse(timing.review_ready_at)))marks.push(e);
  }
  if(timing?.review_ready_at)marks.push({at:timing.review_ready_at,category:'review_interval_unallocated'});
  if(timing?.finish_started_at)marks.push({at:timing.finish_started_at,category:'approval_and_git_closure'});
  for(const m of marks)if(!valid(m.at))throw Error('Invalid phase boundary');
  const unique=[...new Map(marks.filter(m=>Date.parse(m.at)>=Date.parse(start)&&Date.parse(m.at)<Date.parse(end)).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)).map(m=>[Date.parse(m.at),m])).values()];
  return unique.map((m,i)=>({category:m.category,start:m.at,end:unique[i+1]?.at??end}));
}

export async function finalCost({run,sessions,parent,timing,start,end=new Date().toISOString(),phase='final'}) {
  if(phase==='review'?run.status!=='awaiting_final_review':run.status!=='completed') throw Error('Final cost requires completed run; review snapshot requires awaiting_final_review');
  start??=run.execution_control?.cost_window_start??run.started_at;
  const cost=await collectSessionCost({run,sessions,parent,start,end,phaseWindows:phaseWindows(run,timing,start,end)});
  const seal=run.execution_control?.host_cost;
  return {...cost,collection_phase:phase==='review'?'review_ready':'post_finish',lifecycle_complete:false,
    lifecycle:lifecycleWindows(cost.window.start,timing,end),
    since_maintenance_seal:seal?.window?.start===cost.window.start && seal.total?.status==='complete' && cost.total.status==='complete' ? usageDelta(cost.total.known_usage,seal.total.known_usage):null,
    coverage_scope:'Explicit cutoff only. Use phases for ingest cost: review_interval_unallocated may contain user waiting, delivery, retrospective or unrelated turns and is excluded from ingest comparisons. Recovery boundaries are observed controller events, not pure compute measurements. Open turns are partial. Historical review evidence remains unchanged.'};
}

if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args={};for(let i=2;i<process.argv.length;i+=2) args[process.argv[i].slice(2)]=process.argv[i+1];
    const read=p=>JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''));
    const run=read(args.run), timing=fs.existsSync(args.timing)?read(args.timing):null;
    if(args.output && fs.existsSync(args.output)) {
      const existing=read(args.output);
      if(existing.batch_id!==run.batch_id || existing.collection_phase!==(args.phase==='review'?'review_ready':'post_finish')) throw Error('Existing cost output belongs to another batch or phase');
      if((args.start&&Date.parse(args.start)!==Date.parse(existing.window.start))||(args.end&&Date.parse(args.end)!==Date.parse(existing.window.end)))throw Error('Existing cost cutoff differs; use a new output path or read-only snapshot');
      console.log(JSON.stringify({status:'reused',path:args.output,...costSummary(existing),coverage_scope:existing.coverage_scope},null,2));
    } else {
      const result=await finalCost({...args,run,timing});
      if(args.output)fs.writeFileSync(args.output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
      console.log(JSON.stringify({status:args.output?'collected':'snapshot',path:args.output??null,...costSummary(result),coverage_scope:args.output?result.coverage_scope:'Read-only snapshot through cutoff; includes observed Git work, excludes later delivery. Open turns remain partial; not pure compute.'},null,2));
    }
  } catch(e) {console.error(e.message);process.exitCode=2;}
}
