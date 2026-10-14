import {prepareRequestV2,consumeDeliveryV2,unavailableV2} from './game-analysis-decision-v2-binding.mjs';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const repositoryRoot = path.resolve(path.dirname(scriptPath), '..');
const contractPath = path.join(repositoryRoot, 'adapters', 'game-analysis-decision', 'contract.json');
const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exactKeys(value, required, optional = []) {
  const actual = Object.keys(value ?? {}).sort();
  const allowed = [...required, ...optional].sort();
  return {
    missing: required.filter((key) => !actual.includes(key)),
    unknown: actual.filter((key) => !allowed.includes(key))
  };
}

function commonErrors(value, required, optional) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['$: object is required'];
  const keys = exactKeys(value, required, optional);
  for (const key of keys.missing) errors.push(`$.${key}: is required`);
  for (const key of keys.unknown) errors.push(`$.${key}: unknown field`);
  if (value.schema_version !== 1) errors.push('$.schema_version: must equal 1');
  if (!/^ARQ-[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value.request_id ?? '')) errors.push('$.request_id: invalid ARQ id');
  return errors;
}

function validDateTime(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

function validateFromDemoToSpecRequest(value) {
  const required = [
    'schema_version', 'request_id', 'created_at', 'command', 'project_ref', 'host_write_target_ref',
    'intent', 'goal', 'requester_role', 'time_budget_minutes', 'source_policy', 'evidence_refs'
  ];
  const errors = commonErrors(value, required, ['decision_question']);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return errors;
  if (!validDateTime(value.created_at)) errors.push('$.created_at: valid date-time is required');
  if (!['request_analysis_decision', 'lead_designer_takeover'].includes(value.command)) errors.push('$.command: unsupported command');
  if (!value.project_ref?.startsWith('fromdemotospec:')) errors.push('$.project_ref: must use fromdemotospec: namespace');
  if (!value.host_write_target_ref?.startsWith('fromdemotospec:')) errors.push('$.host_write_target_ref: must use fromdemotospec: namespace');
  if (!['analyze', 'decide'].includes(value.intent)) errors.push('$.intent: must be analyze or decide');
  if (typeof value.goal !== 'string' || value.goal.trim().length < 8) errors.push('$.goal: must contain at least 8 characters');
  if (value.intent === 'decide' && (typeof value.decision_question !== 'string' || value.decision_question.trim().length < 8)) errors.push('$.decision_question: decide requires a real question');
  if (value.intent === 'analyze' && value.decision_question && value.command !== 'lead_designer_takeover') errors.push('$.decision_question: analyze cannot hide a decision question');
  if (!['producer', 'human', 'agent', 'system'].includes(value.requester_role)) errors.push('$.requester_role: unsupported role');
  if (!Number.isInteger(value.time_budget_minutes) || value.time_budget_minutes < 1 || value.time_budget_minutes > 1440) errors.push('$.time_budget_minutes: invalid budget');
  if (!['project_only', 'project_and_knowledge', 'project_knowledge_and_web'].includes(value.source_policy)) errors.push('$.source_policy: unsupported source policy');
  if (!Array.isArray(value.evidence_refs) || new Set(value.evidence_refs).size !== value.evidence_refs.length || value.evidence_refs.some((ref) => !/^[a-z][a-z0-9_-]*:[^\s]+$/.test(ref))) errors.push('$.evidence_refs: stable unique references are required');
  return errors;
}

function prepareAdapterIntake(value) {
  const errors = validateFromDemoToSpecRequest(value);
  if (errors.length > 0) throw new Error(`FromDemoToSpec analysis request rejected:\n${errors.join('\n')}`);
  return {
    schema_version: 1,
    request_id: value.request_id,
    created_at: value.created_at,
    adapter_id: 'fromdemotospec-adapter',
    host_ref: value.project_ref,
    host_write_target_ref: value.host_write_target_ref,
    intent: value.intent,
    goal: value.goal,
    ...(value.decision_question ? { decision_question: value.decision_question } : {}),
    requester_role: value.requester_role,
    time_budget_minutes: value.time_budget_minutes,
    source_policy: value.source_policy,
    input_refs: value.evidence_refs,
    ...(value.command === 'lead_designer_takeover' ? { legacy_command: 'lead_designer_takeover' } : {})
  };
}

function prepareUnavailableFallback(value) {
  const errors = validateFromDemoToSpecRequest(value);
  if (errors.length > 0) throw new Error(`FromDemoToSpec unavailable fallback rejected:\n${errors.join('\n')}`);
  return {
    schema_version: 1,
    request_id: value.request_id,
    adapter_id: 'fromdemotospec-adapter',
    host_ref: value.project_ref,
    game_analysis_decision_status: 'unavailable',
    host_action: contract.compatibility.game_analysis_decision_unavailable,
    automatic_expert_fallback: contract.compatibility.automatic_knowledge_expert_fallback,
    permissions: { host_write: false, accept_decision: false, run_experiment: false }
  };
}

function validateProducerDecision(value) {
  const required = [
    'schema_version', 'receipt_id', 'request_id', 'project_ref', 'decision_packet_ref', 'action',
    'producer_ref', 'producer_confirmed', 'host_record_ref', 'host_record_confirmed', 'recorded_at'
  ];
  const errors = commonErrors(value, required);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return errors;
  if (!/^HDR-[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(value.receipt_id ?? '')) errors.push('$.receipt_id: invalid HDR id');
  if (!value.project_ref?.startsWith('fromdemotospec:')) errors.push('$.project_ref: must use fromdemotospec: namespace');
  if (!value.decision_packet_ref?.startsWith('decision:')) errors.push('$.decision_packet_ref: must use decision: namespace');
  if (!['accepted', 'rejected', 'needs_evidence'].includes(value.action)) errors.push('$.action: unsupported producer action');
  if (!value.producer_ref?.startsWith('producer:')) errors.push('$.producer_ref: must use producer: namespace');
  if (value.producer_confirmed !== true) errors.push('$.producer_confirmed: explicit producer confirmation is required');
  if (!value.host_record_ref?.startsWith('fromdemotospec:')) errors.push('$.host_record_ref: formal decision must already exist in FromDemoToSpec');
  if (value.host_record_confirmed !== true) errors.push('$.host_record_confirmed: caller must confirm the formal FromDemoToSpec record exists');
  if (!validDateTime(value.recorded_at)) errors.push('$.recorded_at: valid date-time is required');
  return errors;
}

function prepareHostDecisionReceipt(value) {
  const errors = validateProducerDecision(value);
  if (errors.length > 0) throw new Error(`FromDemoToSpec producer decision rejected:\n${errors.join('\n')}`);
  return {
    schema_version: 1,
    receipt_id: value.receipt_id,
    request_id: value.request_id,
    adapter_id: 'fromdemotospec-adapter',
    host_ref: value.project_ref,
    decision_packet_ref: value.decision_packet_ref,
    observed_action: value.action,
    producer_ref: value.producer_ref,
    host_record_ref: value.host_record_ref,
    recorded_at: value.recorded_at,
    recorded_by: 'host',
    game_analysis_decision_consumption: 'read_only_reference'
  };
}

function argumentValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) throw new Error(`Missing ${name}`);
  return args[index + 1];
}

function adapterStatus() {
  return {
    schema_version: 2,
    adapter_id: contract.adapter_id,
    status: 'binding_ready',
    request_contract: 'GameAnalysisDecision v2',
    receipt_contract: 'HostDecisionReceipt v1',
    commands: ['prepare-request', 'consume-delivery', 'prepare-unavailable', 'prepare-host-decision'],
    analysis_executed: false,
    request_policy: contract.request_policy,
    ownership: contract.ownership,
    legacy: {
      request_schema_version: 1,
      selection: 'explicit_schema_version_1_only',
      external_contract: contract.external_contract,
      commands: contract.commands,
      compatibility: contract.compatibility
    }
  };
}

async function runCli() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'status') {
    process.stdout.write(`${JSON.stringify(adapterStatus(), null, 2)}\n`);
    return;
  }
  const input = readJson(path.resolve(argumentValue(args, '--input')));
  if (input.schema_version === 2) {
    let result;
    if (command === 'prepare-request') result = await prepareRequestV2(input);
    else if (command === 'prepare-unavailable') result = unavailableV2(input);
    else if (command === 'consume-delivery') result = await consumeDeliveryV2(input,readJson(path.resolve(argumentValue(args,'--consumer'))));
    else throw new Error('Unsupported v2 command; formal host decision receipts retain v1');
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
    return;
  }

  if (command === 'prepare-request') {
    if (input.command === 'lead_designer_takeover') {
      process.stderr.write(`${contract.compatibility.legacy_warning_code}: lead_designer_takeover is deprecated; use request_analysis_decision before ${contract.compatibility.legacy_sunset}.\n`);
    }
    process.stdout.write(`${JSON.stringify(prepareAdapterIntake(input), null, 2)}\n`);
    return;
  }
  if (command === 'prepare-unavailable') {
    process.stdout.write(`${JSON.stringify(prepareUnavailableFallback(input), null, 2)}\n`);
    return;
  }
  if (command === 'prepare-host-decision') {
    process.stdout.write(`${JSON.stringify(prepareHostDecisionReceipt(input), null, 2)}\n`);
    return;
  }
  throw new Error('Usage: fromdemotospec-analysis-adapter.mjs status | prepare-request --input <json> | consume-delivery --input <json> --consumer <json> | prepare-unavailable --input <json> | prepare-host-decision --input <json>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) await runCli();

export { runCli, adapterStatus, prepareAdapterIntake, prepareHostDecisionReceipt, prepareUnavailableFallback, validateFromDemoToSpecRequest, validateProducerDecision };
