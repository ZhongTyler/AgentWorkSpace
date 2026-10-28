import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {reviewSession} from './reviewer-route.mjs';

export function validateStage3(semantic) {
  if (!Array.isArray(semantic?.rows)) throw Error('stage3.rows must be an array');
  for (const [index, row] of semantic.rows.entries()) {
    for (const key of ['artifact', 'knowledge_summary', 'source_boundary', 'disposition', 'verification']) {
      if (typeof row?.[key] !== 'string' || !row[key].trim()) throw Error(`stage3.rows[${index}].${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(semantic.splits)) throw Error('stage3.splits must explicitly be an array');
  for (const split of semantic.splits) for (const key of ['before', 'after', 'reason', 'content_destination', 'source_destination', 'verification']) {
    if (!split?.[key] || (typeof split[key] === 'string' && !split[key].trim())) throw Error(`Split result missing ${key}`);
  }
  return {status: 'passed', row_count: semantic.rows.length};
}

export function summarizeRun(run) {
  const state = run.execution_control ?? {};
  const active = state.raw_review_attempts ?? [], history = state.raw_review_history ?? [], sessions = state.agent_sessions ?? [];
  return {
    batch_id: run.batch_id, status: run.status, counts: run.counts, commits: run.commits, final_review: run.final_review,
    review_attempts: {current: active.length, historical: history.length, total: active.length + history.length},
    session_budget: {used: sessions.length, cap: state.child_session_cap, remaining: state.child_session_cap - sessions.length},
    sessions: sessions.map(({session_key, agent_id, role, status, close_reason}) => ({session_key, agent_id, role, status, close_reason})),
    pending_reviews: active.filter(x => x.status !== 'passed').map(({raw_path, status, request_path, report_path}) => ({raw_path, status, request_path, report_path})),
    evidence: {package_data: run.package_data?.path, maintenance: run.packages?.maintenance?.path},
    review_channel: state.preferred_review_channel ?? 'legacy',
    execution_profile: state.execution_profile ?? 'existing',
    next_entry: state.execution_profile==='consolidated-v1'?'ingest-control.ps1 -Action advance':'original version-specific entry',
    parent_review: state.reviewer_route_version===3 ? {agent_id:state.parent_reviewer?.agent_id,model:state.parent_reviewer?.model,reasoning_effort:state.parent_reviewer?.reasoning_effort,review_mode:'parent_non_author',dispatches:state.dispatches?.length??0,deliveries:state.deliveries?.length??0} : null,
    core_pending_reviews: (state.core_review_attempts??[]).filter(x=>x.status!=='passed').map(({raw_path,status,request_path,report_path})=>({raw_path,status,request_path,report_path})),
    quality: qualitySummary(run),
    cost: state.host_cost ? {window:state.host_cost.window,total:state.host_cost.total,parent:state.host_cost.parent,
      coverage_scope:'explicit_window_only',lifecycle_complete:false,post_finish_path:'cost-final.json (if collected; Inspect lists the exact path)'} : null,
    context_budget: {default_output:'summary',full_history:'on_dependency_change_only',new_batch:'fresh_or_compact_parent',child_fork_context:false},
    reading_contract: 'Expand only pending findings or changed dependencies. Read source/Raw/Wiki prose in full for semantic work; do not dump full run or maintenance JSON into the parent context.'
  };
}

export function qualitySummary(run) {
  const events=[...(run.execution_control?.quality_events??[])].sort((a,b)=>String(a.recorded_at).localeCompare(String(b.recorded_at)));
  const first=new Map();
  for(const event of events) if(event.detection_stage==='first_review' && event.raw_path && !first.has(event.raw_path)) first.set(event.raw_path,event);
  const rows=[...first.values()], passed=rows.filter(x=>x.result==='passed').length;
  return {first_review_article_count:rows.length,first_review_passed_count:passed,first_review_pass_rate:rows.length?passed/rows.length:null,
    first_review_finding_count:rows.some(x=>x.review_kind==='core_full' && !x.finding_count_basis)?null:rows.reduce((sum,x)=>sum+(x.first_review_finding_count??x.finding_count??0),0),
    first_review_failure_signal_count:rows.filter(x=>x.review_kind==='core_full').reduce((sum,x)=>sum+(x.failure_signal_count??x.finding_count??0),0),
    finding_count_scope:'Explicit report findings; legacy core events counted failure signals, so explicit total is unknown until reports are reconciled. Neither is a deduplicated semantic defect count.',
    duplicate_first_review_events:events.filter(x=>x.detection_stage==='first_review').length-rows.length,
    missed_defect_rate:null,missed_defect_rate_reason:'No independent post-review sample denominator; final pass is not zero missed defects',
    counting_unit:'first chronological review per Raw article in this batch; rebind/re-review is not a new first review'};
}

export function controllerHandoff(root, runPath) {
  const base=fs.realpathSync(root), full=fs.realpathSync(path.resolve(base,runPath));
  if(!full.startsWith(base+path.sep)) throw Error('Run escapes Knowledge');
  const bytes=fs.readFileSync(full),run=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
  const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
  const references=[{path:path.relative(base,full).replaceAll('\\','/'),sha256:digest(bytes)}];
  for (const p of new Set([
    ...Object.values(run.packages??{}).map(x=>x?.path).filter(Boolean),run.final_review?.path].filter(Boolean))) {
    const file=fs.realpathSync(path.resolve(base,p));
    if(!file.startsWith(base+path.sep)) throw Error('Evidence escapes Knowledge');
    references.push({path:p,sha256:digest(fs.readFileSync(file)),kind:'evidence_reference'});
  }
  for(const item of run.artifacts??[]) {
    const file=fs.realpathSync(path.resolve(base,item.path));
    if(!file.startsWith(base+path.sep)) throw Error('Artifact escapes Knowledge');
    references.push({path:item.path,sha256:digest(fs.readFileSync(file)),kind:item.kind,disposition:item.disposition});
  }
  return {schema_version:1,...summarizeRun(run),references,
    entrypoints:{control:'system/maintenance/checklists/ingest-control.ps1',stage3:'system/maintenance/checklists/finalize-ingest-stage3.ps1',batch:'system/maintenance/checklists/ingest-batch.mjs'},
    next_action: run.status==='completed'?'Inspect committed exit paths and parent gitlink; do not restart ingestion':
      run.status==='awaiting_final_review'?'Verify existing report/content manifest and wait for its exact approval hash':
      'Continue only the pending stage from the compact run summary; prepare-context supplies required prose and rules',
    authority:'Derived handoff, not a new run or approval. Verify every reference hash before resuming; regenerate if state changed.'};
}

export function verifyHandoff(root, handoff) {
  const base=fs.realpathSync(root);
  if(handoff.schema_version!==1 || !Array.isArray(handoff.references) || !handoff.references.length) throw Error('Invalid handoff');
  for(const item of handoff.references) {
    const full=fs.realpathSync(path.resolve(base,item.path));
    if(!full.startsWith(base+path.sep)) throw Error('Handoff reference escapes Knowledge');
    if(crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex')!==item.sha256) throw Error('Stale handoff: '+item.path);
  }
  return {status:'passed',batch_id:handoff.batch_id,reference_count:handoff.references.length};
}

// Execute in the reviewer runtime: file access in the parent cannot prove child access.
export function agentConfiguration({run, agent, log, turnStartedAt}) {
  const session = reviewSession(run, agent);
  if (!session || !session.started_at) throw Error('Reviewer must be bound before preflight');
  if (!Number.isFinite(Date.parse(session.started_at))) throw Error('Invalid reviewer start timestamp');
  if (!['raw_reviewer', 'core_reviewer', 'raw_writer', 'content_writer', 'wiki_writer'].includes(session.role)) throw Error('Not a registered writer/reviewer');
  const events = fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).map(x => JSON.parse(x));
  if (!events.some(x => x.type === 'session_meta' && x.payload?.id === agent)) throw Error('Host session identity mismatch');
  const configs = events.filter(x => x.type === 'turn_context' && x.payload?.model);
  if (configs.some(x => !Number.isFinite(Date.parse(x.timestamp)))) throw Error('Invalid host model timestamp');
  const initial = configs.filter(x => Date.parse(x.timestamp) <= Date.parse(session.started_at)).at(-1);
  const isBoundTask=run.execution_control?.task_session_bindings?.host==='codex'&&Object.values(run.execution_control.task_session_bindings).some(x=>x?.thread_id===agent);
  const observed = isBoundTask?configs.filter(x=>Date.parse(x.timestamp)>=Date.parse(session.started_at)):[...(initial ? [initial] : []), ...configs.filter(x => Date.parse(x.timestamp) > Date.parse(session.started_at))];
  if (!observed.length) throw Error('Host model configuration unavailable');
  if (turnStartedAt !== undefined) {
    const since = Date.parse(turnStartedAt);
    if (!Number.isFinite(since)) throw Error('Invalid dispatch timestamp');
    if (Date.parse(observed.at(-1).timestamp) < since) {
      const dispatches = run.execution_control?.dispatches ?? [];
      const dispatch = dispatches.find(x => x.agent_id === agent && x.dispatched_at === turnStartedAt);
      throw Error((dispatch ? 'TURN_NOT_READY' : 'INVALID_OR_UNRECORDED_DISPATCH_TIME') + ': current turn predates supplied dispatch; do not replace agent until the dispatch time is checked');
    }
  }
  for (const x of observed) {
    if (x.payload.model !== session.model || (x.payload.effort ?? x.payload.reasoning_effort) !== session.reasoning_effort) throw Error('Agent configuration mismatch: expected '+session.model+'/'+session.reasoning_effort+', observed '+x.payload.model+'/'+(x.payload.effort ?? x.payload.reasoning_effort));
  }
  return {status: 'passed', agent_id: agent, model: session.model, reasoning_effort: session.reasoning_effort,
    observed_turn_count: observed.length, last_turn_at: observed.at(-1).timestamp,
    authority: 'turn_context; session_meta model fields are provenance only'};
}

export function reviewerConfiguration(options) {
  const session=reviewSession(options.run,options.agent);
  if (!['raw_reviewer','core_reviewer'].includes(session?.role)) throw Error('Not a registered reviewer');
  return agentConfiguration(options);
}

// Reuse the host path observed at parent binding. Configuration verification
// still checks session identity and actual model/effort on every verification.
export function boundReviewerLog(run,agent) {
  if(run.execution_control?.parent_reviewer?.agent_id===agent&&run.execution_control.parent_reviewer.log)return run.execution_control.parent_reviewer.log;
  return findReviewerLog(agent);
}

export function findReviewerLog(agent, sessionsRoot = path.join(process.env.CODEX_HOME || path.join(process.env.USERPROFILE || '', '.codex'), 'sessions')) {
  if (!/^[A-Za-z0-9-]+$/.test(agent)) throw Error('Invalid reviewer identity');
  const matches = [];
  const namePattern = new RegExp(`(?:^|-)${agent}(?:_[A-Za-z0-9-]+)?\\.jsonl$`);
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
      if (entry.isSymbolicLink()) continue;
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (namePattern.test(entry.name)) matches.push(full);
    }
  };
  walk(sessionsRoot);
  if (!matches.length) throw Error('Reviewer host log not found: ' + agent);
  // Desktop resumption creates a new segment with a turn suffix. Its current
  // model context lives in the newest segment; old segments may be enormous.
  matches.sort((a,b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs || b.localeCompare(a));
  return matches[0];
}

export function preflightReviewer({run, agent, log, requests, root, turnStartedAt}) {
  const configuration = reviewerConfiguration({run, agent, log: log || findReviewerLog(agent), turnStartedAt});
  if (!requests?.length) throw Error('Explicit request paths required');
  const base = fs.realpathSync(root);
  const readBound = item => {
    if (!item?.path || !item.sha256) throw Error('Bound input needs path and sha256');
    const full = fs.realpathSync(path.resolve(base, item.path));
    if (!full.startsWith(base + path.sep)) throw Error('Input escapes Knowledge');
    const bytes = fs.readFileSync(full);
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== item.sha256) throw Error('Input hash mismatch: ' + item.path);
  };
  for (const request of requests) {
    const full = fs.realpathSync(path.resolve(base, request));
    if (!full.startsWith(base + path.sep)) throw Error('Request escapes Knowledge');
    const data = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
    const inputs = data.audit_scope === 'core_claim_bidirectional'
      ? [data.raw, data.source, data.ledger, ...(data.dependencies ?? [])]
      : [data.raw, data.manifest, ...(data.sources ?? []), ...(data.dependencies ?? [])];
    for (const input of inputs) readBound(input);
  }
  return {...configuration, readable_requests: requests.length, next_action: 'Perform semantic review. Repeat preflight immediately on every new/resumed turn before reading or writing; configuration mismatch blocks completion.'};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [action, ...argv] = process.argv.slice(2), args = {};
    for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
    const read = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    const result = action === 'stage3' ? validateStage3(read(args.semantic))
      : action === 'summary' ? summarizeRun(read(args.run))
      : action === 'quality-summary' ? qualitySummary(read(args.run))
      : action === 'handoff' ? controllerHandoff(args.root,args.run)
      : action === 'verify-handoff' ? verifyHandoff(args.root,read(args.handoff))
      : action === 'agent-preflight' ? (()=>{if(!args['turn-started-at'])throw Error('Dispatch timestamp --turn-started-at required');return agentConfiguration({run:read(args.run),agent:args.agent,log:args.log||findReviewerLog(args.agent),turnStartedAt:args['turn-started-at']});})()
      : action === 'reviewer-preflight' ? preflightReviewer({run: read(args.run), agent: args.agent, log: args.log, root: args.root, requests: args.requests?.split('|'),turnStartedAt:args['turn-started-at']})
      : (() => { throw Error('Unknown runtime contract action'); })();
    console.log(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
