/** Called after an approved result commit; ordinary Query never invokes this writer. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function recordPublication(root,event){
 const tool=path.join(root,'system/sync/publication-maintenance.mjs'),binding=process.env.KNOWLEDGE_PUBLICATION_CONFIG??path.join(root,'system/sync/publication.local.json');
 if(!fs.existsSync(tool)||!fs.existsSync(binding))return null;
 const child=spawnSync(process.execPath,[tool,'--root',root],{input:JSON.stringify(event),encoding:'utf8',timeout:60000,windowsHide:true,maxBuffer:1024*1024});
 try{return JSON.parse(child.status===0?child.stdout:child.stderr);}catch{return {status:'failed',reason:'publication_review_event_unavailable'};}
}
export function afterReviewedCommit(root,{run:runPath,revision='HEAD',reviewRef,paths=[]}={}){
 try{
  root=fs.realpathSync(root);
  const git=(...a)=>execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'-C',root,...a],{maxBuffer:32*1024*1024});
  const full=rel=>{if(typeof rel!=='string'||path.isAbsolute(rel))throw Error('relative review path required');const p=path.resolve(root,rel);if(!p.startsWith(root+path.sep)||!fs.realpathSync(p).startsWith(root+path.sep))throw Error('review path escapes library');return p;};
  const rev=git('rev-parse','--verify',revision+'^{commit}').toString().trim();
  if(rev!==git('rev-parse','HEAD').toString().trim())throw Error('reviewed commit is not HEAD');
  if(runPath){
   const actual=fs.readFileSync(full(runPath)),committed=git('show',rev+':'+runPath);
   if(actual.toString().replaceAll('\r\n','\n')!==committed.toString().replaceAll('\r\n','\n'))throw Error('run is not committed');
   const run=JSON.parse(actual),f=run.final_review;
   if(run.status!=='completed'||!f||!/^[a-f0-9]{64}$/i.test(f.approved_sha256??'')||f.approved_sha256!==f.sha256)throw Error('exact final approval required');
   if(sha(fs.readFileSync(full(f.path)))!==f.approved_sha256)throw Error('approved report changed');
   const manifestBytes=fs.readFileSync(full(f.content_manifest));if(sha(manifestBytes)!==f.content_manifest_sha256)throw Error('approved manifest changed');
   const manifest=JSON.parse(manifestBytes);
   if(manifest.batch_id!==run.batch_id||manifest.review_sha256!==f.approved_sha256||manifest.review_path!==f.path)throw Error('review identity mismatch');
   paths=manifest.wiki_paths;
   if(!Array.isArray(paths))throw Error('reviewed Wiki scope required');
   for(const p of paths){
    const row=manifest.files.find(x=>x.path===p);if(!row)throw Error('missing Wiki review record');
    if(row.exists===false){if(fs.existsSync(path.resolve(root,p)))throw Error('deleted reviewed Wiki exists');continue;}
    if(sha(fs.readFileSync(full(p)))!==row.sha256)throw Error('reviewed Wiki changed');
   }
   reviewRef=runPath+'#'+f.approved_sha256;
  }else if(typeof reviewRef!=='string'||!reviewRef.trim()||!Array.isArray(paths)||!paths.length){
   throw Error('maintenance needs actual review reference and explicit Wiki paths');
  }
  // These are trusted host arguments, never Query request fields or an approval service.
  const publication=recordPublication(root,{revision:rev,run:runPath??null,reviewRef,paths});
  const result=value=>publication?{...value,publication}:value;
  const bindingPath=process.env.KNOWLEDGE_RETRIEVAL_CONFIG??path.join(root,'system/query/retrieval.local.json');
  if(!fs.existsSync(bindingPath))return result({status:'skipped',reason:'optional_local_binding_absent'});
  const binding=JSON.parse(fs.readFileSync(bindingPath,'utf8'));
  if(binding.maintenance?.enabled!==true)return result({status:'skipped',reason:'maintenance_not_enabled'});
  const tools=path.resolve(path.dirname(bindingPath),binding.tools_root);
  const p=spawnSync(binding.python,['-X','utf8','-B',path.join(tools,'integrations/retrieval/cli.py'),'refresh','--root',root,'--binding',bindingPath,'--revision',rev],{input:JSON.stringify({review_ref:reviewRef,review_paths:paths}),encoding:'utf8',timeout:900000,windowsHide:true,maxBuffer:4*1024*1024});
  if(p.error||p.status!==0)return result({status:'failed',reason:'refresh_unavailable_or_rejected',fallback:'original Query; previous binding retained unless fresh BM25 activated with explicit hybrid limitation'});
  return result(JSON.parse(p.stdout));
 }catch(e){return {status:'failed',reason:e.message,fallback:'original Query; no knowledge or approval edits'};}
}
export function afterCommitEvent(root){
 root=fs.realpathSync(root);
 const git=(...a)=>execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'-C',root,...a],{encoding:'utf8',maxBuffer:4*1024*1024});
 const changed=git('diff-tree','--root','--no-commit-id','--name-only','-r','-z','HEAD').split('\0').filter(Boolean);
 const runs=changed.filter(p=>/^system\/maintenance\/ingest-runs\/.+\/run\.json$/.test(p));
 const results=[];
 for(const run of runs){
  const state=JSON.parse(git('show','HEAD:'+run));
  if(state.status==='completed')results.push(afterReviewedCommit(root,{run}));
 }
 const msg=git('log','-1','--format=%B'),ref=msg.match(/^Knowledge-Review-Ref: (.+)$/m),scope=msg.match(/^Knowledge-Review-Paths: (.+)$/m);
 if(ref&&scope){try{results.push(afterReviewedCommit(root,{reviewRef:ref[1],paths:JSON.parse(scope[1])}));}catch(e){results.push({status:'failed',reason:e.message});}}
 const result={status:results.some(r=>r.status==='failed')?'failed':results.length?'processed':'skipped',event:'post_commit',head:git('rev-parse','HEAD').trim(),results};
 const bp=process.env.KNOWLEDGE_RETRIEVAL_CONFIG??path.join(root,'system/query/retrieval.local.json');
 if(fs.existsSync(bp)){
  const b=JSON.parse(fs.readFileSync(bp,'utf8'));
  if(b.maintenance?.enabled===true&&b.maintenance.versions_root&&results.length){
   const folder=path.resolve(path.dirname(bp),b.maintenance.versions_root,'events');
   if(folder===root||folder.startsWith(root+path.sep))throw Error('event receipt must be outside Knowledge');
   fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,result.head+'-'+crypto.randomUUID()+'.json'),JSON.stringify(result,null,2)+'\n');
  }
 }
 return result;
}
export function installPostCommitHook(root){
 root=fs.realpathSync(root);
 const g=(...a)=>execFileSync('git',['-c','safe.directory='+root.replaceAll('\\','/'),'-C',root,...a],{encoding:'utf8'}).trim();
 const custom=g('config','--get','--default','','core.hooksPath');
 const folder=custom?path.resolve(root,custom):path.resolve(root,g('rev-parse','--git-common-dir'),'hooks');
 const hook=path.join(folder,'post-commit');
 const body='#!/bin/sh\n# knowledge-retrieval-post-commit-v1\nroot=$(git rev-parse --show-toplevel) || exit 0\nif [ -f "$root/system/query/retrieval-maintenance.mjs" ]; then\n  node "$root/system/query/retrieval-maintenance.mjs" --root "$root" --event commit\nfi\n# Post-commit maintenance cannot undo an approved commit. See actual JSON receipt.\nexit 0\n';
 if(fs.existsSync(hook)){
  if(fs.readFileSync(hook,'utf8')===body)return {status:'unchanged',hook};
  return {status:'blocked',reason:'existing_post_commit_hook_preserved',hook,fallback:'use the existing advance callback or chain this event explicitly after reviewing the host hook'};
 }
 fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(hook,body,{flag:'wx',mode:0o755});return {status:'installed',hook};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].slice(2)]=process.argv[i+1];
 const root=args.root??path.resolve(import.meta.dirname,'../..');
 const result=args['install-hook']==='true'?installPostCommitHook(root):args.event==='commit'?afterCommitEvent(root):afterReviewedCommit(root,{run:args.run,revision:args.revision??'HEAD',reviewRef:args['review-ref'],paths:args.paths?JSON.parse(args.paths):[]});
 console.log(JSON.stringify(result));if(result.status==='failed'&&args.event!=='commit')process.exitCode=2;
}
