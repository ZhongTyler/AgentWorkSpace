import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {syncQueryPackages} from './query-package-sync.mjs';
import {createQueryPackage, validateQueryPackageResults} from '../integrations/query-package.mjs';
import {createQueryPackageInbox} from '../integrations/query-package-local.mjs';
import {namespaceKey, readJson, hash, SyncError} from './state.mjs';

const now = Date.parse('2026-11-07T04:00:00Z');
const namespace = {host: 'online-knowledge', library_id: 'knowledge', view: 'public'};
const snapshots = [{snapshot_id:'fixture-public',manifest_sha256:'a'.repeat(64),sources:{'knowledge:wiki:fixture':'b'.repeat(64)}}];
const toolsRoot = process.env.FEEDBACK_TOOLS_ROOT;
function packet(extra = {}) {
  return createQueryPackage({kind:'query',namespace,package_id:'fixture-package',request_id:'fixture-request',revision:1,created_at:new Date(now-1000).toISOString(),expires_at:new Date(now+86400000).toISOString(),policy:{version:'fixture',analysis_allowed:true,temporary:false,retention_confirmed:true,improvement_use_on_local_confirmed:true,public_return_allowed:true},query:{question:'Fixture complete query'},answer:{text:'Fixture complete answer',status:'completed'},knowledge:{snapshot_id:snapshots[0].snapshot_id,manifest_sha256:snapshots[0].manifest_sha256,used_mode:'bm25'},sources:[{ref:'knowledge:wiki:fixture',version:'b'.repeat(64),ranges:[{mode:'full_source',complete_source:true}]}],feedback:{revision:0,rating:'unspecified'},diagnostics:{warning_codes:[],review_status:'not_verified',usage:{}},...extra});
}
function fixture(t) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'query-package-sync-test-'));
  t.after(()=>{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert(path.basename(directory).startsWith('query-package-sync-test-'));fs.rmSync(directory,{recursive:true,force:true});});
  const catalog=path.join(directory,'snapshots.json');fs.writeFileSync(catalog,JSON.stringify(snapshots));
  const job={retentionPolicyConfirmed:true,improvementUseOnLocalConfirmed:true,tombstoneRetentionMs:86400000,allowedNamespaces:[namespace],queryPackages:{enabled:true,snapshotCatalogPath:catalog,snapshotCatalogSha256:hash(fs.readFileSync(catalog)),maxPackagesPerRun:1,publicReturnConfirmed:true}};
  const home=path.join(directory,'pull-compounding');
  const privateHome=path.join(home,'query-packages',namespaceKey(namespace));
  const options={home,toolsRoot,clock:()=>now};
  const inbox=()=>createQueryPackageInbox({home:privateHome,feedbackHome:path.join(home,'inbox'),namespace,snapshots,toolsRoot,now:()=>now,tombstoneRetentionMs:job.tombstoneRetentionMs});
  return {directory,home,privateHome,job,options,inbox};
}

test('query packages disabled makes no new transport calls',async()=>{
  const result=await syncQueryPackages({},()=>{throw Error('unexpected call');});
  assert.equal(result.status,'disabled');
});

test('durable custody and receipt precede ACK, lost ACK retries without duplicate assessment or cursor advance',async t=>{
  const f=fixture(t),p=packet();let calls=0;
  const request=async(action,input)=>{
    if(action==='query-package-next')return {status:'package',source_cursor:1,package:p};
    assert.equal(action,'query-package-ack');
    assert.deepEqual(Object.keys(input).sort(),['manifest_sha256','namespace','package_id','revision','source_cursor']);
    assert.equal((await f.inbox()).read(p.package_id).answer.text,p.answer.text);
    assert.equal(readJson(path.join(f.privateHome,'receipts/1.json')).acknowledged,false);
    if(calls++===0)throw new SyncError('transport_unavailable',true);
    return {status:'acked',...input};
  };
  assert.equal((await syncQueryPackages(f.job,request,f.options)).status,'partial');
  assert.equal(fs.existsSync(path.join(f.privateHome,'cursor.json')),false);
  const result=await syncQueryPackages(f.job,request,f.options);
  assert.equal(result.acknowledged,1);assert.equal(result.received,0);
  assert.equal(readJson(path.join(f.privateHome,'cursor.json')).source_cursor,1);
  assert.equal((await f.inbox()).pending().length,1);
});

test('version mismatch never ACKs or advances cursor; installed catalog tamper is refused',async t=>{
  const f=fixture(t);let ack=0;const p=packet({sources:[{ref:'knowledge:wiki:fixture',version:'c'.repeat(64),ranges:[]}]});
  const result=await syncQueryPackages(f.job,async action=>{if(action==='query-package-ack')ack++;return {status:'package',source_cursor:1,package:p};},f.options);
  assert.equal(result.status,'partial');assert.equal(ack,0);assert.equal(fs.existsSync(path.join(f.privateHome,'cursor.json')),false);
  fs.appendFileSync(f.job.queryPackages.snapshotCatalogPath,' ');
  await assert.rejects(syncQueryPackages(f.job,()=>{},f.options),{code:'query_package_snapshot_catalog_changed'});
});

test('public output retries stable digest and records delivery only after exact server ACK',async t=>{
  const f=fixture(t),inbox=await f.inbox(),p=packet();inbox.receive(p,{trustedTransport:true});
  inbox.assess({package_id:p.package_id,revision:p.revision,manifest_sha256:p.manifest_sha256,agent:'fixture-owner',reason:'Fixture checked',decision_ref:'fixture:assessment',disposition:'no_increment',public_result:{summary:'Fixture public result',snapshot_id:snapshots[0].snapshot_id,refs:['knowledge:wiki:fixture']},public_review:{approved:true,reviewer:'fixture-owner'}});
  const digests=[];let fail=true;
  const request=async(action,input)=>{
    if(action==='query-package-next')return {status:'unchanged',source_cursor:0};
    assert.equal(action,'query-package-results');validateQueryPackageResults(input);digests.push(input.manifest_sha256);
    assert(!JSON.stringify(input).includes('Fixture complete answer'));
    if(fail){fail=false;throw new SyncError('transport_unavailable',true);}
    return {status:'acked',manifest_sha256:input.manifest_sha256};
  };
  assert.equal((await syncQueryPackages(f.job,request,f.options)).status,'partial');
  assert.equal((await syncQueryPackages(f.job,request,f.options)).resultsAcknowledged,1);
  assert.equal(digests[0],digests[1]);
  assert.equal((await syncQueryPackages(f.job,request,f.options)).resultsAcknowledged,0);
  assert.equal(digests.length,2);
});

test('withdrawal is sent back even if an unrelated new source package cannot be received',async t=>{
  const f=fixture(t),inbox=await f.inbox();
  inbox.receive(createQueryPackage({kind:'withdrawal',namespace,package_id:'withdrawn-package',request_id:'withdrawn-request',revision:2,created_at:new Date(now).toISOString(),expires_at:new Date(now+86400000).toISOString(),reason_code:'visitor_withdrawal'}),{trustedTransport:true});
  let returned=0;
  const result=await syncQueryPackages(f.job,async(action,input)=>{
    if(action==='query-package-next')return {status:'package',source_cursor:1,package:packet({sources:[{ref:'knowledge:wiki:fixture',version:'c'.repeat(64),ranges:[]}]})};
    assert.equal(action,'query-package-results');assert.equal(input.controls[0].operation,'withdraw');returned++;
    return {status:'acked',manifest_sha256:input.manifest_sha256};
  },f.options);
  assert.equal(result.status,'partial');assert.equal(returned,1);assert.equal(result.resultsAcknowledged,1);
});

test('same cursor with different package digest is refused after a lost ACK',async t=>{
  const f=fixture(t);
  await syncQueryPackages(f.job,async action=>{if(action==='query-package-next')return {status:'package',source_cursor:1,package:packet()};throw new SyncError('transport_unavailable',true);},f.options);
  let ack=false;
  const result=await syncQueryPackages(f.job,async action=>{if(action==='query-package-next')return {status:'package',source_cursor:1,package:packet({answer:{text:'Changed same revision',status:'completed'}})};ack=true;},f.options);
  assert.equal(result.failures[0].code,'query_package_revision_conflict');assert.equal(ack,false);
});

test('normal installer includes flat shared package modules and an installed copy resolves its own imports',async t=>{
  const f=fixture(t),client=path.join(f.directory,'client');fs.mkdirSync(client);
  const installer=fs.readFileSync(new URL('./install-local.ps1',import.meta.url),'utf8');
  for(const name of ['query-package.mjs','query-package-local.mjs']){
    assert(installer.includes("$integrationFiles=@('query-package.mjs','query-package-local.mjs')"));
    fs.copyFileSync(new URL('../integrations/'+name,import.meta.url),path.join(client,name));
  }
  for(const name of ['query-package-sync.mjs','state.mjs'])fs.copyFileSync(new URL('./'+name,import.meta.url),path.join(client,name));
  const installed=await import(pathToFileURL(path.join(client,'query-package-sync.mjs')));
  const result=await installed.syncQueryPackages(f.job,async()=>({status:'unchanged',source_cursor:0}),f.options);
  assert.equal(result.status,'unchanged');
});
