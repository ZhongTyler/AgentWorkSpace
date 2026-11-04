/** Trusted publication approval only. Reuse an exact manual decision, never a path-only exception. */
import {hash,requireValue as ok} from './state.mjs';
import {projectWeChatURL,assertPublicSourceText,SOURCE_URL_POLICY} from './source-url-boundary.mjs';
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function manualProjectionRecords(rows=[]){
 ok(Array.isArray(rows)&&rows.length<=32,'invalid_manual_source_projections');const seen=new Set();
 for(const r of rows){ok(r&&Object.keys(r).sort().join(',')==='authorization_ref,path,public_sha256,source_sha256'&&typeof r.path==='string'&&!seen.has(r.path)&&digest(r.source_sha256)&&digest(r.public_sha256)&&typeof r.authorization_ref==='string'&&r.authorization_ref.trim().length>0,'invalid_manual_source_projection');seen.add(r.path);}
 return rows;
}
export function applyApprovedSourceProjection(bytes,record){
 manualProjectionRecords([record]);const original=Buffer.from(bytes);ok(hash(original)===record.source_sha256,'manual_source_version_changed');
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(original),front=/^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(text);ok(front,'manual_source_metadata_missing');let sourceURLs=false;
 const header=front[0].replace(/^[^\r\n]+/gm,line=>{const field=/^([\w-]+):/.exec(line);if(field)sourceURLs=field[1]==='source_url';if(!sourceURLs)return line;
  const scalar=/^([ \t]+-[ \t]*")([^"\r\n]+)(",?[ \t]*)$/.exec(line);if(!scalar)return line;return scalar[1]+projectWeChatURL(scalar[2]).url+scalar[3];
 });
 const output=Buffer.from(header+text.slice(front[0].length));ok(hash(output)===record.public_sha256,'manual_public_version_mismatch');assertPublicSourceText(output.toString('utf8'));
 return {bytes:output,changed:!original.equals(output),source_sha256:record.source_sha256,public_sha256:record.public_sha256,body_sha256:hash(Buffer.from(text.slice(front[0].length))),policy:SOURCE_URL_POLICY,manual_authorization_ref:record.authorization_ref};
}
