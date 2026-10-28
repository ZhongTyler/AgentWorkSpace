import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {preflight} from '../system/maintenance/checklists/ingest-stage3-preflight.mjs';
import {maintenanceSummary} from '../system/maintenance/checklists/ingest-maintenance-summary.mjs';
import {lifecycleWindows} from '../system/maintenance/checklists/ingest-cost-lifecycle.mjs';

test('registry gaps are listed together; unstaged repairs cannot pass Seal',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-preflight-'));
  const put=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),v);};
  const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'}).toString().trim();
  try {
    put('raw-sources/README.md','rules');
    put('system/registry/raw-list.md','### A\n（共 0 篇）\n### B\n（共 0 篇）\n');
    for(const p of ['NOW.md','system/registry/KNOWLEDGE_STATUS.md']) put(p,'- raw：0\n');
    put('system/registry/index.md','index');put('system/maintenance/CHANGELOG.md','log');
    git('init');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');git('add','.');git('commit','-m','baseline');
    const base=git('rev-parse','HEAD');put('raw-sources/a.md','new Raw');
    put('run.json',JSON.stringify({commits:{stage1:base},artifacts:[{kind:'raw',disposition:'ingested',path:'raw-sources/a.md'}]}));
    const bad=preflight(root,'run.json');assert.equal(bad.status,'failed');assert.equal(bad.failed_checks.length,4);
    put('system/registry/raw-list.md','### A\n（共 1 篇）\n| a.md | source |\n### B\n（共 0 篇）\n');
    for(const p of ['NOW.md','system/registry/KNOWLEDGE_STATUS.md']) put(p,'- raw：1\n');
    put('system/registry/index.md','new index');put('system/maintenance/CHANGELOG.md','new log');
    assert.equal(preflight(root,'run.json').status,'passed');
    assert.equal(preflight(root,'run.json',true).status,'failed');git('add','.');
    assert.equal(preflight(root,'run.json',true).status,'passed');
    put('NOW.md','- raw：10\n');assert.equal(preflight(root,'run.json',true).status,'failed');
    put('NOW.md','- raw：1\n');put('system/registry/raw-list.md','### A\n（共 1 篇）\n| b.md | source |\n### B\n（共 0 篇）\n');
    assert.equal(preflight(root,'run.json').status,'failed');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('compact maintenance output uses checks not missing top-level failed_check_ids',()=>{
  const r={status:'passed',checks:[{id:'ok',passed:true}],health:{status:'needs_review',findings:Array.from({length:294},()=>({severity:'warning',detail:'large'}))}};
  const s=maintenanceSummary(r);assert.deepEqual(s.failed_checks,[]);assert.equal(s.health.severity_counts.warning,294);assert.ok(JSON.stringify(s).length<600);
  assert.equal(maintenanceSummary(r,'ok').passed,true);assert.throws(()=>maintenanceSummary(r,'missing'));
});

test('lifecycle separates approval interval and does not invent historical timestamps',()=>{
  const at=n=>'2026-09-15T00:00:'+String(n).padStart(2,'0')+'Z';
  const r=lifecycleWindows(at(0),{review_ready_at:at(10),finish_started_at:at(30),finish_completed_at:at(35)},at(40));
  assert.equal(r.pre_review_seconds,10);assert.equal(r.approval_interval_seconds,20);assert.equal(r.post_approval_seconds,10);
  assert.equal(lifecycleWindows(at(0),null,at(40)).status,'unavailable');
  assert.throws(()=>lifecycleWindows(at(0),{review_ready_at:at(30),finish_started_at:at(10),finish_completed_at:at(35)},at(40)));
});
