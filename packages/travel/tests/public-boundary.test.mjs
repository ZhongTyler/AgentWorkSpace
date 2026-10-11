import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bundleFiles,pack,packageCheck} from '../scripts/lib/package.mjs';

test('public traversal never enters sibling profiles, trips or unknown directories',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-boundary-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'README.md'),'# public');
 for(const name of ['偏好','a-real-trip','小红书MCP']){
   fs.mkdirSync(path.join(root,name));
   fs.writeFileSync(path.join(root,name,'private.txt'),'PRIVATE-CANARY');
   // A dangling link would throw if files() entered this private folder.
   fs.symlinkSync(path.join(root,'absent'),path.join(root,name,'never-read'),'junction');
 }
 assert.deepEqual(bundleFiles(root),[path.join(root,'README.md')]);
});

test('copied workflow contains no profile or real trip and rejects a private documentation link',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-public-copy-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const out=path.join(root,'workflow');pack(out);
 for(const p of ['偏好','挪威瑞典','圣灵群岛','旅行攻略工作流','小红书MCP','.tmp'])assert.equal(fs.existsSync(path.join(out,p)),false,p);
 fs.mkdirSync(path.join(out,'偏好'));fs.writeFileSync(path.join(out,'偏好','someone.md'),'private');
 fs.appendFileSync(path.join(out,'README.md'),'\n[leak](偏好/someone.md)\n');
 assert.ok(packageCheck(out).errors.some(e=>e.includes('private/external local link')));
});
