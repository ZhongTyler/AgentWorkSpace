/** Shared host adapter. Lookup aggregation is ephemeral; only real increments persist. */
import {VERSION,eligibility,canonical} from './core.mjs';
import {createHash} from 'node:crypto';
export const ENTRIES=Object.freeze({
 query_cli:'managed',query_api:'managed',direct_read:'managed',principles:'managed',research:'managed',
 project:'managed',ingest:'managed',audit:'managed',regression:'managed',rag_cache:'managed',online:'managed',manual:'manual_only'
});
const assert=(v,m)=>{if(!v)throw Error(m);};
export function createLookup(context,{store=null,now=()=>Date.now()}={}){
 for(const field of ['lookup_id','host','library_id','view','purpose','entry','request_ref'])assert(typeof context?.[field]==='string'&&context[field],field+' required');
 assert(Object.hasOwn(ENTRIES,context.entry),'Unknown entry: register and test the producer');
 context=structuredClone(context);
 const observations=new Map(),started=now();let finished=null;
 const policy=context.policy??null;
 function observe(event){
  if(finished)return {status:'closed'};
  assert(Object.hasOwn(ENTRIES,event.entry??context.entry),'Unknown observation entry');
  // No content or arbitrary tool results are retained in lookup bookkeeping.
  const source=event.source??null;
  if(source){assert(typeof source.ref==='string','Source ref required');assert(['returned','read','used','technical'].includes(source.stage),'Unknown source stage');}
  const key=[event.entry??context.entry,event.operation??'',source?.ref??'',source?.version??'',canonical(source?.ranges??(source?.range?[source.range]:[]))].join('\0');
  const prior=observations.get(key),rank={returned:0,read:1,used:2,technical:-1};
  if(!prior||rank[source?.stage??'returned']>=rank[prior.source?.stage??'returned'])observations.set(key,{entry:event.entry??context.entry,operation:event.operation??null,status:event.status??null,source:source?{ref:source.ref,version:source.version??null,stage:source.stage,ranges:structuredClone(source.ranges??(source.range?[source.range]:[]))}:null,...(event.knowledge?{knowledge:{snapshot_id:event.knowledge.snapshot_id??null,used_mode:event.knowledge.used_mode??null}}:{})});
  return {status:'observed',persisted:false};
 }
 function snapshot(){
  const continuation=Object.fromEntries(['lookup_id','request_ref','host','library_id','view','purpose','entry','expires_at','enabled','retention'].filter(k=>context[k]!==undefined).map(k=>[k,context[k]]));
  continuation.started_at=context.started_at??new Date(started).toISOString();
  continuation.policy=policy?Object.fromEntries(['version','analysis_allowed','temporary','retention_confirmed','withdrawn'].filter(k=>policy[k]!==undefined).map(k=>[k,policy[k]])):null;
  return {core:VERSION,lookup_id:context.lookup_id,purpose:context.purpose,entry:context.entry,continuation,observations:[...observations.values()],persisted:false};
 }
 function finish({signals=[],issues=[],outcomes=[],outcome='completed',usage=null,defer=false}={}){
  if(finished)return finished;
  const stamp=now(),rows=[...signals,...issues,...outcomes];
  const base={...snapshot(),outcome,elapsed_ms:Math.max(0,stamp-started),usage,observation_count:observations.size};
  if(eligibility(policy,stamp,context.expires_at)!=='eligible')return finished={...base,compounding_status:'excluded'};
  if(context.enabled===false)return finished={...base,compounding_status:'disabled'};
  if(defer){assert(!rows.length,'Producer cannot discard supplied semantic increments');return {...base,compounding_status:'pending',assessment:'awaiting_current_agent',pending_ref:context.request_ref};}
  if(!rows.length){
   if(context.retention&&store?.maintain)try{const maintenance=store.maintain({now:stamp,...context.retention});return finished={...base,compounding_status:'no_increment',persisted:maintenance.persisted,maintenance};}catch(e){return finished={...base,compounding_status:'unavailable',reason:e.code??e.message,pending_ref:context.request_ref};}
   return finished={...base,compounding_status:'no_increment'};
  }
  for(const row of rows){
   assert(['host','library_id','view'].every(k=>row[k]===context[k]),'Record scope differs from lookup');
   if(row.type==='signal')assert(row.lookup_id===context.lookup_id&&row.request_ref===context.request_ref&&row.purpose===context.purpose,'Signal not bound to actual task');
  }
  if(!store)return finished={...base,compounding_status:'unavailable',pending_ref:context.request_ref};
  try{
   const result=store.apply(rows,{now:stamp,...(context.retention?{retention:context.retention}:{})});
   const accepted=['persisted','unchanged'].includes(result.status);
   return finished={...base,compounding_status:accepted?(issues.some(i=>i.status==='linked')?'linked':'pending'):'unavailable',persisted:result.persisted,storage:result,pending_ref:accepted?null:context.request_ref};
  }catch(e){return finished={...base,compounding_status:'unavailable',reason:e.code??e.message,pending_ref:context.request_ref};}
 }
 function pending({terms,limit=5}={}){
  if(!Array.isArray(terms)||!terms.length||limit===0)return [];
  if(context.enabled===false||!store||eligibility(policy,now(),context.expires_at)!=='eligible')return [];
  try{return store.select({now:now(),terms,limit});}catch{return [];}
 }
 return Object.freeze({observe,snapshot,finish,pending});
}
/** Mechanical fields come from the actual host receipt; semantics remain the agent's. */
export function recordsForFinding(context,observations,finding){
 assert(typeof finding?.id==='string'&&finding.id.trim(),'Stable finding ID required');
 assert(typeof context.started_at==='string','Use the actual lookup continuation to bind event time');
 const seed=[context.host,context.library_id,context.view,context.lookup_id,finding.id].join('\0');
 const suffix=createHash('sha256').update(seed).digest('hex').slice(0,40);
 const common={schema_version:1,host:context.host,library_id:context.library_id,view:context.view,revision:finding.revision??1,occurred_at:finding.occurred_at??context.started_at,expires_at:context.expires_at,policy:context.policy};
 const actual=new Map(),rank={technical:-1,returned:0,read:1,used:2};
 for(const event of observations)if(event.source){
  const s=event.source,k=s.ref+'\0'+(s.version??''),old=actual.get(k),ranges=[...(old?.ranges??[]),...(s.ranges??[])];
  actual.set(k,{...s,stage:old&&rank[old.stage]>rank[s.stage]?old.stage:s.stage,ranges:[...new Map(ranges.map(r=>[JSON.stringify(r),r])).values()]});
 }
 const consumption=finding.consumption??[];
 const requested=new Map();
 for(const source of consumption){
  const matches=[...actual.entries()].filter(([,s])=>s.ref===source.ref&&(source.version===undefined||s.version===source.version));
  assert(matches.length===1,'Source missing or has several observed versions; select the actual version explicitly');
  assert(['read','used','returned','technical'].includes(source.stage),'Explicit source stage required');requested.set(matches[0][0],source.stage);
 }
 const sources=[...actual.entries()].map(([k,s])=>({...s,stage:requested.get(k)??s.stage}));
 const knowledge=[...observations].reverse().find(o=>o.knowledge)?.knowledge??{snapshot_id:null,used_mode:null};
 const signal={...common,type:'signal',id:'signal-'+suffix,lookup_id:context.lookup_id,request_ref:context.request_ref,purpose:context.purpose,kind:finding.kind??'unknown',assertion:{by:finding.by??'agent',text:finding.summary},knowledge,sources,payload_ref:finding.payload_ref??null,usage:finding.usage??null,...(finding.increment?{increment:finding.increment}:{})};
 const signals=[signal],issues=[],outcomes=[];
 if(finding.issue){
  const i=finding.issue;
  issues.push({...common,type:'issue',id:i.id??'issue-'+suffix,category:signal.kind,subject:i.subject,condition_key:i.condition_key,signal_ids:[...new Set([...(i.signal_ids??[]),signal.id])],owner:i.owner??null,next_action:i.next_action,review_when:i.review_when,status:i.status??'triage',handoff_ref:i.handoff_ref??null,evidence:i.evidence??[],counterevidence:i.counterevidence??[],...(finding.increment?{increment:finding.increment}:{})});
 }
 if(finding.outcome){
  assert(issues.length||finding.outcome.issue_id,'Outcome must link an issue');
  const o=finding.outcome;
  outcomes.push({...common,type:'outcome_link',id:o.id??'outcome-'+suffix,issue_id:o.issue_id??issues[0].id,evidence:{ingested:null,used:null,adopted:null,effect_observed:null,...o.evidence},affected:o.affected??[],versions:o.versions??{},validation_ref:o.validation_ref??null,result_ref:o.result_ref??null,usage:o.usage??null});
 }
 return {signals,issues,outcomes};
}
/** Server-only bridge: context must come from authenticated host, never browser fields. */
export function createOnlineLookup({trustedContext,browserFeedback=null,store=null,now}={}){
 assert(trustedContext?.authenticated===true,'Server-authenticated context required');
 assert(trustedContext.entry==='online'&&trustedContext.lookup_id&&trustedContext.request_ref,'Server request binding required');
 if(browserFeedback!==null){
  assert(browserFeedback&&Object.keys(browserFeedback).every(k=>['request_id','revision','rating'].includes(k)),'Browser cannot provide paths, sources, assertions or permissions');
  assert(browserFeedback.request_id===trustedContext.lookup_id,'Feedback belongs to another request');
  assert(Number.isSafeInteger(browserFeedback.revision)&&browserFeedback.revision>0,'Invalid feedback revision');
  assert(['helpful','unhelpful','unspecified'].includes(browserFeedback.rating),'Invalid feedback rating');
 }
 const {authenticated,...context}=trustedContext;
 const lookup=createLookup(context,{store,now});
 return Object.freeze({...lookup,publicReceipt:receipt=>({request_id:context.lookup_id,compounding_status:receipt.compounding_status,knowledge_version:context.public_snapshot_id??null})});
}
