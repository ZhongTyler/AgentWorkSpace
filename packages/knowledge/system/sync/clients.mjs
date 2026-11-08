import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gzipSync} from 'node:zlib';
import {canonical,hash,readJson,atomicJson,scopedFile,namespaceKey,requireValue,SyncError} from './state.mjs';
import {assertMinimalMetadata} from './private-metadata.mjs';
import {assertPublicSourceText} from './source-url-boundary.mjs';
import {safeContentPath,validContentAccess} from './content-policy.mjs';
export {safeContentPath,validContentAccess} from './content-policy.mjs';
const id=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function publicationPath(home,file,directory=false){
 requireValue(typeof home==='string'&&path.isAbsolute(home)&&typeof file==='string'&&path.isAbsolute(file),'unsafe_publication_pointer');
 const root=path.resolve(home),target=path.resolve(file),relative=path.relative(root,target);
 requireValue(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'unsafe_publication_pointer');
 requireValue(path.resolve(fs.realpathSync(root)).toLowerCase()===root.toLowerCase()&&path.resolve(fs.realpathSync(target)).toLowerCase()===target.toLowerCase(),'unsafe_publication_pointer');
 let at=target;while(at!==root){requireValue(!fs.lstatSync(at).isSymbolicLink(),'unsafe_publication_pointer');at=path.dirname(at);}
 const stat=fs.statSync(target);requireValue(directory?stat.isDirectory():stat.isFile()&&stat.size<=8*1024*1024,'unsafe_publication_pointer');return target;
}
// Read exactly one accepted pointer. It selects immutable artifact paths only;
// all transport, scope, enabled and privacy policy still come from the job.
export function publicationSelection(config){
 if(config.publicationPointer===undefined)return {config,pointer:null};
 const file=publicationPath(config.publicationHome,config.publicationPointer);requireValue(fs.statSync(file).size<=65536,'unsafe_publication_pointer');const pointer=readJson(file);
 requireValue(pointer&&Object.keys(pointer).sort().join(',')==='acceptancePath,admission_state_sha256,base_snapshot,manifestPath,manifest_sha256,schema,snapshot_id,sourceRoot,source_revision'&&pointer.schema===1&&id(pointer.snapshot_id)&&/^[a-f0-9]{40}$/.test(pointer.source_revision)&&digest(pointer.manifest_sha256)&&digest(pointer.admission_state_sha256)&&(pointer.base_snapshot===null||id(pointer.base_snapshot)),'unsafe_publication_pointer');
 const selected={...config,sourceRoot:publicationPath(config.publicationHome,pointer.sourceRoot,true),manifestPath:publicationPath(config.publicationHome,pointer.manifestPath),acceptancePath:publicationPath(config.publicationHome,pointer.acceptancePath)};
 return {config:selected,pointer};
}
export function acceptedManifest(config){
 const selected=publicationSelection(config);config=selected.config;
 const readBound=(file,max)=>{const s=fs.lstatSync(file);requireValue(s.isFile()&&!s.isSymbolicLink()&&s.size<=max,'unsafe_acceptance_file');return fs.readFileSync(file);};
 const manifestBytes=readBound(config.manifestPath,8*1024*1024),acceptanceBytes=readBound(config.acceptancePath,1024*1024);
 const manifest=JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/,'')),acceptance=JSON.parse(acceptanceBytes.toString('utf8').replace(/^\uFEFF/,''));
 requireValue(manifest?.schema===1&&id(manifest.snapshot_id)&&/^[a-f0-9]{40}$/.test(manifest.source_revision)&&Array.isArray(manifest.entries)&&Array.isArray(manifest.deletions),'invalid_manifest');
 requireValue(manifest.acceptance?.receipt_sha256===hash(acceptanceBytes)&&acceptance?.decision==='accepted'&&acceptance.source_revision===manifest.source_revision,'manifest_not_accepted');
 const {acceptance:approval,...subject}=manifest;
 requireValue(acceptance.schema===1&&acceptance.subject_sha256===hash(canonical(subject)),'acceptance_subject_mismatch');
 requireValue(Array.isArray(config.allowedPrefixes)&&config.allowedPrefixes.length>0,'content_scope_unconfigured');
 requireValue(new Set(manifest.entries.map(r=>r.path?.toLowerCase())).size===manifest.entries.length&&manifest.entries.length<=(config.maxFiles??20000),'duplicate_content_path');
 requireValue(typeof manifest.query_contract==='string'&&manifest.query_contract.length>0&&manifest.query_contract.length<=256,'index_contract_missing');
 const descriptors=new Map();let scannedBytes=0;
 for(const row of manifest.entries){
  requireValue(safeContentPath(row.path)&&validContentAccess(row)&&row.review_status==='accepted'&&digest(row.sha256)&&config.allowedPrefixes.some(p=>row.path.startsWith(p)),'content_not_accepted');
  const file=scopedFile(config.sourceRoot,row.path);const size=fs.statSync(file).size;
  requireValue(size===row.size&&size<=(config.maxObjectBytes??8*1024*1024),'content_size_mismatch');
  const bytes=fs.readFileSync(file);requireValue(hash(bytes)===row.sha256,'accepted_content_changed');
  if(row.access!=='private_evidence'&&/\.(md|txt|json|svg)$/i.test(row.path))assertPublicSourceText(bytes.toString('utf8'));
  scannedBytes+=bytes.length;requireValue(scannedBytes<=(config.maxContentBytes??32*1024*1024),'content_capacity');descriptors.set(row.sha256,{path:row.path,size:row.size});
 }
 for(const relative of manifest.deletions)requireValue(safeContentPath(relative)&&config.allowedPrefixes.some(p=>relative.startsWith(p))&&!manifest.entries.some(e=>e.path.toLowerCase()===relative.toLowerCase()),'deletion_not_accepted');
 const manifestSha=hash(canonical(manifest));
 if(selected.pointer)requireValue(manifest.snapshot_id===selected.pointer.snapshot_id&&manifest.source_revision===selected.pointer.source_revision&&manifestSha===selected.pointer.manifest_sha256&&manifest.base_snapshot===selected.pointer.base_snapshot,'publication_pointer_changed');
 // Keep identities, never the complete snapshot's bytes. Recheck every lazy read
 // so a changed local object cannot be uploaded under an earlier approval.
 const objects=Object.freeze({
  size:descriptors.size,has:sha=>descriptors.has(sha),keys:()=>descriptors.keys(),info:sha=>{const row=descriptors.get(sha);return row?{...row}:undefined;},
  get(sha){
   const row=descriptors.get(sha);if(!row)return undefined;
   const file=scopedFile(config.sourceRoot,row.path);
   requireValue(fs.statSync(file).size===row.size,'accepted_content_changed');
   const bytes=fs.readFileSync(file);requireValue(hash(bytes)===sha,'accepted_content_changed');return bytes;
  }
 });
 return {manifest,manifestSha,objects,scannedBytes};
}
export async function publishContent(config,request,{home}={}){
 const {manifest,manifestSha,objects,scannedBytes}=acceptedManifest(config),file=path.join(home,'published.json');
 const identity={snapshot_id:manifest.snapshot_id,manifest_sha256:manifestSha};
 const matched=value=>value?.status==='active'&&value.active_snapshot===identity.snapshot_id&&value.manifest_sha256===manifestSha&&digest(value.index_sha256);
 const active=await request('content-status',{snapshot_id:identity.snapshot_id});
 if(matched(active)){atomicJson(file,{...identity,source_revision:manifest.source_revision,publishedAt:new Date().toISOString()});return {status:'unchanged',scannedBytes,objectsUploaded:0,activeSnapshot:manifest.snapshot_id,indexVerified:true};}
 const missing=await request('content-plan',{manifest});
 requireValue(['planned','unchanged'].includes(missing?.status)&&missing.manifest_sha256===manifestSha&&Array.isArray(missing.missing)&&new Set(missing.missing).size===missing.missing.length&&missing.missing.every(sha=>objects.has(sha)),'invalid_missing_objects');
 const limit=Math.min(config.maxStageBytes??10*1024*1024,64*1024*1024-1),chunked=config.chunkedStage===true;
 const decodedLimit=config.maxStageDecodedBytes??64*1024*1024;
 const envelope=chunked?{manifest,objects:[],finalize:false}:{manifest,objects:[]};
 const overhead=Buffer.byteLength(canonical(envelope));
 requireValue(overhead<=limit,'content_batch_too_large');
 let batch=[],batchBytes=overhead,batchDecoded=0,checked;
 const stage=async(final=false)=>{
  const payload={manifest,objects:batch,...(chunked?{finalize:final}:{})};
  try{checked=await request('content-stage',payload);}catch(e){if(chunked||e.code!=='missing_objects'||final)throw e;}
  batch=[];batchBytes=overhead;batchDecoded=0;
 };
 for(const sha of missing.missing){
  const bytes=objects.get(sha),decodedSize=bytes.length;
  const compress=config.gzipObjects===true&&bytes.length>8*1024*1024&&/\.(html|md|txt|json|svg)$/i.test(objects.info(sha).path);
  const encoded=compress?gzipSync(bytes):bytes;
  const item={sha256:sha,data_base64:encoded.toString('base64'),...(compress?{encoding:'gzip'}:{})},itemBytes=Buffer.byteLength(canonical(item));
  requireValue(overhead+itemBytes<=limit,'content_object_too_large');
  requireValue(decodedSize<=decodedLimit,'content_object_too_large');
  if(batchBytes+itemBytes+(batch.length?1:0)>limit||batchDecoded+decodedSize>decodedLimit)await stage();
  batchBytes+=itemBytes+(batch.length?1:0);batchDecoded+=decodedSize;batch.push(item);
 }
 if(chunked){if(batch.length)await stage();await stage(true);}else await stage(true);
 requireValue(checked?.status==='staged'&&checked.snapshot_id===manifest.snapshot_id&&checked.manifest_sha256===manifestSha&&digest(checked.index_sha256),'staging_not_verified');
 try{await request('content-activate',identity,{attempts:1});}
 catch(e){if(!e.retryable)throw e;/* Actual activation readback before any resend. */}
 const readback=await request('content-status',{snapshot_id:identity.snapshot_id});requireValue(matched(readback),'activation_unconfirmed');
 atomicJson(file,{...identity,source_revision:manifest.source_revision,publishedAt:new Date().toISOString()});
 return {status:'published',scannedBytes,objectsUploaded:missing.missing.length,activeSnapshot:manifest.snapshot_id,indexVerified:true};
}
export async function coreStoreFactory(toolsRoot){
 const profiles=[{"core.mjs":"3551205247bd31a212be19d855b64db14255278cdbe9edda653a82d9ba05678b","store.mjs":"39f71a53c71327d5b214ec0f3a347bdcc8aeb96a00bc20011bbaff8efb68caad"},{"core.mjs":"f6898010b9b031bfa3f14f9acb889d8460ec8b7c752166fb43f0b78b346e079b","store.mjs":"b7b3625d4e3f02311ef6048ba220107d1c51fbd0efc303774238d3438d707285"}];
 const base=path.join(toolsRoot,'integrations/knowledge-feedback');
 const observed=Object.fromEntries(Object.keys(profiles[0]).map(name=>[name,hash(fs.readFileSync(path.join(base,name)))]));
 requireValue(profiles.some(profile=>Object.entries(profile).every(([name,sha])=>observed[name]===sha)),'feedback_core_drift');
 const {FileStore}=await import(pathToFileURL(path.join(base,'store.mjs')));
 return (home,namespace)=>new FileStore({home,namespace});
}
export function validateEnvelope(packet,config,now){
 requireValue(packet?.sync_schema===1&&packet.core_schema===1&&id(packet.transfer_id)&&Number.isSafeInteger(packet.source_cursor)&&packet.source_cursor>=0,'unknown_transfer_schema');
 requireValue(Object.keys(packet).every(k=>['sync_schema','core_schema','transfer_id','origin','namespace','source_cursor','generated_at','expires_at','payload_sha256','payload','attachments'].includes(k)),'unknown_transfer_schema');
 requireValue(packet.attachments===undefined||packet.attachments&&Object.getPrototypeOf(packet.attachments)===Object.prototype&&Object.keys(packet.attachments).join(',')==='analysis_snapshot','unknown_attachment_schema');
 const key=namespaceKey(packet.namespace);
 requireValue(config.allowedNamespaces.some(ns=>namespaceKey(ns)===key),'namespace_not_allowed');
 requireValue(packet.origin===packet.namespace.host&&packet.namespace.host!=='local-agent','online_namespace_required');
 requireValue(Number.isFinite(Date.parse(packet.generated_at))&&Date.parse(packet.generated_at)<=now+300000&&Date.parse(packet.expires_at)>now,'transfer_expired');
 requireValue(digest(packet.payload_sha256)&&hash(canonical(packet.payload))===packet.payload_sha256&&canonical(packet.payload?.namespace)===canonical(packet.namespace),'transfer_integrity');
 requireValue(Array.isArray(packet.payload?.records)&&packet.payload.records.every(r=>['signal','issue','outcome_link','control'].includes(r.type)),'unknown_transfer_schema');
 requireValue(packet.payload.records.every(r=>Date.parse(r.expires_at)>now&&(r.type==='control'||r.policy?.export_to_owner===true&&r.policy.analysis_allowed===true&&r.policy.temporary===false&&r.policy.withdrawn!==true&&r.policy.retention_confirmed===true)),'transfer_not_qualified');
 requireValue(config.improvementUseOnLocalConfirmed!==false||packet.payload.records.every(r=>r.type==='control'),'case_import_unconfirmed');
 assertMinimalMetadata(packet.payload);
 requireValue(Buffer.byteLength(canonical(packet))<=(config.maxPacketBytes??8*1024*1024),'transfer_too_large');
 return key;
}
const analysisContext=(packet,home,now)=>({namespace:packet.namespace,sourceCursor:packet.source_cursor,transferId:packet.transfer_id,corePayloadSha256:packet.payload_sha256,rejectBefore:packet.payload.reject_before,home,now});
export async function importAndAck(packet,config,request,{home,storeFactory,now=Date.now(),consumeAnalysisSnapshot,onCoreApplied}={}){
 const key=validateEnvelope(packet,config,now),receiptFile=path.join(home,'receipts',key+'-'+hash(packet.transfer_id)+'.json');
 const attachmentSha=packet.attachments?hash(canonical(packet.attachments)):null;
 const checkpoint=readJson(path.join(home,'cursors',key+'.json'));
 requireValue(!checkpoint||packet.source_cursor>checkpoint.source_cursor||packet.source_cursor===checkpoint.source_cursor&&packet.transfer_id===checkpoint.transfer_id&&packet.payload_sha256===checkpoint.payload_sha256&&(checkpoint.attachment_sha256??null)===attachmentSha,'revision_conflict');
 const prior=readJson(receiptFile);if(prior)requireValue(prior.payload_sha256===packet.payload_sha256&&prior.source_cursor===packet.source_cursor&&(prior.attachment_sha256??null)===attachmentSha,'revision_conflict');
 {
  const store=storeFactory(path.join(home,'inbox'),packet.namespace),imported=store.import(packet.payload,{now,importAllowed:true});
  requireValue(!['busy','cursor_conflict'].includes(imported.status),'core_import_busy');
  const context=analysisContext(packet,home,now);if(onCoreApplied)await onCoreApplied(context);
  if(packet.attachments){
   // Current core controls are already durable. Invalid/unconfirmed analytics
   // cannot undo deletion, and cannot be ACKed or advance the source cursor.
   requireValue(typeof consumeAnalysisSnapshot==='function','analysis_snapshot_contract_unconfirmed');
   const stored=await consumeAnalysisSnapshot(packet.attachments.analysis_snapshot,context);
   requireValue(stored?.durable===true,'analysis_snapshot_not_durable');
  }
  // The core transaction is idempotent if power fails before this receipt write.
  if(!prior)atomicJson(receiptFile,{schema_version:1,namespace:packet.namespace,transfer_id:packet.transfer_id,payload_sha256:packet.payload_sha256,source_cursor:packet.source_cursor,attachment_sha256:attachmentSha,importedAt:new Date(now).toISOString(),importStatus:imported.status,acknowledged:false});
 }
 const receipt=readJson(receiptFile);
 const ack=await request('feedback-ack',{namespace:packet.namespace,transfer_id:packet.transfer_id,payload_sha256:packet.payload_sha256,source_cursor:packet.source_cursor});
 requireValue(ack?.status==='acked'&&ack.transfer_id===packet.transfer_id&&ack.source_cursor===packet.source_cursor,'ack_unconfirmed');
 atomicJson(receiptFile,{...receipt,acknowledged:true});
 atomicJson(path.join(home,'cursors',key+'.json'),{namespace:packet.namespace,source_cursor:packet.source_cursor,transfer_id:packet.transfer_id,payload_sha256:packet.payload_sha256,attachment_sha256:attachmentSha,acknowledgedAt:new Date(now).toISOString()});
 return {imported:!prior,acknowledged:true};
}
export const privateReceiveAllowed=config=>config.retentionPolicyConfirmed===true&&(config.improvementUseOnLocalConfirmed===true||config.analyticsSnapshotImportConfirmed===true||config.controlReceiptConfirmed===true);
export async function pullCompounding(config,request,{home,storeFactory,now=Date.now(),clock=()=>now,consumeAnalysisSnapshot,onCoreApplied,pruneAnalysis}={}){
 requireValue(privateReceiveAllowed(config),'private_transfer_policy_unconfirmed');
 requireValue(Array.isArray(config.allowedNamespaces)&&config.allowedNamespaces.length>0,'namespace_scope_unconfigured');
 requireValue(Number.isSafeInteger(config.tombstoneRetentionMs)&&config.tombstoneRetentionMs>0&&config.tombstoneRetentionMs<=365*86400000,'retention_unconfigured');
 let imported=0,acknowledged=0;const failures=[];
 for(const namespace of config.allowedNamespaces){
  try{
   const key=namespaceKey(namespace),cursor=readJson(path.join(home,'cursors',key+'.json'));
   const store=storeFactory(path.join(home,'inbox'),namespace);
   store.maintain({now:clock(),tombstone_retention_ms:config.tombstoneRetentionMs});
   if(pruneAnalysis)await pruneAnalysis(namespace);
   // Backend feedback-next exports current authorized control/state together;
   // core.import sorts controls before records and retains its rejection floor.
   const next=await request('feedback-next',{namespace,after_cursor:cursor?.source_cursor??0});
   if(next?.status==='window_lost'){
    // A lost payload window is not complete delivery. Its authenticated current
    // controls must still suppress deleted data; never ACK or advance the cursor.
    if(next.package){validateEnvelope(next.package,config,clock());requireValue(canonical(next.package.namespace)===canonical(namespace),'transfer_identity_mismatch');
     const {manifest_sha256,classification,...body}=next.package.payload;body.records=body.records.filter(r=>r.type==='control');
     const applied=store.import({...body,manifest_sha256:hash(canonical(body)),classification},{now:clock(),importAllowed:true});requireValue(!['busy','cursor_conflict'].includes(applied.status),'core_import_busy');
     const context=analysisContext(next.package,home,clock());if(onCoreApplied)await onCoreApplied(context);
     if(next.package.attachments)try{requireValue(typeof consumeAnalysisSnapshot==='function','analysis_snapshot_contract_unconfirmed');const stored=await consumeAnalysisSnapshot(next.package.attachments.analysis_snapshot,context);requireValue(stored?.durable===true,'analysis_snapshot_not_durable');}catch(e){failures.push({namespace:key,code:e.code??'analysis_snapshot_invalid'});}
    }
    throw new SyncError('window_lost');
   }
   if(next?.status==='disabled')throw new SyncError('permission_revoked');
   requireValue(['unchanged','package'].includes(next?.status),'invalid_outbox_inventory');
   if(next.status==='package'){
    requireValue(canonical(next.package?.namespace)===canonical(namespace),'transfer_identity_mismatch');
    const result=await importAndAck(next.package,config,request,{home,storeFactory,now:clock(),consumeAnalysisSnapshot,onCoreApplied});imported+=Number(result.imported);acknowledged++;
   }
  }catch(e){failures.push({namespace:namespaceKey(namespace),code:e.code??'import_rejected'});}
 }
 return {status:failures.length?'partial':imported?'imported':'unchanged',packagesImported:imported,acknowledged,failures};
}
