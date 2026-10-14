import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { adapterStatus, prepareAdapterIntake, prepareHostDecisionReceipt, prepareUnavailableFallback, validateFromDemoToSpecRequest, validateProducerDecision } from '../scripts/fromdemotospec-analysis-adapter.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adapterRoot = path.join(root, 'adapters', 'game-analysis-decision');
const examples = path.join(root, 'examples', 'game-analysis-decision');

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function assert(condition, message) { if (!condition) throw new Error(message); }

for (const schemaName of ['fromdemotospec-analysis-request.schema.json', 'fromdemotospec-producer-decision.schema.json']) {
  const schema = readJson(path.join(adapterRoot, schemaName));
  assert(schema.type === 'object' && schema.additionalProperties === false, `${schemaName}: root contract must be closed`);
}

const contract = readJson(path.join(adapterRoot, 'contract.json'));
const currentStatus = adapterStatus();
assert(currentStatus.schema_version === 2 && currentStatus.request_contract === 'GameAnalysisDecision v2', 'Status must advertise the current v2 request route.');
assert(currentStatus.commands.includes('consume-delivery') && currentStatus.receipt_contract === 'HostDecisionReceipt v1', 'Status must distinguish v2 consumption from v1 decision receipts.');
assert(currentStatus.analysis_executed === false && currentStatus.ownership.host_write === false, 'Status is not analysis execution or permission.');
assert(currentStatus.legacy.selection === 'explicit_schema_version_1_only' && currentStatus.legacy.external_contract.revision === contract.external_contract.revision, 'Legacy status must remain separately identifiable without rewriting historical contracts.');
for (const [args, check] of [
  [['status'], value => value.schema_version === 2 && value.commands.includes('consume-delivery')],
  [['prepare-request', '--input', path.join(examples, 'request-v2.json')], value => value.schema_version === 2],
  [['prepare-request', '--input', path.join(examples, 'fromdemotospec-request.json')], value => value.schema_version === 1]
]) {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/fromdemotospec-analysis-adapter.mjs'), ...args], {encoding: 'utf8'});
  assert(result.status === 0, `Actual CLI failed: ${args[0]}: ${result.stderr || result.error}`);
  assert(check(JSON.parse(result.stdout)), `CLI route/status mismatch: ${args.join(' ')}`);
}
assert(contract.adapter_id === 'fromdemotospec-adapter' && contract.status === 'ready', 'FromDemoToSpec adapter identity drifted.');
assert(contract.external_contract.revision === 'ff66c413f3b623379f81ffbb50bf701876eec34f', 'External adapter revision must be explicitly pinned to the decision-rationale-review revision.');
assert(contract.ownership.formal_decision_owner === 'fromdemotospec_host' && contract.ownership.accept_decision === false, 'FromDemoToSpec fact ownership or producer gate drifted.');
assert(contract.commands.legacy_role === 'lead_designer_agent', 'Legacy command must name the Agent role, not the producer.');
assert(contract.compatibility.legacy_sunset === '2026-09-30' && contract.compatibility.legacy_warning_code === 'AD008_LEGACY_COMMAND', 'AD-008 legacy retirement policy drifted.');
assert(contract.compatibility.game_analysis_decision_unavailable === 'continue_fromdemotospec_normal_flow' && contract.compatibility.automatic_knowledge_expert_fallback === false, 'GameAnalysisDecision-unavailable fallback must remain host-owned and expert-free.');

const request = readJson(path.join(examples, 'fromdemotospec-request.json'));
const intake = prepareAdapterIntake(request);
assert(intake.adapter_id === 'fromdemotospec-adapter' && intake.intent === 'decide', 'New request command mapping drifted.');
assert(intake.host_ref.startsWith('fromdemotospec:') && intake.host_write_target_ref.startsWith('fromdemotospec:'), 'FromDemoToSpec namespace was lost.');
assert(!Object.hasOwn(intake, 'legacy_command'), 'New command must not be marked as legacy.');

const legacy = readJson(path.join(examples, 'legacy-request.json'));
const legacyIntake = prepareAdapterIntake(legacy);
assert(legacyIntake.legacy_command === 'lead_designer_takeover' && legacyIntake.requester_role === 'agent', 'Legacy command must remain an Agent request-only compatibility path.');

const unavailable = prepareUnavailableFallback(request);
assert(unavailable.game_analysis_decision_status === 'unavailable' && unavailable.host_action === 'continue_fromdemotospec_normal_flow', 'GameAnalysisDecision unavailability must return to the FromDemoToSpec normal flow.');
assert(unavailable.automatic_expert_fallback === false && unavailable.permissions.host_write === false, 'Fallback must not invoke Knowledge experts or write FromDemoToSpec state.');

const missingQuestion = structuredClone(request);
delete missingQuestion.decision_question;
assert(validateFromDemoToSpecRequest(missingQuestion).some((error) => error.includes('decision_question')), 'Decide intent without a real question must fail.');

const foreignTarget = structuredClone(request);
foreignTarget.host_write_target_ref = 'brainstorm:DEC-001';
assert(validateFromDemoToSpecRequest(foreignTarget).some((error) => error.includes('host_write_target_ref')), 'Foreign host target must fail.');

const unknownField = structuredClone(request);
unknownField.auto_write_demo = true;
assert(validateFromDemoToSpecRequest(unknownField).some((error) => error.includes('unknown field')), 'Unknown auto-write field must fail closed.');

const producerDecision = readJson(path.join(examples, 'producer-decision.json'));
const receipt = prepareHostDecisionReceipt(producerDecision);
assert(receipt.recorded_by === 'host' && receipt.game_analysis_decision_consumption === 'read_only_reference', 'Decision receipt must remain a read-only host fact.');

const unconfirmed = structuredClone(producerDecision);
unconfirmed.producer_confirmed = false;
assert(validateProducerDecision(unconfirmed).some((error) => error.includes('explicit producer confirmation')), 'Unconfirmed Agent action must not become a producer decision.');

const missingHostRecord = structuredClone(producerDecision);
missingHostRecord.host_record_ref = 'decision:DCP-fromdemotospec-adapter-demo';
assert(validateProducerDecision(missingHostRecord).some((error) => error.includes('already exist in FromDemoToSpec')), 'Receipt requires a prior FromDemoToSpec formal record.');

const unconfirmedHostRecord = structuredClone(producerDecision);
unconfirmedHostRecord.host_record_confirmed = false;
assert(validateProducerDecision(unconfirmedHostRecord).some((error) => error.includes('caller must confirm')), 'Receipt requires explicit confirmation that the FromDemoToSpec record exists.');

assert(validateFromDemoToSpecRequest(null).length > 0 && validateProducerDecision([]).length > 0, 'Non-object inputs must fail closed without crashing.');

process.stdout.write('FromDemoToSpec AD-005/008 game-analysis adapter contract: PASS (2 request paths, 1 fallback, 1 producer receipt, 7 negative gates)\n');

assert(contract.request_policy.per_request_confirmation === false && contract.request_policy.formal_product_decision === 'user' && contract.request_policy.automatic_knowledge_ingest === false, 'Autonomous analysis must preserve user adoption and no-ingest boundaries');
const autonomousRequest = structuredClone(request);
autonomousRequest.requester_role = 'agent';
autonomousRequest.source_policy = 'project_and_knowledge';
const autonomousIntake = prepareAdapterIntake(autonomousRequest);
assert(autonomousIntake.requester_role === 'agent' && autonomousIntake.source_policy === 'project_and_knowledge', 'Agent requests must work without per-request producer approval');
assert(!Object.hasOwn(autonomousIntake, 'producer_confirmed'), 'Request must not pretend producer adoption');
process.stdout.write('FromDemoToSpec v2 autonomous request boundary: PASS\n');
