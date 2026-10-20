import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {makeDemo} from '../scripts/make-demo.mjs';
import {ROOT,inside,write,read,loadTrip} from '../scripts/lib/core.mjs';
import {frontendBuild,frontendCheck,frontendAudit,renderTemplate,inspectBindings,loadContract,valuesAt} from '../scripts/frontend.mjs';
import {bundleFiles} from '../scripts/lib/package.mjs';

export function setupFrontend(project){
  makeDemo(project);fs.mkdirSync(inside(project,'frontend'),{recursive:true});
  for(const file of ['template.html','fixtures.json'])fs.copyFileSync(path.join(ROOT,'examples/frontend',file),inside(project,'frontend/'+file));
  fs.copyFileSync(path.join(ROOT,'模板/前端组件合同.json'),inside(project,'frontend/contract.json'));
  write(inside(project,'frontend/DESIGN-SPEC.md'),'# Synthetic baseline\n\nDraft; no human approval. Token values live in template.html.');
}
function sample(t){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'travel-contract-'));t.after(()=>fs.rmSync(temp,{recursive:true,force:true}));
  const project=path.join(temp,'trip');setupFrontend(project);return project;
}
test('custom build binds current facts without changing them, and is read-only when checked',t=>{
  const p=sample(t),before=fs.readFileSync(inside(p,'trip.json'));
  assert.equal(frontendBuild(p).valid,true);assert.equal(frontendCheck(p).valid,true);
  assert.deepEqual(fs.readFileSync(inside(p,'trip.json')),before);
  const receipt=fs.readFileSync(inside(p,'frontend/receipt.json'));frontendCheck(p);
  assert.deepEqual(fs.readFileSync(inside(p,'frontend/receipt.json')),receipt);
});
test('fact, generated-data and artifact changes cannot borrow an old successful receipt',t=>{
  const p=sample(t);frontendBuild(p);
  const data=read(inside(p,'generated/data.json'));data.orders=[];write(inside(p,'generated/data.json'),data);
  assert.ok(frontendCheck(p).errors.some(e=>e.includes('stale or edited')));
  frontendBuild(p);fs.appendFileSync(inside(p,'frontend/index.html'),'<!-- unexpected -->');assert.equal(frontendCheck(p).valid,false);
  frontendBuild(p);const trip=loadTrip(p);trip.title='Changed title';write(inside(p,'trip.json'),trip);assert.equal(frontendCheck(p).valid,false);
});
test('normative spec, fixtures, contract and token/template changes invalidate output',t=>{
  const p=sample(t);
  for(const f of ['DESIGN-SPEC.md','template.html','fixtures.json','contract.json']){
    frontendBuild(p);fs.appendFileSync(inside(p,'frontend/'+f),f.endsWith('.json')?'\n':'\n<!-- changed -->');
    assert.equal(frontendCheck(p).valid,false,f);
  }
});
test('binding errors identify missing fields, Unicode length, newlines and projection drift',()=>{
  const binding={id:'x',component:'heading',source:'title',projection:'title',transform:'identity',required:true,maxChars:2,multiline:false};
  assert.deepEqual(inspectBindings({title:'汉😀'},{title:'汉😀'},{bindings:[binding]}),[]);
  for(const value of [null,'','abc','a\nb'])assert.ok(inspectBindings({title:value},{title:value},{bindings:[binding]}).length);
  assert.ok(inspectBindings({title:'a'},{title:'b'},{bindings:[binding]}).some(e=>e.includes('mismatch')));
  assert.deepEqual(inspectBindings({routes:[{}, {status:'pending'}]},{routes:[{pending:false},{pending:true}]},{bindings:[{id:'route',source:'routes[].status',projection:'routes[].pending',transform:'pending'}]}),[]);
  assert.throws(()=>valuesAt({},'__proto__.x'),/Invalid/);assert.throws(()=>valuesAt({days:{}},'days[].date'),/Expected array/);
});
test('JSON embedding rejects misplaced/repeated markers and escapes script termination and replacement syntax',()=>{
  const template='<script id="data" type="application/json">__TRAVEL_DATA__</script>';
  const value={text:'</script><script>alert(1)</script>$&\u2028'};
  const html=renderTemplate(template,value);assert.doesNotMatch(html,/<script>alert/);
  assert.equal(JSON.parse(html.match(/>(.*)<\/script>/)[1]).text,value.text);
  assert.throws(()=>renderTemplate('<div>__TRAVEL_DATA__</div>',{}),/application\/json/);
  assert.throws(()=>renderTemplate(template+template,{}),/exactly one/);
});
test('contract fails closed for omitted states, unsupported transforms, unsafe output, and token omissions',t=>{
  const p=sample(t),original=read(inside(p,'frontend/contract.json'));
  const fixture=read(inside(p,'frontend/fixtures.json'));write(inside(p,'frontend/fixtures.json'),fixture.slice(1));
  assert.throws(()=>loadContract(p),/Fixtures must cover/);write(inside(p,'frontend/fixtures.json'),fixture);
  for(const mutate of [c=>c.output='frontend/../trip.json',c=>c.output=c.template,c=>c.widths=[1440],c=>c.bindings[0].transform='eval',c=>c.views=[]]){
    const contract=structuredClone(original);mutate(contract);write(inside(p,'frontend/contract.json'),contract);assert.throws(()=>loadContract(p));
  }
  write(inside(p,'frontend/contract.json'),original);frontendBuild(p);
  fs.appendFileSync(inside(p,'frontend/template.html'),' ');
  const contract=structuredClone(original);contract.tokens.push('--not-defined');write(inside(p,'frontend/contract.json'),contract);
  assert.throws(()=>frontendBuild(p),/Missing CSS token/);
});
test('CLI missing contract exits nonzero, never silently falls back to unrelated build',t=>{
  const p=sample(t);fs.renameSync(inside(p,'frontend/contract.json'),inside(p,'frontend/contract-backup.json'));
  const r=spawnSync(process.execPath,[path.join(ROOT,'scripts/travel.mjs'),'frontend-check','--project',p],{encoding:'utf8'});
  assert.equal(r.status,1);assert.match(r.stderr,/contract.json/);
});
test('unavailable optional browser replaces old success with an explicit failed report',async t=>{
  const p=sample(t);frontendBuild(p);write(inside(p,'reports/frontend-audit.json'),{valid:true});
  const r=await frontendAudit(p,{browser:inside(p,'frontend/nonexistent-browser')});
  assert.equal(r.valid,false);assert.equal(r.browserChecked,false);assert.ok(r.errors.length);
  assert.equal(read(inside(p,'reports/frontend-audit.json')).valid,false);
});
test('formal publish whitelist matches portable bundle without silently omitting dependencies',t=>{
  const file=path.join(ROOT,'release-input/manifest.json');
  if(!fs.existsSync(file)){t.skip('Source publish adapter is not part of distributed package');return;}
  const manifest=read(file),actual=bundleFiles().map(f=>path.relative(ROOT,f).replaceAll(path.sep,'/')).sort();
  assert.equal(manifest.expected_file_count,actual.length);
  assert.deepEqual(manifest.copy_files.map(f=>f.source).sort(),actual);
  assert.equal(new Set(manifest.copy_files.map(f=>f.target)).size,actual.length);
});
test('optional real browser rejects a fixed empty-order message after orders are added',{skip:process.env.TRAVEL_FRONTEND_BROWSER!=='1'},async t=>{
  const p=sample(t);frontendBuild(p);
  const good=await frontendAudit(p);assert.equal(good.valid,true,good.errors.join('\n'));assert.equal(good.checks.length,15);assert.equal(good.network.length,0);
  const file=inside(p,'frontend/template.html'),template=fs.readFileSync(file,'utf8');
  const broken=template.replace(/document\.querySelector\('#orders'\)\.textContent=.*;/,"document.querySelector('#orders').textContent='暂无预订';");
  assert.notEqual(broken,template);write(file,broken);frontendBuild(p);
  const bad=await frontendAudit(p);assert.equal(bad.valid,false);
  assert.equal(bad.checks.filter(c=>!c.passed&&c.label.startsWith('has-data/')).length,3);
});
