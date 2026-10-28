/** Explicit local catalog maintenance, never invoked during lookup or Ingest. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {defaultRoot} from '../query/query-evidence.mjs';
import {localResearchOptions} from './research-reports-host.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export function acceptDossier({root=defaultRoot,bindings={},binding='research',manifest,python,title,aliases,expectedId}={}){
 if(!python||!path.isAbsolute(python))throw Error('Explicit absolute Python executable required');
 const bindingRoot=fs.realpathSync(bindings[binding]),manifestFile=fs.realpathSync(path.resolve(bindingRoot,manifest)),relative=path.relative(bindingRoot,manifestFile);
 if(path.isAbsolute(relative)||relative==='..'||relative.startsWith('..'+path.sep))throw Error('Manifest outside binding');
 const bytes=fs.readFileSync(manifestFile),m=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 if(!/^[a-z0-9-]+$/.test(m.dossier_id)||expectedId&&m.dossier_id!==expectedId)throw Error('Unexpected dossier identity');
 const tool=path.join(bindingRoot,'game-research/deep-game-analysis/dossier.py');
 const check=spawnSync(python,['-B',tool,'check','--manifest',manifestFile],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024,windowsHide:true});
 if(check.error||check.status!==0)throw Error('Original dossier check failed: '+(check.error?.message??check.stdout??check.stderr));
 const result=JSON.parse(check.stdout);
 if(result.status!=='pass')throw Error('Original dossier check did not pass');
 if(sha(fs.readFileSync(manifestFile))!==sha(bytes))throw Error('Manifest changed during acceptance');
 const catalogPath=path.join(root,'research-reports/catalog.json'),old=fs.existsSync(catalogPath)?fs.readFileSync(catalogPath):null;
 const catalog=old?JSON.parse(old.toString('utf8')):{schema_version:1,reports:[]};
 if(catalog.schema_version!==1||!Array.isArray(catalog.reports))throw Error('Invalid current catalog');
 const previous=catalog.reports.find(r=>r.id===m.dossier_id);
 const entry={...previous,id:m.dossier_id,title:title??previous?.title??m.game_title,aliases:aliases??previous?.aliases??[],format:'research-dossier-v1',binding,manifest:relative.replaceAll('\\','/'),manifest_sha256:sha(bytes),status:'active',visibility:'local-owner',owner:'Research',acceptance:{kind:'original_dossier_check',status:'pass',checked_at:new Date().toISOString(),checker_sha256:sha(fs.readFileSync(tool)),scope:'Original mechanical provenance check; local lookup only, not semantic approval or public permission',counts:result.counts}};
 catalog.reports=catalog.reports.filter(r=>r.id!==entry.id).concat(entry);
 fs.mkdirSync(path.dirname(catalogPath),{recursive:true});
 const temporary=catalogPath+'.'+crypto.randomUUID()+'.tmp';
 try{
  fs.writeFileSync(temporary,JSON.stringify(catalog,null,2)+'\n',{flag:'wx'});
  const current=fs.existsSync(catalogPath)?fs.readFileSync(catalogPath):null;
  if((old===null)!==(current===null)||old&&sha(old)!==sha(current))throw Error('Catalog changed during acceptance');
  fs.renameSync(temporary,catalogPath);
 }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
 return {status:'accepted_local',id:entry.id,manifest_sha256:entry.manifest_sha256,check:result,public_release:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const options={};
  for(let i=2;i<process.argv.length;i+=2){const key={'--root':'root','--manifest':'manifest','--binding':'binding','--python':'python','--id':'expectedId'}[process.argv[i]];if(!key||!process.argv[i+1])throw Error('Usage: --manifest <binding-relative path> --python <absolute executable> [--root ...] [--binding research] [--id ...]');options[key]=process.argv[i+1];}
  if(!options.manifest)throw Error('--manifest is required');
  console.log(JSON.stringify(acceptDossier({...localResearchOptions(options.root),...options})));
 }catch(e){console.error(JSON.stringify({status:'not_accepted',reason:e.message}));process.exitCode=2;}
}
