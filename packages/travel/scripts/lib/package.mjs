import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { ROOT, VERSION, files, inside, hash, write, read } from './core.mjs';

export const publicRoots=Object.freeze(['README.md','AGENTS.md','SKILL.md','00-全流程与事实分工.md','package.json','.gitignore','.gitattributes','THIRD_PARTY.md','LICENSE','LICENSE-NOTICE.md','scripts','web','skills','运行','流程','模板','examples','tests','schemas']);
function packageBytes(file){
  const bytes=fs.readFileSync(file);
  return /\.(md|json|mjs|js|css|html|txt)$/.test(file)||['LICENSE','.gitignore','.gitattributes'].includes(path.basename(file))?Buffer.from(bytes.toString('utf8').replaceAll('\r\n','\n')):bytes;
}
export function bundleFiles(root=ROOT){
  // Select before traversing. Sibling trips, profiles and runtime directories must never be read.
  return publicRoots.flatMap(relative=>{
    const full=inside(root,relative);
    if(!fs.existsSync(full))return [];
    return fs.statSync(full).isDirectory()?files(full):[full];
  });
}
export function packageCheck(root=ROOT){
  const errors=[],all=bundleFiles(root),required=['AGENTS.md','SKILL.md','运行/快速开始.md','运行/角色与步骤.md','运行/小红书安装与登录.md','运行/数据合同.md','运行/品质复现与验收.md','运行/视觉层级与全量巡检.md','skills/travel-presentation/SKILL.md','scripts/lib/quality.mjs','scripts/travel.mjs','scripts/browser-audit.mjs','scripts/frontend.mjs','模板/前端组件合同.json','examples/frontend/fixtures.json','examples/frontend/template.html','web/app.js','web/editorial.css','web/hierarchy.css','tests/core.test.mjs','tests/frontend-contract.test.mjs'];
  for(const p of required)if(!fs.existsSync(path.join(root,p)))errors.push('Missing '+p);
  for(const file of all){
    const rel=path.relative(root,file).replaceAll(path.sep,'/');
    if(!/\.(md|json|mjs|js|css|html)$/.test(file))continue;
    const text=fs.readFileSync(file,'utf8');
    if(/(?<![\\\w])[A-Z]:[\\/]/i.test(text)&&!rel.startsWith('tests/'))errors.push(rel+': machine-specific path');
    if(file.endsWith('.md'))for(const m of text.matchAll(/!?\[[^\]]*\]\(([^)\n]+)\)/g)){
      let target=m[1].replace(/^<|>$/g,'').split('#')[0];
      if(!target||/^(https?:|mailto:|data:)/.test(target))continue;
      try{target=decodeURIComponent(target);const full=path.resolve(path.dirname(file),target);
        if(!all.some(f=>f===full||f.startsWith(full+path.sep)))errors.push(rel+': missing/private/external local link '+target);
      }catch{errors.push(rel+': bad link '+target);}
    }
    if(/\.(mjs|js)$/.test(file)){
      const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8',windowsHide:true});
      if(result.status!==0)errors.push(rel+': syntax '+result.stderr);
    }
  }
  return {valid:!errors.length,files:all.length,errors};
}
export function pack(target,root=ROOT){
  const check=packageCheck(root);if(!check.valid)throw Error(check.errors.join('\n'));
  const out=path.resolve(target),base=path.resolve(root);
  if(out===base||out.startsWith(base+path.sep)||fs.existsSync(out))throw Error('Pack needs a new directory outside package');
  // inside also validates parent junctions before creating the target.
  inside(path.dirname(out),path.basename(out));
  return copyPackage(out,root);
}
function copyPackage(out,root){
  fs.mkdirSync(out,{recursive:true});
  const entries=[];
  for(const source of bundleFiles(root)){
    const rel=path.relative(root,source).replaceAll(path.sep,'/'),bytes=packageBytes(source);
    write(inside(out,rel),bytes,{exclusive:true});entries.push({file:rel,sha256:hash(bytes),bytes:bytes.length});
  }
  write(inside(out,'MANIFEST.json'),{name:'portable-travel-workflow',version:VERSION,files:entries},{exclusive:true});
  return {directory:out,files:entries.length,...verifyPackage(out)};
}
export function verifyPackage(root){
  const manifest=read(inside(root,'MANIFEST.json')),errors=[],seen=new Set();
  for(const entry of manifest.files){
    if(seen.has(entry.file))errors.push('Duplicate manifest entry '+entry.file);seen.add(entry.file);
    const full=inside(root,entry.file);
    if(!fs.existsSync(full)||hash(fs.readFileSync(full))!==entry.sha256)errors.push('Fingerprint mismatch '+entry.file);
  }
  const visit=relative=>{
    const dir=relative?inside(root,relative):path.resolve(root);
    for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
      const rel=relative?relative+'/'+entry.name:entry.name;
      try{inside(root,rel);}catch(e){errors.push(e.message);continue;}
      if(entry.isDirectory()){
        if(![...seen].some(p=>p.startsWith(rel+'/')))errors.push('Unmanifested package directory '+rel);
        else visit(rel);
      }else if(rel!=='MANIFEST.json'&&!seen.has(rel))errors.push('Unmanifested package file '+rel);
    }
  };
  visit('');
  return {valid:!errors.length,errors};
}
export function installSkill(workspace){
  return pack(inside(path.resolve(workspace),'.agents/skills/travel-workflow'));
}
// Released is an owned generated snapshot, never an arbitrary directory to overwrite.
function releaseInventory(root){
  const manifest=read(inside(root,'MANIFEST.json')),check=verifyPackage(root);
  if(manifest.name!=='portable-travel-workflow'||!check.valid)throw Error('Released was modified or is not owned: '+check.errors.join('; '));
  return manifest;
}
export function release({apply=false,out:destination}={},root=ROOT){
  const check=packageCheck(root);if(!check.valid)throw Error(check.errors.join('\n'));
  const base=path.resolve(root),out=destination?path.resolve(destination):inside(root,'released');
  // A sibling snapshot is allowed; the source or an ancestor must never be replaced.
  if(out===base||base.startsWith(out+path.sep)||out===path.parse(out).root)throw Error('Release output must not replace source or an ancestor');
  inside(path.dirname(out),path.basename(out));
  if(out.startsWith(base+path.sep)&&out!==inside(root,'released'))throw Error('Release inside source is only allowed at released');
  const entries=bundleFiles(root).map(f=>{const bytes=packageBytes(f);return {file:path.relative(root,f).replaceAll(path.sep,'/'),sha256:hash(bytes),bytes:bytes.length};});
  const desired={name:'portable-travel-workflow',version:VERSION,files:entries};
  const previous=fs.existsSync(out)?releaseInventory(out):null;
  const before=new Map((previous?.files??[]).map(e=>[e.file,e.sha256])),after=new Map(entries.map(e=>[e.file,e.sha256]));
  const diff={added:entries.filter(e=>!before.has(e.file)).map(e=>e.file),modified:entries.filter(e=>before.has(e.file)&&before.get(e.file)!==e.sha256).map(e=>e.file),removed:[...before.keys()].filter(f=>!after.has(f))};
  const changed=!previous||JSON.stringify(previous)!==JSON.stringify(desired);
  if(!apply||!changed)return {directory:out,applied:false,changed,...diff};
  const id=randomUUID(),stage=inside(root,'.runtime/release-stage-'+id);
  copyPackage(stage,root);
  if(JSON.stringify(read(inside(stage,'MANIFEST.json')))!==JSON.stringify(desired))throw Error('Source changed during release; staging preserved, retry after review');
  let backup=null;
  if(previous){
    if(JSON.stringify(releaseInventory(out))!==JSON.stringify(previous))throw Error('Released changed during update; staging preserved');
    backup=inside(root,'.runtime/release-backups/'+id);fs.mkdirSync(path.dirname(backup),{recursive:true});fs.renameSync(out,backup);
  }
  try{fs.renameSync(stage,out);}catch(e){if(backup&&!fs.existsSync(out))fs.renameSync(backup,out);throw e;}
  return {directory:out,applied:true,changed,backup,...diff,...verifyPackage(out)};
}
export function doctor(){
  const command=name=>{const r=spawnSync(name,['--version'],{encoding:'utf8',windowsHide:true});return {available:r.status===0,version:r.status===0?(r.stdout||r.stderr).split(/\r?\n/)[0]:null};};
  return {node:{version:process.version,supported:+process.versions.node.split('.')[0]>=22},platform:process.platform,arch:process.arch,tar:command('tar'),git:command('git'),coreNeedsNpmInstall:false,optional:['Xiaohongshu native service + its managed browser + human account login','Playwright/browser for screenshots and browser smoke','Server and deployment adapter only if explicitly chosen']};
}
