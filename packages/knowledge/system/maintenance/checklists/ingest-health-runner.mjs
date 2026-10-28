// Transport large exact changed-path lists to the existing read-only health core.
// The health rules and their result/exit semantics remain in knowledge-health.mjs.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runHealth} from './knowledge-health.mjs';

function inside(root,relative){
  if(typeof relative!=='string'||!relative||relative.includes('\0')||
     path.isAbsolute(relative)||path.win32.isAbsolute(relative)||/^[A-Za-z]:/.test(relative)||relative.includes('\\')||
     relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Invalid health input path');
  const full=path.resolve(root,relative);
  if(!full.startsWith(root+path.sep)||!fs.existsSync(full)||fs.realpathSync(full)!==full)
    throw Error('Health input outside or linked from Knowledge');
  return full;
}

export function readChanged(root,relative){
  const value=JSON.parse(fs.readFileSync(inside(root,relative),'utf8'));
  if(!Array.isArray(value)||new Set(value).size!==value.length||
     value.some(p=>typeof p!=='string'||!p||p.includes('\0')||p.includes('\\')||
       path.posix.isAbsolute(p)||path.win32.isAbsolute(p)||/^[A-Za-z]:/.test(p)||
       p.split('/').some(x=>!x||x==='.'||x==='..')))
    throw Error('Invalid or duplicated health changed-path list');
  return value;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?null:args[i+1];};
    const root=fs.realpathSync(value('--root')??path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..'));
    const changedFile=value('--changed-file');
    if(!changedFile)throw Error('Health changed-path file is required');
    const previous=value('--previous')?JSON.parse(fs.readFileSync(inside(root,value('--previous')),'utf8')):null;
    const report=runHealth({root,scope:value('--scope')??'affected',previous,changed:readChanged(root,changedFile)});
    console.log(JSON.stringify(report,null,2));
    process.exitCode=report.status==='incomplete'?3:report.status==='issues_found'?2:0;
  }catch(error){console.error('INGEST_HEALTH_RUNNER_FAILED: '+error.message);process.exitCode=3;}
}
