import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {safe,sha} from './raw-quality.mjs';

export function verifiedCaptureEvidence(root,runDirectory) {
  const runFile=path.resolve(root,runDirectory,'run.json');
  if(!fs.existsSync(runFile))return [];
  const run=JSON.parse(fs.readFileSync(runFile,'utf8'));
  const manifestPaths=new Set();
  for(const artifact of run.artifacts??[]) {
    if(artifact.kind!=='raw'||artifact.disposition!=='ingested')continue;
    const raw=fs.readFileSync(safe(root,artifact.path),'utf8');
    for(const found of raw.matchAll(/Clippings\/_source-captures\/[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+\/manifest\.json/g))
      manifestPaths.add(found[0]);
  }
  const paths=new Set();
  for(const manifestPath of manifestPaths) {
    const dir=path.posix.dirname(manifestPath);
    const manifest=JSON.parse(fs.readFileSync(safe(root,manifestPath),'utf8'));
    if(!/^[a-f0-9]{64}$/i.test(manifest.source_sha256??'')||
       sha(fs.readFileSync(safe(root,dir+'/source.html')))!==manifest.source_sha256)
      throw Error('Source capture manifest drift: '+manifestPath);
    for(const name of ['manifest.json','source.html','body.html','body.txt']) {
      if(!fs.existsSync(safe(root,dir+'/'+name)))throw Error('Incomplete source capture: '+dir+'/'+name);
      paths.add(dir+'/'+name);
    }
    const outOfBody=Array.isArray(manifest.out_of_body_media)?manifest.out_of_body_media:
      (manifest.out_of_body_media?[manifest.out_of_body_media]:[]);
    for(const media of [...(manifest.images??[]),...outOfBody]) {
      if(media.status&&media.status!=='downloaded')continue;
      const rel=dir+'/'+media.path;
      if(!/^[a-f0-9]{64}$/i.test(media.sha256??'')||sha(fs.readFileSync(safe(root,rel)))!==media.sha256)
        throw Error('Source capture media drift: '+rel);
      paths.add(rel);
    }
  }
  const disk=new Set();
  for(const manifestPath of manifestPaths) {
    const dir=path.posix.dirname(manifestPath);
    for(const name of fs.readdirSync(path.dirname(safe(root,manifestPath)))) {
      if(fs.statSync(safe(root,dir+'/'+name)).isFile())disk.add(dir+'/'+name);
    }
  }
  if(disk.size!==paths.size||[...disk].some(p=>!paths.has(p)))
    throw Error('Unmanifested file in source capture directories');
  if(paths.size) {
    const admissionPath=path.resolve(root,runDirectory,'capture-admission.json');
    if(!fs.existsSync(admissionPath))throw Error('Source capture admission missing');
    const admission=JSON.parse(fs.readFileSync(admissionPath,'utf8'));
    if(admission.schema_version!==1||admission.kind!=='source_capture_admission'||
       admission.batch_id!==run.batch_id||!Array.isArray(admission.files)||
       admission.files.length!==paths.size)
      throw Error('Source capture admission identity mismatch');
    const seen=new Set();
    for(const item of admission.files) {
      if(!paths.has(item.path)||seen.has(item.path)||!(/^[a-f0-9]{64}$/i.test(item.sha256??''))||
         item.bytes!==fs.statSync(safe(root,item.path)).size||
         sha(fs.readFileSync(safe(root,item.path)))!==item.sha256||
         item.manifest!==path.posix.join(path.posix.dirname(item.path),'manifest.json'))
        throw Error('Source capture admission drift: '+item.path);
      seen.add(item.path);
    }
  }
  return [...paths].sort();
}

// Immutable evidence is checked as bytes, not reformatted as authored Markdown.
// Content coverage records actual Git blobs, never a worktree-only PASS.
export function maintenanceScope(root,{base,revision,staged=false,runDirectory}) {
  const git=(...a)=>execFileSync('git',['-C',root,'-c','safe.directory='+root.replaceAll('\\','/'),...a],{stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});
  const range=staged?['--cached',base]:[base,revision];
  if(!base||(!staged&&!revision))throw Error('Explicit baseline and revision/staged required');
  const local=path.relative(path.resolve(root),path.resolve(root,runDirectory)).replaceAll('\\','/');
  if(!/^system\/maintenance\/ingest-runs\/[^/]+$/.test(local))throw Error('Run directory required');
  const paths=git('diff','--name-only','-z',...range,'--').toString('utf8').split('\0').filter(Boolean);
  const capturePaths=new Set(paths.some(p=>p.startsWith('Clippings/_source-captures/'))?
    verifiedCaptureEvidence(root,local):[]);
  if(paths.some(p=>p.startsWith('Clippings/_source-captures/')&&!capturePaths.has(p)))
    throw Error('Changed source capture has no verified batch manifest');
  const snapshots=[],coverage=[],excludes=[':(exclude).obsidian/workspace.json',':(exclude)system/maintenance/ingest-runs/**/semantic-reviews/**/actual.diff'];
  for(const p of paths) {
    const spec=staged?':'+p:revision+':'+p;
    let blob=null;try{blob=git('rev-parse','--verify',spec).toString().trim();}catch{}
    const match=p.match(/^system\/maintenance\/ingest-runs\/[^/]+\/evidence\/([a-f0-9]{64})\.md$/);
    if(match && blob) {
      if(sha(git('show',spec))!==match[1])throw Error('Evidence snapshot hash mismatch: '+p);
      snapshots.push(p);excludes.push(':(exclude,literal)'+p);
    }
    // Public source captures retain upstream HTML bytes, including upstream whitespace.
    // Their blob identity remains in coverage and is rechecked at the checkpoint.
    if(capturePaths.has(p)&&p.endsWith('/source.html'))excludes.push(':(exclude,literal)'+p);
    // Run-local package/receipt finalization is checked again at checkpoint;
    // substantive content outside that directory must match maintenance inputs.
    if(!p.startsWith(local+'/') && p!=='.obsidian/workspace.json')coverage.push({path:p,blob});
  }
  try{git('diff','--check',...range,'--','.',...excludes);}
  catch(e){throw Error('Authored diff check failed: '+(e.stdout?.toString()??e.message));}
  return {schema_version:1,base,run_directory:local,coverage,snapshots,verified_source_captures:[...capturePaths],status:'passed'};
}
export function verifyScope(root,receipt,revision) {
  const old=receipt.validation_scope;
  if(!old||old.schema_version!==1||receipt.status!=='passed')throw Error('Passed maintenance coverage receipt required');
  const current=maintenanceScope(root,{base:old.base,revision,runDirectory:old.run_directory});
  if(JSON.stringify(current.coverage)!==JSON.stringify(old.coverage))throw Error('Maintenance content coverage changed; rerun maintenance for final staged content');
  return current;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];
    const result=a.captureEvidence==='true'?verifiedCaptureEvidence(a.root,a.runDirectory):
      a.receipt?verifyScope(a.root,JSON.parse(fs.readFileSync(safe(a.root,a.receipt),'utf8').replace(/^\uFEFF/,'')),a.revision):
      maintenanceScope(a.root,{base:a.base,revision:a.revision,staged:a.staged==='true',runDirectory:a.runDirectory});
    console.log(JSON.stringify(result));
  }catch(e){console.error(e.message);process.exitCode=2;}
}
