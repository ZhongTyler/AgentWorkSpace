/** Shared server/local transport contract. Integrity checks do not authenticate a sender. */
import {createHash} from 'node:crypto';

export const QUERY_PACKAGE_VERSION = 'knowledge-query-package-v1';
export const QUERY_PACKAGE_RESULTS_VERSION = 'knowledge-query-package-results-v1';
export const QUERY_PACKAGE_MAX_BYTES = 2 * 1024 * 1024;
const identifier = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const digestPattern = /^[a-f0-9]{64}$/;
function requireValue(condition, code) {
  if (!condition) throw Object.assign(new Error(code), {code});
}
function object(value, keys) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype, 'package_object_required');
  requireValue(Object.keys(value).every(key => keys.includes(key)), 'package_unknown_field');
}
function text(value, maximum = 16000) {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= maximum, 'package_text_invalid');
}
function id(value) {
  requireValue(typeof value === 'string' && identifier.test(value) && !['constructor','prototype','__proto__'].includes(value), 'package_id_invalid');
}
function date(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), 'package_date_invalid');
}
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), 'package_number_invalid');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  object(value, Object.keys(value ?? {}));
  requireValue(!Object.keys(value).some(key => ['__proto__', 'prototype', 'constructor'].includes(key)), 'package_reserved_key');
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}
export function queryPackageDigest(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
const commonFields = ['schema_version', 'contract', 'kind', 'package_id', 'namespace', 'request_id', 'revision', 'created_at', 'expires_at', 'manifest_sha256'];

export function validateQueryPackage(packet) {
  object(packet, [...commonFields, 'policy', 'query', 'answer', 'knowledge', 'sources', 'feedback', 'diagnostics', 'reason_code']);
  requireValue(packet.schema_version === 1 && packet.contract === QUERY_PACKAGE_VERSION, 'package_version_unsupported');
  requireValue(['query', 'withdrawal'].includes(packet.kind), 'package_kind_invalid');
  id(packet.package_id);
  id(packet.request_id);
  object(packet.namespace, ['host', 'library_id', 'view']);
  for (const field of ['host', 'library_id', 'view']) id(packet.namespace[field]);
  requireValue(Number.isSafeInteger(packet.revision) && packet.revision > 0, 'package_revision_invalid');
  date(packet.created_at);
  date(packet.expires_at);
  requireValue(Date.parse(packet.expires_at) > Date.parse(packet.created_at), 'package_retention_invalid');
  if (packet.kind === 'withdrawal') {
    requireValue(!['policy', 'query', 'answer', 'knowledge', 'sources', 'feedback', 'diagnostics'].some(key => key in packet), 'withdrawal_contains_payload');
    id(packet.reason_code);
  } else {
    requireValue(!('reason_code' in packet), 'query_contains_control');
    object(packet.policy, ['version', 'analysis_allowed', 'temporary', 'retention_confirmed', 'improvement_use_on_local_confirmed', 'public_return_allowed']);
    text(packet.policy.version, 128);
    for (const field of ['analysis_allowed', 'temporary', 'retention_confirmed', 'improvement_use_on_local_confirmed', 'public_return_allowed']) {
      requireValue(typeof packet.policy[field] === 'boolean', 'package_policy_invalid');
    }
    object(packet.query, ['question', 'context']);
    text(packet.query.question);
    if (packet.query.context !== undefined) {
      const context = packet.query.context;
      requireValue(typeof context === 'string' || Array.isArray(context) || context !== null && typeof context === 'object', 'package_context_invalid');
      requireValue(canonical(context).length <= 512000, 'package_context_limit');
    }
    object(packet.answer, ['text', 'status']);
    requireValue(typeof packet.answer.text === 'string' && packet.answer.text.length <= 100000, 'package_answer_invalid');
    id(packet.answer.status);
    object(packet.knowledge, ['snapshot_id', 'used_mode', 'manifest_sha256']);
    id(packet.knowledge.snapshot_id);
    id(packet.knowledge.used_mode);
    requireValue(digestPattern.test(packet.knowledge.manifest_sha256), 'package_snapshot_digest_invalid');
    requireValue(Array.isArray(packet.sources) && packet.sources.length <= 128, 'package_sources_invalid');
    for (const source of packet.sources) {
      object(source, ['ref', 'version', 'ranges']);
      text(source.ref, 2048);
      requireValue(digestPattern.test(source.version), 'package_source_version_invalid');
      requireValue(Array.isArray(source.ranges) && source.ranges.length <= 64, 'package_ranges_invalid');
      for (const range of source.ranges) {
        object(range, ['mode', 'heading', 'start_line', 'end_line', 'complete_unit', 'complete_source', 'scope_reason', 'role', 'principle_id', 'chars']);
        id(range.mode);
        for (const field of ['heading', 'scope_reason', 'role', 'principle_id']) if (range[field] !== undefined) text(range[field], 2048);
        for (const field of ['start_line', 'end_line', 'chars']) if (range[field] !== undefined) requireValue(Number.isSafeInteger(range[field]) && range[field] >= 0, 'package_range_invalid');
        for (const field of ['complete_unit', 'complete_source']) if (range[field] !== undefined) requireValue(typeof range[field] === 'boolean', 'package_range_invalid');
        if (range.start_line !== undefined && range.end_line !== undefined) requireValue(range.end_line >= range.start_line, 'package_range_invalid');
      }
    }
    object(packet.feedback, ['revision', 'rating', 'comment']);
    requireValue(Number.isSafeInteger(packet.feedback.revision) && packet.feedback.revision >= 0, 'package_feedback_invalid');
    requireValue(['helpful', 'unhelpful', 'unspecified'].includes(packet.feedback.rating), 'package_feedback_invalid');
    if (packet.feedback.comment !== undefined) text(packet.feedback.comment, 4000);
    object(packet.diagnostics, ['warning_codes', 'review_status', 'usage']);
    requireValue(Array.isArray(packet.diagnostics.warning_codes) && packet.diagnostics.warning_codes.length <= 32, 'package_diagnostics_invalid');
    packet.diagnostics.warning_codes.forEach(id);
    id(packet.diagnostics.review_status);
    object(packet.diagnostics.usage, ['input_tokens', 'cached_input_tokens', 'output_tokens', 'cost', 'currency', 'active_ms']);
    for (const [key, value] of Object.entries(packet.diagnostics.usage)) {
      if (key === 'currency') requireValue(value === null || typeof value === 'string' && /^[A-Z]{3}$/.test(value), 'package_usage_invalid');
      else requireValue(value === null || Number.isFinite(value) && value >= 0, 'package_usage_invalid');
    }
  }
  const {manifest_sha256, ...body} = packet;
  requireValue(digestPattern.test(manifest_sha256) && queryPackageDigest(body) === manifest_sha256, 'package_checksum_mismatch');
  requireValue(Buffer.byteLength(canonical(packet)) <= QUERY_PACKAGE_MAX_BYTES, 'package_size_limit');
  return JSON.parse(canonical(packet));
}

/** Host supplies the allowed snapshot identities. Contents never grant their own permission. */
export function queryPackageEligibility(packet, {now, namespace, snapshots} = {}) {
  validateQueryPackage(packet);
  requireValue(Number.isFinite(now), 'package_host_time_required');
  if (canonical(packet.namespace) !== canonical(namespace)) return {status: 'excluded', reason: 'package_namespace_mismatch'};
  if (Date.parse(packet.created_at) > now + 300000) return {status: 'excluded', reason: 'package_future_timestamp'};
  // A withdrawal must still remove old input even if its transfer was delayed.
  if (packet.kind === 'withdrawal') return {status: 'eligible'};
  const policy = packet.policy;
  if (policy.analysis_allowed !== true || policy.temporary !== false || policy.retention_confirmed !== true || policy.improvement_use_on_local_confirmed !== true) return {status: 'excluded', reason: 'package_not_authorized'};
  if (Date.parse(packet.expires_at) <= now) return {status: 'excluded', reason: 'package_expired'};
  const snapshot = snapshots?.find(item => item.snapshot_id === packet.knowledge.snapshot_id && item.manifest_sha256 === packet.knowledge.manifest_sha256);
  if (!snapshot) return {status: 'excluded', reason: 'package_snapshot_mismatch'};
  if (!packet.sources.every(source => snapshot.sources?.[source.ref] === source.version)) return {status: 'excluded', reason: 'package_source_version_mismatch'};
  return {status: 'eligible'};
}

/** Call only with server-owned, minimized fields after the request's permission check. */
export function createQueryPackage(input) {
  const body = {schema_version: 1, contract: QUERY_PACKAGE_VERSION, ...input};
  requireValue(!('manifest_sha256' in input), 'package_digest_is_generated');
  return validateQueryPackage({...body, manifest_sha256: queryPackageDigest(body)});
}

export function validateQueryPackageResults(packet) {
  object(packet, ['schema_version','contract','namespace','results','controls','manifest_sha256']);
  requireValue(packet.schema_version === 1 && packet.contract === QUERY_PACKAGE_RESULTS_VERSION, 'package_result_version_invalid');
  object(packet.namespace, ['host','library_id','view']);
  for (const field of ['host','library_id','view']) id(packet.namespace[field]);
  requireValue(Array.isArray(packet.results) && packet.results.length <= 1000 && Array.isArray(packet.controls) && packet.controls.length <= 1000, 'package_result_limit');
  for (const result of packet.results) {
    object(result, ['package_id','request_id','revision','source_revision','source_manifest_sha256','disposition','summary','snapshot_id','snapshot_manifest_sha256','refs','reviewer','expires_at','core_records']);
    for (const field of ['package_id','request_id','snapshot_id']) id(result[field]);
    text(result.reviewer, 256);
    text(result.summary, 4000);
    date(result.expires_at);
    requireValue(Number.isSafeInteger(result.revision) && result.revision > 0 && ['increment','bug_fixed','no_increment','duplicate'].includes(result.disposition), 'package_result_disposition_invalid');
    requireValue(Number.isSafeInteger(result.source_revision) && result.source_revision > 0 && digestPattern.test(result.source_manifest_sha256), 'package_result_source_identity_invalid');
    requireValue(digestPattern.test(result.snapshot_manifest_sha256) && Array.isArray(result.refs) && result.refs.length <= 128, 'package_result_sources_invalid');
    result.refs.forEach(ref => text(ref, 2048));
    if (result.core_records !== undefined) {
      requireValue(Array.isArray(result.core_records) && result.core_records.length <= 32 && Buffer.byteLength(canonical(result.core_records)) <= 131072, 'package_public_core_limit');
      for (const record of result.core_records) {
        requireValue(record.schema_version === 1 && ['signal','issue','outcome_link','control'].includes(record.type), 'package_public_core_type');
        requireValue(['host','library_id','view'].every(key => record[key] === packet.namespace[key]), 'package_public_core_namespace');
      }
    }
  }
  for (const control of packet.controls) {
    object(control, ['package_id','request_id','revision','source_revision','operation','expires_at']);
    id(control.package_id);
    id(control.request_id);
    date(control.expires_at);
    requireValue(Number.isSafeInteger(control.revision) && control.revision > 0 && control.operation === 'withdraw', 'package_result_control_invalid');
    requireValue(Number.isSafeInteger(control.source_revision) && control.source_revision > 0, 'package_result_source_identity_invalid');
  }
  const {manifest_sha256, ...body} = packet;
  requireValue(queryPackageDigest(body) === manifest_sha256, 'package_checksum_mismatch');
  return JSON.parse(canonical(packet));
}

export function createQueryPackageResults({namespace, results, controls}) {
  const body = {schema_version: 1, contract: QUERY_PACKAGE_RESULTS_VERSION, namespace, results, controls};
  return validateQueryPackageResults({...body, manifest_sha256: queryPackageDigest(body)});
}
