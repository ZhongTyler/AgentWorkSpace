import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import {fileURLToPath} from 'node:url';

const own = fileURLToPath(import.meta.url);
const fields = ['input_tokens', 'cached_input_tokens', 'output_tokens'];
const zero = () => Object.fromEntries(fields.map(k => [k, 0]));
function time(value) {
  if (typeof value !== 'string' || !/(Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw Error('Timestamp needs an explicit timezone: ' + value);
  return Date.parse(value);
}
export function usageDelta(end, begin) {
  if (!end || !begin) return null;
  const result = {};
  for (const key of fields) {
    if (!Number.isSafeInteger(end[key]) || !Number.isSafeInteger(begin[key])) return null;
    result[key] = end[key] - begin[key];
    if (result[key] < 0) return null;
  }
  if (result.cached_input_tokens > result.input_tokens) return null;
  return result;
}
async function* events(file) {
  const input = fs.createReadStream(file, {encoding: 'utf8'});
  const lines = readline.createInterface({input, crlfDelay: Infinity});
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try { event = JSON.parse(line); } catch { yield {malformed: true}; continue; }
      yield event;
    }
  } finally { lines.close(); input.destroy(); }
}
async function metadata(file) {
  for await (const event of events(file)) {
    if (event.type === 'session_meta') return {...event.payload, file, created: event.timestamp};
    break;
  }
  return null;
}
function logFiles(root) {
  const result = [];
  for (const entry of fs.readdirSync(root, {withFileTypes: true})) {
    if (entry.isSymbolicLink()) continue;
    const name = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...logFiles(name));
    else if (entry.name.endsWith('.jsonl')) result.push(name);
  }
  return result;
}
export async function readSession(meta, start, end, resumed = false, phaseWindows = []) {
  const from = time(start), until = time(end);
  let baseline = time(meta.created) >= from && !resumed ? zero() : null;
  let latest = null, firstAt = null, lastAt = null, malformed = 0, taskComplete = false;
  const models = [], closed = new Set();
  let previousUsage = time(meta.created) >= from && !resumed ? zero() : null, currentModel = null, openTurn = null;
  const byModel = new Map(), turns = []; let unallocatable = 0;
  const phaseUsage=phaseWindows.map(w=>({...w,usage:zero(),unallocatable_events:0}));
  for await (const event of events(meta.file)) {
    if (event.malformed) { malformed++; continue; }
    const at = time(event.timestamp);
    if (at > until) continue;
    const payload = event.payload ?? {};
    if (event.type === 'turn_context' && payload.model) currentModel = {model:payload.model,effort:payload.effort ?? payload.reasoning_effort ?? null,service_tier:payload.service_tier ?? 'unknown'};
    if (event.type === 'event_msg' && payload.type === 'token_count' && payload.info?.total_token_usage) {
      const currentUsage=payload.info.total_token_usage;
      if(at>=from) {
        // A resumed host log keeps cumulative counters but starts a new file.
        // Its first in-window event can supply the previous counter explicitly.
        if (!previousUsage && payload.info.last_token_usage) {
          const prior = {};
          for (const k of fields) prior[k] = currentUsage[k] - payload.info.last_token_usage[k];
          if (fields.every(k=>Number.isSafeInteger(prior[k])&&prior[k]>=0) && prior.cached_input_tokens<=prior.input_tokens && usageDelta(currentUsage, prior)) { previousUsage = prior; baseline ??= prior; }
        }
        const delta=usageDelta(currentUsage,previousUsage);
        const phase=phaseUsage.find((w,i)=>at>=time(w.start)&&(at<time(w.end)||(i===phaseUsage.length-1&&at===time(w.end))));
        if(phase){if(!delta)phase.unallocatable_events++;else for(const k of fields)phase.usage[k]+=delta[k];}
        if(!delta) unallocatable++;
        else {
        const config=currentModel??{model:'unknown',effort:null},key=JSON.stringify(config);
          if(!byModel.has(key))byModel.set(key,{...config,usage:zero(),token_events:0});
          const group=byModel.get(key);for(const k of fields)group.usage[k]+=delta[k];
          if(fields.some(k=>delta[k]>0))group.token_events++;
        }
      }
      previousUsage=currentUsage;
      if (at < from) baseline = payload.info.total_token_usage;
      else { latest = payload.info.total_token_usage; firstAt ??= event.timestamp; lastAt = event.timestamp; }
    }
    if(event.type==='event_msg' && payload.type==='task_started') {
      if(openTurn && at>=from)turns.push({...openTurn,end:null,status:'unmatched_start'});
      openTurn={start:event.timestamp};
    }
    if(event.type==='event_msg' && ['task_complete','task_completed','turn_aborted'].includes(payload.type) && openTurn) {
      if(at>=from)turns.push({...openTurn,observed_start:openTurn.start,start:new Date(Math.max(from,time(openTurn.start))).toISOString(),end:event.timestamp,status:payload.type==='turn_aborted'?'aborted':'completed',elapsed_seconds:(at-Math.max(from,time(openTurn.start)))/1000});
      openTurn=null;
    }
    if (at < from) continue;
    if (event.type === 'turn_context' && payload.model) {
      const config = {model: payload.model, effort: payload.effort ?? payload.reasoning_effort ?? null};
      if (JSON.stringify(models.at(-1)?.config) !== JSON.stringify(config)) models.push({at: event.timestamp, config});
    }
    if (event.type === 'event_msg' && ['task_complete','task_completed'].includes(payload.type)) taskComplete = true;
    if (event.type === 'response_item' && payload.type === 'function_call' && /close_agent$/.test(payload.name ?? '')) {
      try { const args = JSON.parse(payload.arguments); if (args.id) closed.add(args.id); } catch { /* unparseable calls are not closure evidence */ }
    }
  }
  if(openTurn)turns.push({...openTurn,end:null,status:'open_at_cutoff'});
  if (!latest && baseline) latest = baseline;
  const usage = usageDelta(latest, baseline);
  return {id: meta.id, log: meta.file, usage, usage_status: usage && !malformed && !unallocatable ? 'available' : 'partial_or_unavailable',
    phase_usage:phaseUsage,
    model_usage:{status:unallocatable||[...byModel.values()].some(x=>x.model==='unknown')?'partial':'available',unallocatable_events:unallocatable,rows:[...byModel.values()],basis:'Cumulative counter increments attributed to latest observed turn_context; not billing.'},
    turn_timing:{rows:turns,completed_count:turns.filter(x=>x.status==='completed').length,aborted_count:turns.filter(x=>x.status==='aborted').length,paired_elapsed_seconds:turns.filter(x=>x.end).reduce((n,x)=>n+x.elapsed_seconds,0),boundary:'Task intervals include tool waits and approvals; not active compute. Do not sum parallel sessions as wall time.'},
    first_token_at: firstAt, last_token_at: lastAt,
    token_event_span_seconds: firstAt ? (time(lastAt) - time(firstAt)) / 1000 : null,
    observed_task_complete: taskComplete, observed_close_requests: [...closed], models, malformed_lines: malformed};
}
export function pairedTurnUnion(rows,start,end) {
  const from=time(start),until=time(end),intervals=[];
  for(const session of rows)for(const t of session.turn_timing?.rows??[])if(t.end) {
    const a=Math.max(from,time(t.start)),b=Math.min(until,time(t.end));if(b>a)intervals.push([a,b]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);const merged=[];
  for(const [a,b] of intervals){const last=merged.at(-1);if(last&&a<=last[1])last[1]=Math.max(last[1],b);else merged.push([a,b]);}
  return {status:rows.length>0&&rows.every(r=>r.turn_timing&&!r.malformed_lines&&r.turn_timing.rows.length>0&&r.turn_timing.rows.every(t=>t.end))?'complete_paired_intervals':'partial',
    seconds:merged.reduce((n,[a,b])=>n+(b-a)/1000,0),
    basis:'Union of paired task intervals clipped to cost window; excludes gaps between turns, includes within-turn tool/approval waits. Not pure compute. Open/unmatched turns are not estimated.'};
}
function combineSessionSegments(parts) {
  if (parts.length === 1) return parts[0];
  const usage = parts.every(x=>x.usage) ? parts.reduce((sum,x)=>{
    for (const k of fields) sum[k]+=x.usage[k];
    return sum;
  },zero()) : null;
  const modelRows = new Map();
  for (const part of parts) for (const row of part.model_usage.rows) {
    const key=JSON.stringify([row.model,row.effort,row.service_tier]);
    if (!modelRows.has(key)) modelRows.set(key,{...row,usage:zero(),token_events:0});
    const target=modelRows.get(key);
    for (const k of fields) target.usage[k]+=row.usage[k];
    target.token_events+=row.token_events;
  }
  const turns=parts.flatMap(x=>x.turn_timing.rows);
  const first=parts.map(x=>x.first_token_at).filter(Boolean).sort()[0]??null;
  const last=parts.map(x=>x.last_token_at).filter(Boolean).sort().at(-1)??null;
  return {
    id:parts[0].id, log:parts.at(-1).log, logs:parts.map(x=>x.log),
    usage, usage_status:parts.every(x=>x.usage_status==='available')?'available':'partial_or_unavailable',
    phase_usage:(parts[0].phase_usage??[]).map((row,i)=>({...row,usage:parts.reduce((sum,p)=>{for(const k of fields)sum[k]+=p.phase_usage[i].usage[k];return sum;},zero()),unallocatable_events:parts.reduce((n,p)=>n+p.phase_usage[i].unallocatable_events,0)})),
    model_usage:{status:parts.every(x=>x.model_usage.status==='available')?'available':'partial',
      unallocatable_events:parts.reduce((n,x)=>n+x.model_usage.unallocatable_events,0),
      rows:[...modelRows.values()],basis:parts[0].model_usage.basis},
    turn_timing:{rows:turns,completed_count:turns.filter(x=>x.status==='completed').length,
      aborted_count:turns.filter(x=>x.status==='aborted').length,
      paired_elapsed_seconds:turns.filter(x=>x.end).reduce((n,x)=>n+x.elapsed_seconds,0),
      boundary:parts[0].turn_timing.boundary},
    first_token_at:first,last_token_at:last,
    token_event_span_seconds:first&&last?(time(last)-time(first))/1000:null,
    observed_task_complete:parts.some(x=>x.observed_task_complete),
    observed_close_requests:[...new Set(parts.flatMap(x=>x.observed_close_requests))],
    models:parts.flatMap(x=>x.models).sort((a,b)=>time(a.at)-time(b.at)),
    malformed_lines:parts.reduce((n,x)=>n+x.malformed_lines,0)
  };
}
export async function collectSessionCost({run, sessions, parent, start = run.execution_control?.cost_window_start ?? run.started_at, end = new Date().toISOString(), phaseWindows = []}) {
  if (time(end) < time(start)) throw Error('End precedes start.');
  if (run.execution_control?.cost_window_start && time(run.execution_control.cost_window_start) > time(run.started_at)) throw Error('Configured startup window cannot begin after run creation');
  if (!parent) throw Error('An explicit parent session ID is required.');
  const registered = new Map((run.execution_control?.agent_sessions ?? []).filter(x => x.agent_id).map(x => [x.agent_id, x]));
  const allMetas = new Map(), metas = new Map();
  for (const file of logFiles(sessions)) {
    const meta = await metadata(file);
    if (!meta?.id) continue;
    if (!allMetas.has(meta.id)) allMetas.set(meta.id, []);
    allMetas.get(meta.id).push(meta);
  }
  for (const [id, group] of allMetas) {
    group.sort((a,b)=>time(a.created)-time(b.created));
    for (let i=1;i<group.length;i++) {
      if (time(group[i].created)===time(group[i-1].created))
        throw Error('Duplicate host session segment timestamp: '+id);
    }
    const within=group.map((meta,i)=>({...meta,resumed:i>0})).filter((meta,i)=>time(meta.created)<=time(end)
      && (i===group.length-1 || time(group[i+1].created)>time(start)));
    if (within.length) metas.set(id,within);
  }
  if (!metas.has(parent)) throw Error('Parent session log not found.');
  const selected = new Set([parent, ...registered.keys()]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const group of metas.values()) for (const meta of group) {
      const parentId = meta.source?.subagent?.thread_spawn?.parent_thread_id;
      if (!selected.has(meta.id) && selected.has(parentId) && time(meta.created) >= time(start) && time(meta.created) <= time(end)) {
        selected.add(meta.id); changed = true;
      }
    }
  }
  const rows = [];
  for (const id of selected) {
    const record = registered.get(id), group = metas.get(id);
    const row = group ? combineSessionSegments(await Promise.all(group.map(meta=>readSession(meta,start,end,meta.resumed,phaseWindows))))
      : {id, usage: null, usage_status: 'missing_log', models: []};
    row.role = id === parent ? 'parent' : record ? record.role ?? 'registered_child' : 'unregistered_child';
    row.registered_status = record?.status ?? null;
    const executionStart = record?.started_at ?? start;
    // A closed writer can still be resumed for an in-window backtest repair.
    // Do not hide that turn merely because its registry was closed earlier.
    const executionEnd = ['content_writer','raw_writer','wiki_writer'].includes(record?.role) ? end : record?.ended_at ?? end;
    const initial = row.models.filter(x => time(x.at) <= time(executionStart)).at(-1);
    row.execution_models = [...(initial ? [initial] : []), ...row.models.filter(x => time(x.at) > time(executionStart) && time(x.at) <= time(executionEnd))];
    row.configuration_status = row.execution_models.length ? 'observed' : 'unavailable';
    row.configuration_drift = !!record && row.execution_models.some(x => x.config.model !== record.model || (x.config.effort && x.config.effort !== record.reasoning_effort));
    row.recorded_negative_duration = record?.duration_seconds < 0;
    rows.push(row);
  }
  const aggregate = group => {
    const available = group.filter(x => x.usage);
    const known = available.reduce((sum, row) => { for (const k of fields) sum[k] += row.usage[k]; return sum; }, zero());
    return {status: group.every(x => x.usage_status === 'available') ? 'complete' : 'partial', known_usage: known,
      missing_session_ids: group.filter(x => x.usage_status !== 'available').map(x => x.id)};
  };
  return {schema_version: 1, batch_id: run.batch_id, window: {start, end}, parent_session_id: parent,
    execution_conditions:run.execution_control?.execution_conditions??{fast:'unknown',parent_context:'unknown'},
    startup_seconds_before_run:Math.max(0,(time(run.started_at)-time(start))/1000),
    timing: {elapsed_window_seconds: (time(end) - time(start)) / 1000, active_execution_seconds: null, paired_task_union:pairedTurnUnion(rows,start,end),
      basis: 'Window includes pauses and waiting. Active execution is unavailable without measured turn intervals; child durations overlap and must not be added to parent wall time.'},
    coverage_scope:'explicit_window_only', lifecycle_complete:false,
    phases:phaseWindows.map((w,i)=>({...w,status:rows.every(r=>r.usage_status==='available'&&r.phase_usage?.[i]?.unallocatable_events===0)?'complete':'partial',known_usage:rows.reduce((sum,r)=>{for(const k of fields)sum[k]+=r.phase_usage?.[i]?.usage[k]??0;return sum;},zero()),timing:pairedTurnUnion(rows,w.start,w.end)})),
    actual_child_session_count: rows.length - 1, unregistered_child_ids: rows.filter(x => x.role === 'unregistered_child').map(x => x.id),
    parent: aggregate(rows.filter(x => x.role === 'parent')), children: aggregate(rows.filter(x => x.role !== 'parent')), total: aggregate(rows), sessions: rows,
    accounting_boundary: 'Local cumulative-counter deltas; cached input is included in input. Not a billing statement. Event spans include idle time and must not be summed as wall time. Descendants launched by the parent in this explicit batch window are in scope; inspect unregistered sessions for ownership.'};
}
async function cli() {
  const args = {};
  for (let i = 2; i < process.argv.length; i += 2) {
    if (!process.argv[i].startsWith('--') || !process.argv[i + 1]) throw Error('Expected --name value.');
    args[process.argv[i].slice(2)] = process.argv[i + 1];
  }
  const run = JSON.parse(fs.readFileSync(args.run, 'utf8').replace(/^\uFEFF/, ''));
  const result = await collectSessionCost({...args, run});
  if (args.output) fs.writeFileSync(args.output, JSON.stringify(result, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify(args.output ? {path: args.output, total: result.total, actual_child_session_count: result.actual_child_session_count, unregistered_child_ids: result.unregistered_child_ids} : result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === own) cli().catch(e => { console.error(e.message); process.exitCode = 2; });
