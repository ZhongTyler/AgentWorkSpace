import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe, sha, styleCheck} from './raw-quality.mjs';
import {metadataPreflight, metadataDelta, checkReviewerRuntime} from './ingest-review-support.mjs';
import {reviewerRoute, matchesReviewerRoute, parentReview, rawProducer, assertReviewOwnership, assertDelivered} from './reviewer-route.mjs';

const own = fileURLToPath(import.meta.url);
const RULESET = 'core-claim-bidirectional-20260914';
const reviewDependencies = ['core-review-control.mjs','ingest-review-support.mjs','raw-quality.mjs','raw-standard-v2.md','raw-writing-v2.md'].map(x=>'system/maintenance/checklists/'+x);
const assert = (ok, message) => { if (!ok) throw Error(message); };
const nowIso = () => new Date().toISOString();
const clean = value => JSON.stringify(value, null, 2) + '\n';
const readText = (root, value) => fs.readFileSync(safe(root, value), 'utf8').replace(/^\uFEFF/, '');
const readJson = (root, value) => JSON.parse(readText(root, value));
const hashFile = (root, value) => sha(fs.readFileSync(safe(root, value)));
const rel = (root, value) => path.relative(root, value).split(path.sep).join('/');

function runDirectory(root, runPath) { return path.dirname(safe(root, runPath)); }
function assertRunLocal(root, runPath, candidate, mustExist = false) {
  const directory = runDirectory(root, runPath) + path.sep;
  const full = safe(root, candidate, mustExist);
  assert(full.startsWith(directory), 'Core-review evidence must stay beside the run manifest: ' + candidate);
  return full;
}
function writeOnce(root, value, data) {
  const full = safe(root, value, false), text = clean(data);
  if (fs.existsSync(full)) { assert(fs.readFileSync(full, 'utf8') === text, 'Evidence already exists with different content: ' + value); return false; }
  fs.mkdirSync(path.dirname(full), {recursive: true}); fs.writeFileSync(full, text); return true;
}
function saveRun(root, runPath, run, at = nowIso()) { run.updated_at = at; fs.writeFileSync(safe(root, runPath), clean(run)); }
function stateFor(run) {
  const state = run.execution_control;
  assert(run.schema_version >= 8 && state?.schema_version === 2, 'Core review requires a writable schema8 execution_control v2 run.');
  assert(Array.isArray(state.agent_sessions), 'Core review requires agent_sessions.');
  state.core_review_attempts ??= [];
  state.core_review_history ??= [];
  state.core_review_policy ??= {mode: 'single_primary', primary_agent_id: null, primary_context_id: null};
  assert(state.core_review_policy.mode === 'single_primary', 'Core review requires single_primary policy.');
  return state;
}
function assertWritable(run) { assert(['running_scoring', 'scoring_approved', 'stage2_planned'].includes(run.status), 'Core review is not allowed from run status: ' + run.status); }
function rawArtifact(run, rawPath) { assert((run.artifacts ?? []).filter(x => x.kind === 'raw' && x.disposition === 'ingested' && x.path === rawPath).length === 1, 'Core review requires one ingested Raw artifact: ' + rawPath); }
function inputArtifact(run, sourcePath) { assert((run.artifacts ?? []).filter(x => x.kind === 'input' && x.disposition === 'ingested' && x.path === sourcePath).length === 1, 'Core review requires one ingested input artifact: ' + sourcePath); }
function lines(text) { return text.split(/\r?\n/); }
export function sectionInventory(text) {
  const rows = lines(text), starts = [];
  let begin = 0, fence = false;
  if (rows[0]?.trim() === '---') {
    const end = rows.findIndex((x, i) => i > 0 && x.trim() === '---');
    assert(end >= 0, 'Unclosed frontmatter.'); begin = end + 1;
  }
  starts.push(begin);
  for (let i = begin; i < rows.length; i++) {
    if (/^\s*(`{3,}|~{3,})/.test(rows[i])) { fence = !fence; continue; }
    if (!fence && /^#{1,6}\s+/.test(rows[i]) && i !== begin) starts.push(i);
  }
  return starts.map((start, i) => ({start, end: (starts[i + 1] ?? rows.length) - 1}))
    .filter(({start, end}) => rows.slice(start, end + 1).some(x => x.trim()))
    .map(({start, end}, i) => ({id: 'S' + (i + 1), line_start: start + 1, line_end: end + 1, heading: rows[start].trim().slice(0, 160)}));
}
function validRanges(value, max, label) {
  assert(Array.isArray(value) && value.length, label + ' requires at least one line range.');
  for (const range of value) assert(Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) && range[0] >= 1 && range[1] >= range[0] && range[1] <= max, 'Invalid ' + label + ' line range.');
}
function inRanges(textLines, ranges, quote, label) {
  assert(typeof quote === 'string' && quote.trim(), label + ' quote is required.');
  assert(ranges.some(([start, end]) => textLines.slice(start - 1, end).join('\n').includes(quote)), label + ' quote is not contained by its declared range.');
}
function ledgerFor(root, run, rawPath, ledgerPath) {
  rawArtifact(run, rawPath); assertRunLocal(root, run.__path, ledgerPath, true);
  const ledger = readJson(root, ledgerPath);
  assert(ledger.schema_version === 1 && ledger.ruleset === RULESET, 'Unsupported core-claim ledger.');
  assert(ledger.raw?.path === rawPath && ledger.raw.sha256 === hashFile(root, rawPath), 'Core-claim ledger Raw binding drifted.');
  assert(typeof ledger.source?.path === 'string' && ledger.source.sha256 === hashFile(root, ledger.source.path), 'Core-claim ledger source binding drifted.');
  inputArtifact(run, ledger.source.path);
  const sourceLines = lines(readText(root, ledger.source.path)), rawLines = lines(readText(root, rawPath));
  assert(Array.isArray(ledger.claims) && ledger.claims.length >= 1, 'Core-claim ledger requires all necessary claims, with no fixed quota.');
  const ids = new Set();
  for (const claim of ledger.claims) {
    assert(typeof claim.id === 'string' && /^C[1-9]\d*$/.test(claim.id) && !ids.has(claim.id), 'Core-claim IDs must be unique positive C identifiers.'); ids.add(claim.id);
    assert(typeof claim.meaning === 'string' && claim.meaning.trim(), 'Each core claim needs a meaning.');
    validRanges(claim.source_ranges, sourceLines.length, 'source'); validRanges(claim.raw_ranges, rawLines.length, 'Raw');
    inRanges(sourceLines, claim.source_ranges, claim.source_quote, 'Source'); inRanges(rawLines, claim.raw_ranges, claim.raw_quote, 'Raw');
  }
  assert(ledger.exclusion_policy?.version === 1 && Array.isArray(ledger.exclusion_policy.categories), 'Ledger must declare deterministic exclusion policy v1.');
  return ledger;
}
function template(request) {
  return {schema_version: 1, ruleset: RULESET, request_sha256: null, reviewer_context_id: 'FILL_REVIEWER_CONTEXT_ID', producer_context_id: request.producer_context_id, fresh_context: request.review_mode !== 'parent_non_author',
    checks: request.claims.map(claim => ({id: claim.id, source_status: 'FILL_STATUS', raw_status: 'FILL_STATUS', source_quote: 'FILL_SOURCE_QUOTE', raw_quote: 'FILL_RAW_QUOTE', note: 'FILL_NOTE'})),
    coverage: {ledger_complete: null, missing_claims: [], source_sections: request.source_sections.map(x => ({id:x.id,status:'FILL_STATUS',claim_ids:[],reason:'FILL_REASON'})), raw_sections: request.raw_sections.map(x => ({id:x.id,status:'FILL_STATUS',reason:'FILL_REASON'}))}, findings: []};
}
function coverageErrors(request, report) {
  const errors = [], c = report.coverage;
  if (request.coverage_contract !== 2) return ['Regenerate pending request with coverage contract v2; historical sealed receipts remain read-only.'];
  if (!c || typeof c.ledger_complete !== 'boolean' || !Array.isArray(c.missing_claims)) return ['coverage ledger completeness and missing_claims are required'];
  if (!Array.isArray(report.findings)) errors.push('findings must be an array');
  if (request.review_mode === 'parent_non_author' ? report.fresh_context !== false : report.fresh_context !== true) errors.push('fresh_context must describe the actual review mode');
  for (const key of ['source_sections','raw_sections']) {
    const rows = c[key];
    if (!Array.isArray(rows) || rows.length !== request[key].length || new Set(rows.map(x=>x.id)).size !== request[key].length || request[key].some(x=>!rows.some(y=>y.id===x.id))) { errors.push('coverage must account for every ' + key); continue; }
    for (const row of rows) {
      const allowed = key === 'source_sections' ? ['covered','excluded','missing','uncertain'] : ['supported','excluded','unsupported','uncertain'];
      if (!allowed.includes(row.status) || typeof row.reason !== 'string' || !row.reason.trim() || row.reason.startsWith('FILL_')) errors.push(key + ':' + row.id + ': invalid judgment');
      if (key === 'source_sections' && row.status === 'covered' && (!Array.isArray(row.claim_ids) || !row.claim_ids.length || row.claim_ids.some(id=>!request.claims.some(x=>x.id===id)))) errors.push(row.id + ': covered source section needs valid claim_ids');
    }
  }
  return errors;
}
function attemptFor(state, rawPath) { const rows = state.core_review_attempts.filter(x => x.raw_path === rawPath && x.status === 'prepared'); assert(rows.length === 1, 'Expected exactly one prepared core review: ' + rawPath); return rows[0]; }
function preflightData(root, run, state, rawPath) {
  const attempt = attemptFor(state, rawPath), request = readJson(root, attempt.request_path), errors = []; let report;
  try { report = readJson(root, attempt.report_path); } catch (error) { errors.push('report_json: ' + error.message); return {attempt, request, errors, report: null}; }
  for (const field of ['schema_version','ruleset','request_sha256','reviewer_context_id','producer_context_id','fresh_context','checks','findings']) if (!Object.hasOwn(report, field)) errors.push('missing_field: ' + field);
  if (report.schema_version !== 1 || report.ruleset !== RULESET) errors.push('wrong_schema_or_ruleset');
  if (report.request_sha256 !== attempt.request_sha256) errors.push('request_sha256_mismatch');
  if (report.producer_context_id !== request.producer_context_id) errors.push('producer_context_mismatch');
  if (typeof report.reviewer_context_id !== 'string' || !report.reviewer_context_id.trim() || report.reviewer_context_id === request.producer_context_id) errors.push('invalid_reviewer_context');
  const checks = Array.isArray(report.checks) ? report.checks : [];
  const ids = new Set(checks.map(x => x.id));
  if (checks.length !== request.claims.length || ids.size !== request.claims.length || request.claims.some(x => !ids.has(x.id))) errors.push('checks_must_exactly_match_claim_ledger');
  const rawLines = lines(readText(root, request.raw.path));
  for (const check of checks) {
    const claim = request.claims.find(x => x.id === check.id); if (!claim) continue;
    if (!['complete','partial','missing','distorted'].includes(check.source_status)) errors.push(check.id + ': invalid source_status');
    if (!['supported','partial','unsupported','overstated'].includes(check.raw_status)) errors.push(check.id + ': invalid raw_status');
    if (check.source_quote !== claim.source_quote) errors.push(check.id + ': source_quote must exactly restate the ledger evidence');
    if (typeof check.raw_quote !== 'string' || !check.raw_quote.trim() || !rawLines.join('\n').includes(check.raw_quote)) errors.push(check.id + ': raw_quote must be an exact Raw quote');
    if (typeof check.note !== 'string' || !check.note.trim() || check.note.startsWith('FILL_')) errors.push(check.id + ': note is required');
  }
  errors.push(...coverageErrors(request, report));
  return {attempt, request, report, errors};
}
// Structural checks before allocating immutable request/report paths. Semantic failures
// remain valid reports and are evaluated by completeCoreReview, not converted to PASS.
export function bundleDecisionErrors(request, input, rawText) {
  const errors=coverageErrors({...request,coverage_contract:2},input??{});
  const checks=input?.checks;
  if(!Array.isArray(checks))return [...errors,'checks must be an array'];
  if(checks.length!==request.claims.length || new Set(checks.map(x=>x.id)).size!==request.claims.length || request.claims.some(x=>!checks.some(y=>y.id===x.id)))errors.push('checks must exactly match claims');
  for(const check of checks) {
    if(!['complete','partial','missing','distorted'].includes(check.source_status))errors.push(check.id+': invalid source_status');
    if(!['supported','partial','unsupported','overstated'].includes(check.raw_status))errors.push(check.id+': invalid raw_status');
    if(typeof check.raw_quote!=='string'||!check.raw_quote.trim()||!rawText.includes(check.raw_quote))errors.push(check.id+': exact raw_quote required');
    if(typeof check.note!=='string'||!check.note.trim()||check.note.startsWith('FILL_'))errors.push(check.id+': note required');
  }
  return errors;
}
export function preflightCoreReview(root, options) {
  root = fs.realpathSync(root); const run = readJson(root, options.run); run.__path = options.run; const state = stateFor(run); assertWritable(run);
  const value = preflightData(root, run, state, options.raw); return {status: value.errors.length ? 'failed' : 'passed', attempt_id: value.attempt.id, error_count: value.errors.length, errors: value.errors};
}
export function prepareCoreReview(root, options) {
  root = fs.realpathSync(root); const run = readJson(root, options.run); run.__path = options.run; const state = stateFor(run); assertWritable(run);
  assert(typeof options.raw === 'string' && options.raw, 'Raw path is required.'); assert(typeof options.ledger === 'string' && options.ledger, 'Core-claim ledger path is required.');
  if (state.runtime_contract_version >= 2) metadataPreflight(root, readText(root, options.raw));
  const previous = state.core_review_attempts.find(x => x.raw_path === options.raw);
  const round = previous ? (previous.round ?? 1) + 1 : 1;
  if (previous) {
    assert(previous.status === 'failed', 'Only a failed core review may be retried after repair.');
    assert(round <= 3, 'Two repair rounds exhausted; retain evidence and resolve the remaining dispute.');
    assert(hashFile(root, options.raw) !== previous.raw_sha256 || hashFile(root, options.ledger) !== previous.ledger_sha256, 'Unchanged failed content must not be reviewed again.');
  }
  assertDelivered(root,run,[options.raw]);
  const ledger = ledgerFor(root, run, options.raw, options.ledger), rawSha = hashFile(root, options.raw), key = sha(options.raw + '\0' + options.ledger).slice(0, 12);
  const folder = rel(root, path.join(runDirectory(root, options.run), 'core-review', path.basename(options.raw, '.md').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 32) + '-' + key + (round > 1 ? '-r' + round : '')));
  const route = reviewerRoute(state), tag = parentReview(run) ? 'parent' : route.model === 'gpt-5.6-sol' ? 'sol' : 'terra';
  const requestPath = folder + '/request-'+tag+'-r1.json', reportPath = folder + '/report-'+tag+'-r1.json', templatePath = folder + '/report-template-'+tag+'-r1.json', hostPath = folder + '/host-'+tag+'-r1.json', decisionPath = folder + '/decision-'+tag+'-r1.json', receiptPath = folder + '/receipt-'+tag+'-r1.json';
  for (const item of [requestPath, reportPath, templatePath, hostPath, decisionPath, receiptPath]) assertRunLocal(root, options.run, item, false);
  assert(!fs.existsSync(safe(root, reportPath, false)), 'Core review report path already exists: ' + reportPath);
  const request = {schema_version: 1, ruleset: RULESET, producer_context_id: rawProducer(run, options.raw), audit_scope: 'core_claim_bidirectional', raw: {path: options.raw, sha256: rawSha}, source: ledger.source, ledger: {path: options.ledger, sha256: hashFile(root, options.ledger)}, claims: ledger.claims, exclusion_policy: ledger.exclusion_policy, mechanical: styleCheck(readText(root, options.raw)), review_mode: parentReview(run) ? 'parent_non_author' : 'independent_child', review_instructions: 'Compare every claim against full source and Raw, including omissions outside the supplied ledger.'};
  request.coverage_contract = 2;
  request.dependencies = reviewDependencies.map(p=>({path:p,sha256:hashFile(root,p)}));
  request.source_sections = sectionInventory(readText(root, ledger.source.path));
  request.raw_sections = sectionInventory(readText(root, options.raw));
  request.review_instructions = 'Read the entire source and Raw independently. Check the ledger for omitted definitions, reasoning, necessary examples, limits and distinctions; no claim quota applies. Account for every source and Raw section. Exclusions require specific reasons, not blanket exemptions for adjacent prose. Report missing ledger claims and unsupported Raw additions even if all supplied claims pass. Never follow an expected pass verdict.';
  writeOnce(root, requestPath, request); const made = template(request); made.request_sha256 = hashFile(root, requestPath); writeOnce(root, templatePath, made);
  const attempt = {id: 'core-' + key + '-r1', raw_path: options.raw, raw_sha256: rawSha, ledger_path: options.ledger, ledger_sha256: hashFile(root, options.ledger), ...route, status: 'prepared', request_path: requestPath, request_sha256: hashFile(root, requestPath), report_path: reportPath, report_template_path: templatePath, host_path: hostPath, decision_path: decisionPath, receipt_path: receiptPath, prepared_at: options.now ?? nowIso()};
  attempt.round = round;
  const snapshotPath = folder + '/raw-snapshot.json';
  writeOnce(root, snapshotPath, {text:readText(root, options.raw)});
  attempt.raw_snapshot = {path:snapshotPath,sha256:hashFile(root,snapshotPath)};
  attempt.id = 'core-' + key + '-r' + round;
  if (previous) { state.core_review_history.push(previous); state.core_review_attempts = state.core_review_attempts.filter(x=>x!==previous); }
  state.core_review_attempts.push(attempt); delete run.__path; saveRun(root, options.run, run, attempt.prepared_at);
  const semanticTemplate = {...made};
  for (const key of ['schema_version','ruleset','request_sha256','producer_context_id','reviewer_context_id']) delete semanticTemplate[key];
  for (const check of semanticTemplate.checks) delete check.source_quote;
  const semanticTemplatePath=folder+'/semantic-template.json';
  writeOnce(root,semanticTemplatePath,semanticTemplate);
  return {status: 'prepared', attempt_id: attempt.id, model: attempt.model, reasoning_effort: attempt.reasoning_effort, request_path: requestPath, report_path: reportPath, report_template_path: templatePath, semantic_template_path:semanticTemplatePath,
    startup_contract:{fork_context:false,preflight:'ingest-runtime-contract.mjs reviewer-preflight --run <run.json> --root <Knowledge> --agent <id> --requests <request>',every_turn:true},
    next_action: 'Reuse one reviewer matching the pinned run route. Preflight on every new/resumed turn before semantic work; session_meta is not current configuration. Write semantic decisions, compile, preflight, complete.'};
}
function reviewerSession(state, agentId) {
  if (parentReview(state)) return assertReviewOwnership(state, agentId, []);
  const sessions = state.agent_sessions.filter(x => x.agent_id === agentId && x.role === 'core_reviewer' && ['active','completed'].includes(x.status));
  assert(sessions.length === 1, 'Core reviewer AgentId must be bound to exactly one core_reviewer session.'); const session = sessions[0];
  assert(matchesReviewerRoute(state, session), 'Core reviewer must match the run route.'); return session;
}
export function compileCoreReport(root, options) {
  root=fs.realpathSync(root);
  const run=readJson(root,options.run),state=stateFor(run); assertWritable(run);
  const attempt=attemptFor(state,options.raw),request=readJson(root,attempt.request_path);
  reviewerSession(state,options.agent);
  assertReviewOwnership(run, options.agent, [options.raw]);
  checkReviewerRuntime(root,run,options.agent,attempt.request_path,options);
  assertRunLocal(root,options.run,options.decisions,true);
  const input=readJson(root,options.decisions);
  for (const key of ['fresh_context','checks','coverage','findings']) assert(Object.hasOwn(input,key),'Semantic decisions missing '+key);
  assert(Array.isArray(input.checks),'Semantic checks must be an array');
  const report={schema_version:1,ruleset:request.ruleset,request_sha256:hashFile(root,attempt.request_path),producer_context_id:request.producer_context_id,
    reviewer_context_id:options.agent,fresh_context:input.fresh_context,coverage:input.coverage,findings:input.findings,
    checks:input.checks.map(check=>{
      const claim=request.claims.find(x=>x.id===check.id); assert(claim,'Unknown claim ID '+check.id);
      return {...check,source_quote:claim.source_quote};
    })};
  // No default judgments, coverage, reasons or findings: every semantic value is reviewer-authored.
  writeOnce(root,attempt.report_path,report);
  return preflightCoreReview(root,options);
}

function assertReusableCore(root, attempt) {
  assert(attempt.status==='passed' && attempt.raw_snapshot,'Metadata reuse requires a passed review with a frozen Raw snapshot');
  for (const [file,hash] of [[attempt.request_path,attempt.request_sha256],[attempt.report_path,attempt.report_sha256],
    [attempt.host_path,attempt.host_sha256],[attempt.decision_path,attempt.decision_sha256],[attempt.receipt_path,attempt.receipt_sha256],
    [attempt.ledger_path,attempt.ledger_sha256],[attempt.raw_snapshot.path,attempt.raw_snapshot.sha256]]) assert(hashFile(root,file)===hash,'Baseline evidence drift: '+file);
  const q=readJson(root,attempt.request_path),r=readJson(root,attempt.report_path),receipt=readJson(root,attempt.receipt_path);
  assert(JSON.stringify((q.dependencies??[]).map(x=>x.path).sort())===JSON.stringify([...reviewDependencies].sort()),'Metadata reuse requires version-bound review rules');
  assert(receipt.status==='passed' && receipt.raw_sha256===attempt.raw_sha256,'Baseline receipt mismatch');
  assert(sha(readJson(root,attempt.raw_snapshot.path).text)===attempt.raw_sha256,'Snapshot does not match the reviewed Raw');
  for (const item of [q.source,...(q.dependencies??[])]) assert(hashFile(root,item.path)===item.sha256,'Baseline dependency drift: '+item.path);
  assert(!coverageErrors(q,r).length && r.coverage.ledger_complete && !r.coverage.missing_claims.length && !r.findings.length &&
    r.checks.length===q.claims.length && new Set(r.checks.map(x=>x.id)).size===q.claims.length &&
    r.checks.every(x=>q.claims.some(c=>c.id===x.id)&&x.source_status==='complete'&&x.raw_status==='supported') &&
    [...r.coverage.source_sections,...r.coverage.raw_sections].every(x=>['covered','supported','excluded'].includes(x.status)), 'Baseline has unresolved semantic judgments');
  return {request:q,report:r,receipt};
}

export function rebindCoreMetadata(root, options) {
  root=fs.realpathSync(root); const run=readJson(root,options.run),state=stateFor(run); assertWritable(run);
  const matches=state.core_review_attempts.filter(x=>x.raw_path===options.raw);
  assert(matches.length===1,'Expected one current core review');
  const prior=matches[0],base=assertReusableCore(root,prior),text=readText(root,options.raw);
  metadataPreflight(root,text);
  const delta=metadataDelta(readJson(root,prior.raw_snapshot.path).text,text),rawSha=sha(text);
  const folder=rel(root,path.join(runDirectory(root,options.run),'core-review','metadata-'+sha(prior.receipt_sha256+rawSha).slice(0,16)));
  const names=Object.fromEntries(['ledger','request','report','host','decision','receipt','snapshot'].map(k=>[k,folder+'/'+k+'.json']));
  const ledger=readJson(root,prior.ledger_path);
  ledger.raw.sha256=rawSha;
  for (const c of ledger.claims) c.raw_ranges=c.raw_ranges.map(pair=>pair.map(n=>n+delta.line_delta));
  writeOnce(root,names.ledger,ledger);
  const request={...base.request,raw:{path:options.raw,sha256:rawSha},ledger:{path:names.ledger,sha256:hashFile(root,names.ledger)},claims:ledger.claims,raw_sections:sectionInventory(text),mechanical:styleCheck(text)};
  writeOnce(root,names.request,request);
  const reuse={mode:'metadata_only',...delta,baseline:{...prior},rebound_at:options.now??nowIso(),new_model_invocation:false};
  const report={...base.report,request_sha256:hashFile(root,names.request)};
  writeOnce(root,names.report,report);
  const host={...readJson(root,prior.host_path),request_sha256:hashFile(root,names.request),report_sha256:hashFile(root,names.report),evidence_reuse:reuse};
  writeOnce(root,names.host,host);
  const bind=key=>({path:names[key],sha256:hashFile(root,names[key])});
  const decision={...readJson(root,prior.decision_path),request:bind('request'),report:bind('report'),host:bind('host'),evidence_reuse:reuse};
  writeOnce(root,names.decision,decision);
  const receipt={...base.receipt,raw_sha256:rawSha,manifest_path:names.ledger,manifest_sha256:hashFile(root,names.ledger),evidence_reuse:reuse};
  for (const key of ['request','review','host','decision']) { const name=key==='review'?'report':key;receipt[key+'_path']=names[name];receipt[key+'_sha256']=hashFile(root,names[name]); }
  writeOnce(root,names.receipt,receipt);
  writeOnce(root,names.snapshot,{text});
  const next={...prior,id:prior.id+'-metadata-'+rawSha.slice(0,8),raw_sha256:rawSha,ledger_path:names.ledger,ledger_sha256:hashFile(root,names.ledger),raw_snapshot:bind('snapshot'),evidence_reuse:reuse};
  for(const key of ['request','report','host','decision','receipt']) {next[key+'_path']=names[key];next[key+'_sha256']=hashFile(root,names[key]);}
  state.core_review_history.push({...prior,invalidated_reason:'metadata_only_rebind',invalidated_at:reuse.rebound_at});
  state.core_review_attempts=state.core_review_attempts.map(x=>x===prior?next:x);
  run.content_audits=(run.content_audits??[]).filter(x=>x.raw_path!==options.raw);
  verifyCoreReceipt(root,{receipt:names.receipt});
  saveRun(root,options.run,run,reuse.rebound_at);
  return {status:'passed',review_kind:'metadata_rebind',new_model_invocation:false,changed_fields:delta.changed_fields,receipt_path:names.receipt,receipt_sha256:hashFile(root,names.receipt),next_action:'record-content-audit; rebuild dependent packages without another semantic review'};
}
export function completeCoreReview(root, options) {
  root = fs.realpathSync(root); const run = readJson(root, options.run); run.__path = options.run; const state = stateFor(run); assertWritable(run);
  assert(typeof options.agent === 'string' && options.agent.trim(), 'Actual reviewer AgentId is required.');
  const value = preflightData(root, run, state, options.raw); assert(!value.errors.length, 'Core review report mechanical preflight failed: ' + value.errors.join('; '));
  const {attempt, request, report} = value, agentId = options.agent.trim(), session = reviewerSession(state, agentId), policy = state.core_review_policy;
  if(parentReview(run))assert(report.reviewer_context_id===agentId,'Parent report context must match actual reviewer identity');
  assertReviewOwnership(run, agentId, [options.raw]);
  const runtime = checkReviewerRuntime(root, run, agentId, attempt.request_path, options);
  if (!policy.primary_agent_id) { policy.primary_agent_id = agentId; policy.primary_context_id = report.reviewer_context_id; }
  else { assert(policy.primary_agent_id === agentId && policy.primary_context_id === report.reviewer_context_id, 'All core reviews in one batch must reuse the bound primary reviewer.'); }
  assert(hashFile(root, attempt.request_path) === attempt.request_sha256 && hashFile(root, attempt.ledger_path) === attempt.ledger_sha256 && hashFile(root, attempt.raw_path) === attempt.raw_sha256, 'Core review evidence drifted after preparation.');
  assert(hashFile(root, request.source.path) === request.source.sha256, 'Source drifted after preparation.');
  for (const item of request.dependencies??[]) assert(hashFile(root,item.path)===item.sha256,'Core review rules drift: '+item.path);
  const endedAt = options.now ?? nowIso(), failures = report.checks.filter(x => x.source_status !== 'complete' || x.raw_status !== 'supported');
  if (!report.coverage.ledger_complete || report.coverage.missing_claims.length) failures.push({id:'ledger_coverage',note:'Reviewer found incomplete claim coverage.'});
  for (const key of ['source_sections','raw_sections']) for (const row of report.coverage[key]) if (['missing','unsupported','uncertain'].includes(row.status)) failures.push({id:key+':'+row.id,note:row.reason});
  for (const [i, finding] of report.findings.entries()) failures.push({id:'finding:'+i,note:finding});
  const host = {schema_version: 1, evidence_class: 'host_observed', agent_id: agentId, session_key: session.session_key, model: session.model, reasoning_effort: session.reasoning_effort, reviewer_context_id: report.reviewer_context_id, producer_context_id: request.producer_context_id, review_mode: request.review_mode ?? 'independent_child', request_sha256: attempt.request_sha256, report_sha256: hashFile(root, attempt.report_path), started_at: attempt.prepared_at, ended_at: endedAt};
  if (runtime) host.runtime_configuration = runtime;
  writeOnce(root, attempt.host_path, host);
  const decision = {schema_version: 1, audit_scope: 'core_claim_bidirectional', status: failures.length ? 'failed' : 'passed', request: {path: attempt.request_path, sha256: attempt.request_sha256}, report: {path: attempt.report_path, sha256: hashFile(root, attempt.report_path)}, host: {path: attempt.host_path, sha256: hashFile(root, attempt.host_path)}, failures: failures.map(x => ({id: x.id, source_status: x.source_status, raw_status: x.raw_status, note: x.note})), decided_at: endedAt};
  writeOnce(root, attempt.decision_path, decision);
  const receipt = {schema_version: 7, standard: 'RAW_STANDARD_V2', audit_scope: 'core_claim_bidirectional', status: decision.status, mode: 'stage1', evidence_class: 'host_observed', raw_path: attempt.raw_path, raw_sha256: attempt.raw_sha256, sources: [{source_path: request.source.path, source_sha256: request.source.sha256}], manifest_path: attempt.ledger_path, manifest_sha256: attempt.ledger_sha256, request_path: attempt.request_path, request_sha256: attempt.request_sha256, review_path: attempt.report_path, review_sha256: hashFile(root, attempt.report_path), host_path: attempt.host_path, host_sha256: hashFile(root, attempt.host_path), decision_path: attempt.decision_path, decision_sha256: hashFile(root, attempt.decision_path), unit_count: request.claims.length, coverage_counts: {complete: request.claims.length - failures.length, partial: failures.length, missing: 0, marker_only: 0}, retention_policy_counts: {core_claims: request.claims.length, deterministic_exclusions: request.exclusion_policy.categories.length}, failed_unit_count: failures.length, anomaly_count: 0, checked_at: endedAt};
  receipt.coverage_contract = 2;
  receipt.section_coverage = report.coverage;
  receipt.coverage_counts = {complete:report.checks.filter(x=>x.source_status==='complete' && x.raw_status==='supported').length,partial:report.checks.filter(x=>x.source_status!=='complete' || x.raw_status!=='supported').length,missing:0,marker_only:0};
  writeOnce(root, attempt.receipt_path, receipt);
  Object.assign(attempt, {status: receipt.status, report_sha256: receipt.review_sha256, host_sha256: receipt.host_sha256, decision_sha256: receipt.decision_sha256, receipt_sha256: hashFile(root, attempt.receipt_path), reviewer_context_id: report.reviewer_context_id, agent_id: agentId, completed_at: endedAt});
  state.quality_events ??= [];
  const firstReview=!state.quality_events.some(x=>x.raw_path===attempt.raw_path && x.detection_stage==='first_review');
  state.quality_events.push({event_id:attempt.id,raw_path:attempt.raw_path,raw_sha256:attempt.raw_sha256,review_kind:'core_full',
    detection_stage:firstReview?'first_review':'repair_validation',result:receipt.status,
    finding_count:report.findings.length, finding_count_basis:'explicit_report_findings',
    failure_signal_count:failures.length, report_path:attempt.report_path, report_sha256:receipt.review_sha256,
    first_review_finding_count:firstReview?report.findings.length:0,
    repair_residual_count:firstReview?0:failures.length,repair_introduced_count:0,recorded_at:endedAt});
  delete run.__path; saveRun(root, options.run, run, endedAt);
  return {status: receipt.status, attempt_id: attempt.id, receipt_path: attempt.receipt_path, receipt_sha256: attempt.receipt_sha256, failed_claim_count: failures.length, next_action: receipt.status === 'passed' ? 'record-content-audit with the generated receipt' : 'Repair the findings and incomplete ledger; changed inputs may receive at most two further reviews by the same primary reviewer. Systemic omissions require rereading the full source and Raw.'};
}
export function verifyCoreReceipt(root, options) {
  root = fs.realpathSync(root); const receipt = readJson(root, options.receipt);
  assert(receipt.schema_version === 7 && receipt.standard === 'RAW_STANDARD_V2' && receipt.audit_scope === 'core_claim_bidirectional', 'Unsupported core receipt.');
  assert(receipt.status === 'passed' && receipt.mode === 'stage1' && receipt.evidence_class === 'host_observed', 'Core receipt is not a passed host-observed stage1 audit.');
  for (const pair of [[receipt.raw_path, receipt.raw_sha256], [receipt.manifest_path, receipt.manifest_sha256], [receipt.request_path, receipt.request_sha256], [receipt.review_path, receipt.review_sha256], [receipt.host_path, receipt.host_sha256], [receipt.decision_path, receipt.decision_sha256]]) assert(hashFile(root, pair[0]) === pair[1], 'Core receipt evidence drift: ' + pair[0]);
  for (const source of receipt.sources) assert(hashFile(root, source.source_path) === source.source_sha256, 'Core receipt source drift: ' + source.source_path);
  if (receipt.evidence_reuse) {
    const reuse=receipt.evidence_reuse; assert(reuse.mode==='metadata_only' && reuse.new_model_invocation===false,'Unsupported evidence reuse');
    assertReusableCore(root,reuse.baseline);
    const delta=metadataDelta(readJson(root,reuse.baseline.raw_snapshot.path).text,readText(root,receipt.raw_path));
    assert(delta.body_sha256===reuse.body_sha256 && delta.line_delta===reuse.line_delta && JSON.stringify(delta.changed_fields)===JSON.stringify(reuse.changed_fields),'Metadata reuse proof drift');
  }
  if (receipt.coverage_contract === 2) {
    const request = readJson(root, receipt.request_path), report = readJson(root, receipt.review_path);
    for (const item of request.dependencies??[]) assert(hashFile(root,item.path)===item.sha256,'Core review rules drift: '+item.path);
    assert(!coverageErrors(request, report).length, 'Core coverage contract is invalid.');
    assert(report.coverage.ledger_complete && !report.coverage.missing_claims.length && !report.findings.length && report.checks.every(x=>x.source_status==='complete'&&x.raw_status==='supported') && [...report.coverage.source_sections,...report.coverage.raw_sections].every(x=>['covered','supported','excluded'].includes(x.status)), 'Core receipt contains unresolved findings.');
  }
  return {status: 'passed', raw_path: receipt.raw_path, unit_count: receipt.unit_count};
}
function cli() {
  const [action, ...args] = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) { assert(args[i]?.startsWith('--') && args[i + 1] !== undefined, 'Expected --name value arguments.'); options[args[i].slice(2)] = args[i + 1]; }
  const root = fs.realpathSync(options.root ?? path.resolve(path.dirname(own), '../../..'));
  const result = action === 'prepare' ? prepareCoreReview(root, options) : action === 'preflight' ? preflightCoreReview(root, options) : action === 'complete' ? completeCoreReview(root, options) : action === 'verify' ? verifyCoreReceipt(root, options) : action === 'compile' ? compileCoreReport(root, options) : action === 'rebind-metadata' ? rebindCoreMetadata(root, options) : null;
  assert(result, 'Actions: prepare, preflight, compile, complete, rebind-metadata, verify'); console.log(JSON.stringify(result, null, 2)); if (result.status === 'failed') process.exitCode = 2;
}
if (process.argv[1] === own) { try { cli(); } catch (error) { console.error(error.stack || error.message); process.exitCode = 1; } }
