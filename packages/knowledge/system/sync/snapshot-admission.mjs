// Explicit local publication admission. A commit or this tool is not a semantic approval.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {canonical,hash,requireValue as ok} from './state.mjs';
import {safeContentPath,acceptedManifest} from './clients.mjs';

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
 const seen=new Set();for(const row of approval.paths){ok(safeContentPath(row.path)&&/^[a-f0-9]{64}$/.test(row.sha256)&&!seen.has(row.path.toLowerCase()),'invalid_approved_path');seen.add(row.path.toLowerCase());}
 for(const p of approval.deletions)ok(safeContentPath(p)&&!seen.has(p.toLowerCase()),'invalid_approved_deletion');
 ok(new Set(approval.deletions.map(p=>p.toLowerCase())).size===approval.deletions.length,'invalid_approved_deletion');
 const revision=approval.source_revision;
 const evidence=approval.evidence;ok(Array.isArray(evidence)&&evidence.length>0&&evidence.length<=128,'review_evidence_required');
 for(const e of evidence){ok(ordinary(e.path)&&/^[a-f0-9]{64}$/.test(e.sha256),'invalid_review_reference');const rows=committedFiles(repository,revision,[e.path]);ok(rows.length===1&&rows[0].path===e.path&&rows[0].mode==='100644'&&rows[0].size<=8*1024*1024,'review_evidence_missing');ok(hash(readBlobs(repository,rows)[0].bytes)===e.sha256,'review_evidence_changed');}
 const all=committedFiles(repository,revision,['wiki','raw-sources','domains','groups','domain-groups','Clippings','assets','attachments']);
 const byPath=new Map(all.map(r=>[r.path,r]));let total=0;const selected=approval.paths.map(r=>{const row=byPath.get(r.path);ok(row&&row.mode==='100644'&&row.type==='blob','approved_content_missing_or_linked');total+=row.size;ok(row.size<=maxObjectBytes&&total<=maxBytes,'publication_capacity');return {...row,approved_sha256:r.sha256};});
 const files=readBlobs(repository,selected);for(const f of files)ok(hash(f.bytes)===f.approved_sha256,'approved_content_changed');
 const entries=files.map(f=>({path:f.path,sha256:f.approved_sha256,size:f.size,kind:kind(f.path),review_status:'accepted'})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const base={schema:1,source_revision:revision,base_snapshot:approval.base_snapshot??null,query_contract:approval.query_contract,entries,deletions:[...approval.deletions].sort()};
 ok(base.base_snapshot===null||/^[A-Za-z0-9_.:-]{1,128}$/.test(base.base_snapshot),'invalid_base_snapshot');
 const normalizedApproval={...approval,paths:[...approval.paths].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),evidence:[...evidence].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0),deletions:[...approval.deletions].sort()};
 const approvalSha=hash(canonical(normalizedApproval));
 const subject={...base,snapshot_id:'knowledge-'+hash(canonical({base,approval_sha256:approvalSha})).slice(0,32)};
 const receipt={schema:1,decision:'accepted',source_revision:revision,subject_sha256:hash(canonical(subject)),publication_approval_sha256:approvalSha,authorization_ref:approval.authorization_ref,evidence:normalizedApproval.evidence,limitations:approval.limitations,scope:'Query-publication admission only; no new semantic or external-fact certification'};
 const receiptBytes=Buffer.from(canonical(receipt)+'\n'),manifest={...subject,acceptance:{receipt_sha256:hash(receiptBytes)}};
 ok(path.isAbsolute(output),'absolute_output_required');const parent=path.dirname(path.resolve(output));fs.mkdirSync(parent,{recursive:true});ok(path.resolve(fs.realpathSync(parent)).toLowerCase()===parent.toLowerCase(),'publication_output_linked');
 // New target only; no overwrite, restore, cleanup of user files, or network side effects.
 fs.mkdirSync(output,{mode:0o700});const sourceRoot=path.join(output,'content');fs.mkdirSync(sourceRoot,{mode:0o700});
 for(const f of files){const target=path.join(sourceRoot,...f.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.writeFileSync(target,f.bytes,{flag:'wx',mode:0o600});}
 const manifestPath=path.join(output,'manifest.json'),acceptancePath=path.join(output,'acceptance.json');fs.writeFileSync(acceptancePath,receiptBytes,{flag:'wx',mode:0o600});fs.writeFileSync(manifestPath,canonical(manifest)+'\n',{flag:'wx',mode:0o600});
 const config={sourceRoot,manifestPath,acceptancePath,allowedPrefixes:[...new Set(entries.map(e=>e.path.split('/')[0]+'/'))],maxContentBytes:maxBytes,maxObjectBytes};
 const checked=acceptedManifest(config);ok(checked.scannedBytes===total,'publication_readback_mismatch');
 return {config,snapshot_id:subject.snapshot_id,source_revision:revision,files:entries.length,bytes:total,manifest_sha256:checked.manifestSha,approval_sha256:receipt.publication_approval_sha256,limitations:approval.limitations};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{const [inputFile,output]=process.argv.slice(2);const input=JSON.parse(fs.readFileSync(inputFile,'utf8'));const result=preparePublication({...input,output});console.log(JSON.stringify(result));}
 catch(e){console.error(JSON.stringify({status:'failed',code:e.message}));process.exitCode=1;}
}
