import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pack,verifyPackage,packageCheck} from '../scripts/lib/package.mjs';
import {inside,read} from '../scripts/lib/core.mjs';

test('copy to clean workspace runs demo/build/tests without source workspace or npm',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-portable-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const target=path.join(root,'copied toolkit'),project=path.join(root,'stranger trip');
 assert.equal(packageCheck().valid,true);
 const packed=pack(target);assert.equal(packed.valid,true);assert.equal(verifyPackage(target).valid,true);
 assert.ok(!fs.existsSync(path.join(target,'node_modules')));assert.ok(!fs.existsSync(path.join(target,'.runtime')));
 const run=(file,args=[])=>{const r=spawnSync(process.execPath,[path.join(target,file),...args],{cwd:root,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;};
 run('scripts/travel.mjs',['package-check']);
 run('scripts/make-demo.mjs',['--project',project]);
 run('scripts/travel.mjs',['validate','--project',project]);
 run('scripts/travel.mjs',['build','--project',project]);
 const state=JSON.parse(run('scripts/travel.mjs',['status','--project',project]));assert.equal(state.freshness.build,true);
 const r=spawnSync(process.execPath,['--test',...['core','mcp','intake','route-access'].map(name=>path.join(target,'tests/'+name+'.test.mjs'))],{cwd:root,encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stdout+r.stderr);
 fs.appendFileSync(inside(target,'web/app.js'),'\n// changed after pack');
 assert.equal(verifyPackage(target).valid,false);
 assert.throws(()=>pack(target),/new directory/);
 const manifest=read(inside(target,'MANIFEST.json'));assert.ok(manifest.files.every(x=>!x.file.startsWith('.runtime')));
});
