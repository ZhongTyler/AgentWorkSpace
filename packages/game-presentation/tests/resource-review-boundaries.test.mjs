import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const builder = path.resolve(import.meta.dirname, '../adapters/resource-review/build.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'review-boundary-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  const manifest = path.join(root,'manifest.json');
  const output = path.join(root,'output');
  function run(value) {
    fs.writeFileSync(manifest,JSON.stringify(value));
    return spawnSync(process.execPath,[builder,'--root',root,'--manifest',manifest,'--output',output],{encoding:'utf8'});
  }
  return {root,output,run};
}
test('resource IDs and pixel sizes cannot escape output ownership', t => {
  const f = fixture(t);
  for (const id of ['../outside','..\\outside','C:outside','__proto__']) {
    const result = f.run({sources:[],assets:[{id}],scenes:[]});
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Unsafe resource ID/);
    assert.equal(fs.existsSync(f.output),false);
  }
  const invalidSize=f.run({sources:[],assets:[{id:'safe',sizes:['../../outside']}],scenes:[]});
  assert.match(invalidSize.stderr,/Invalid output pixel size/);
  assert.equal(fs.existsSync(f.output),false);
});
test('existing output is refused before browser startup and keeps owner bytes', t => {
  const f=fixture(t);
  fs.mkdirSync(f.output);
  const canary=path.join(f.output,'owner.txt');fs.writeFileSync(canary,'owner bytes');
  const result=f.run({sources:[],assets:[],scenes:[]});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/Choose a new output directory/);
  assert.equal(fs.readFileSync(canary,'utf8'),'owner bytes');
});
