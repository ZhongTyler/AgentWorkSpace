import {reviewerRoute, matchesReviewerRoute} from './reviewer-route.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepare, evaluate, safe, sha, styleCheck} from './raw-quality.mjs';
import {metadataPreflight, checkReviewerRuntime} from './ingest-review-support.mjs';

const own = fileURLToPath(import.meta.url);
const assert = (ok, message) => { if (!ok) throw Error(message); };
const nowIso = () => new Date().toISOString();
const rel = (root, value) => path.relative(root, value).split(path.sep).join('/');
const readJson = (root, value) => JSON.parse(fs.readFileSync(safe(root, value), 'utf8').replace(/^\uFEFF/, ''));
const hashFile = (root, value) => sha(fs.readFileSync(safe(root, value)));
const clean = value => JSON.stringify(value, null, 2) + '\n';

function runDirectory(root, runPath) {
  return path.dirname(safe(root, runPath));
}

function assertRunLocal(root, runPath, candidate, mustExist = false) {
  const directory = runDirectory(root, runPath) + path.sep;
  const full = safe(root, candidate, mustExist);
  assert(full.startsWith(directory), 'Raw review evidence must stay beside the run manifest: ' + candidate);
  return full;
}

function writeOnce(root, value, data) {
  const full = safe(root, value, false);
  const text = clean(data);
  if (fs.existsSync(full)) {
    assert(fs.readFileSync(full, 'utf8') === text, 'Evidence already exists with different content: ' + value);
    return false;
  }
  fs.mkdirSync(path.dirname(full), {recursive: true});
  fs.writeFileSync(full, text);
  return true;
}

function reportTemplate(request) {
  return {
    schema_version: 2,
    ruleset: request.ruleset,
    request_sha256: null,
    reviewer_context_id: 'FILL_REVIEWER_CONTEXT_ID',
    producer_context_id: request.producer_context_id,
    fresh_context: false,
    core_claims: [],
    manifest_review: {status: 'FILL_STATUS', reason: 'FILL_REASON'},
    source_checks: (request.source_units ?? []).map(unit => ({
      id: unit.id, policy: 'FILL_POLICY', status: 'FILL_STATUS',
      elements: [{source_quote: unit.text, status: 'FILL_STATUS', raw_ranges: [], raw_quote: 'FILL_RAW_QUOTE'}]
    })),
    raw_checks: (request.raw_units ?? []).map(unit => ({id: unit.id, status: 'FILL_STATUS', source_ids: [], raw_quote: 'FILL_RAW_QUOTE'})),
    style: {status: 'FILL_STATUS', findings: []},
    cross_section: {status: 'FILL_STATUS'},
    findings: []
  };
}

export function preflightReport(root, options) {
  root = fs.realpathSync(root);
  const run = readJson(root, options.run);
  const state = control(run);
  const attempts = state.raw_review_attempts.filter(item => item.raw_path === options.raw && item.status === 'prepared');
  assert(attempts.length === 1, 'Expected exactly one prepared Raw review attempt: ' + options.raw);
  const attempt = attempts[0];
  const request = readJson(root, attempt.request_path);
  const errors = [];
  const advisories = [];
  let report;
  try { report = readJson(root, attempt.report_path); } catch (error) { errors.push('report_json: ' + error.message); }
  if (report) {
    const required = ['schema_version','ruleset','request_sha256','reviewer_context_id','producer_context_id','core_claims','manifest_review','source_checks','raw_checks','style','cross_section','findings'];
    for (const key of required) if (!Object.hasOwn(report, key)) errors.push('missing_field: ' + key);
    const placeholders = (value, pointer = 'report') => {
      if (typeof value === 'string' && value.startsWith('FILL_')) errors.push(`${pointer}: unresolved template placeholder ${value}`);
      else if (Array.isArray(value)) value.forEach((item, index) => placeholders(item, `${pointer}[${index}]`));
      else if (value && typeof value === 'object') for (const [key, item] of Object.entries(value)) placeholders(item, `${pointer}.${key}`);
    };
    placeholders(report);
    if (report.request_sha256 !== attempt.request_sha256) errors.push('request_sha256: does not match prepared request');
    for (const [group, rows] of [['core_claims', report.core_claims], ['source_checks', report.source_checks], ['raw_checks', report.raw_checks], ['findings', report.findings]]) {
      if (!Array.isArray(rows)) { errors.push(`${group}: must be an array`); continue; }
      for (let i = 0; i < rows.length; i++) {
        if (rows[i].raw_ranges !== undefined && (!Array.isArray(rows[i].raw_ranges) || rows[i].raw_ranges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger)))) errors.push(`${group}[${i}].raw_ranges: must contain [integer, integer] pairs`);
      }
    }
    for (let i = 0; i < (report.source_checks ?? []).length; i++) {
      const sourceUnit = (request.source_units ?? []).find(unit => unit.id === report.source_checks[i].id);
      if (!sourceUnit) errors.push(`source_checks[${i}].id: not present in request`);
      for (let j = 0; j < (report.source_checks[i].elements ?? []).length; j++) {
        const element = report.source_checks[i].elements[j];
        if (typeof element.source_quote !== 'string' || !element.source_quote.trim()) errors.push(`source_checks[${i}].elements[${j}].source_quote: required`);
        else if (sourceUnit && !sourceUnit.text.includes(element.source_quote)) errors.push(`source_checks[${i}].elements[${j}].source_quote: not found in source unit`);
        if (!Array.isArray(element.raw_ranges) || element.raw_ranges.some(range => !Array.isArray(range) || range.length !== 2 || !range.every(Number.isInteger))) errors.push(`source_checks[${i}].elements[${j}].raw_ranges: must contain [integer, integer] pairs`);
      }
      const check = report.source_checks[i];
      if (check.policy === 'media' && check.status === 'marker_only' && !check.nonessential) {
        advisories.push({
          code: 'media_boundary_unresolved',
          pointer: `source_checks[${i}]`,
          source_id: check.id,
          message: 'marker_only without nonessential will intentionally evaluate as media_limited; add nonessential.claim_ids/reason only when the visual detail is not required for the retained claims'
        });
      }
    }
    const sourceIds = new Set((request.source_units ?? []).map(unit => unit.id));
    const rawIds = new Set((request.raw_units ?? []).map(unit => unit.id));
    const sourceCheckIds = (report.source_checks ?? []).map(item => item.id);
    const rawCheckIds = (report.raw_checks ?? []).map(item => item.id);
    for (const id of sourceIds) if (sourceCheckIds.filter(value => value === id).length !== 1) errors.push(`source_checks: expected exactly one row for ${id}`);
    for (const id of rawIds) if (rawCheckIds.filter(value => value === id).length !== 1) errors.push(`raw_checks: expected exactly one row for ${id}`);
    for (let i = 0; i < (report.raw_checks ?? []).length; i++) {
      const check = report.raw_checks[i];
      if (!rawIds.has(check.id)) errors.push(`raw_checks[${i}].id: not present in request`);
      if (check.status === 'supported' && (!Array.isArray(check.source_ids) || check.source_ids.length === 0)) errors.push(`raw_checks[${i}].source_ids: supported Raw needs source`);
      for (const id of check.source_ids ?? []) if (!sourceIds.has(id)) errors.push(`raw_checks[${i}].source_ids: unknown source id ${id}`);
    }
  }
  return {status: errors.length ? 'failed' : 'passed', attempt_id: attempt.id, error_count: errors.length, errors, advisory_count: advisories.length, advisories};
}

function saveRun(root, runPath, run, at = nowIso()) {
  run.updated_at = at;
  fs.writeFileSync(safe(root, runPath), clean(run));
}

function control(run) {
  const value = run.execution_control;
  assert(run.schema_version >= 8 && [1, 2].includes(value?.schema_version), 'Run lacks supported schema 8 execution_control; historical runs remain read-only.');
  assert(Number.isInteger(value.child_session_cap) && value.child_session_cap > 0, 'Invalid child session cap.');
  assert(Array.isArray(value.raw_review_attempts), 'execution_control.raw_review_attempts must be an array.');
  assert(value.writer_stages && Object.hasOwn(value.writer_stages, 'stage1') && Object.hasOwn(value.writer_stages, 'stage3'), 'execution_control.writer_stages is incomplete.');
  if (value.schema_version >= 2) {
    assert(Array.isArray(value.agent_sessions), 'execution_control.agent_sessions must be an array.');
    assert(Array.isArray(value.quality_events), 'execution_control.quality_events must be an array.');
    assert(value.reviewer_policy?.mode === 'single_primary', 'execution_control.reviewer_policy must select single_primary.');
  }
  return value;
}

function assertWritableRun(run) {
  assert(['running_scoring', 'scoring_approved', 'stage2_planned'].includes(run.status), 'Raw review is not allowed from run status: ' + run.status);
}

function rawArtifact(run, rawPath) {
  const matches = (run.artifacts ?? []).filter(item => item.kind === 'raw' && item.disposition === 'ingested' && item.path === rawPath);
  assert(matches.length === 1, 'Raw review requires exactly one registered ingested Raw artifact: ' + rawPath);
}

function evidenceKey(manifestPath, rawPath) {
  const manifestFolder = path.basename(path.dirname(manifestPath));
  const rawStem = path.basename(rawPath, path.extname(rawPath));
  const label = (manifestFolder + '-' + rawStem)
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  return (label || 'raw') + '-' + sha(manifestPath + '\0' + rawPath).slice(0, 12);
}

function routeFor(previous, rawSha, route) {
  assert(!previous.some(item => item.status === 'passed'), 'Raw review already passed; additional review is forbidden.');
  assert(!previous.some(item => item.status === 'prepared'), 'A Raw review attempt is already prepared and must be completed before another is allocated.');
  if (previous.length === 0) return {sequence: 1, kind: 'full_default', ...route};
  const prior = previous.at(-1);
  assert(['failed', 'needs_review', 'media_limited'].includes(prior.status), 'Only an unresolved review can allocate another attempt.');
  assert(prior.kind !== 'escalated_review', 'Raw review budget exhausted after the one Astra escalation.');
  if (prior.kind === 'full_default') {
    assert(rawSha !== prior.raw_sha256, 'primary targeted recheck requires a changed Raw; correct report/schema errors inside the still-prepared attempt.');
    return {sequence: prior.sequence + 1, kind: 'targeted_recheck', ...route};
  }
  if (prior.outcome_class === 'semantic_dispute') {
    assert(rawSha === prior.raw_sha256, 'Astra escalation reviews the unchanged disputed primary-targeted version.');
    return {sequence: prior.sequence + 1, kind: 'escalated_review', model: 'gpt-6-astra', reasoning_effort: 'low'};
  }
  const primaryTargetedCount = previous.filter(item => item.kind === 'targeted_recheck').length;
  assert(primaryTargetedCount < 2, 'Raw repair budget exhausted after two targeted Luna repairs and primary rechecks; clear defects do not justify Astra escalation.');
  assert(rawSha !== prior.raw_sha256, 'Another primary targeted recheck requires a changed Raw for the remaining repairable findings.');
  return {sequence: prior.sequence + 1, kind: 'targeted_recheck', ...route};
}

function outcomeClass(receipt, report) {
  const sourceUncertain = (report.source_checks ?? []).some(check => check.status === 'uncertain' || (check.elements ?? []).some(element => element.status === 'uncertain'));
  const rawUncertain = (report.raw_checks ?? []).some(check => check.status === 'uncertain');
  const holisticUncertain = ['manifest_review', 'style', 'cross_section'].some(key => report[key]?.status === 'uncertain');
  const disputedFinding = [...(report.findings ?? []), ...(report.style?.findings ?? [])].some(finding => finding.resolution === 'semantic_dispute');
  return receipt.status === 'passed' ? 'passed' : (sourceUncertain || rawUncertain || holisticUncertain || disputedFinding ? 'semantic_dispute' : 'repairable');
}

function knownAgentIds(run) {
  const ids = new Set();
  for (const attempt of run.execution_control?.raw_review_attempts ?? []) if (attempt.agent_id) ids.add(attempt.agent_id);
  for (const attempt of run.execution_control?.raw_review_history ?? []) if (attempt.agent_id) ids.add(attempt.agent_id);
  for (const stage of ['stage1', 'stage3']) {
    for (const id of run.execution_control?.writer_stages?.[stage]?.agent_ids ?? []) if (id) ids.add(id);
  }
  for (const record of run.execution_control?.writer_stage_history ?? []) {
    for (const id of record.agent_ids ?? []) if (id) ids.add(id);
  }
  return ids;
}

function sessionFor(state, agentId, attempt) {
  if (state.schema_version < 2) return null;
  const matches = state.agent_sessions.filter(item => item.agent_id === agentId && item.role === 'raw_reviewer' && ['active', 'completed'].includes(item.status));
  assert(matches.length === 1, 'Reviewer AgentId must be bound to exactly one reserved raw_reviewer session: ' + agentId);
  const session = matches[0];
  assert(session.model === attempt.model && session.reasoning_effort === attempt.reasoning_effort, 'Reviewer session model/effort does not match the prepared review route.');
  return session;
}

export function prepareAttempt(root, options) {
  root = fs.realpathSync(root);
  const run = readJson(root, options.run);
  const state = control(run);
  assertWritableRun(run);
  assert(typeof options.raw === 'string' && options.raw, 'Raw path is required.');
  assert(typeof options.manifest === 'string' && options.manifest, 'Manifest path is required.');
  rawArtifact(run, options.raw);
  assertRunLocal(root, options.run, options.manifest, true);
  if (state.runtime_contract_version >= 2) metadataPreflight(root, fs.readFileSync(safe(root, options.raw), 'utf8'));
  const mechanical = styleCheck(fs.readFileSync(safe(root, options.raw), 'utf8').replace(/^\uFEFF/, ''));
  assert(
    mechanical.status === 'passed',
    'Raw mechanical preflight failed before reviewer dispatch: ' + mechanical.findings.map(item => `${item.rule} ${item.detail}`).join('; ')
  );
  const rawSha = hashFile(root, options.raw);
  const previous = state.raw_review_attempts.filter(item => item.raw_path === options.raw).sort((a, b) => a.sequence - b.sequence);
  const route = routeFor(previous, rawSha, reviewerRoute(run));
  if (route.sequence > 1) assert(typeof options.reason === 'string' && options.reason.trim(), 'A concrete retry/escalation reason is required.');
  if (route.kind === 'escalated_review') {
    const targeted = previous.at(-1);
    assert(options.manifest === targeted.manifest_path, 'Astra escalation must reuse the primary targeted manifest path.');
    assert(hashFile(root, options.manifest) === targeted.manifest_sha256, 'Astra escalation manifest drifted after primary targeted review.');
  }
  const key = evidenceKey(options.manifest, options.raw);
  const archived = (state.raw_review_history ?? []).filter(item => item.raw_path === options.raw);
  const recoveryTag = archived.length
    ? `-recovery-${sha(JSON.stringify(archived.map(item => [item.id, item.receipt_sha256, item.invalidated_at]))).slice(0, 8)}`
    : '';
  const tag = route.model.split('-').at(-1);
  const folder = rel(root, path.join(runDirectory(root, options.run), 'raw-v2', key + recoveryTag));
  const requestPath = route.kind === 'escalated_review' ? previous.at(-1).request_path : `${folder}/request-${tag}-r${route.sequence}.json`;
  const reportPath = `${folder}/report-${tag}-r${route.sequence}.json`;
  const templatePath = `${folder}/report-template-${tag}-r${route.sequence}.json`;
  const hostPath = `${folder}/host-${tag}-r${route.sequence}.json`;
  const provenancePath = `${folder}/provenance-${tag}-r${route.sequence}.json`;
  const receiptPath = `${folder}/receipt-${tag}-r${route.sequence}.json`;
  for (const candidate of [requestPath, templatePath, reportPath, hostPath, provenancePath, receiptPath]) assertRunLocal(root, options.run, candidate, false);
  assert(!fs.existsSync(safe(root, reportPath, false)), 'Review report path already exists: ' + reportPath);
  if (route.kind !== 'escalated_review') {
    const baseline = route.kind === 'targeted_recheck' ? {
      request: previous.at(-1).request_path,
      review: previous.at(-1).report_path,
      receipt: previous.at(-1).receipt_path
    } : null;
    prepare(root, {raw: options.raw, manifest: options.manifest, request: requestPath, producer: run.producer_context_id, config: state.schema_version >= 2 ? 'single-primary-continuity' : 'fresh-context-default', baseline});
  } else {
    assert(hashFile(root, requestPath) === previous.at(-1).request_sha256, 'Escalation request drifted.');
  }
  const request = readJson(root, requestPath);
  const template = reportTemplate(request);
  template.request_sha256 = hashFile(root, requestPath);
  writeOnce(root, templatePath, template);
  const preparedAt = options.now ?? nowIso();
  const attempt = {
    id: `${key}-r${route.sequence}`,
    raw_path: options.raw,
    raw_sha256: rawSha,
    manifest_path: options.manifest,
    manifest_sha256: hashFile(root, options.manifest),
    sequence: route.sequence,
    kind: route.kind,
    model: route.model,
    reasoning_effort: route.reasoning_effort,
    status: 'prepared',
    request_path: requestPath,
    request_sha256: hashFile(root, requestPath),
    report_path: reportPath,
    report_template_path: templatePath,
    host_path: hostPath,
    provenance_path: provenancePath,
    receipt_path: receiptPath,
    reason: options.reason?.trim() || null,
    prepared_at: preparedAt
  };
  state.raw_review_attempts.push(attempt);
  saveRun(root, options.run, run, preparedAt);
  return {
    status: 'prepared', attempt_id: attempt.id, review_kind: attempt.kind,
    startup_contract: {fork_context: false, preflight: 'ingest-runtime-contract.mjs reviewer-preflight --run <run.json> --root <Knowledge> --agent <bound-id> --requests <request-paths-separated-by-pipe>', execution: 'Preflight inside reviewer on EVERY new/resumed turn before reading or writing. Never resume without explicitly preserving the pinned route; session_meta is provenance, not active configuration. On mismatch stop immediately; complete also rejects drift.'},
    model: attempt.model, reasoning_effort: attempt.reasoning_effort,
    request_path: attempt.request_path, request_sha256: attempt.request_sha256,
    report_path: attempt.report_path, report_template_path: attempt.report_template_path,
    remaining_child_session_slots: state.child_session_cap - (state.schema_version >= 2 ? state.agent_sessions.length : knownAgentIds(run).size),
    next_action: route.kind === 'escalated_review'
      ? 'dispatch one fresh Astra low reviewer session for the disputed request, then complete-raw-review'
      : 'reuse the batch primary reviewer matching the pinned route (reserve it first if absent), then complete-raw-review'
  };
}

export function invalidatePassedAttempt(root, options) {
  root = fs.realpathSync(root);
  const run = readJson(root, options.run);
  const state = control(run);
  assertWritableRun(run);
  assert(typeof options.raw === 'string' && options.raw, 'Raw path is required.');
  assert(typeof options.reason === 'string' && options.reason.trim(), 'A concrete invalidation reason is required.');
  rawArtifact(run, options.raw);
  const matching = state.raw_review_attempts.filter(item => item.raw_path === options.raw).sort((a, b) => a.sequence - b.sequence);
  assert(matching.length > 0 && matching.some(item => item.status === 'passed'), 'Only a previously passed Raw review can be invalidated.');
  assert(!matching.some(item => item.status === 'prepared'), 'Complete the prepared Raw review before invalidation.');
  const latestPassed = matching.filter(item => item.status === 'passed').at(-1);
  const rawSha = hashFile(root, options.raw);
  assert(rawSha !== latestPassed.raw_sha256, 'Passed Raw review remains bound to the current Raw; invalidation is forbidden.');
  const invalidatedAt = options.now ?? nowIso();
  state.raw_review_history = state.raw_review_history ?? [];
  state.raw_review_history.push(...matching.map(item => ({
    ...item,
    invalidated_reason: options.reason.trim(),
    invalidated_at: invalidatedAt
  })));
  state.raw_review_attempts = state.raw_review_attempts.filter(item => item.raw_path !== options.raw);
  run.content_audits = (run.content_audits ?? []).filter(item => item.raw_path !== options.raw);
  saveRun(root, options.run, run, invalidatedAt);
  return {
    status: 'invalidated',
    raw_path: options.raw,
    previous_raw_sha256: latestPassed.raw_sha256,
    current_raw_sha256: rawSha,
    archived_attempt_count: matching.length,
    next_action: 'prepare one fresh primary full review for the changed Raw only'
  };
}


export function discardPreparedAttempt(root, options) {
  root = fs.realpathSync(root);
  const run = readJson(root, options.run);
  const state = control(run);
  assertWritableRun(run);
  assert(typeof options.raw === 'string' && options.raw, 'Raw path is required.');
  assert(typeof options.reason === 'string' && options.reason.trim(), 'A concrete discard reason is required.');
  rawArtifact(run, options.raw);
  const matching = state.raw_review_attempts.filter(item => item.raw_path === options.raw && item.status === 'prepared');
  assert(matching.length === 1, 'Expected exactly one prepared Raw review to discard: ' + options.raw);
  const discardedAt = options.now ?? nowIso();
  state.raw_review_history = state.raw_review_history ?? [];
  state.raw_review_history.push({
    ...matching[0],
    invalidated_kind: 'superseded_malformed_attempt',
    invalidated_reason: options.reason.trim(),
    invalidated_at: discardedAt
  });
  state.raw_review_attempts = state.raw_review_attempts.filter(item => item !== matching[0]);
  run.content_audits = (run.content_audits ?? []).filter(item => item.raw_path !== options.raw);
  saveRun(root, options.run, run, discardedAt);
  return {status: 'discarded', raw_path: options.raw, archived_attempt_count: 1, next_action: 'use the core-claim review channel; this legacy full-unit attempt is historical evidence only'};
}

export function recoverReviewerDrift(root, options) {
  root = fs.realpathSync(root);
  const run = readJson(root, options.run);
  const state = control(run);
  assertWritableRun(run);
  assert(state.schema_version >= 2, 'Reviewer-drift recovery requires execution_control v2.');
  assert(typeof options.reason === 'string' && options.reason.trim(), 'A concrete reviewer-drift recovery reason is required.');
  assert(typeof options.evidence === 'string' && options.evidence.trim(), 'Reviewer-drift recovery requires host-observed evidence.');
  assert(run.packages?.stage1 == null, 'Reopen the Stage1 package before reviewer-drift recovery.');
  assert(run.commits?.stage1 == null, 'Reviewer-drift recovery must occur before the replacement Stage1 checkpoint.');

  const evidencePath = assertRunLocal(root, options.run, options.evidence, true);
  const evidence = readJson(root, options.evidence);
  const policy = state.reviewer_policy;
  const primaryAgentId = policy?.primary_agent_id;
  assert(typeof primaryAgentId === 'string' && primaryAgentId.trim(), 'No primary reviewer is bound; reviewer-drift recovery is not applicable.');
  assert(evidence.configuration_drift === true, 'Host evidence does not record configuration_drift=true.');
  assert(evidence.agent_id === primaryAgentId, 'Host drift evidence does not identify the bound primary reviewer.');
  assert(evidence.role === 'raw_reviewer', 'Host drift evidence must identify a raw_reviewer session.');
  assert(matchesReviewerRoute(run, {model:evidence.registered_model, reasoning_effort:evidence.registered_reasoning_effort}), 'The registered primary reviewer must match the pinned route.');
  assert(Array.isArray(evidence.observed_models) && evidence.observed_models.length > 1, 'Host drift evidence must include the observed model transitions.');

  const session = state.agent_sessions.find(item => item.agent_id === primaryAgentId && item.role === 'raw_reviewer');
  assert(session && ['active', 'completed'].includes(session.status), 'The bound primary reviewer session is not recoverable.');
  const attempts = state.raw_review_attempts;
  assert(attempts.length > 0, 'No current Raw review attempts are available for drift recovery.');
  assert(!attempts.some(item => item.status === 'prepared'), 'Complete or discard prepared Raw reviews before reviewer-drift recovery.');
  assert(attempts.every(item => item.agent_id === primaryAgentId), 'Reviewer-drift recovery requires one affected primary reviewer across the current attempts.');

  const recoveredAt = options.now ?? nowIso();
  const evidenceRelative = rel(root, evidencePath);
  const evidenceSha = hashFile(root, evidenceRelative);
  const history = attempts.map(item => ({
    ...item,
    invalidated_kind: 'reviewer_configuration_drift',
    invalidated_reason: options.reason.trim(),
    invalidation_evidence_path: evidenceRelative,
    invalidation_evidence_sha256: evidenceSha,
    invalidated_at: recoveredAt
  }));
  state.raw_review_history = [...(state.raw_review_history ?? []), ...history];
  state.raw_review_attempts = [];
  policy.primary_agent_id = null;
  policy.primary_context_id = null;
  session.status = 'replaced';
  session.close_reason = (session.close_reason ?? 'completed') + '; replaced after observed reviewer configuration drift';

  run.content_audits = [];
  if (!Array.isArray(state.reviewer_drift_history)) state.reviewer_drift_history = [];
  state.reviewer_drift_history.push({
    kind: 'reviewer_configuration_drift',
    agent_id: primaryAgentId,
    evidence_path: evidenceRelative,
    evidence_sha256: evidenceSha,
    archived_attempt_count: history.length,
    reason: options.reason.trim(),
    recovered_at: recoveredAt
  });
  saveRun(root, options.run, run, recoveredAt);
  return {
    status: 'recovered',
    primary_agent_id: primaryAgentId,
    archived_attempt_count: history.length,
    evidence_path: evidenceRelative,
    next_action: 'reserve a fresh primary route raw_reviewer session, then prepare six fresh full reviews'
  };
}
export function applyProposedRepairs(root, options) {
  root = fs.realpathSync(root);
  const run = readJson(root, options.run);
  const state = control(run);
  assertWritableRun(run);
  const attempts = state.raw_review_attempts.filter(item => item.raw_path === options.raw && ['failed','needs_review','media_limited'].includes(item.status)).sort((a, b) => a.sequence - b.sequence);
  assert(attempts.length > 0, 'No failed Raw review is available for deterministic repair: ' + options.raw);
  const attempt = attempts.at(-1);
  assert(attempt.kind !== 'escalated_review', 'Astra escalation findings require a human/producer decision, not deterministic repair.');
  assert(hashFile(root, options.raw) === attempt.raw_sha256, 'Raw changed after the reviewed version; deterministic repair is forbidden.');
  const report = readJson(root, attempt.report_path);
  const findings = [...(report.findings ?? []), ...(report.style?.findings ?? [])].filter(item => Object.hasOwn(item, 'replacement_text'));
  assert(findings.length > 0, 'No reviewer finding contains replacement_text.');
  const edits = findings.map((finding, index) => {
    assert(Array.isArray(finding.raw_ranges) && finding.raw_ranges.length === 1, `Repair finding ${index + 1} must bind exactly one raw range.`);
    const [start, end] = finding.raw_ranges[0];
    assert(Number.isInteger(start) && Number.isInteger(end) && start > 0 && end >= start, `Repair finding ${index + 1} has an invalid raw range.`);
    assert(typeof finding.replacement_text === 'string', `Repair finding ${index + 1} replacement_text must be a string.`);
    return {start, end, replacement_text: finding.replacement_text, rule: finding.rule ?? null};
  }).sort((a, b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) assert(edits[i].start > edits[i - 1].end, 'Reviewer repair ranges overlap.');
  const rawFull = safe(root, options.raw, true);
  let lines = fs.readFileSync(rawFull, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
  const trailingNewline = lines.at(-1) === '';
  if (trailingNewline) lines.pop();
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    assert(edit.end <= lines.length, `Reviewer repair range exceeds current Raw line count: ${edit.start}-${edit.end}`);
    lines.splice(edit.start - 1, edit.end - edit.start + 1, ...edit.replacement_text.split(/\r?\n/));
  }
  const beforeSha = attempt.raw_sha256;
  fs.writeFileSync(rawFull, lines.join('\n') + (trailingNewline ? '\n' : ''));
  const afterSha = hashFile(root, options.raw);
  assert(afterSha !== beforeSha, 'Reviewer repair proposal produced no Raw change.');
  const evidencePath = rel(root, path.join(path.dirname(safe(root, attempt.report_path)), `repair-application-${attempt.id}.json`));
  const evidence = {schema_version: 1, raw_path: options.raw, before_sha256: beforeSha, after_sha256: afterSha, review_attempt_id: attempt.id, edit_count: edits.length, edits, applied_at: options.now ?? nowIso()};
  writeOnce(root, evidencePath, evidence);
  attempt.repair_application = {path: evidencePath, sha256: hashFile(root, evidencePath), after_raw_sha256: afterSha};
  saveRun(root, options.run, run, evidence.applied_at);
  return {status: 'repaired', raw_path: options.raw, edit_count: edits.length, evidence_path: evidencePath, after_raw_sha256: afterSha, next_action: 'prepare a targeted primary recheck using the same primary reviewer session'};
}

export function completeAttempt(root, options) {
  root = fs.realpathSync(root);
  const run = readJson(root, options.run);
  const state = control(run);
  assertWritableRun(run);
  assert(typeof options.raw === 'string' && options.raw, 'Raw path is required.');
  assert(typeof options.agent === 'string' && options.agent.trim(), 'Actual reviewer agent id is required.');
  const matches = state.raw_review_attempts.filter(item => item.raw_path === options.raw && item.status === 'prepared');
  assert(matches.length === 1, 'Expected exactly one prepared Raw review attempt: ' + options.raw);
  const attempt = matches[0];
  const reportFull = assertRunLocal(root, options.run, attempt.report_path, true);
  const preflight = preflightReport(root, options);
  assert(preflight.status === 'passed', 'Review report mechanical preflight failed (' + preflight.error_count + '): ' + preflight.errors.join('; '));
  const report = JSON.parse(fs.readFileSync(reportFull, 'utf8').replace(/^\uFEFF/, ''));
  assert(typeof report.reviewer_context_id === 'string' && report.reviewer_context_id.trim(), 'Report lacks reviewer_context_id.');
  assert(report.reviewer_context_id !== run.producer_context_id, 'Reviewer context must differ from producer context.');
  const agentId = options.agent.trim();
  const reviewerSession = sessionFor(state, agentId, attempt);
  const runtime = checkReviewerRuntime(root, run, agentId, attempt.request_path, options);
  if (state.schema_version >= 2) {
    const policy = state.reviewer_policy;
    const noCurrentCompletion = !state.raw_review_attempts.some(item => item.status !== 'prepared');
    if (run.stage1_baseline_recovery && noCurrentCompletion && policy.primary_agent_id) {
      policy.primary_agent_id = null;
      policy.primary_context_id = null;
    }
    if (attempt.kind === 'escalated_review') {
      assert(policy.primary_agent_id && agentId !== policy.primary_agent_id, 'Astra escalation must use a different reviewer session from the primary primary reviewer.');
      assert(report.reviewer_context_id !== policy.primary_context_id, 'Astra escalation must use a context distinct from the primary primary reviewer.');
    } else if (!policy.primary_agent_id) {
      policy.primary_agent_id = agentId;
      policy.primary_context_id = report.reviewer_context_id;
    } else {
      assert(agentId === policy.primary_agent_id, 'All primary reviews in one batch must reuse the single primary reviewer AgentId.');
      assert(report.reviewer_context_id === policy.primary_context_id, 'All primary reviews in one batch must reuse the single primary reviewer context.');
    }
    assert(state.agent_sessions.length <= state.child_session_cap, `Child session cap exceeded: ${state.agent_sessions.length} > ${state.child_session_cap}`);
  } else {
    const priorSameRaw = state.raw_review_attempts.filter(item => item.raw_path === options.raw && item.status !== 'prepared');
    assert(!priorSameRaw.some(item => item.reviewer_context_id === report.reviewer_context_id), 'Each legacy review attempt for one Raw requires a fresh reviewer context.');
    assert(!priorSameRaw.some(item => item.agent_id === agentId), 'Each legacy review attempt for one Raw requires a fresh reviewer AgentId.');
    const proposedAgents = knownAgentIds(run);
    proposedAgents.add(agentId);
    assert(proposedAgents.size <= state.child_session_cap, `Child session cap exceeded: ${proposedAgents.size} > ${state.child_session_cap}`);
  }
  assert(hashFile(root, attempt.request_path) === attempt.request_sha256, 'Prepared Raw review request drifted.');
  assert(hashFile(root, attempt.raw_path) === attempt.raw_sha256, 'Raw changed after review preparation.');
  const endedAt = options.now ?? nowIso();
  const invocationId = `raw-review-${attempt.id}-${sha(agentId + endedAt).slice(0, 12)}`;
  const continuity = attempt.kind === 'escalated_review' ? 'fresh-context-escalation' : (state.schema_version >= 2 ? 'single-primary-continuity' : 'fresh-context-default');
  const auditConfig = readJson(root, attempt.request_path).audit_config;
  const provenance = {
    schema_version: 1,
    invocation_id: invocationId,
    reviewer_context_id: report.reviewer_context_id,
    producer_context_id: run.producer_context_id,
    request_sha256: attempt.request_sha256,
    evidence_class: 'host_observed',
    tool: 'codex_subagent_dispatch',
    agent_id: agentId,
    session_key: reviewerSession?.session_key ?? null,
    model: attempt.model,
    reasoning_effort: attempt.reasoning_effort,
    audit_config: auditConfig,
    review_kind: attempt.kind,
    observation: attempt.kind === 'escalated_review'
      ? 'The host dispatched the one allowed independent Astra reviewer for a semantic dispute.'
      : 'The host reused the batch primary primary reviewer so the standard remains stable across full reviews and targeted validation.',
    recorded_at: endedAt
  };
  if (runtime) provenance.runtime_configuration = runtime;
  const created = [];
  try {
    if (writeOnce(root, attempt.provenance_path, provenance)) created.push(attempt.provenance_path);
    const host = {
      schema_version: 1,
      evidence_class: 'host_observed',
      invocation_id: invocationId,
      reviewer_context_id: report.reviewer_context_id,
      producer_context_id: run.producer_context_id,
      fresh_context: attempt.kind === 'escalated_review' || state.schema_version < 2,
      model: attempt.model,
      reasoning_effort: attempt.reasoning_effort,
      audit_config: auditConfig,
      review_kind: attempt.kind,
      request_sha256: attempt.request_sha256,
      report_sha256: hashFile(root, attempt.report_path),
      started_at: attempt.prepared_at,
      ended_at: endedAt,
      agent_id: agentId,
      session_key: reviewerSession?.session_key ?? null,
      provenance: {path: attempt.provenance_path, sha256: hashFile(root, attempt.provenance_path)}
    };
    if (writeOnce(root, attempt.host_path, host)) created.push(attempt.host_path);
    const receipt = evaluate(root, {request: attempt.request_path, review: attempt.report_path, host: attempt.host_path, mode: 'stage1'});
    if (writeOnce(root, attempt.receipt_path, receipt)) created.push(attempt.receipt_path);
    Object.assign(attempt, {
      status: receipt.status,
      report_sha256: hashFile(root, attempt.report_path),
      host_sha256: hashFile(root, attempt.host_path),
      provenance_sha256: hashFile(root, attempt.provenance_path),
      receipt_sha256: hashFile(root, attempt.receipt_path),
      reviewer_context_id: report.reviewer_context_id,
      agent_id: agentId,
      outcome_class: outcomeClass(receipt, report),
      completed_at: endedAt
    });
    if (state.schema_version >= 2) {
      const reportedFindings = [...(report.findings ?? []), ...(report.style?.findings ?? [])];
      const introducedCount = reportedFindings.filter(item => item.origin === 'repair_introduced').length;
      const firstReview = attempt.kind === 'full_default' && !state.quality_events.some(x=>x.raw_path===attempt.raw_path && x.detection_stage==='first_review');
      state.quality_events.push({
        event_id: invocationId,
        raw_path: attempt.raw_path,
        review_kind: attempt.kind,
        detection_stage: attempt.kind === 'full_default' ? (firstReview?'first_review':'content_revalidation') : (attempt.kind === 'targeted_recheck' ? 'repair_validation' : 'second_perspective'),
        raw_sha256: attempt.raw_sha256,
        result: receipt.status,
        outcome_class: attempt.outcome_class,
        finding_count: reportedFindings.length,
        first_review_finding_count: firstReview ? reportedFindings.length : 0,
        repair_residual_count: attempt.kind === 'targeted_recheck' ? reportedFindings.length - introducedCount : 0,
        repair_introduced_count: introducedCount,
        recorded_at: endedAt
      });
    }
    saveRun(root, options.run, run, endedAt);
    const targetedprimaryCount = state.raw_review_attempts.filter(item => item.raw_path === options.raw && item.kind === 'targeted_recheck').length;
    const nextAction = receipt.status === 'passed'
      ? 'record-content-audit with the generated receipt'
      : attempt.kind === 'escalated_review'
        ? 'stop and fuse or report the unresolved semantic blocker; no further review is permitted'
        : attempt.kind === 'full_default'
          ? 'apply one targeted Luna repair, then prepare the primary targeted recheck'
          : attempt.outcome_class === 'semantic_dispute'
            ? 'prepare one Astra low escalation on this unchanged targeted request'
            : targetedprimaryCount < 2
              ? 'apply one more targeted Luna repair, then prepare another primary targeted recheck'
              : 'stop and fuse or report the unresolved repairable blocker; two targeted repair rounds are exhausted';
    return {
      status: receipt.status,
      attempt_id: attempt.id,
      review_kind: attempt.kind,
      model: attempt.model,
      reasoning_effort: attempt.reasoning_effort,
      outcome_class: attempt.outcome_class,
      receipt_path: attempt.receipt_path,
      receipt_sha256: attempt.receipt_sha256,
      actual_child_session_count: state.schema_version >= 2 ? state.agent_sessions.length : knownAgentIds(run).size,
      child_session_cap: state.child_session_cap,
      next_action: nextAction
    };
  } catch (error) {
    for (const value of created.reverse()) {
      const full = safe(root, value, false);
      if (fs.existsSync(full)) fs.unlinkSync(full);
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === own) {
  try {
    const [action, ...args] = process.argv.slice(2);
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      assert(args[index]?.startsWith('--') && args[index + 1] !== undefined, 'Expected --key value arguments.');
      options[args[index].slice(2)] = args[index + 1];
    }
    const root = fs.realpathSync(options.root ?? path.resolve(path.dirname(own), '../../..'));
    const result = action === 'prepare' ? prepareAttempt(root, options) : action === 'preflight' ? preflightReport(root, options) : action === 'apply' ? applyProposedRepairs(root, options) : action === 'complete' ? completeAttempt(root, options) : action === 'invalidate' ? invalidatePassedAttempt(root, options) : action === 'discard' ? discardPreparedAttempt(root, options) : action === 'recover-drift' ? recoverReviewerDrift(root, options) : null;
    assert(result, 'Actions: prepare, preflight, apply, complete, invalidate, discard, recover-drift');
    console.log(JSON.stringify(result, null, 2));
    if (action === 'complete' && result.status !== 'passed') process.exitCode = 2;
  } catch (error) {
    console.error('RAW_REVIEW_CONTROL_FAILED: ' + error.message);
    process.exitCode = 1;
  }
}
