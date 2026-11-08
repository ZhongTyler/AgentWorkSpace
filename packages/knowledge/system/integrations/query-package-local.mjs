/** Explicit local Agent inbox for authenticated host packages. No model, network or content writes. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {validateQueryPackage, queryPackageEligibility, queryPackageDigest, createQueryPackageResults} from './query-package.mjs';

function requireValue(condition, code) {
  if (!condition) throw Object.assign(new Error(code), {code});
}
const terminal = new Set(['increment', 'bug_fixed', 'no_increment', 'duplicate', 'withdrawn', 'expired']);
const copy = value => JSON.parse(JSON.stringify(value));

export async function createQueryPackageInbox({home, feedbackHome = path.join(home ?? '', 'feedback'), namespace, snapshots, toolsRoot, now = () => Date.now(), tombstoneRetentionMs} = {}) {
  requireValue(typeof home === 'string' && path.isAbsolute(home), 'package_private_home_required');
  requireValue(Array.isArray(snapshots), 'package_snapshot_catalog_required');
  requireValue(new Set(snapshots.map(item => item.snapshot_id)).size === snapshots.length, 'package_snapshot_identity_ambiguous');
  requireValue(Number.isSafeInteger(tombstoneRetentionMs) && tombstoneRetentionMs > 0, 'package_confirmed_tombstone_retention_required');
  requireValue(typeof toolsRoot === 'string' && path.isAbsolute(toolsRoot), 'explicit_tools_root_required');
  const {FileStore} = await import(pathToFileURL(path.join(toolsRoot, 'integrations/knowledge-feedback/store.mjs')));
  const {recordsForFinding} = await import(pathToFileURL(path.join(toolsRoot, 'integrations/knowledge-feedback/host.mjs')));
  const {initialState, validateRecord} = await import(pathToFileURL(path.join(toolsRoot, 'integrations/knowledge-feedback/core.mjs')));
  namespace = initialState(namespace).namespace;
  home = path.resolve(home);
  const store = new FileStore({home: feedbackHome, namespace});
  const file = path.join(home, 'query-packages-' + queryPackageDigest(namespace) + '.json');
  function state() {
    if (!fs.existsSync(file)) return {schema_version: 1, namespace, reject_before: 0, rows: {}};
    requireValue(!fs.lstatSync(file).isSymbolicLink(), 'package_state_symlink');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    requireValue(value.schema_version === 1 && queryPackageDigest(value.namespace) === queryPackageDigest(namespace), 'package_state_namespace_mismatch');
    return value;
  }
  function mutate(action) {
    let parent = home;
    while (!fs.existsSync(parent)) parent = path.dirname(parent);
    requireValue(path.resolve(fs.realpathSync(parent)).toLowerCase() === parent.toLowerCase(), 'package_home_symlink');
    fs.mkdirSync(home, {recursive: true, mode: 0o700});
    const lock = file + '.lock';
    let descriptor;
    try { descriptor = fs.openSync(lock, 'wx', 0o600); }
    catch (error) {
      if (error.code === 'EEXIST') return {status: 'busy', acknowledged: false};
      throw error;
    }
    let temporary;
    try {
      const current = state();
      const before = queryPackageDigest(current);
      const result = action(current);
      if (queryPackageDigest(current) !== before) {
        temporary = file + '.' + randomUUID() + '.tmp';
        const output = fs.openSync(temporary, 'wx', 0o600);
        try { fs.writeFileSync(output, JSON.stringify(current) + '\n'); fs.fsyncSync(output); }
        finally { fs.closeSync(output); }
        fs.renameSync(temporary, file);
        temporary = null;
      }
      return result;
    } finally {
      if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary);
      fs.closeSync(descriptor);
      fs.unlinkSync(lock);
    }
  }
  function eligible(packet) {
    return queryPackageEligibility(packet, {now: now(), namespace, snapshots});
  }
  function accepted(result) {
    requireValue(['persisted', 'unchanged', 'no_increment'].includes(result.status), 'package_feedback_' + result.status);
  }
  function revokeSignals(requestId, reason) {
    const current = store.read();
    const stamp = now();
    const signals = Object.values(current.records.signal).filter(signal => signal.lookup_id === requestId);
    const controls = signals.map(signal => ({schema_version: 1, ...namespace, type: 'control', id: 'package-withdraw-' + queryPackageDigest(signal.id).slice(0,40), revision: 1, occurred_at: new Date(stamp).toISOString(), expires_at: new Date(stamp + tombstoneRetentionMs).toISOString(), operation: 'withdraw', target: {type: 'signal', id: signal.id}, reason_code: reason}));
    if (controls.length) accepted(store.apply(controls, {now: stamp, expectedCursor: current.cursor}));
  }
  function receipt(row, status = row.status) {
    return {package_id: row.package_id, request_id: row.request_id, revision: row.revision, manifest_sha256: row.manifest_sha256, status, acknowledged: true};
  }
  function receive(input, {trustedTransport = false} = {}) {
    requireValue(trustedTransport === true, 'package_authenticated_transport_required');
    const packet = validateQueryPackage(input);
    const qualification = eligible(packet);
    if (qualification.status !== 'eligible') return {...qualification, acknowledged: false};
    return mutate(current => {
      const prior = current.rows[packet.package_id];
      const sameRequest = Object.values(current.rows).find(row => row.request_id === packet.request_id);
      requireValue(!sameRequest || sameRequest.package_id === packet.package_id, 'package_request_identity_conflict');
      if (prior) {
        requireValue(prior.request_id === packet.request_id, 'package_identity_conflict');
        if (prior.status === 'withdrawn') return receipt(prior, 'withdrawn');
        if (packet.kind !== 'withdrawal' && packet.revision < prior.revision) return receipt(prior, 'stale');
        if (packet.revision === prior.revision && packet.manifest_sha256 === prior.manifest_sha256) return receipt(prior, 'duplicate_delivery');
        if (packet.kind !== 'withdrawal') requireValue(packet.revision > prior.revision, 'package_revision_conflict');
      }
      if (packet.kind !== 'withdrawal' && Date.parse(packet.created_at) <= current.reject_before) return {status: 'excluded', reason: 'package_retention_watermark', acknowledged: false};
      const row = {package_id: packet.package_id, request_id: packet.request_id, revision: packet.revision, manifest_sha256: packet.manifest_sha256, created_at: packet.created_at, expires_at: packet.expires_at, result_revision: prior?.result_revision ?? 0, public_return_allowed: packet.kind === 'query' && packet.policy.public_return_allowed, status: 'pending'};
      if (packet.kind === 'withdrawal') {
        revokeSignals(packet.request_id, packet.reason_code);
        row.revision = Math.max(prior?.revision ?? 0, packet.revision);
        row.status = 'withdrawn';
        row.result_revision++;
        row.expires_at = new Date(now() + tombstoneRetentionMs).toISOString();
      } else {
        row.packet = packet;
        if (prior?.decision_ref) row.prior_decision_ref = prior.decision_ref;
        if (prior?.record_ids) row.record_ids = prior.record_ids;
      }
      current.rows[packet.package_id] = row;
      return receipt(row, packet.kind === 'withdrawal' ? 'withdrawn' : 'received');
    });
  }
  function pending({terms = [], limit = 5} = {}) {
    requireValue(Number.isSafeInteger(limit) && limit >= 0 && limit <= 50 && Array.isArray(terms) && terms.every(term => typeof term === 'string'), 'package_pending_budget_invalid');
    return Object.values(state().rows).filter(row => row.packet && !terminal.has(row.status) && eligible(row.packet).status === 'eligible')
      .filter(row => !terms.length || terms.some(term => row.packet.query.question.toLowerCase().includes(term.toLowerCase())))
      .sort((a, b) => Number(b.packet.feedback.rating === 'unhelpful') - Number(a.packet.feedback.rating === 'unhelpful') || b.packet.diagnostics.warning_codes.length - a.packet.diagnostics.warning_codes.length || a.created_at.localeCompare(b.created_at))
      .slice(0, limit).map(row => ({package_id: row.package_id, request_id: row.request_id, revision: row.revision, manifest_sha256: row.manifest_sha256, status: row.status, question: row.packet.query.question.slice(0,400), feedback: row.packet.feedback.rating, warning_codes: row.packet.diagnostics.warning_codes, next_action: row.next_action ?? 'Agent reads the package and exact source versions before assessment', review_when: row.review_when ?? 'current authorized local task'}));
  }
  function read(packageId) {
    const row = state().rows[packageId];
    requireValue(row?.packet && !terminal.has(row.status), 'package_not_active');
    const qualification = eligible(row.packet);
    requireValue(qualification.status === 'eligible', qualification.reason);
    return copy(row.packet);
  }
  function preparePublicRecords({package_id, finding, refs}) {
    const packet = read(package_id);
    requireValue(packet.policy.public_return_allowed === true && Array.isArray(refs) && refs.every(ref => packet.sources.some(source => source.ref === ref)), 'package_public_refs_outside_snapshot');
    const row = state().rows[package_id];
    const context = {...namespace, lookup_id: packet.request_id, request_ref: 'query-package:' + package_id, purpose: 'maintenance', started_at: packet.created_at, expires_at: packet.expires_at, policy: {...packet.policy, export_to_owner: true}};
    const observations = packet.sources.filter(source => refs.includes(source.ref)).map(source => ({source: {...source, stage: 'returned'}, knowledge: {snapshot_id: packet.knowledge.snapshot_id, used_mode: packet.knowledge.used_mode}}));
    const generated = recordsForFinding(context, observations, {...finding, revision: row.result_revision + 1, payload_ref: null});
    const records = [...generated.signals,...generated.issues,...generated.outcomes];
    const prefix = 'public-qp-' + queryPackageDigest(package_id).slice(0,20) + '-';
    const ids = new Map(records.map(record => [record.id, prefix + 'r' + (row.result_revision + 1) + '-' + record.type + '-' + queryPackageDigest(record.id).slice(0,16)]));
    for (const record of records) {
      record.id = ids.get(record.id);
      if (record.type === 'issue') record.signal_ids = record.signal_ids.map(id => ids.get(id) ?? id);
      if (record.type === 'outcome_link') record.issue_id = ids.get(record.issue_id) ?? record.issue_id;
    }
    return {core_records: records, core_record_hashes: records.map(queryPackageDigest), status: 'prepared_requires_public_review'};
  }
  function assess(input) {
    requireValue(input && ['increment','needs_evidence','no_increment','duplicate','bug_fixed'].includes(input.disposition), 'package_disposition_invalid');
    requireValue(typeof input.agent === 'string' && input.agent.trim() && typeof input.decision_ref === 'string' && input.decision_ref.trim(), 'package_agent_decision_required');
    requireValue(typeof input.reason === 'string' && input.reason.trim(), 'package_reason_required');
    const decisionDigest = queryPackageDigest(input);
    return mutate(current => {
      const row = current.rows[input.package_id];
      requireValue(row && row.revision === input.revision && row.manifest_sha256 === input.manifest_sha256, 'package_assessment_version_mismatch');
      if (row.decision_digest === decisionDigest) return receipt(row, 'duplicate_assessment');
      requireValue(row.packet && !terminal.has(row.status), 'package_not_active');
      const packet = row.packet;
      const qualification = eligible(packet);
      requireValue(qualification.status === 'eligible', qualification.reason);
      if (input.disposition === 'duplicate') {
        const target = current.rows[input.duplicate_of];
        requireValue(target && target.package_id !== row.package_id && terminal.has(target.status) && !['expired','withdrawn'].includes(target.status), 'package_duplicate_target_required');
      }
      if (input.disposition === 'needs_evidence') requireValue(typeof input.next_action === 'string' && input.next_action.trim() && typeof input.review_when === 'string' && input.review_when.trim(), 'package_evidence_action_required');
      let publicResult = null;
      if (input.public_result) {
        requireValue(terminal.has(input.disposition), 'package_public_result_requires_disposition');
        requireValue(packet.policy.public_return_allowed === true && input.public_review?.approved === true && typeof input.public_review.reviewer === 'string' && input.public_review.reviewer.trim(), 'package_public_review_required');
        requireValue(typeof input.public_result.summary === 'string' && input.public_result.summary.trim() && input.public_result.summary.length <= 4000, 'package_public_summary_invalid');
        const snapshot = snapshots.find(item => item.snapshot_id === input.public_result.snapshot_id);
        requireValue(snapshot && Array.isArray(input.public_result.refs) && input.public_result.refs.every(ref => typeof snapshot.sources[ref] === 'string'), 'package_public_refs_outside_snapshot');
        publicResult = {package_id: packet.package_id, request_id: packet.request_id, revision: row.result_revision + 1, source_revision: packet.revision, source_manifest_sha256: packet.manifest_sha256, disposition: input.disposition, summary: input.public_result.summary, snapshot_id: snapshot.snapshot_id, snapshot_manifest_sha256: snapshot.manifest_sha256, refs: input.public_result.refs, reviewer: input.public_review.reviewer, expires_at: packet.expires_at};
        if (input.public_result.core_records) {
          const records = input.public_result.core_records.map(validateRecord);
          requireValue(!records.length || ['increment','bug_fixed'].includes(input.disposition), 'package_no_increment_has_core_records');
          requireValue(records.length <= 32 && Buffer.byteLength(JSON.stringify(records)) <= 131072, 'package_public_core_limit');
          const hashes = records.map(queryPackageDigest);
          requireValue(Array.isArray(input.public_review.core_record_hashes) && queryPackageDigest(hashes) === queryPackageDigest(input.public_review.core_record_hashes), 'package_public_core_review_required');
          const prefix = 'public-qp-' + queryPackageDigest(packet.package_id).slice(0,20) + '-';
          const publicRefs = new Set(input.public_result.refs);
          const signals = new Set(records.filter(record => record.type === 'signal').map(record => record.id));
          const issues = new Set(records.filter(record => record.type === 'issue').map(record => record.id));
          for (const record of records) {
            requireValue(record.id.startsWith(prefix) && ['host','library_id','view'].every(key => record[key] === namespace[key]), 'package_public_core_identity');
            requireValue(Date.parse(record.expires_at) <= Date.parse(packet.expires_at) && Date.parse(record.expires_at) > now(), 'package_public_core_retention');
            if (record.type !== 'control') requireValue(record.policy.analysis_allowed === true && record.policy.temporary === false && record.policy.retention_confirmed === true && record.policy.public_return_allowed === true, 'package_public_core_policy');
            if (record.type === 'signal') requireValue(record.lookup_id === packet.request_id && record.payload_ref === null && record.sources.every(source => publicRefs.has(source.ref) && snapshot.sources[source.ref] === source.version), 'package_public_core_source');
            if (record.type === 'issue') requireValue(record.signal_ids.every(id => signals.has(id)) && [...record.evidence,...record.counterevidence,...[record.handoff_ref].filter(Boolean)].every(ref => publicRefs.has(ref)), 'package_public_core_dependency');
            if (record.type === 'outcome_link') {
              const evidenceRefs = Object.values(record.evidence).filter(Boolean).flatMap(value => value.refs);
              requireValue(issues.has(record.issue_id) && [...evidenceRefs,...record.affected,...[record.validation_ref,record.result_ref].filter(Boolean)].every(ref => publicRefs.has(ref)), 'package_public_core_dependency');
            }
            if (record.type === 'control') requireValue(record.target.id.startsWith(prefix), 'package_public_core_dependency');
          }
          publicResult.core_records = records;
        }
      }
      let rows = null;
      if (['increment','bug_fixed','needs_evidence'].includes(input.disposition)) {
        requireValue(input.finding?.issue?.owner, 'package_increment_owner_required');
        const context = {...namespace, lookup_id: packet.request_id, request_ref: 'query-package:' + packet.package_id, purpose: 'maintenance', entry: 'online', started_at: packet.created_at, expires_at: packet.expires_at, policy: packet.policy};
        const observations = packet.sources.map(source => ({source: {...source, stage: 'returned'}, knowledge: {snapshot_id: packet.knowledge.snapshot_id, used_mode: packet.knowledge.used_mode}}));
        const finding = {...input.finding, revision: packet.revision * 2, occurred_at: packet.created_at, payload_ref: null};
        requireValue(input.disposition !== 'increment' || finding.increment, 'package_increment_evidence_required');
        if (input.disposition === 'increment') requireValue(finding.issue.status === 'linked' && finding.issue.handoff_ref, 'package_increment_handoff_required');
        rows = recordsForFinding(context, observations, finding);
        requireValue(rows.issues.length === 1, 'package_issue_required');
        if (input.disposition === 'needs_evidence') {
          rows.issues[0].status = 'needs_evidence';
          rows.issues[0].next_action = input.next_action;
          rows.issues[0].review_when = input.review_when;
        }
        if (input.disposition === 'bug_fixed') {
          const outcome = rows.outcomes[0];
          requireValue(rows.outcomes.length === 1 && outcome.validation_ref?.trim() && outcome.result_ref?.trim() && (outcome.evidence.adopted !== null || outcome.evidence.ingested !== null), 'package_fix_outcome_required');
        }
        if (input.disposition === 'bug_fixed' && typeof store.resolveIssue !== 'function') return {status:'unavailable', reason:'feedback_resolution_unavailable', acknowledged:false};
        const previous = store.read();
        const withoutRevision = record => {const result = {...record}; delete result.revision; return queryPackageDigest(result);};
        const existingOutcome = rows.outcomes[0] && previous.records.outcome_link[rows.outcomes[0].id];
        const completedRetry = input.disposition === 'bug_fixed' && previous.records.issue[rows.issues[0].id]?.status === 'resolved' && existingOutcome && withoutRevision(existingOutcome) === withoutRevision(rows.outcomes[0]);
        const updates = [...rows.signals, ...rows.issues, ...rows.outcomes].filter(record => !(completedRetry && record.type === 'issue'));
        for (const record of updates) {
          const old = previous.records[record.type][record.id];
          if (old) record.revision = withoutRevision(old) === withoutRevision(record) ? old.revision : old.revision + 1;
        }
        // Completion is a second idempotent transaction. Exact retained outcomes identify a retry.
        accepted(store.apply(updates, {now: now(), expectedCursor: previous.cursor}));
        if (input.disposition === 'bug_fixed') {
          requireValue(rows.outcomes.length === 1, 'package_fix_outcome_required');
          accepted(store.resolveIssue({issueId: rows.issues[0].id, outcome: rows.outcomes[0], now: now()}));
        }
      } else if (row.record_ids?.length) {
        const previous = store.read();
        const closed = row.record_ids.filter(record => record.type === 'issue').map(record => previous.records.issue[record.id]).filter(issue => issue && !['resolved','rejected'].includes(issue.status)).map(issue => ({...issue, revision: issue.revision + 1, status: 'rejected', handoff_ref: input.decision_ref, next_action: 'Closed by local Agent assessment', review_when: 'new evidence for this condition'}));
        accepted(store.apply(closed, {now: now(), expectedCursor: previous.cursor}));
      }
      row.status = input.disposition;
      row.decision_ref = input.decision_ref;
      row.decision_digest = decisionDigest;
      row.record_ids = rows ? [...rows.signals, ...rows.issues, ...rows.outcomes].map(record => ({type: record.type, id: record.id})) : [];
      row.public_result = publicResult;
      if (publicResult) row.result_revision = publicResult.revision;
      if (input.disposition === 'needs_evidence') {
        row.next_action = input.next_action;
        row.review_when = input.review_when;
      } else delete row.packet;
      return receipt(row, 'assessed');
    });
  }
  function exportResults({publicTransferAllowed = false} = {}) {
    requireValue(publicTransferAllowed === true, 'package_public_transfer_required');
    const rows = Object.values(state().rows);
    return createQueryPackageResults({namespace, results: rows.filter(row => row.public_result && Date.parse(row.expires_at) > now() && !['withdrawn','expired'].includes(row.status)).map(row => copy(row.public_result)), controls: rows.filter(row => row.status === 'withdrawn').map(row => ({package_id: row.package_id, request_id: row.request_id, revision: row.result_revision, source_revision: row.revision, operation: 'withdraw', expires_at: row.expires_at}))});
  }
  function maintain() {
    return mutate(current => {
      const removed = [];
      for (const [packageId, row] of Object.entries(current.rows)) {
        if (Date.parse(row.expires_at) > now()) continue;
        revokeSignals(row.request_id, 'retention_expired');
        current.reject_before = Math.max(current.reject_before, now());
        delete current.rows[packageId];
        removed.push(packageId);
      }
      accepted(store.maintain({now: now(), tombstone_retention_ms: tombstoneRetentionMs}));
      return {status: removed.length ? 'pruned' : 'unchanged', removed_count: removed.length};
    });
  }
  return Object.freeze({receive, pending, read, preparePublicRecords, assess, exportResults, maintain, feedback: store});
}
