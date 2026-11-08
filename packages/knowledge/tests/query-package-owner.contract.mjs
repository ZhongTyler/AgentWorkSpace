import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {createQueryPackage, queryPackageDigest} from '../system/integrations/query-package.mjs';
import {createQueryPackageInbox} from '../system/integrations/query-package-local.mjs';
import {execute} from '../system/integrations/lookup-host.mjs';

const moduleRoot = path.resolve(import.meta.dirname, '..');
const originalTools = process.env.FEEDBACK_TOOLS_ROOT ?? path.resolve(moduleRoot, '../tools');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function write(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, JSON.stringify(value));
}

async function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-owner-package-'));
  t.after(() => {
    assert.equal(path.dirname(folder), path.resolve(os.tmpdir()));
    assert(path.basename(folder).startsWith('knowledge-owner-package-'));
    fs.rmSync(folder, {recursive: true, force: true});
  });
  const toolsRoot = path.join(folder, 'Tools');
  const base = path.join(toolsRoot, 'integrations/knowledge-feedback');
  fs.mkdirSync(base, {recursive: true});
  for (const name of ['core.mjs', 'store.mjs', 'host.mjs']) fs.copyFileSync(path.join(originalTools, 'integrations/knowledge-feedback', name), path.join(base, name));
  const knowledgeRoot = path.join(folder, 'Knowledge');
  fs.mkdirSync(path.join(knowledgeRoot, 'wiki'), {recursive: true});
  fs.writeFileSync(path.join(knowledgeRoot, 'wiki/Example.md'), '# Example\n\nA fixture condition.\n');
  const home = path.join(folder, 'owner');
  const installation = path.join(folder, 'PersonalSite/.local/knowledge-local-sync-20261025/v07/install-12345678');
  const privateHome = path.join(installation, 'private');
  const namespace = {host: 'online-knowledge', library_id: 'knowledge', view: 'public'};
  const snapshots = [{snapshot_id: 'fixture', manifest_sha256: 'b'.repeat(64), sources: {'knowledge:wiki:Example': 'a'.repeat(64)}}];
  const catalogPath = path.join(folder, 'catalog.json');
  write(catalogPath, snapshots);
  const configPath = path.join(installation, 'config.json');
  const config = {
    schemaVersion: 1, toolsRoot, privateHome,
    jobs: {'pull-compounding': {
      enabled: true, retentionPolicyConfirmed: true, improvementUseOnLocalConfirmed: true,
      tombstoneRetentionMs: 86400000, allowedNamespaces: [namespace],
      queryPackages: {enabled: true, snapshotCatalogPath: catalogPath, snapshotCatalogSha256: hash(fs.readFileSync(catalogPath))},
    }},
  };
  write(configPath, config);
  write(path.join(home, 'online-inbox.json'), {schemaVersion: 1, enabled: true, configPath, configRoot: path.dirname(configPath), namespace: {host:'online-knowledge',library_id:'knowledge',view:'public'}, ownerNamespace: {host:'local-agent',library_id:'example-library',view:'local-owner'}, configSha256: hash(fs.readFileSync(configPath)), coreHashes: Object.fromEntries(['core.mjs', 'store.mjs'].map(name => [name, hash(fs.readFileSync(path.join(base, name)))]))});
  const healthPath = path.join(privateHome, 'health/pull-compounding.json');
  const health = {exitCode: 0, at: new Date().toISOString(), lastSuccessAt: new Date().toISOString()};
  write(healthPath, health);
  const packetHome = path.join(privateHome, 'pull-compounding/query-packages', queryPackageDigest(namespace));
  const receiver = await createQueryPackageInbox({home: packetHome, feedbackHome: path.join(privateHome, 'pull-compounding/inbox'), namespace, snapshots, toolsRoot, tombstoneRetentionMs: 86400000});
  const context = {host: 'local-agent', library_id: 'example-library', view: 'local-owner', lookup_id: 'fixture-owner', request_ref: 'fixture-owner', entry: 'query_api', purpose: 'research', policy: {version: 'fixture', analysis_allowed: true, temporary: false, retention_confirmed: true}, expires_at: new Date(Date.now() + 3600000).toISOString()};
  const options = {knowledgeRoot, moduleRoot, toolsRoot, home};
  function packet(id) {
    return createQueryPackage({
      kind: 'query', package_id: id, request_id: id, namespace, revision: 1,
      created_at: new Date().toISOString(), expires_at: context.expires_at,
      policy: {...context.policy, improvement_use_on_local_confirmed: true, public_return_allowed: true},
      query: {question: 'Fixture condition'}, answer: {text: 'Private fixture answer', status: 'completed'},
      knowledge: {snapshot_id: 'fixture', manifest_sha256: 'b'.repeat(64), used_mode: 'public'},
      sources: [{ref: 'knowledge:wiki:Example', version: 'a'.repeat(64), ranges: []}],
      feedback: {rating: 'unspecified', revision: 0},
      diagnostics: {warning_codes: [], review_status: 'not_verified', usage: {}},
    });
  }
  return {receiver, context, options, packet, packetHome, configPath, config, catalogPath, healthPath, health};
}

test('original local pending and read expose bounded packages, then explicit assessment closes one', async t => {
  const f = await fixture(t);
  for (let i = 0; i < 4; i++) f.receiver.receive(f.packet('fixture-' + i), {trustedTransport: true});
  const stateFile = path.join(f.packetHome, 'query-packages-' + queryPackageDigest({host: 'online-knowledge', library_id: 'knowledge', view: 'public'}) + '.json');
  const before = hash(fs.readFileSync(stateFile));
  const pending = await execute({operation: 'pending', context: f.context}, f.options);
  assert.equal(pending.query_packages.status, 'selected');
  assert.equal(pending.query_packages.packages.length, 3);
  assert(!JSON.stringify(pending.query_packages).includes('Private fixture answer'));
  const request = {schema_version: 1, need: {question: 'Fixture condition', kind: 'understanding'}, terms: ['condition'], budget: {max_sources: 3, max_content_chars: 1000}};
  const read = await execute({operation: 'read', context: f.context, input: {request, ref: 'knowledge:wiki:Example', selection: {mode: 'full'}}}, f.options);
  assert.equal(read.status, 'source_read');
  assert.equal(read.compounding.query_packages.packages.length, 3);
  assert.equal(hash(fs.readFileSync(stateFile)), before, 'ordinary entry must not assess or rewrite package state');
  const material = await execute({operation: 'query_package_read', context: f.context, input: {package_id: 'fixture-0'}}, f.options);
  assert.equal(material.package.answer.text, 'Private fixture answer');
  const packet = material.package;
  const closed = await execute({operation: 'query_package_assess', context: f.context, input: {package_id: packet.package_id, revision: packet.revision, manifest_sha256: packet.manifest_sha256, agent: 'fixture-owner', disposition: 'no_increment', reason: 'Synthetic explicit decision', decision_ref: 'fixture:decision'}}, f.options);
  assert.equal(closed.status, 'assessed');
  const after = await execute({operation: 'pending', context: f.context}, f.options);
  assert(!after.query_packages.packages.some(p => p.package_id === 'fixture-0'));
});

test('unavailable package queue stays visible without blocking Query or disclosing to foreign callers', async t => {
  const f = await fixture(t);
  f.receiver.receive(f.packet('fixture'), {trustedTransport: true});
  const pending = extra => execute({operation: 'pending', context: {...f.context, ...extra}}, f.options);
  assert.equal((await pending({})).query_packages.packages.length, 1);
  assert.equal((await pending({library_id: 'another-library'})).query_packages, null);
  assert.equal((await pending({policy: {...f.context.policy, temporary: true}})).query_packages, null);
  write(f.healthPath, {...f.health, lastSuccessAt: new Date(Date.now() - 3600001).toISOString()});
  assert.equal((await pending({})).query_packages.status, 'unavailable');
  const request = {schema_version: 1, need: {question: 'Fixture condition', kind: 'understanding'}, terms: ['condition'], budget: {max_sources: 3, max_content_chars: 1000}};
  const read = await execute({operation: 'read', context: f.context, input: {request, ref: 'knowledge:wiki:Example', selection: {mode: 'full'}}}, f.options);
  assert.equal(read.status, 'source_read');
  assert.equal(read.compounding.query_packages.status, 'unavailable');
  write(f.healthPath, f.health);
  write(f.configPath, {...f.config, privateHome: path.dirname(f.configPath)});
  assert.equal((await pending({})).query_packages.status, 'unavailable');
  write(f.configPath, f.config);
  write(f.catalogPath, []);
  assert.equal((await pending({})).query_packages.status, 'unavailable');
  assert.equal((await execute({operation: 'query_package_read', context: {...f.context, knowledge_allowed: false}, input: {package_id: 'fixture'}}, f.options)).status, 'disabled');
});
