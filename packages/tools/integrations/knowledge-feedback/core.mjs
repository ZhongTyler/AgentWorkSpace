/** Pure feedback reducer. No filesystem, network, model, or knowledge-write access. */
import {createHash} from 'node:crypto';
export const VERSION='knowledge-feedback-v1';
const TYPES=['signal','issue','outcome_link','control'];
const KINDS=['knowledge_gap','retrieval_gap','answer_omission','source_conflict','application_mismatch','transfer_candidate','cost_problem','unknown'];
const PURPOSES=['lookup','research','application','authoring','maintenance','regression','technical'];
const ISSUE_STATES=['triage','needs_evidence','ready_for_handoff','deferred','rejected','linked'];
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
const need=(v,m)=>{if(!v)fail('invalid_record',m);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
export function canonical(value){
 if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
 if(typeof value==='number'){need(Number.isFinite(value),'Non-finite number');return JSON.stringify(value);}
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 need(plain(value),'Only JSON data is accepted');
 const keys=Object.keys(value).sort();need(!keys.some(k=>['__proto__','constructor','prototype'].includes(k)),'Reserved key');
 return '{'+keys.map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
const copy=v=>JSON.parse(canonical(v));
const id=(v,label)=>need(typeof v==='string'&&ID.test(v)&&!['__proto__','constructor','prototype'].includes(v),'Invalid '+label);
const text=(v,label,max=16000)=>need(typeof v==='string'&&v.trim().length>0&&v.length<=max,'Invalid '+label);
const date=(v,label)=>{need(typeof v==='string'&&Number.isFinite(Date.parse(v)),'Invalid '+label);return Date.parse(v);};
const refs=(v,label)=>{need(Array.isArray(v),'Invalid '+label);for(const ref of v)text(ref,label,2048);};
const allowed=(r,keys)=>need(Object.keys(r).every(k=>keys.includes(k)),'Unknown record field');
const common=['schema_version','type','id','host','library_id','view','revision','occurred_at','expires_at','policy'];
const fields={signal:['lookup_id','request_ref','purpose','kind','assertion','knowledge','sources','payload_ref','usage','outcome','increment'],issue:['category','subject','condition_key','signal_ids','owner','next_action','review_when','status','handoff_ref','evidence','counterevidence','increment'],outcome_link:['issue_id','evidence','affected','versions','validation_ref','result_ref','usage'],control:['operation','target','replica','acknowledgements','reason_code']};
export function initialState(namespace){
 for(const k of ['host','library_id','view'])id(namespace?.[k],k);
 return {schema_version:1,namespace:{host:namespace.host,library_id:namespace.library_id,view:namespace.view},cursor:0,reject_before:0,records:Object.fromEntries(TYPES.map(t=>[t,{}])),tombstones:{}};
}
export function eligibility(policy,now,expiresAt){
 if(!plain(policy)||policy.analysis_allowed!==true||policy.temporary!==false||policy.withdrawn===true)return 'excluded';
 if(policy.retention_confirmed!==true||typeof policy.version!=='string'||!policy.version)return 'excluded';
 if(!Number.isFinite(now)||!expiresAt||!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=now)return 'excluded';
 return 'eligible';
}
function increment(v){
 need(plain(v),'Invalid increment');
 for(const k of ['trigger','mechanism','basis','conditions','novelty','consumer'])text(v[k],'increment.'+k);
 refs(v.counterexamples,'increment.counterexamples');
 need(['source_fact','project_experience','synthesis','method','retrieval'].includes(v.kind),'Invalid increment kind');
 need(['hypothesis','source_grounded','observed_in_scope'].includes(v.evidence_level),'Invalid evidence level');
 need(['host','research','knowledge','tools','query'].includes(v.destination),'Invalid increment destination');
 if(v.kind==='project_experience')need(v.evidence_level!=='source_grounded','Project experience is not a source fact');
}
export function validateRecord(record){
 need(plain(record),'Expected record object');canonical(record);
 need(record.schema_version===1&&TYPES.includes(record.type),'Unsupported schema or type');
 allowed(record,[...common,...fields[record.type]]);
 for(const k of ['id','host','library_id','view'])id(record[k],k);
 need(Number.isSafeInteger(record.revision)&&record.revision>0,'Invalid revision');
 date(record.occurred_at,'occurred_at');date(record.expires_at,'expires_at');
 if(record.type!=='control')need(plain(record.policy),'Policy required');
 if(record.type==='signal'){
  id(record.lookup_id,'lookup_id');text(record.request_ref,'request_ref',2048);
  need(PURPOSES.includes(record.purpose)&&KINDS.includes(record.kind),'Invalid purpose/kind');
  need(plain(record.assertion)&&['user','agent','program','independent_reviewer'].includes(record.assertion.by),'Invalid assertion source');text(record.assertion.text,'assertion');
  need(plain(record.knowledge),'Knowledge version must be explicit, unknown values may be null');
  need(plain(record.knowledge)&&'snapshot_id' in record.knowledge&&'used_mode' in record.knowledge,'Missing actual knowledge version/mode');
  need(Array.isArray(record.sources),'Sources required, empty if none read');
  for(const s of record.sources){
   need(plain(s),'Invalid source');allowed(s,['ref','version','stage','ranges']);text(s.ref,'source.ref',2048);need(s.version===null||typeof s.version==='string'&&s.version.length>0,'Source version or null required');need(['returned','read','used','technical'].includes(s.stage),'Invalid source stage');
   if(s.ranges!==undefined){need(Array.isArray(s.ranges),'Invalid returned ranges');for(const range of s.ranges){need(plain(range),'Invalid returned range');allowed(range,['mode','heading','start_line','end_line','complete_unit','complete_source','scope_reason','role','principle_id','chars']);text(range.mode,'range.mode',128);}}
  }
  need(record.payload_ref===null||typeof record.payload_ref==='string'&&ID.test(record.payload_ref),'Payload reference must be an opaque host ID');
  if(record.increment!==undefined)increment(record.increment);
 }
 if(record.type==='issue'){
  need(KINDS.includes(record.category),'Invalid issue category');text(record.subject,'subject');text(record.condition_key,'condition_key');
  refs(record.signal_ids,'signal_ids');need(record.signal_ids.length>0,'Issue requires an observed signal');
  need(record.owner===null||typeof record.owner==='string'&&record.owner.trim(),'Invalid owner');
  text(record.next_action,'next_action');text(record.review_when,'review_when');need(ISSUE_STATES.includes(record.status),'Invalid issue status');
  refs(record.evidence,'evidence');refs(record.counterevidence,'counterevidence');
  if(record.status==='linked')need(record.owner&&typeof record.handoff_ref==='string'&&record.handoff_ref.trim(),'Linked requires owner and authoritative handoff');
  if(record.increment!==undefined)increment(record.increment);
 }
 if(record.type==='outcome_link'){
  id(record.issue_id,'issue_id');need(plain(record.evidence),'Outcome evidence required');
  for(const k of ['ingested','used','adopted','effect_observed']){
   const e=record.evidence[k];need(e===null||plain(e)&&Array.isArray(e.refs)&&e.refs.length>0,'Outcome needs specific evidence or null: '+k);
   if(e!==null){refs(e.refs,k);text(e.scope,k+'.scope');}
  }
  refs(record.affected,'affected');need(plain(record.versions),'Outcome version mapping required');
  need(record.validation_ref===null||typeof record.validation_ref==='string','Invalid validation reference');
 }
 if(record.type==='control'){
  need(['withdraw','delete','expire','ack'].includes(record.operation),'Invalid control operation');
  need(plain(record.target)&&['signal','issue','outcome_link'].includes(record.target.type),'Invalid control target');id(record.target.id,'target.id');
  if(record.operation==='ack')id(record.replica,'replica');
  // Control records are minimal tombstones, never copies of removed text.
  if(record.reason_code!==undefined)id(record.reason_code,'reason_code');
 }
 return copy(record);
}
const key=(type,id)=>type+':'+id;
function removeScope(state,target,control){
 const removed=new Set([key(target.type,target.id)]);
 let changed=true;
 while(changed){
  changed=false;
  for(const item of Object.values(state.records.issue))if(item.signal_ids.some(id=>removed.has(key('signal',id)))&&!removed.has(key('issue',item.id))){removed.add(key('issue',item.id));changed=true;}
  for(const item of Object.values(state.records.outcome_link))if(removed.has(key('issue',item.issue_id))&&!removed.has(key('outcome_link',item.id))){removed.add(key('outcome_link',item.id));changed=true;}
 }
 for(const entry of removed){const split=entry.indexOf(':'),type=entry.slice(0,split),id=entry.slice(split+1);delete state.records[type][id];state.tombstones[entry]={type,id,control_id:control.id,revision:control.revision,expires_at:control.expires_at,acknowledgements:[]};}
 return [...removed];
}
export function applyRecord(current,input,{now}={}){
 need(Number.isFinite(now),'Host must supply current time');
 const r=validateRecord(input);
 need(current?.schema_version===1&&plain(current.namespace),'Invalid feedback state');
 need(['host','library_id','view'].every(k=>r[k]===current.namespace[k]),'Namespace mismatch');
 if(r.type!=='control'&&eligibility(r.policy,now,r.expires_at)!=='eligible')return {state:current,status:'excluded',changed:false};
 const existing=current.records[r.type][r.id];
 if(existing){
  if(r.revision<existing.revision)return {state:current,status:'stale',changed:false};
  if(r.revision===existing.revision){if(canonical(r)!==canonical(existing))fail('revision_conflict','Same revision has different content');return {state:current,status:'duplicate',changed:false};}
 }
 if(r.type!=='control'&&current.tombstones[key(r.type,r.id)])return {state:current,status:'withdrawn',changed:false};
 if(r.type!=='control'&&Date.parse(r.occurred_at)<=(current.reject_before??0))return {state:current,status:'outside_retention_window',changed:false};
 if(r.type==='issue'){
  need(r.signal_ids.every(id=>current.records.signal[id]&&!current.tombstones[key('signal',id)]&&Date.parse(current.records.signal[id].expires_at)>now),'Issue references missing/withdrawn/expired signal');
  if(existing)need(['category','subject','condition_key'].every(k=>existing[k]===r[k]),'Different conditions need a different issue ID');
 }
 if(r.type==='outcome_link')need(current.records.issue[r.issue_id]&&!current.tombstones[key('issue',r.issue_id)]&&Date.parse(current.records.issue[r.issue_id].expires_at)>now,'Outcome requires an active issue');
 const state=copy(current);let removed=[];
 if(r.type==='control'){
  if(r.operation==='ack'){
   const t=state.tombstones[key(r.target.type,r.target.id)];need(t,'Cannot acknowledge unknown tombstone');
   t.acknowledgements=[...new Set([...t.acknowledgements,r.replica])].sort();
  }else removed=removeScope(state,r.target,r);
 }
 state.records[r.type][r.id]=r;state.cursor++;
 return {state,status:existing?'updated':'applied',changed:true,removed};
}
/** Explicit host retention job, not a background timer. Returns a new state only. */
export function pruneState(current,{now,tombstone_retention_ms}={}){
 need(Number.isFinite(now)&&Number.isSafeInteger(tombstone_retention_ms)&&tombstone_retention_ms>0,'Confirmed tombstone retention required');
 let state=copy(current),changed=false;
 for(const type of ['signal','issue','outcome_link'])for(const r of Object.values(state.records[type])){
  if(Date.parse(r.expires_at)>now)continue;
  const control={schema_version:1,...state.namespace,type:'control',id:'expiry:'+createHash('sha256').update(type+':'+r.id).digest('hex'),revision:r.revision,operation:'expire',target:{type,id:r.id},occurred_at:new Date(now).toISOString(),expires_at:new Date(now+tombstone_retention_ms).toISOString(),reason_code:'retention_expired'};
  const result=applyRecord(state,control,{now});state=result.state;changed=true;
 }
 for(const [id,t] of Object.entries(state.tombstones))if(Date.parse(t.expires_at)<=now){
  const c=state.records.control[t.control_id];
  state.reject_before=Math.max(state.reject_before??0,c?Date.parse(c.occurred_at):Date.parse(t.expires_at));
  delete state.tombstones[id];changed=true;
 }
 for(const [id,r] of Object.entries(state.records.control))if(Date.parse(r.expires_at)<=now){
  state.reject_before=Math.max(state.reject_before??0,Date.parse(r.occurred_at));delete state.records.control[id];changed=true;
 }
 if(changed)state.cursor++;
 return {state,changed,status:changed?'pruned':'unchanged'};
}
export function selectIssues(state,{now,terms=[],limit=5}={}){
 need(Number.isFinite(now)&&Number.isSafeInteger(limit)&&limit>=0&&limit<=50,'Invalid selection budget');
 need(Array.isArray(terms)&&terms.every(t=>typeof t==='string'),'Invalid selection terms');
 if(!terms.length||!limit)return [];
 return Object.values(state.records.issue).filter(r=>!['rejected','deferred'].includes(r.status)&&eligibility(r.policy,now,r.expires_at)==='eligible'&&!state.tombstones[key('issue',r.id)]&&r.signal_ids.every(id=>state.records.signal[id]&&eligibility(state.records.signal[id].policy,now,state.records.signal[id].expires_at)==='eligible'))
 .map(r=>({r,score:terms.filter(t=>t&&[r.subject,r.condition_key,r.increment?.trigger??''].some(v=>v.toLowerCase().includes(t.toLowerCase()))).length}))
 .filter(x=>x.score>0).sort((a,b)=>b.score-a.score||a.r.id.localeCompare(b.r.id)).slice(0,limit).map(({r})=>({id:r.id,category:r.category,owner:r.owner,status:r.status,subject:r.subject,condition_key:r.condition_key,next_action:r.next_action,handoff_ref:r.handoff_ref??null,increment:r.increment??null,review_when:r.review_when,scope:'candidate_requires_current_task_review',evidence:r.evidence,outcomes:Object.values(state.records.outcome_link).filter(o=>o.issue_id===r.id&&eligibility(o.policy,now,o.expires_at)==='eligible').map(o=>({id:o.id,validation_ref:o.validation_ref,affected:o.affected,versions:o.versions,evidence:o.evidence,result_ref:o.result_ref??null}))}));
}
