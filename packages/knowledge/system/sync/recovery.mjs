// Explicit, encrypted inbox recovery adapter. No timer, server call or credential export.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {canonical,hash,requireValue,namespaceKey,ensurePrivateHome,atomicJson} from './state.mjs';
import {assertMinimalMetadata} from './private-metadata.mjs';
const AAD=Buffer.from('knowledge-local-inbox-backup-v1');
export function sealInbox(packets,key,{now=Date.now()}={}){
 requireValue(Buffer.isBuffer(key)&&key.length===32,'recovery_key_required');
 requireValue(Array.isArray(packets)&&packets.length>0&&packets.length<=100,'invalid_recovery_scope');
 for(const p of packets){requireValue(p?.schema_version===1&&p.core==='knowledge-feedback-v1'&&p.classification==='private_host_data'&&Array.isArray(p.records)&&Object.keys(p).every(k=>['schema_version','core','namespace','package_id','exported_at','reject_before','records','tombstones','manifest_sha256','classification'].includes(k)),'invalid_recovery_schema');
  requireValue(p.records.every(r=>['signal','issue','outcome_link','control'].includes(r.type)),'invalid_recovery_schema');
  assertMinimalMetadata(p);
 }
 const body=Buffer.from(canonical({schema:1,createdAt:new Date(now).toISOString(),packets}));
 requireValue(body.length<=32*1024*1024,'recovery_capacity');
 const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(AAD);
 try{return Buffer.concat([iv,cipher.update(body),cipher.final(),cipher.getAuthTag()]);}finally{body.fill(0);}
}
export function writeInboxBackup(file,packets,key,{now=Date.now(),policyConfirmed=false}={}){
 requireValue(policyConfirmed===true,'backup_policy_unconfirmed');
 ensurePrivateHome(path.dirname(file));requireValue(!fs.existsSync(file),'backup_exists');
 const encrypted=sealInbox(packets,key,{now});const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,encrypted);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const receipt={schema:1,createdAt:new Date(now).toISOString(),encrypted:true,encryptedSha256:hash(encrypted),bytes:encrypted.length,credentialsIncluded:false,namespaceCount:packets.length};
 atomicJson(file+'.receipt.json',receipt);return receipt;
}
export function restoreInbox(encrypted,key,{target,storeFactory,currentControls,allowedNamespaces,now=Date.now(),tombstoneRetentionMs}={}){
 requireValue(Buffer.isBuffer(encrypted)&&encrypted.length>=28&&encrypted.length<=33*1024*1024&&Buffer.isBuffer(key)&&key.length===32,'invalid_recovery_package');
 requireValue(Number.isSafeInteger(tombstoneRetentionMs)&&tombstoneRetentionMs>0,'retention_unconfigured');
 requireValue(!fs.existsSync(target)||fs.readdirSync(target).length===0,'empty_restore_target_required');
 // The caller must obtain fresh authenticated control-only core exports under
 // the original namespace. An old backup is never its own deletion authority.
 requireValue(Array.isArray(currentControls)&&Array.isArray(allowedNamespaces),'current_controls_required');
 const d=crypto.createDecipheriv('aes-256-gcm',key,encrypted.subarray(0,12));d.setAAD(AAD);d.setAuthTag(encrypted.subarray(-16));
 let bytes;try{bytes=Buffer.concat([d.update(encrypted.subarray(12,-16)),d.final()]);}catch{throw Object.assign(new Error('recovery_authentication'),{code:'recovery_authentication'});}
 let body;try{body=JSON.parse(bytes.toString('utf8'));}finally{bytes.fill(0);}
 requireValue(body?.schema===1&&Array.isArray(body.packets)&&body.packets.length>0,'invalid_recovery_schema');
 const seen=new Set(),controls=new Map(currentControls.map(p=>[namespaceKey(p.namespace),p]));
 for(const packet of body.packets){const k=namespaceKey(packet.namespace),control=controls.get(k);
  requireValue(Array.isArray(packet.records)&&packet.records.every(r=>['signal','issue','outcome_link','control'].includes(r.type)),'invalid_recovery_schema');
  assertMinimalMetadata(packet);
  requireValue(!seen.has(k)&&allowedNamespaces.some(ns=>namespaceKey(ns)===k),'recovery_scope');seen.add(k);
  requireValue(control&&Date.parse(control.exported_at)<=now&&now-Date.parse(control.exported_at)<=300000&&control.records.every(r=>r.type==='control'),'current_controls_required');
  assertMinimalMetadata(control);
 }
 ensurePrivateHome(target);
 const receipts=[];
 for(const packet of body.packets){const k=namespaceKey(packet.namespace),store=storeFactory(path.join(target,'inbox'),packet.namespace);
  const control=store.import(controls.get(k),{now,importAllowed:true});requireValue(!['busy','cursor_conflict'].includes(control.status),'restore_busy');
  const imported=store.import(packet,{now,importAllowed:true});requireValue(!['busy','cursor_conflict'].includes(imported.status),'restore_busy');
  store.maintain({now,tombstone_retention_ms:tombstoneRetentionMs});
  receipts.push({namespace:k,controlApplied:true,importStatus:imported.status});
 }
 const receipt={schema:1,status:'restored-isolated',at:new Date(now).toISOString(),encryptedSha256:hash(encrypted),namespaces:receipts,
  controlWatermarksVerified:true,transportCheckpointsRestored:false,credentialsIncluded:false,providerCalls:0,productionWrites:0};
 atomicJson(path.join(target,'restore-receipt.json'),receipt);return receipt;
}
