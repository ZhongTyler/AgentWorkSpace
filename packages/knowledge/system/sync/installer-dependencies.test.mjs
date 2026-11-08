import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {verifyRuntimeClosure} from './runtime-closure.mjs';

const sourceRoot=path.resolve(import.meta.dirname,'../..');
const toolsRoot=process.env.KNOWLEDGE_SYNC_TOOLS??path.resolve(sourceRoot,'../Tools');
function runtimeFiles(){
 const installer=fs.readFileSync(new URL('./install-local.ps1',import.meta.url),'utf8');
 const selected=name=>{
  const declarations=[...installer.matchAll(new RegExp('\\$'+name+'=@\\(([^)]*)\\)','g'))];
  assert.equal(declarations.length,1,'The installer owns one '+name+' list');
  return [...declarations[0][1].matchAll(/'([^']+)'/g)].map(match=>match[1]);
 };
 return [...selected('runtimeFiles').map(file=>'system/sync/'+file),...selected('integrationFiles').map(file=>'system/integrations/'+file)];
}

test('normal installer verifies source and actual flat layout including dynamic package dependencies',async t=>{
 const files=runtimeFiles(),flat=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-install-closure-'));
 t.after(()=>fs.rmSync(flat,{recursive:true,force:true}));
 const source=await verifyRuntimeClosure({sourceRoot,files,toolsRoot});
 assert.equal(source.files.length,files.length);assert.equal(source.writes,0);
 assert(source.edges.some(edge=>edge.from==='query-package-sync.mjs'&&edge.to==='query-package-local.mjs'));
 for(const file of files)fs.copyFileSync(path.join(sourceRoot,file),path.join(flat,path.basename(file)));
 const installed=await verifyRuntimeClosure({sourceRoot:flat,files,toolsRoot,layout:'installed'});
 assert.deepEqual(installed.files,source.files);assert.equal(installed.importsVerified,true);
 fs.unlinkSync(path.join(flat,'schema-check.mjs'));
 await assert.rejects(verifyRuntimeClosure({sourceRoot:flat,files,toolsRoot,layout:'installed'}),{code:'ENOENT'});
});

test('omitted relative dependencies and package contract fail closure verification',async()=>{
 const files=runtimeFiles();
 await assert.rejects(verifyRuntimeClosure({sourceRoot,files:files.filter(file=>!file.endsWith('/schema-check.mjs')),toolsRoot}),/Missing installed dependency/);
 await assert.rejects(verifyRuntimeClosure({sourceRoot,files:files.filter(file=>!file.endsWith('/query-package.mjs')),toolsRoot}),/Missing installed dependency/);
});
