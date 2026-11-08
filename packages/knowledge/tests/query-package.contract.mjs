const recipientTools = process.env.FEEDBACK_TOOLS_ROOT;
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createQueryPackage, validateQueryPackage, validateQueryPackageResults} from '../system/integrations/query-package.mjs';
import {createQueryPackageInbox} from '../system/integrations/query-package-local.mjs';
import {runQueryPackageLocal} from '../system/integrations/query-package-cli.mjs';

const stamp = Date.parse('2026-11-07T04:00:00Z');
const namespace = {host: 'online-knowledge', library_id: 'knowledge', view: 'public'};
const source = {ref: 'knowledge:wiki:fixture', version: 'a'.repeat(64), ranges: [{mode: 'full_source', complete_source: true}]};
const snapshots = [{snapshot_id: 'public-fixture-v1', manifest_sha256: 'b'.repeat(64), sources: {[source.ref]: source.version}}];
function packet(extra = {}) {
  return createQueryPackage({kind: 'query', package_id: 'package-1', namespace, request_id: 'request-1', revision: 1, created_at: new Date(stamp - 1000).toISOString(), expires_at: new Date(stamp + 86400000).toISOString(), policy: {version: 'test-policy', analysis_allowed: true, temporary: false, retention_confirmed: true, improvement_use_on_local_confirmed: true, public_return_allowed: true}, query: {question: 'Fixture question about source conditions'}, answer: {text: 'Fixture answer', status: 'completed'}, knowledge: {snapshot_id: snapshots[0].snapshot_id, manifest_sha256: snapshots[0].manifest_sha256, used_mode: 'bm25'}, sources: [source], feedback: {revision: 0, rating: 'unspecified'}, diagnostics: {warning_codes: [], review_status: 'not_verified', usage: {input_tokens: null, cached_input_tokens: null, output_tokens: null, cost: null, currency: null, active_ms: null}}, ...extra});
}
function withdrawal(extra = {}) {
  return createQueryPackage({kind: 'withdrawal', package_id: 'package-1', namespace, request_id: 'request-1', revision: 2, created_at: new Date(stamp).toISOString(), expires_at: new Date(stamp + 86400000).toISOString(), reason_code: 'user_withdrawal', ...extra});
}
async function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-package-test-'));
  const home = path.join(parent, 'private');
  let time = stamp;
  const config = {home, namespace, snapshots, toolsRoot: recipientTools, now: () => time, tombstoneRetentionMs: 86400000};
  const inbox = await createQueryPackageInbox(config);
  t.after(() => {
    assert.equal(path.dirname(parent), path.resolve(os.tmpdir()));
    assert(path.basename(parent).startsWith('knowledge-package-test-'));
    fs.rmSync(parent, {recursive: true, force: true});
  });
  return {home, config, inbox, time: value => {time = value;}};
}
function assessment(p = packet(), extra = {}) {
  return {package_id: p.package_id, revision: p.revision, manifest_sha256: p.manifest_sha256, agent: 'local-owner', disposition: 'no_increment', reason: 'Fixture checked against existing coverage', decision_ref: 'fixture:assessment-1', ...extra};
}
function finding(extra = {}) {
  return {id: 'fixture-condition', kind: 'retrieval_gap', summary: 'Fixture source version mismatch', issue: {subject: 'Fixture source version', condition_key: 'fixed-fixture-snapshot', owner: 'query-owner', next_action: 'Fix and validate the source mapping', review_when: 'after owner fix', evidence: ['fixture:source'], counterevidence: []}, ...extra};
}
const fixedOutcome = {evidence: {adopted: {refs: ['fixture:fix'], scope: 'Fixture mapping correction'}}, validation_ref: 'fixture:validation', result_ref: 'fixture:owner-result', versions: {before: 'fixture-v1', after: 'fixture-v2'}};

const resolutionSupported = typeof (await import(pathToFileURL(path.join(recipientTools,'integrations/knowledge-feedback/store.mjs')))).FileStore.prototype.resolveIssue === 'function';
test('shared packet is deterministic and rejects hidden fields and checksum tampering', () => {
  assert.deepEqual(packet(), packet());
  assert.deepEqual(validateQueryPackage(JSON.parse(JSON.stringify(packet()))), packet());
  assert.throws(() => validateQueryPackage({...packet(), answer: {text: 'changed', status: 'completed'}}), /package_checksum_mismatch/);
  assert.throws(() => createQueryPackage({...packet(), private_thoughts: 'secret'}));
  const {manifest_sha256, ...body} = packet();
  assert.throws(() => createQueryPackage({...body, diagnostics: {...body.diagnostics, api_key: 'secret'}}), /package_unknown_field/);
  assert.throws(() => createQueryPackage({...body, package_id: 'constructor'}), /package_id_invalid/);
  assert.throws(() => createQueryPackage({...body, contract: 'future-version'}), /package_version_unsupported/);
});

test('bounded complete JSON history survives six turns without truncation', () => {
  const context = {history: Array.from({length: 12}, (_, index) => ({role: index % 2 ? 'assistant' : 'user', content: '中'.repeat(10000)}))};
  const full = packet({query: {question: 'Fixture follow-up', context}});
  assert.deepEqual(validateQueryPackage(full).query.context, context);
  assert.throws(() => packet({query: {question: 'too large', context: {history: '中'.repeat(512001)}}}), /package_context_limit/);
});

test('receiver refuses untrusted, unauthorized, expired and uninstalled source versions without saving payload', async t => {
  const f = await fixture(t);
  assert.throws(() => f.inbox.receive(packet()), /package_authenticated_transport_required/);
  for (const p of [packet({policy: {...packet().policy, temporary: true}}), packet({policy: {...packet().policy, improvement_use_on_local_confirmed: false}}), packet({expires_at: new Date(stamp - 100).toISOString()}), packet({knowledge: {...packet().knowledge, snapshot_id: 'uninstalled'}}), packet({sources: [{...source, version: 'c'.repeat(64)}]})]) {
    assert.equal(f.inbox.receive(p, {trustedTransport: true}).status, 'excluded');
  }
  assert.equal(fs.existsSync(f.home), false);
});

test('durable receipt deduplicates retry and rejects conflicting revision and changed request identity', async t => {
  const {inbox} = await fixture(t);
  assert.equal(inbox.receive(packet(), {trustedTransport: true}).status, 'received');
  assert.equal(inbox.receive(packet(), {trustedTransport: true}).status, 'duplicate_delivery');
  assert.equal(inbox.pending().length, 1);
  assert.equal(inbox.read('package-1').sources[0].version, source.version);
  assert.throws(() => inbox.receive(packet({answer: {text: 'different', status: 'completed'}}), {trustedTransport: true}), /package_revision_conflict/);
  assert.throws(() => inbox.receive(packet({package_id: 'second-id'}), {trustedTransport: true}), /package_request_identity_conflict/);
  assert.equal(inbox.read('package-1').answer.text, 'Fixture answer');
});

test('no increment and duplicate are explicit dispositions and remove question and answer from live storage', async t => {
  const {inbox, home} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  const decision = assessment();
  assert.equal(inbox.assess(decision).status, 'assessed');
  assert.equal(inbox.assess(decision).status, 'duplicate_assessment');
  assert.equal(inbox.pending().length, 0);
  assert.throws(() => inbox.read('package-1'), /package_not_active/);
  const text = fs.readFileSync(path.join(home, fs.readdirSync(home).find(name => name.endsWith('.json'))), 'utf8');
  assert(!text.includes('Fixture question') && !text.includes('Fixture answer'));
  assert.equal(Object.keys(inbox.feedback.read().records.signal).length, 0);
  const second = packet({package_id: 'package-2', request_id: 'request-2'});
  inbox.receive(second, {trustedTransport: true});
  assert.throws(() => inbox.assess(assessment(second, {disposition: 'duplicate', duplicate_of: 'missing'})), /package_duplicate_target_required/);
  inbox.assess(assessment(second, {disposition: 'duplicate', duplicate_of: 'package-1'}));
  assert.equal(inbox.pending().length, 0);
});

test('new feedback revision reopens assessment and stale assessment cannot settle the new revision', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  inbox.assess(assessment());
  const revised = packet({revision: 2, feedback: {revision: 1, rating: 'unhelpful', comment: 'Fixture missing condition'}});
  inbox.receive(revised, {trustedTransport: true});
  assert.equal(inbox.pending()[0].feedback, 'unhelpful');
  assert.throws(() => inbox.assess(assessment()), /package_assessment_version_mismatch/);
});

test('needs evidence records a real handoff and remains actionable, without counting returned sources as read', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  inbox.assess(assessment(packet(), {disposition: 'needs_evidence', next_action: 'Obtain the exact old source', review_when: 'source supplied by owner', finding: finding()}));
  assert.equal(inbox.pending()[0].status, 'needs_evidence');
  const state = inbox.feedback.read();
  assert.equal(Object.values(state.records.signal)[0].sources[0].stage, 'returned');
  assert.equal(Object.values(state.records.issue)[0].status, 'needs_evidence');
});

resolutionTest('verified bug fix closes active issue, preserves evidence, and handles replay after core commit', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  const decision = assessment(packet(), {disposition: 'bug_fixed', finding: finding({outcome: fixedOutcome})});
  // Simulate a crash after feedback commit but before the inbox disposition commits.
  const resolve = inbox.feedback.resolveIssue.bind(inbox.feedback);
  let injected = true;
  inbox.feedback.resolveIssue = options => {
    const result = resolve(options);
    if (injected) {injected = false; throw Error('fixture crash after commit');}
    return result;
  };
  assert.throws(() => inbox.assess(decision), /fixture crash/);
  assert.equal(inbox.pending().length, 1);
  assert.equal(inbox.assess(decision).status, 'assessed');
  assert.equal(inbox.pending().length, 0);
  assert.equal(inbox.feedback.select({now: stamp, terms: ['Fixture'], limit: 5}).length, 0);
  const state = inbox.feedback.read();
  assert.equal(Object.values(state.records.issue)[0].status, 'resolved');
  const outcome = Object.values(state.records.outcome_link)[0];
  assert.equal(outcome.validation_ref, 'fixture:validation');
  assert.equal(outcome.evidence.effect_observed, null);
});

test('a claimed fix without validation leaves both queue and feedback state unchanged', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  assert.throws(() => inbox.assess(assessment(packet(), {disposition: 'bug_fixed', finding: finding()})), /package_fix_outcome_required/);
  assert.equal(Object.keys(inbox.feedback.read().records.signal).length, 0);
  assert.equal(inbox.pending().length, 1);
});

resolutionTest('evidence follow-up uses the original issue and closes it when fixed or dismissed', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  inbox.assess(assessment(packet(), {disposition: 'needs_evidence', next_action: 'inspect source', review_when: 'source available', finding: finding()}));
  const issueId = Object.values(inbox.feedback.read().records.issue)[0].id;
  inbox.assess(assessment(packet(), {disposition: 'bug_fixed', finding: finding({outcome: fixedOutcome})}));
  assert.equal(inbox.feedback.read().records.issue[issueId].status, 'resolved');
  assert.equal(Object.keys(inbox.feedback.read().records.issue).length, 1);
  const second = packet({package_id: 'package-2', request_id: 'request-2'});
  inbox.receive(second, {trustedTransport: true});
  inbox.assess(assessment(second, {disposition: 'needs_evidence', next_action: 'check scope', review_when: 'scope available', finding: finding()}));
  inbox.assess(assessment(second));
  assert.equal(inbox.feedback.select({now: stamp, terms: ['Fixture']}).length, 0);
  assert.equal(inbox.pending().length, 0);
});

test('valuable increment requires grounded fields and owner handoff, then retains four-type evidence', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  const increment = {kind: 'retrieval', evidence_level: 'observed_in_scope', destination: 'query', trigger: 'Fixture missing condition', mechanism: 'Fixture source range mapping', basis: 'fixture:read', conditions: 'fixed fixture snapshot', counterexamples: [], novelty: 'new condition in this fixture', consumer: 'query-owner'};
  const value = finding({increment, issue: {...finding().issue, status: 'linked', handoff_ref: 'fixture:owner-handoff'}});
  inbox.assess(assessment(packet(), {disposition: 'increment', finding: value}));
  assert.equal(inbox.pending().length, 0);
  assert.equal(inbox.feedback.select({now: stamp, terms: ['Fixture']})[0].status, 'linked');
  assert.deepEqual(Object.keys(inbox.feedback.read().records).sort(), ['control','issue','outcome_link','signal']);
});

test('withdrawal before or after payload delivery blocks resurrection and removes dependent summaries', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  inbox.assess(assessment(packet(), {disposition: 'needs_evidence', next_action: 'get source', review_when: 'new source', finding: finding()}));
  inbox.receive(withdrawal(), {trustedTransport: true});
  assert.equal(inbox.pending().length, 0);
  assert.equal(Object.keys(inbox.feedback.read().records.signal).length, 0);
  assert.equal(Object.keys(inbox.feedback.read().records.issue).length, 0);
  assert.equal(Object.keys(inbox.feedback.read().records.control).length, 1);
  assert.equal(inbox.receive(packet({revision: 9}), {trustedTransport: true}).status, 'withdrawn');
  const other = withdrawal({package_id: 'package-2', request_id: 'request-2'});
  inbox.receive(other, {trustedTransport: true});
  assert.equal(inbox.receive(packet({package_id: 'package-2', request_id: 'request-2'}), {trustedTransport: true}).status, 'withdrawn');
});

test('retention maintenance removes payload and prevents old inputs after tombstones are compacted', async t => {
  const f = await fixture(t);
  f.inbox.receive(packet(), {trustedTransport: true});
  f.time(stamp + 86400001);
  assert.equal(f.inbox.pending().length, 0);
  assert.throws(() => f.inbox.read('package-1'), /package_expired/);
  assert.equal(f.inbox.maintain().removed_count, 1);
  const old = packet({expires_at: new Date(stamp + 4 * 86400000).toISOString()});
  assert.equal(f.inbox.receive(old, {trustedTransport: true}).reason, 'package_retention_watermark');
});

test('public return requires consent, local review and snapshot refs and contains only explicit reviewed fields', async t => {
  const {inbox} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  const decision = assessment(packet(), {public_result: {summary: 'Fixture public finding', snapshot_id: snapshots[0].snapshot_id, refs: [source.ref]}});
  assert.throws(() => inbox.assess(decision), /package_public_review_required/);
  assert.equal(inbox.pending().length, 1);
  inbox.assess({...decision, public_review: {approved: true, reviewer: 'knowledge-owner'}});
  assert.throws(() => inbox.exportResults(), /package_public_transfer_required/);
  const exported = inbox.exportResults({publicTransferAllowed: true});
  assert.equal(exported.results.length, 1);
  assert(!JSON.stringify(exported).includes('Fixture answer'));
  assert(!JSON.stringify(exported).includes('fixture:assessment'));
  inbox.receive(withdrawal(), {trustedTransport: true});
  const withdrawn = inbox.exportResults({publicTransferAllowed: true});
  assert.equal(withdrawn.results.length, 0);
  assert.equal(withdrawn.controls.length, 1);
  assert.equal(validateQueryPackageResults(withdrawn).controls[0].operation, 'withdraw');
});

test('source catalog is rechecked on consumption and busy receiver does not acknowledge', async t => {
  const {inbox, home} = await fixture(t);
  inbox.receive(packet(), {trustedTransport: true});
  const locked = path.join(home, fs.readdirSync(home).find(name => name.endsWith('.json')) + '.lock');
  fs.writeFileSync(locked, 'fixture owner');
  const result = inbox.receive(packet({revision: 2}), {trustedTransport: true});
  assert.equal(result.status, 'busy');
  assert.equal(result.acknowledged, false);
  fs.unlinkSync(locked);
  const other = await createQueryPackageInbox({home, namespace, toolsRoot: recipientTools, snapshots: [], now: () => stamp, tombstoneRetentionMs: 86400000});
  assert.throws(() => other.read('package-1'), /package_snapshot_mismatch/);
});

test('CLI adapter uses installed configuration and disabled feedback leaves normal caller independent', async t => {
  const {config} = await fixture(t);
  assert.equal((await runQueryPackageLocal('receive', packet(), {...config, enabled: false})).status, 'disabled');
  assert.equal((await runQueryPackageLocal('receive', packet(), {...config, enabled: true, trustedTransportConfirmed: true})).status, 'received');
  assert.equal((await runQueryPackageLocal('pending', {limit: 1}, {...config, enabled: true})).packages.length, 1);
});

test('host-selected existing feedback inbox receives the new issue for ordinary pending consumption', async t => {
  const f = await fixture(t);
  const feedbackHome = path.join(path.dirname(f.home), 'installed-sync-inbox');
  const inbox = await createQueryPackageInbox({...f.config, feedbackHome});
  inbox.receive(packet(), {trustedTransport: true});
  inbox.assess(assessment(packet(), {disposition: 'needs_evidence', next_action: 'Read exact source', review_when: 'source available', finding: finding()}));
  assert.equal(fs.existsSync(feedbackHome), true);
  const {FileStore} = await import(pathToFileURL(path.join(recipientTools,'integrations/knowledge-feedback/store.mjs')));
  const nextTask = new FileStore({home: feedbackHome, namespace});
  assert.equal(nextTask.select({now: stamp, terms: ['Fixture'], limit: 1})[0].status, 'needs_evidence');
});

test('public result revision is independent of the original package revision and withdrawal advances it', async t => {
  const {inbox} = await fixture(t);
  const first = packet({revision: 3});
  inbox.receive(first, {trustedTransport: true});
  const publicFields = {public_result: {summary: 'Public fixture summary', snapshot_id: snapshots[0].snapshot_id, refs: [source.ref]}, public_review: {approved: true, reviewer: 'local-owner'}};
  const decision = assessment(first, publicFields);
  inbox.assess(decision);
  inbox.assess(decision);
  let result = inbox.exportResults({publicTransferAllowed: true}).results[0];
  assert.equal(result.revision, 1);
  assert.equal(result.source_revision, 3);
  assert.equal(result.source_manifest_sha256, first.manifest_sha256);
  const second = packet({revision: 4, feedback: {revision: 1, rating: 'helpful'}});
  inbox.receive(second, {trustedTransport: true});
  inbox.assess(assessment(second, publicFields));
  result = inbox.exportResults({publicTransferAllowed: true}).results[0];
  assert.equal(result.revision, 2);
  assert.equal(result.source_revision, 4);
  inbox.receive(withdrawal({revision: 5}), {trustedTransport: true});
  const control = inbox.exportResults({publicTransferAllowed: true}).controls[0];
  assert.equal(control.revision, 3);
  assert.equal(control.source_revision, 5);
});

resolutionTest('Core backflow is an explicitly reviewed public copy with generated IDs, not the private finding', async t => {
  const {inbox} = await fixture(t),p=packet();
  inbox.receive(p,{trustedTransport:true});
  const prepared=inbox.preparePublicRecords({package_id:p.package_id,refs:[source.ref],finding:{id:'public-fixture-note',kind:'unknown',summary:'Fixture bounded public source note'}});
  assert.equal(prepared.status,'prepared_requires_public_review');
  assert.equal(prepared.core_records[0].lookup_id,p.request_id);
  assert.equal(prepared.core_records[0].sources[0].stage,'returned');
  assert(prepared.core_records[0].id.startsWith('public-qp-'));
  const other=inbox.preparePublicRecords({package_id:p.package_id,refs:[source.ref],finding:{id:'different-public-condition',kind:'unknown',summary:'A different bounded fixture condition'}});
  assert.notEqual(prepared.core_records[0].id,other.core_records[0].id,'distinct condition findings must not share a public Core ID');
  const decision=assessment(p,{disposition:'bug_fixed',finding:finding({outcome:fixedOutcome}),public_result:{summary:'Fixture public note',snapshot_id:snapshots[0].snapshot_id,refs:[source.ref],core_records:prepared.core_records},public_review:{approved:true,reviewer:'knowledge-owner'}});
  assert.throws(()=>inbox.assess(decision),/package_public_core_review_required/);
  decision.public_review.core_record_hashes=prepared.core_record_hashes;
  inbox.assess(decision);
  const result=validateQueryPackageResults(inbox.exportResults({publicTransferAllowed:true})).results[0];
  assert.equal(result.core_records.length,1);
  assert(!JSON.stringify(result.core_records).includes('fixture:owner-result'));
  assert.equal(result.core_records[0].payload_ref,null);
});

resolutionTest('a new reviewed result has fresh Core IDs after old-result withdrawal, while replay stays blocked',async t=>{
  const f=await fixture(t),inbox=f.inbox,p=packet();
  const {FileStore}=await import(pathToFileURL(path.join(recipientTools,'integrations/knowledge-feedback/store.mjs')));
  const online=new FileStore({home:path.join(path.dirname(f.home),'online-core'),namespace});
  function review(input){
    const prepared=inbox.preparePublicRecords({package_id:input.package_id,refs:[source.ref],finding:{id:'stable-public-condition',kind:'unknown',summary:'Fixture bounded public source condition'}});
    inbox.assess(assessment(input,{disposition:'bug_fixed',finding:finding({outcome:fixedOutcome}),public_result:{summary:'Fixture public condition',snapshot_id:snapshots[0].snapshot_id,refs:[source.ref],core_records:prepared.core_records},public_review:{approved:true,reviewer:'knowledge-owner',core_record_hashes:prepared.core_record_hashes}}));
    return inbox.exportResults({publicTransferAllowed:true}).results[0];
  }
  inbox.receive(p,{trustedTransport:true});
  const first=review(p);
  online.apply(first.core_records,{now:stamp});
  const oldId=first.core_records[0].id;
  assert(oldId.includes('-r1-'));
  online.apply([{schema_version:1,...namespace,type:'control',id:'fixture-retire-old-public-result',revision:1,occurred_at:new Date(stamp).toISOString(),expires_at:p.expires_at,operation:'withdraw',target:{type:'signal',id:oldId}}],{now:stamp});
  const revised=packet({revision:2,feedback:{revision:1,rating:'unhelpful'}});
  inbox.receive(revised,{trustedTransport:true});
  const second=review(revised),newId=second.core_records[0].id;
  assert(newId.includes('-r2-'));
  assert.notEqual(newId,oldId);
  assert.equal(online.apply(second.core_records,{now:stamp}).status,'persisted');
  assert.equal(online.apply(first.core_records,{now:stamp}).results[0].status,'withdrawn');
  assert(online.read().records.signal[newId]);
  assert.equal(online.read().records.signal[oldId],undefined);
});

function resolutionTest(name, action) {
  test(name, {skip: resolutionSupported ? false : 'requires separately configured compatible feedback Core'}, action);
}
test('legacy Core retains a verified fix pending without changing queue or feedback records', async t => {
  if (resolutionSupported) return;
  const {inbox, home} = await fixture(t);
  inbox.receive(packet(), {trustedTransport:true});
  const before = fs.readFileSync(path.join(home,fs.readdirSync(home).find(name=>name.endsWith('.json'))));
  const result = inbox.assess(assessment(packet(), {disposition:'bug_fixed', finding:finding({outcome:fixedOutcome})}));
  assert.equal(result.status,'unavailable');
  assert.equal(result.reason,'feedback_resolution_unavailable');
  assert.equal(result.acknowledged,false);
  assert.equal(inbox.pending().length,1);
  assert.deepEqual(fs.readFileSync(path.join(home,fs.readdirSync(home).find(name=>name.endsWith('.json')))),before);
});
