import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pack,release,verifyPackage} from '../scripts/lib/package.mjs';
import {read,hash} from '../scripts/lib/core.mjs';

function fixture(t){
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'travel-release-'));
 t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const root=path.join(parent,'workflow');pack(root);return root;
}
test('release previews, creates, no-ops and keeps the previous snapshot on update',t=>{
 const root=fixture(t),out=path.join(root,'released');
 fs.mkdirSync(path.join(root,'偏好'));fs.writeFileSync(path.join(root,'偏好','private.md'),'PRIVATE_CANARY');
 fs.mkdirSync(path.join(root,'复盘'));fs.writeFileSync(path.join(root,'复盘','private.md'),'PRIVATE_CANARY');
 assert.equal(release({},root).changed,true);assert.equal(fs.existsSync(out),false);
 assert.equal(release({apply:true},root).valid,true);
 assert.equal(release({apply:true},root).changed,false);
 fs.writeFileSync(path.join(root,'README.md'),fs.readFileSync(path.join(root,'README.md'),'utf8').replaceAll('\n','\r\n'));
 assert.equal(release({},root).changed,false,'line ending alone must not drift a snapshot');
 assert.ok(read(path.join(out,'MANIFEST.json')).files.every(e=>!e.file.startsWith('偏好/')&&!e.file.startsWith('复盘/')&&!e.file.startsWith('released/')));
 const old=fs.readFileSync(path.join(out,'README.md'),'utf8');
 fs.appendFileSync(path.join(root,'README.md'),'\nA source update.\n');
 assert.deepEqual(release({},root).modified,['README.md']);
 const result=release({apply:true},root);
 assert.equal(result.valid,true);assert.equal(fs.readFileSync(path.join(result.backup,'README.md'),'utf8'),old);
 assert.equal(release({},root).changed,false);
});
test('release supports a sibling snapshot and protects source, ancestors and source subfolders',t=>{
 const root=fixture(t),out=path.join(path.dirname(root),'released');
 assert.equal(release({out},root).directory,out);
 assert.equal(fs.existsSync(out),false);
 assert.equal(release({out,apply:true},root).valid,true);
 assert.equal(release({out,apply:true},root).changed,false);
 fs.appendFileSync(path.join(root,'README.md'),'\nSource update.\n');
 const result=release({out,apply:true},root);
 assert.equal(result.valid,true);assert.ok(fs.existsSync(result.backup));
 for(const unsafe of [root,path.dirname(root),path.join(root,'scripts')]){
  assert.throws(()=>release({out:unsafe,apply:true},root),/source|ancestor/);
 }
 assert.ok(fs.existsSync(path.join(root,'scripts','travel.mjs')));
});
test('manifest bytes survive Git staging with Windows autocrlf enabled',t=>{
 const root=fixture(t),parent=path.dirname(root);
 const git=args=>{const r=spawnSync('git',['-c','safe.directory='+parent,'-c','core.autocrlf=true','-C',parent,...args],{encoding:null,windowsHide:true});assert.equal(r.status,0,String(r.stderr));return r.stdout;};
 git(['init','--quiet']);git(['add','--','workflow']);
 for(const entry of read(path.join(root,'MANIFEST.json')).files){
  assert.equal(hash(git(['show',':workflow/'+entry.file])),entry.sha256,entry.file);
 }
});
test('release refuses edited or unowned output, without changing its contents',t=>{
 const root=fixture(t),out=path.join(root,'released');release({apply:true},root);
 fs.writeFileSync(path.join(out,'personal.txt'),'keep me');
 assert.equal(verifyPackage(out).valid,false);
 assert.throws(()=>release({apply:true},root),/modified|owned/);
 assert.equal(fs.readFileSync(path.join(out,'personal.txt'),'utf8'),'keep me');
 fs.unlinkSync(path.join(out,'personal.txt'));
 fs.appendFileSync(path.join(out,'README.md'),'\nmanual edit');
 assert.throws(()=>release({apply:true},root),/modified|owned/);
 assert.match(fs.readFileSync(path.join(out,'README.md'),'utf8'),/manual edit$/);
});
test('release refuses foreign directories and junctions instead of following them',t=>{
 const root=fixture(t),out=path.join(root,'released');release({apply:true},root);
 const extra=path.join(out,'unexpected');fs.mkdirSync(extra);
 assert.throws(()=>release({apply:true},root),/modified|owned/);fs.rmdirSync(extra);
 const external=path.join(path.dirname(root),'external');fs.mkdirSync(external);
 fs.symlinkSync(external,extra,process.platform==='win32'?'junction':'dir');
 assert.throws(()=>release({apply:true},root),/modified|owned|Symlink/);
 assert.equal(fs.existsSync(external),true);
});
