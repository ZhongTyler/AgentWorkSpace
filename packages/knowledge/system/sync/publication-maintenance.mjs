/** Approved Git events produce scope; the existing publisher compiles under its own lock. */
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
import {gitBytes,committedFiles,readBlobs,preparePublication} from './snapshot-admission.mjs';
import {safeContentPath,acceptedManifest} from './clients.mjs';
import {canonical,hash,atomicJson,readJson,ensurePrivateHome,withLock,requireValue as ok} from './state.mjs';
const scopes=['wiki','raw-sources','domains','groups','domain-groups','Clippings','assets','attachments'];
const relative=p=>typeof p==='string'&&!path.isAbsolute(p)&&!/[\\:\x00-\x1f]/.test(p)&&!p.split('/').some(x=>!x||x==='.'||x==='..');
const inside=(root,p)=>path.isAbsolute(p)&&path.resolve(p).startsWith(path.resolve(root)+path.sep);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const bindingFile=root=>process.env.KNOWLEDGE_PUBLICATION_CONFIG??path.join(root,'system/sync/publication.local.json');
function boundedJson(file,max=4*1024*1024){const s=fs.lstatSync(file);ok(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'unsafe_publication_metadata');return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));}
function binding(value){const b=typeof value==='string'?boundedJson(value):value;ok(b?.schema===1&&typeof b.enabled==='boolean','invalid_publication_binding');if(!b.enabled)return b;
 ok(path.isAbsolute(b.repository)&&path.isAbsolute(b.publicationHome)&&inside(b.publicationHome,b.pointerPath)&&inside(b.publicationHome,b.bootstrapInput)&&digest(b.bootstrapInputSHA256),'invalid_publication_binding');ensurePrivateHome(b.publicationHome);return b;}
function admitted(b){const stateFile=path.join(b.publicationHome,'accepted-state.json'),saved=readJson(stateFile);const inputPath=saved?.inputPath??b.bootstrapInput;ok(inside(b.publicationHome,inputPath),'publication_input_outside_home');const input=boundedJson(inputPath);ok(path.resolve(input.repository).toLowerCase()===path.resolve(b.repository).toLowerCase()&&hash(canonical(input))===(saved?.input_sha256??b.bootstrapInputSHA256),'publication_admission_changed');return {input,inputPath,input_sha256:hash(canonical(input))};}
function evidence(root,revision,p,expected){ok(relative(p),'invalid_review_reference');const rows=committedFiles(root,revision,[p]);ok(rows.length===1&&rows[0].path===p&&rows[0].mode==='100644'&&rows[0].size<=8*1024*1024,'committed_review_missing');const bytes=readBlobs(root,rows)[0].bytes;ok(!expected||hash(bytes)===expected,'committed_review_changed');return {bytes,reference:{path:p,sha256:hash(bytes)}};}

export async function recordReviewedPublication(root,event,{bindingPath=bindingFile(root)}={}){
 if(!fs.existsSync(bindingPath))return {status:'skipped',reason:'publication_not_configured'};const b=binding(bindingPath);if(!b.enabled)return {status:'skipped',reason:'publication_disabled'};
 return withLock(b.publicationHome,'publication-admission',()=>{
 ok(fs.realpathSync(root).toLowerCase()===fs.realpathSync(b.repository).toLowerCase(),'publication_repository_mismatch');
 const revision=gitBytes(root,['rev-parse','--verify',(event.revision??'HEAD')+'^{commit}']).toString().trim();ok(revision===gitBytes(root,['rev-parse','HEAD']).toString().trim(),'publication_review_not_head');
 const prior=admitted(b);if(prior.input.approval.source_revision===revision)return {status:'unchanged',source_revision:revision};
 gitBytes(root,['merge-base','--is-ancestor',prior.input.approval.source_revision,revision]);
 const accepted=new Map(),refs=[];
 if(event.run){
  const rr=evidence(root,revision,event.run),run=JSON.parse(rr.bytes),f=run.final_review;ok(run.status==='completed'&&digest(f?.approved_sha256)&&f.approved_sha256===f.sha256,'exact_publication_review_required');
  const report=evidence(root,revision,f.path,f.approved_sha256),manifestFile=evidence(root,revision,f.content_manifest,f.content_manifest_sha256),manifest=JSON.parse(manifestFile.bytes);
  ok(manifest.batch_id===run.batch_id&&manifest.review_path===f.path&&manifest.review_sha256===f.approved_sha256&&Array.isArray(manifest.files),'publication_review_identity');
  for(const row of manifest.files)if(safeContentPath(row.path)){ok(row.exists===false||digest(row.sha256),'invalid_reviewed_content');accepted.set(row.path,row);}
  refs.push(rr.reference,report.reference,manifestFile.reference);
 }else{
  ok(typeof event.reviewRef==='string'&&event.reviewRef.trim()&&Array.isArray(event.paths)&&event.paths.length,'publication_maintenance_scope_required');const ref=event.reviewRef.split('#')[0];refs.push(evidence(root,revision,ref).reference);
  for(const p of event.paths){ok(safeContentPath(p),'publication_maintenance_scope_required');accepted.set(p,{path:p});}
 }
 const paths=new Map(prior.input.approval.paths.map(r=>[r.path,r]));const changed=gitBytes(root,['diff','--no-renames','--name-only','-z',prior.input.approval.source_revision,revision,'--',...scopes]).toString('utf8').split('\0').filter(Boolean);
 const relevant=changed.filter(p=>safeContentPath(p)&&(paths.has(p)||accepted.has(p)||/^(wiki|raw-sources|domains|groups|domain-groups)\//.test(p)));if(!relevant.length)return {status:'unchanged',reason:'no_accepted_content_delta'};
 for(const p of relevant)ok(accepted.has(p),'unreviewed_committed_content_delta');
 const rows=new Map(committedFiles(root,revision,relevant).map(r=>[r.path,r]));const bodies=readBlobs(root,[...rows.values()]);const byPath=new Map(bodies.map(r=>[r.path,r]));
 for(const p of relevant){const reviewed=accepted.get(p),file=byPath.get(p);if(!file){ok(reviewed.exists===false||!event.run,'reviewed_content_missing');paths.delete(p);continue;}ok(file.mode==='100644'&&reviewed.exists!==false&&(!reviewed.sha256||hash(file.bytes)===reviewed.sha256),'reviewed_content_changed');paths.set(p,{path:p,sha256:hash(file.bytes)});}
 const approval={...prior.input.approval,authorization_ref:'Explicit accepted commit '+revision+'; '+(event.run??event.reviewRef),source_revision:revision,paths:[...paths.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),evidence:refs,deletions:[],base_snapshot:null,prior_admission_sha256:prior.input_sha256,limitations:[...prior.input.approval.limitations.filter(s=>!s.startsWith('New accepted scope:')),'New accepted scope: '+(event.run??event.reviewRef)+'; prior scoped limits retained; no whole-library recertification.']};
 const input={repository:b.repository,approval},sha=hash(canonical(input)),events=path.join(b.publicationHome,'reviewed-events');ensurePrivateHome(events);const file=path.join(events,revision+'-'+sha.slice(0,16)+'.json');
 if(fs.existsSync(file))ok(hash(canonical(boundedJson(file)))===sha,'review_event_identity_conflict');else atomicJson(file,input);
 atomicJson(path.join(b.publicationHome,'accepted-state.json'),{schema:1,source_revision:revision,inputPath:file,input_sha256:sha,prior_inputPath:prior.inputPath,prior_input_sha256:prior.input_sha256});
 return {status:'queued',source_revision:revision,approved_files:approval.paths.length,input_sha256:sha};
 }).then(result=>{atomicJson(path.join(b.publicationHome,'review-event-health.json'),{...result,source_revision:result.source_revision??event.revision??null,updated_at:new Date().toISOString()});return result;}).catch(error=>{atomicJson(path.join(b.publicationHome,'review-event-health.json'),{status:'failed',reason:typeof error.code==='string'?error.code:'publication_review_invalid',source_revision:event.revision??null,updated_at:new Date().toISOString()});throw error;});
}

export async function refreshPublication(value,{lockHeldHome}={}){
 const b=binding(value);if(!b.enabled)return {status:'skipped',reason:'publication_disabled'};
 ok(path.isAbsolute(lockHeldHome??''),'publication_lock_required');const lock=readJson(path.join(lockHeldHome,'publish-content.lock'));ok(lock?.pid===process.pid&&typeof lock.token==='string','publication_lock_required');
 const current=readJson(b.pointerPath),published=readJson(path.join(lockHeldHome,'publish-content','published.json')),state=admitted(b);
 const eventHealth=readJson(path.join(b.publicationHome,'review-event-health.json'));if(eventHealth?.status==='failed'&&eventHealth.source_revision!==state.input.approval.source_revision){let superseded=false;try{gitBytes(b.repository,['merge-base','--is-ancestor',eventHealth.source_revision,state.input.approval.source_revision]);superseded=true;}catch{}ok(superseded,'publication_review_event_pending');}
 const publishedId=published?.snapshot_id??null;const source=state.input.approval.source_revision;
 if(current&&current.source_revision===source&&current.admission_state_sha256===state.input_sha256&&(current.snapshot_id===publishedId||current.base_snapshot===publishedId))return {status:'unchanged',snapshot_id:current.snapshot_id};
 const indexHome=path.join(b.publicationHome,'candidate-index');ensurePrivateHome(indexHome);
 const checkPointer=p=>{ok(p?.schema===1&&/^[A-Za-z0-9_.:-]{1,128}$/.test(p.snapshot_id)&&[p.sourceRoot,p.manifestPath,p.acceptancePath].every(x=>inside(b.publicationHome,x)),'unsafe_publication_pointer');const m=boundedJson(p.manifestPath);ok(m.snapshot_id===p.snapshot_id&&hash(canonical(m))===p.manifest_sha256,'publication_pointer_changed');return m;};
 if(current){checkPointer(current);atomicJson(path.join(indexHome,current.snapshot_id+'.json'),current);}
 let previousPaths=new Set();if(publishedId){ok(/^[A-Za-z0-9_.:-]{1,128}$/.test(publishedId),'unknown_published_scope');const old=current?.snapshot_id===publishedId?current:readJson(path.join(indexHome,publishedId+'.json'));ok(old&&old.manifest_sha256===published.manifest_sha256,'unknown_published_scope');previousPaths=new Set(checkPointer(old).entries.map(e=>e.path));}
 const newPaths=new Set(state.input.approval.paths.map(e=>e.path));
 // Explicit deployment deletions accumulate against the last compiled view; they are not inferred from omitted uploads.
 const deletions=[...previousPaths].filter(p=>!newPaths.has(p)).sort();
 const approval={...state.input.approval,base_snapshot:publishedId,deletions};
 const key=hash(canonical(approval)),versions=path.join(b.publicationHome,'versions'),target=path.join(versions,key);ensurePrivateHome(versions);
 if(!fs.existsSync(target)){
  const staging=path.join(versions,'.build-'+crypto.randomUUID());
  try{preparePublication({repository:b.repository,approval,output:staging,maxBytes:b.maxContentBytes??32*1024*1024,maxObjectBytes:b.maxObjectBytes??8*1024*1024});atomicJson(path.join(staging,'approval-input.json'),{repository:b.repository,approval});fs.renameSync(staging,target);}
  catch(error){if(fs.existsSync(staging)){ok(path.dirname(staging)===versions&&path.basename(staging).startsWith('.build-'),'publication_cleanup_scope');fs.rmSync(staging,{recursive:true,force:true});}throw error;}
 }
 const config={sourceRoot:path.join(target,'content'),manifestPath:path.join(target,'manifest.json'),acceptancePath:path.join(target,'acceptance.json'),allowedPrefixes:scopes.map(p=>p+'/'),maxContentBytes:b.maxContentBytes??32*1024*1024,maxObjectBytes:b.maxObjectBytes??8*1024*1024};
 const checked=acceptedManifest(config);ok(checked.manifest.source_revision===source&&checked.manifest.base_snapshot===publishedId,'publication_candidate_identity');
 const pointer={schema:1,snapshot_id:checked.manifest.snapshot_id,source_revision:source,manifest_sha256:checked.manifestSha,sourceRoot:config.sourceRoot,manifestPath:config.manifestPath,acceptancePath:config.acceptancePath,base_snapshot:publishedId,admission_state_sha256:state.input_sha256};atomicJson(path.join(indexHome,pointer.snapshot_id+'.json'),pointer);atomicJson(b.pointerPath,pointer);
 return {status:'prepared',snapshot_id:pointer.snapshot_id,source_revision:source,files:checked.manifest.entries.length,bytes:checked.scannedBytes};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{const args=process.argv.slice(2),at=args.indexOf('--root'),root=at>=0?path.resolve(args[at+1]):path.resolve(import.meta.dirname,'../..');const event=JSON.parse(fs.readFileSync(0,'utf8'));console.log(JSON.stringify(await recordReviewedPublication(root,event)));}catch(e){console.error(JSON.stringify({status:'failed',reason:e.message}));process.exitCode=1;}}
