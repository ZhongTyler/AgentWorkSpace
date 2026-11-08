// Explicit local publication admission. A commit or this tool is not a semantic approval.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {canonical,hash,requireValue as ok} from './state.mjs';
import {safeContentPath,validContentAccess,acceptedManifest} from './clients.mjs';
import {projectPublicSource,SOURCE_URL_POLICY} from './source-url-boundary.mjs';
import {manualProjectionRecords,applyApprovedSourceProjection} from './approved-source-projections.mjs';

export function gitBytes(repository,args,input){
 const r=spawnSync('git',['-c','safe.directory='+path.resolve(repository),...args],{cwd:repository,input,maxBuffer:256*1024*1024,windowsHide:true});
 ok(!r.error&&r.status===0,'publication_git_read_failed');return r.stdout;
}
export function committedFiles(repository,revision,prefixes){
 ok(/^[a-f0-9]{40}$/.test(revision),'full_revision_required');
 const rows=gitBytes(repository,['ls-tree','-rlz',revision,'--',...prefixes]).toString('utf8').split('\0').filter(Boolean);
 return rows.map(line=>{const tab=line.indexOf('\t'),[mode,type,oid,size]=line.slice(0,tab).trim().split(/\s+/);return {path:line.slice(tab+1),mode,type,oid,size:Number(size)};});
}
export function readBlobs(repository,rows){
 if(!rows.length)return [];
 const bytes=gitBytes(repository,['cat-file','--batch'],Buffer.from(rows.map(r=>r.oid).join('\n')+'\n'));let at=0;
 return rows.map(row=>{const end=bytes.indexOf(10,at);ok(end>=at,'invalid_git_blob_stream');const [oid,type,len]=bytes.subarray(at,end).toString().split(' ');const size=Number(len);ok(oid===row.oid&&type==='blob'&&Number.isSafeInteger(size)&&size===row.size,'invalid_git_blob_stream');at=end+1;const body=bytes.subarray(at,at+size);at+=size;ok(bytes[at++]===10,'invalid_git_blob_stream');return {...row,bytes:body};});
}
const kind=p=>({'wiki':'wiki','raw-sources':'raw','domains':'domain','groups':'group','domain-groups':'group','Clippings':'clipping'})[p.split('/')[0]]??'attachment';
const ordinary=p=>typeof p==='string'&&!/[\x00-\x1f\\:]/.test(p)&&!p.startsWith('/')&&!p.split('/').some(x=>!x||x==='.'||x==='..');

export function preparePublication({repository,approval,output,maxBytes=32*1024*1024,maxObjectBytes=8*1024*1024}){
 ok(approval?.schema===1&&approval.decision==='accepted_for_query_publication'&&typeof approval.authorization_ref==='string'&&approval.authorization_ref.trim(),'publication_approval_required');
 ok(Array.isArray(approval.limitations)&&approval.limitations.length>0,'explicit_scope_limits_required');
 ok(approval.query_contract==='knowledge-query-bm25-v1','unsupported_publication_contract');
 ok(Array.isArray(approval.paths)&&approval.paths.length>0&&approval.paths.length<=20000&&Array.isArray(approval.deletions),'publication_scope_required');
 const seen=new Set();for(const row of approval.paths){ok(safeContentPath(row.path)&&validContentAccess(row)&&/^[a-f0-9]{64}$/.test(row.sha256)&&!seen.has(row.path.toLowerCase()),'invalid_approved_path');seen.add(row.path.toLowerCase());}
 for(const p of approval.deletions)ok(safeContentPath(p)&&!seen.has(p.toLowerCase()),'invalid_approved_deletion');
 ok(new Set(approval.deletions.map(p=>p.toLowerCase())).size===approval.deletions.length,'invalid_approved_deletion');
 const revision=approval.source_revision;
 const evidence=approval.evidence;ok(Array.isArray(evidence)&&evidence.length>0&&evidence.length<=128,'review_evidence_required');
 for(const e of evidence){ok(ordinary(e.path)&&/^[a-f0-9]{64}$/.test(e.sha256),'invalid_review_reference');const rows=committedFiles(repository,revision,[e.path]);ok(rows.length===1&&rows[0].path===e.path&&rows[0].mode==='100644'&&rows[0].size<=8*1024*1024,'review_evidence_missing');ok(hash(readBlobs(repository,rows)[0].bytes)===e.sha256,'review_evidence_changed');}
 const privateReceipts=approval.paths.filter(row=>row.path.startsWith('docs/')).map(row=>row.path);
 const all=committedFiles(repository,revision,['wiki','raw-sources','domains','groups','domain-groups','Clippings','assets','attachments','research-reports',...privateReceipts]);
 const byPath=new Map(all.map(r=>[r.path,r])),artifactInputs=approval.artifact_inputs??[],anchors=new Map();
 ok(Array.isArray(artifactInputs)&&new Set(artifactInputs.map(row=>row.path)).size===artifactInputs.length,'invalid_artifact_inputs');
 for(const input of artifactInputs)ok(approval.paths.some(row=>row.path===input.path&&row.sha256===input.sha256&&row.access==='private_evidence')&&input.anchor?.path==='.git-artifacts/research-media.json'&&/^[a-f0-9]{64}$/.test(input.anchor.sha256),'artifact_input_not_approved');
 function artifactRow(approved){
  const input=artifactInputs.find(row=>row.path===approved.path);if(!input)return null;
  let anchor=anchors.get(input.anchor.sha256);
  if(!anchor){
   const rows=committedFiles(repository,revision,[input.anchor.path]);ok(rows.length===1&&rows[0].mode==='100644'&&rows[0].size<=8*1024*1024,'artifact_anchor_missing');
   const bytes=readBlobs(repository,rows)[0].bytes;ok(hash(bytes)===input.anchor.sha256,'artifact_anchor_changed');anchor=JSON.parse(bytes.toString('utf8'));
   ok(anchor.schema_version===1&&/^[a-f0-9]{40}$/.test(anchor.source_revision)&&Array.isArray(anchor.files),'invalid_artifact_anchor');anchors.set(input.anchor.sha256,anchor);
  }
  const record=anchor.files.find(row=>row.path===approved.path);
  ok(record&&record.sha256===approved.sha256&&record.mode==='100644'&&['video_frame','image_contact_sheet'].includes(record.role),'artifact_not_in_recovery_scope');
  const rows=committedFiles(repository,anchor.source_revision,[approved.path]);
  ok(rows.length===1&&rows[0].path===approved.path&&rows[0].oid===record.oid&&rows[0].size===record.bytes&&rows[0].mode==='100644','artifact_recovery_identity_changed');
  return rows[0];
 }
 let total=0;const selected=approval.paths.map(r=>{const row=byPath.get(r.path)??artifactRow(r);ok(row&&row.mode==='100644'&&row.type==='blob','approved_content_missing_or_linked');total+=row.size;ok(row.size<=maxObjectBytes&&total<=maxBytes,'publication_capacity');return {...row,approved_sha256:r.sha256,...(r.access?{access:r.access}:{})};});
 const manual=manualProjectionRecords(approval.manual_source_url_projections);
 const projection=[];
 function publicBytes(row,recordProjection=false){
  const bytes=readBlobs(repository,[row])[0].bytes;ok(hash(bytes)===row.approved_sha256,'approved_content_changed');
  if(row.access==='private_evidence'||!/\.(md|txt)$/i.test(row.path))return bytes;
  let result;try{result=projectPublicSource(bytes);}catch(error){const record=manual.find(r=>r.path===row.path);if(error.code!=='source_url_manual_review_required'||!record)throw error;result=applyApprovedSourceProjection(bytes,record);}
  if(result.changed&&recordProjection)projection.push({path:row.path,source_sha256:result.source_sha256,public_sha256:result.public_sha256,body_sha256:result.body_sha256,...(result.manual_authorization_ref?{manual_authorization_ref:result.manual_authorization_ref}:{removed_parameters:result.removed_parameters})});
  return result.bytes;
 }
 const files=selected.map(row=>{const bytes=publicBytes(row,true);return {...row,public_sha256:hash(bytes),public_size:bytes.length};});
 const entries=files.map(f=>({path:f.path,sha256:f.public_sha256,size:f.public_size,kind:f.path.startsWith('research-reports/')&&f.access==='query'&&/\.(md|txt)$/i.test(f.path)?'research':kind(f.path),review_status:'accepted',...(f.access?{access:f.access}:{})})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const publicTotal=files.reduce((sum,file)=>sum+file.public_size,0);
 const base={schema:1,source_revision:revision,base_snapshot:approval.base_snapshot??null,query_contract:approval.query_contract,entries,deletions:[...approval.deletions].sort()};
 ok(base.base_snapshot===null||/^[A-Za-z0-9_.:-]{1,128}$/.test(base.base_snapshot),'invalid_base_snapshot');
 const normalizedApproval={...approval,paths:[...approval.paths].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),evidence:[...evidence].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),deletions:[...approval.deletions].sort()};
 const approvalSha=hash(canonical(normalizedApproval));
 const subject={...base,snapshot_id:'knowledge-'+hash(canonical({base,approval_sha256:approvalSha})).slice(0,32)};
 const receipt={schema:1,decision:'accepted',source_revision:revision,subject_sha256:hash(canonical(subject)),publication_approval_sha256:approvalSha,authorization_ref:approval.authorization_ref,evidence:normalizedApproval.evidence,limitations:approval.limitations,scope:'Query-publication admission only; no new semantic or external-fact certification',...(projection.length?{public_source_projection:{policy:SOURCE_URL_POLICY,mapping:projection}}:{})};
 const receiptBytes=Buffer.from(canonical(receipt)+'\n'),manifest={...subject,acceptance:{receipt_sha256:hash(receiptBytes)}};
 ok(path.isAbsolute(output),'absolute_output_required');const parent=path.dirname(path.resolve(output));fs.mkdirSync(parent,{recursive:true});ok(path.resolve(fs.realpathSync(parent)).toLowerCase()===parent.toLowerCase(),'publication_output_linked');
 // New target only; no overwrite, restore, cleanup of user files, or network side effects.
 fs.mkdirSync(output,{mode:0o700});const sourceRoot=path.join(output,'content');fs.mkdirSync(sourceRoot,{mode:0o700});
 for(const f of files){const bytes=publicBytes(f);ok(hash(bytes)===f.public_sha256,'publication_projection_changed');const target=path.join(sourceRoot,...f.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});}
 const manifestPath=path.join(output,'manifest.json'),acceptancePath=path.join(output,'acceptance.json');fs.writeFileSync(acceptancePath,receiptBytes,{flag:'wx',mode:0o600});fs.writeFileSync(manifestPath,canonical(manifest)+'\n',{flag:'wx',mode:0o600});
 const config={sourceRoot,manifestPath,acceptancePath,allowedPrefixes:[...new Set(entries.map(e=>e.path.split('/')[0]+'/'))],maxContentBytes:maxBytes,maxObjectBytes};
 const checked=acceptedManifest(config);ok(checked.scannedBytes===publicTotal,'publication_readback_mismatch');
 return {config,snapshot_id:subject.snapshot_id,source_revision:revision,files:entries.length,bytes:publicTotal,manifest_sha256:checked.manifestSha,approval_sha256:receipt.publication_approval_sha256,limitations:approval.limitations};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const [inputFile,output]=process.argv.slice(2);const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));const result=preparePublication({...input,output});console.log(JSON.stringify(result));}
 catch(e){console.error(JSON.stringify({status:'failed',code:e.message}));process.exitCode=1;}
}
