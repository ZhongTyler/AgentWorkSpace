import test from 'node:test';
import assert from 'node:assert/strict';
import {safeContentPath,validContentAccess} from './content-policy.mjs';
import {safeContentPath as clientPath,validContentAccess as clientAccess} from './clients.mjs';

test('clients use the same dependency-free content policy',()=>{
 assert.equal(clientPath,safeContentPath);assert.equal(clientAccess,validContentAccess);
});

test('research diagrams remain query assets while originals require a private evidence role',()=>{
 for(const name of ['chapter.md','notes.txt','diagram.svg','frame.png','paper.pdf']){
  const path='research-reports/report/'+name;
  assert.equal(safeContentPath(path),true);assert.equal(validContentAccess({path}),true);
  assert.equal(validContentAccess({path,access:'query'}),true);
 }
 for(const name of ['source.json','reader.html','source.js','source.mjs','check.cjs','style.css','style.scss','source.hx','source.lua','source.py','source.xml','release.zip','LICENSE','capture.mp4','capture.webm','capture.mov','capture.m4v','audio.mp3','audio.ogg','audio.wav','audio.m4a','audio.flac']){
  const path='research-reports/report/'+name;
  assert.equal(safeContentPath(path),true,name);
  assert.equal(validContentAccess({path,access:'private_evidence'}),true,name);
  for(const access of [undefined,'query','public'])assert.equal(validContentAccess({path,access}),false,name);
 }
});

test('Group receipt admission is a precise path shape with a mandatory private role',()=>{
 const path='docs/audits/raw-fidelity-20261013/full-b257-group-puzzle-design.adjudication.json';
 assert.equal(safeContentPath(path),true);assert.equal(validContentAccess({path,access:'private_evidence'}),true);
 for(const access of [undefined,'query','public'])assert.equal(validContentAccess({path,access}),false);
 for(const path of ['docs/audits/raw-fidelity-20261013/credentials.json','docs/audits/raw-fidelity-20261013/full-b257-group-puzzle-design.json','docs/audits/other/full-b257-group-puzzle-design.adjudication.json','docs/audits/raw-fidelity-20261013/full-b257-group-.adjudication.json','wiki/code.js','wiki/diagram.svg','wiki/receipt.json','.env','private/key.pem'])assert.equal(safeContentPath(path),false,path);
 for(const row of [null,{}, {path:'research-reports/../secret.txt',access:'private_evidence'}])assert.equal(validContentAccess(row),false);
});
test('the two accepted source names retain their literal percent characters',()=>{
 for(const p of ['raw-sources/90%功能不该做-小鱼先森-20250827.md','raw-sources/抄玩法死得快：90%卡牌商业化网络游戏败在哪里？-车尔斯基的游戏运营杂谈-20260220.md'])assert.equal(safeContentPath(p),true,p);
});
test('literal percent does not become URL decoding or traversal permission',()=>{
 for(const p of ['raw-sources/90%.md','wiki/%2.md','wiki/%A_.md','wiki/%2g.md'])assert.equal(safeContentPath(p),true,p);
 for(const escape of ['%2f','%2F','%2e','%2E','%25','%252f','%252e','%20','%00','%5c','%5C','%c0%af','%%32'])assert.equal(safeContentPath('wiki/'+escape+'source.md'),false,escape);
 for(const p of ['/wiki/a.md','wiki/../secret.md','wiki/./a.md','wiki//a.md','wiki/a\\b.md','wiki/C:secret.md','wiki/a\0.md'])assert.equal(safeContentPath(p),false,p);
});
test('all hex byte escapes are rejected in both cases; no decoding step is used',()=>{
 for(let n=0;n<256;n++)for(const hex of [n.toString(16).padStart(2,'0'),n.toString(16).padStart(2,'0').toUpperCase()])assert.equal(safeContentPath('wiki/%'+hex+'.md'),false,hex);
});
