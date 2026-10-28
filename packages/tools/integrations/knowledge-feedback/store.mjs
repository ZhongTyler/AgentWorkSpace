/** Host-owned private file adapter. Explicit home; no collection or model service. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {VERSION,initialState,applyRecord,canonical,validateRecord,selectIssues,eligibility,pruneState} from './core.mjs';
const hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const order={control:0,signal:1,issue:2,outcome_link:3};
const requireValue=(ok,message)=>{if(!ok)throw Error(message);};
export class FileStore{
 constructor({home,namespace}){
  requireValue(typeof home==='string'&&path.isAbsolute(home),'Host must configure an absolute private home');
  this.home=path.resolve(home);this.namespace=initialState(namespace).namespace;
  this.file=path.join(this.home,hash(canonical(this.namespace))+'.json');
 }
 read(){
  if(!fs.existsSync(this.file))return initialState(this.namespace);
  requireValue(!fs.lstatSync(this.file).isSymbolicLink(),'State symlink refused');
  const state=JSON.parse(fs.readFileSync(this.file,'utf8'));
  requireValue(state.schema_version===1&&canonical(state.namespace)===canonical(this.namespace),'Unknown schema or wrong namespace');
  requireValue(Number.isSafeInteger(state.cursor)&&state.cursor>=0&&state.records&&state.tombstones,'Invalid private state');
  for(const [type,rows] of Object.entries(state.records))for(const [id,r] of Object.entries(rows)){
   validateRecord(r);requireValue(r.type===type&&r.id===id&&canonical({host:r.host,library_id:r.library_id,view:r.view})===canonical(this.namespace),'State record mismatch');
  }
  return state;
 }
 apply(records,{now,expectedCursor,retention=null,rejectBefore=0}={}){
  requireValue(Array.isArray(records),'Records must be an array');
  for(const r of records)validateRecord(r);
  if(records.length&&records.every(r=>r.type!=='control'&&eligibility(r.policy,now,r.expires_at)!=='eligible'))return {status:'excluded',persisted:false,results:records.map(r=>({type:r.type,id:r.id,status:'excluded'}))};
  if(!records.length&&!retention&&!rejectBefore)return {status:'no_increment',persisted:false,cursor:this.read().cursor,results:[]};
  const existingParent=(()=>{let p=this.home;while(!fs.existsSync(p))p=path.dirname(p);return p;})();
  requireValue(path.resolve(fs.realpathSync(existingParent)).toLowerCase()===existingParent.toLowerCase(),'Private home parent must not be a symlink');
  fs.mkdirSync(this.home,{recursive:true,mode:0o700});
  requireValue(fs.realpathSync(this.home)===this.home||path.resolve(fs.realpathSync(this.home)).toLowerCase()===this.home.toLowerCase(),'Private home must not be a symlink');
  const lock=this.file+'.lock';let fd;
  try{fd=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')return {status:'busy',persisted:false,retry:'next explicit host action'};throw e;}
  let temp;
  try{
   let state=this.read();
   if(expectedCursor!==undefined&&state.cursor!==expectedCursor)return {status:'cursor_conflict',persisted:false,cursor:state.cursor};
   const results=[];let maintenanceChanged=false;
   if(retention){const p=pruneState(state,{now,...retention});state=p.state;maintenanceChanged=p.changed;}
   if(rejectBefore>(state.reject_before??0)){state.reject_before=rejectBefore;state.cursor++;maintenanceChanged=true;}
   // Controls always precede imported payload; dependencies then follow their source.
   const rows=[...records].sort((a,b)=>order[a.type]-order[b.type]||(a.type==='control'&&b.type==='control'?(a.operation==='ack')-(b.operation==='ack'):0));
   for(const row of rows){const r=applyRecord(state,row,{now});state=r.state;results.push({type:row.type,id:row.id,status:r.status});}
   const changed=maintenanceChanged||results.some(r=>['applied','updated'].includes(r.status));
   if(changed){
    temp=this.file+'.'+crypto.randomUUID()+'.tmp';const out=fs.openSync(temp,'wx',0o600);
    try{fs.writeFileSync(out,canonical(state)+'\n');fs.fsyncSync(out);}finally{fs.closeSync(out);}
    fs.renameSync(temp,this.file);temp=null;
   }
   return {status:changed?'persisted':'unchanged',persisted:changed,cursor:state.cursor,results};
  }finally{
   if(temp&&fs.existsSync(temp))fs.unlinkSync(temp);
   fs.closeSync(fd);fs.unlinkSync(lock);
  }
 }
 select(options){return selectIssues(this.read(),options);}
 maintain({now,tombstone_retention_ms}={}){if(!fs.existsSync(this.file))return {status:'unchanged',persisted:false,cursor:0};return this.apply([],{now,retention:{tombstone_retention_ms}});}
 export({now,exportAllowed=false}={}){
  requireValue(exportAllowed===true,'Host-approved private export required');
  const state=this.read();
  requireValue(Object.values(state.records).flatMap(rows=>Object.values(rows)).every(r=>r.type==='control'?Date.parse(r.expires_at)>now:eligibility(r.policy,now,r.expires_at)==='eligible'),'Run authorized retention maintenance before exporting expired or ineligible data');
  const body={schema_version:1,core:VERSION,namespace:this.namespace,package_id:crypto.randomUUID(),exported_at:new Date(now).toISOString(),reject_before:state.reject_before??0,records:Object.values(state.records).flatMap(rows=>Object.values(rows)),tombstones:state.tombstones};
  return {...body,manifest_sha256:hash(canonical(body)),classification:'private_host_data'};
 }
 import(packet,{now,importAllowed=false}={}){
  requireValue(importAllowed===true,'Host-approved private import required');
  requireValue(packet?.schema_version===1&&packet.core===VERSION,'Unknown package version; retain outside state for host triage');
  const {manifest_sha256,classification,...body}=packet;
  requireValue(hash(canonical(body))===manifest_sha256,'Package checksum mismatch');
  requireValue(canonical(packet.namespace)===canonical(this.namespace),'Package scope mismatch');
  requireValue(classification==='private_host_data','Expected a private package');
  requireValue(Array.isArray(packet.records)&&packet.records.every(r=>r.type!=='control'||!['text','summary','payload_ref'].some(k=>k in r)),'Invalid private package');
  requireValue(Number.isSafeInteger(packet.reject_before)&&packet.reject_before>=0&&packet.reject_before<=now,'Invalid retention floor');
  // Replaying control records re-establishes deletion before any old payload.
  return this.apply(packet.records,{now,rejectBefore:packet.reject_before});
 }
}
