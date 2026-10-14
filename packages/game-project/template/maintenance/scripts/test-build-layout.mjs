import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {checkBuildLayout} from './check-build-layout.mjs';

function fixture(run) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godot-build-layout-'));
  const write=(p,text='fixture')=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),text);};
  const c={schema_version:1,root_launcher:'play.cmd',current_release:null,current_executable:null,preview_directory:'maintenance/previews',packages_directory:'builds/windows/packages',packs_directory:'builds/windows/packs',archive_directory:'builds/windows/archive'};
  const save=()=>write('builds/windows/layout.json',JSON.stringify(c));
  for(const key of ['preview_directory','packages_directory','packs_directory','archive_directory'])write(c[key]+'/README.md');
  save();
  try { run({root,write,c,save}); }
  finally { fs.rmSync(root,{recursive:true,force:true}); }
}
test('empty template requires no game or launcher',()=>fixture(({root})=>assert.deepEqual(checkBuildLayout(root),[])));
test('generic current identity routes without a local generated package',()=>fixture(({root,write,c,save})=>{
  c.current_release='MyGame-v1';c.current_executable='MyGame.exe';save();
  write('play.cmd','call "%~dp0builds\\windows\\play.cmd"');
  write('builds/windows/play.cmd','"%~dp0packages\\MyGame-v1\\MyGame.exe"');
  assert.deepEqual(checkBuildLayout(root),[]);
}));
test('reject scattered previews and flat packs',()=>fixture(({root,write})=>{
  write('preview.cmd');write('builds/windows/test.pck');assert.equal(checkBuildLayout(root).length,2);
}));
test('reject fake entrypoint before first release',()=>fixture(({root,write})=>{
  write('play.cmd');assert.match(checkBuildLayout(root).join(),/without a current release/);
}));
test('reject missing README and tampered route',()=>fixture(({root,c,save})=>{
  fs.unlinkSync(path.join(root,'maintenance/previews/README.md'));c.packs_directory='../outside';save();assert.equal(checkBuildLayout(root).length,2);
}));
test('reject incomplete, unsafe or stale current identities',()=>fixture(({root,c,save,write})=>{
  c.current_release='../escape';c.current_executable='Game.exe';save();assert.match(checkBuildLayout(root).join(),/invalid current/);
  c.current_release='Game-v1';c.current_executable=null;save();assert.match(checkBuildLayout(root).join(),/invalid current/);
  c.current_executable='Game.exe';save();write('play.cmd','wrong');write('builds/windows/play.cmd','old');assert.equal(checkBuildLayout(root).length,2);
}));
