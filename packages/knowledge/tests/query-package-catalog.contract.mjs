import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildQueryPackageSnapshotCatalog,mergeQueryPackageSnapshotCatalog} from '../system/integrations/query-package-catalog.mjs';
import {canonical,hash} from '../system/sync/state.mjs';

test('accepted snapshot catalog maps principle IDs to the exact original public domain file',t=>{
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'query-package-catalog-test-'));
  t.after(()=>{assert.equal(path.dirname(home),path.resolve(os.tmpdir()));assert(path.basename(home).startsWith('query-package-catalog-test-'));fs.rmSync(home,{recursive:true,force:true});});
  const content=path.join(home,'content');fs.mkdirSync(path.join(content,'domains'),{recursive:true});
  const bytes=Buffer.from('# Fixture domain\n\n1. Scope <!-- principle_id: DPR-TEST-001 -->\nKeep the fixture condition.\n');
  fs.writeFileSync(path.join(content,'domains/Fixture.md'),bytes);
  const subject={schema:1,snapshot_id:'fixture-catalog',source_revision:'1'.repeat(40),base_snapshot:null,deletions:[],query_contract:'fixture-query',entries:[{kind:'domain',path:'domains/Fixture.md',review_status:'accepted',sha256:hash(bytes),size:bytes.length}]};
  const approval={schema:1,decision:'accepted',source_revision:subject.source_revision,subject_sha256:hash(canonical(subject))};
  const acceptanceBytes=Buffer.from(JSON.stringify(approval));
  fs.writeFileSync(path.join(home,'acceptance.json'),acceptanceBytes);
  fs.writeFileSync(path.join(home,'manifest.json'),JSON.stringify({...subject,acceptance:{receipt_sha256:hash(acceptanceBytes)}}));
  const config={sourceRoot:content,manifestPath:path.join(home,'manifest.json'),acceptancePath:path.join(home,'acceptance.json'),allowedPrefixes:['domains/']};
  const catalog=buildQueryPackageSnapshotCatalog(config);
  const previous={snapshot_id:'old-reviewed',manifest_sha256:'a'.repeat(64),sources:{'knowledge:wiki:old':'b'.repeat(64)}};
  const retained=buildQueryPackageSnapshotCatalog(config,{previousSnapshots:[previous]});
  assert.deepEqual(retained[0],previous);assert.deepEqual(retained[1],catalog[0]);
  assert.equal(catalog[0].sources['knowledge:principle:DPR-TEST-001'],hash(bytes));
  assert.equal(catalog[0].sources['knowledge:domain:Fixture'],hash(bytes));
  fs.appendFileSync(path.join(content,'domains/Fixture.md'),'changed');
  assert.throws(()=>buildQueryPackageSnapshotCatalog(config),{code:'content_size_mismatch'});
});

test('catalog merge preserves old approved identities and refuses conflicting replacements',()=>{
 const old={snapshot_id:'old',manifest_sha256:'1'.repeat(64),sources:{'knowledge:wiki:A':'2'.repeat(64)}};
 const next={snapshot_id:'next',manifest_sha256:'3'.repeat(64),sources:{'knowledge:research:game/overview':'4'.repeat(64)}};
 const original=structuredClone(old),combined=mergeQueryPackageSnapshotCatalog([old],[next,old]);
 assert.deepEqual(combined,[old,next]);assert.deepEqual(old,original);
 combined[0].sources['knowledge:wiki:A']='5'.repeat(64);assert.deepEqual(old,original);
 assert.throws(()=>mergeQueryPackageSnapshotCatalog([old],[{...old,manifest_sha256:'6'.repeat(64)}]),/identity conflict/);
});
