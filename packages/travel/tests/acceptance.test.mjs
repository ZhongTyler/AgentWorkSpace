import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {prepareAcceptance,acceptanceCheck} from '../scripts/acceptance.mjs';
import {ROOT,read,inside,write} from '../scripts/lib/core.mjs';
test('consumer trial copies only public tooling and frozen brief, with no existing trip or human result',t=>{
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'travel-new-user-'));t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  const root=path.join(parent,'workspace'),brief=read(path.join(ROOT,'examples/acceptance-brief.json'));
  assert.equal(prepareAcceptance(root,brief).packageValid,true);
  assert.equal(fs.existsSync(inside(root,'trip')),false);assert.equal(fs.existsSync(inside(root,'workflow/.runtime')),false);
  const r=acceptanceCheck(root);assert.equal(r.engineeringPassed,false);assert.equal(r.humanAcceptance,'not-performed');
  assert.throws(()=>prepareAcceptance(root,brief),/new/);
  const changed={...brief,party:3};write(inside(root,'BRIEF.json'),changed);assert.ok(acceptanceCheck(root).errors.includes('Trial brief changed'));
});
