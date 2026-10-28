import fs from 'node:fs';
import path from 'node:path';
import {safe,sha} from './raw-quality.mjs';

export const executionProfile='consolidated-v1';
export const consolidated=run=>run.execution_control?.execution_profile===executionProfile;
export function readJson(root,p){return JSON.parse(fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,''));}
export function writeJson(root,p,value){
  const full=safe(root,p,false),bytes=JSON.stringify(value,null,2)+'\n';
  if(fs.existsSync(full)&&fs.readFileSync(full,'utf8')===bytes)return false;
  fs.mkdirSync(path.dirname(full),{recursive:true});
  const tmp=full+'.pending';safe(root,tmp,false);
  fs.writeFileSync(tmp,bytes);fs.renameSync(tmp,full);return true;
}
export function ownedPaths(root,runPath,semantic={}){
  const run=readJson(root,runPath),directory=path.dirname(safe(root,runPath))+path.sep;
  const paths=new Set([runPath,...(semantic.rows??[]).map(r=>r.artifact)]),visited=new Set();
  const visit=value=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(value&&typeof value==='object'){Object.values(value).forEach(visit);return;}
    if(typeof value!=='string'||!value.startsWith(path.relative(root,directory).split(path.sep).join('/')+'/'))return;
    let full;try{full=safe(root,value,false);}catch{return;}
    if(!full.startsWith(directory)||!fs.existsSync(full)||!fs.statSync(full).isFile()||visited.has(full))return;
    visited.add(full);paths.add(path.relative(root,full).split(path.sep).join('/'));
    if(full.endsWith('.json'))visit(readJson(root,full));
  };
  visit(run);visit(semantic);
  return [...paths].filter(p=>typeof p==='string'&&fs.existsSync(safe(root,p,false))).sort();
}
export function inputIdentity(root,paths){
  return sha(JSON.stringify([...new Set(paths)].sort().map(p=>[p,fs.existsSync(safe(root,p,false))?sha(fs.readFileSync(safe(root,p))):null])));
}
