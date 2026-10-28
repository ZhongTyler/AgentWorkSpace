import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {canonical,VERSION,initialState,applyRecord,selectIssues} from '../core.mjs';
import {FileStore} from '../store.mjs';
import {createLookup,createOnlineLookup,recordsForFinding,ENTRIES} from '../host.mjs';
const now=Date.parse('2026-10-24T14:00:00Z');
const ns={host:'local',library_id:'knowledge',view:'owner'};
const policy={version:'test-1',analysis_allowed:true,temporary:false,retention_confirmed:true};
const common={schema_version:1,...ns,revision:1,occurred_at:'2026-10-24T13:00:00Z',expires_at:'2026-11-24T13:00:00Z',policy};
const signal=(id='s1',extra={})=>({...common,type:'signal',id,lookup_id:'lookup1',request_ref:'request1',purpose:'research',kind:'answer_omission',assertion:{by:'agent',text:'Condition missing from answer'},knowledge:{snapshot_id:null,used_mode:'bm25'},sources:[{ref:'knowledge:wiki:example',version:'v1',stage:'returned'}],payload_ref:null,...extra});
const issue=(id='i1',signal_ids=['s1'],extra={})=>({...common,type:'issue',id,category:'answer_omission',subject:'stage condition',condition_key:'v1-before-release',signal_ids,owner:'original-task',next_action:'Read the actual condition and correct this answer',review_when:'next relevant task',status:'triage',handoff_ref:null,evidence:['original-source-ref'],counterevidence:[],...extra});
const control=(target={type:'signal',id:'s1'},extra={})=>({...common,type:'control',id:'c1',operation:'withdraw',target,...extra});
const outcome=(extra={})=>({...common,type:'outcome_link',id:'o1',issue_id:'i1',evidence:{ingested:null,used:null,adopted:null,effect_observed:null},affected:['answer:condition'],versions:{old:'v1',new:null},validation_ref:null,result_ref:null,...extra});
const apply=(s,r)=>applyRecord(s,r,{now}).state;
const populated=()=>apply(apply(initialState(ns),signal()),issue());
function tmp(t){
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-feedback-test-'));
 t.after(()=>{assert.equal(path.dirname(path.resolve(folder)),path.resolve(os.tmpdir()));assert.ok(path.basename(folder).startsWith('knowledge-feedback-test-'));fs.rmSync(folder,{recursive:true,force:true});});
 return folder;
}
test('pure reducer does not mutate input; retries/revisions/conflicts preserve evidence',()=>{
 const before=initialState(ns),encoded=canonical(before);const result=applyRecord(before,signal(),{now});
 assert.equal(canonical(before),encoded);assert.equal(result.state.cursor,1);
 assert.equal(applyRecord(result.state,signal(),{now}).status,'duplicate');
 assert.equal(applyRecord(result.state,signal(),{now}).state.cursor,1);
 const second=applyRecord(result.state,signal('s1',{revision:2,assertion:{by:'user',text:'Corrected bounded feedback'}}),{now});
 assert.equal(second.state.cursor,2);assert.equal(Object.keys(second.state.records.signal).length,1);
 assert.equal(applyRecord(second.state,signal(),{now}).status,'stale');
 assert.throws(()=>applyRecord(result.state,signal('s1',{assertion:{by:'user',text:'different'}}),{now}),e=>e.code==='revision_conflict');
});
test('generated retry schedules obey idempotence and independent-task counts',()=>{
 // Bounded metamorphic coverage without adding a test-library dependency.
 for(let n=1;n<=64;n++){
  let state=initialState(ns);
  for(let i=0;i<n;i++){const row=signal('s'+i,{lookup_id:'q'+i});for(let retry=0;retry<1+(i%7);retry++)state=apply(state,row);}
  assert.equal(state.cursor,n);assert.equal(Object.keys(state.records.signal).length,n);
  assert.equal(new Set(Object.values(state.records.signal).map(r=>r.lookup_id)).size,n);
 }
});
test('independent record permutations commute; canonical serialization roundtrips',()=>{
 const rows=Array.from({length:24},(_,i)=>signal('s'+i));
 const forward=rows.reduce(apply,initialState(ns));const reverse=[...rows].reverse().reduce(apply,initialState(ns));
 assert.equal(canonical(forward),canonical(reverse));assert.equal(canonical(JSON.parse(canonical(forward))),canonical(forward));
 assert.throws(()=>canonical({bad:Infinity}));assert.throws(()=>canonical(JSON.parse('{"__proto__":1}')));
 for(const reserved of ['constructor','prototype'])assert.throws(()=>apply(initialState(ns),signal(reserved)));
});
test('scope, condition identity and linked ownership are enforced',()=>{
 assert.throws(()=>apply(initialState(ns),signal('s1',{library_id:'another-library'})));
 assert.throws(()=>apply(initialState(ns),issue()));
 const state=populated();
 assert.throws(()=>apply(state,issue('i1',['s1'],{revision:2,condition_key:'other-version'})));
 assert.throws(()=>apply(state,issue('i2',['s1'],{status:'linked',owner:null,handoff_ref:'fake-approved'})));
 const distinct=apply(state,issue('i2',['s1'],{condition_key:'opposite-condition'}));assert.equal(Object.keys(distinct.records.issue).length,2);
});
test('outcomes distinguish unknown from independently evidenced use/effect',()=>{
 const state=populated();const accepted=apply(state,outcome());assert.equal(accepted.records.outcome_link.o1.evidence.effect_observed,null);
 assert.equal(selectIssues(accepted,{now,terms:['stage']})[0].outcomes[0].evidence.effect_observed,null);
 assert.throws(()=>apply(state,outcome({evidence:{ingested:null,used:true,adopted:null,effect_observed:null}})));
 assert.throws(()=>apply(state,outcome({evidence:{ingested:null,used:null,adopted:null,effect_observed:{refs:[],scope:'all knowledge'}}})));
});
test('withdrawal removes dependent summaries; repeated and revised payload cannot revive them',()=>{
 let state=apply(populated(),outcome());state=apply(state,control());
 assert.equal(Object.keys(state.records.signal).length,0);assert.equal(Object.keys(state.records.issue).length,0);assert.equal(Object.keys(state.records.outcome_link).length,0);
 assert.ok(!canonical(state).includes('Condition missing from answer'));
 assert.equal(applyRecord(state,signal('s1',{revision:9}),{now}).status,'withdrawn');
 const ack=apply(state,control({type:'signal',id:'s1'},{id:'ack1',operation:'ack',replica:'offline-copy'}));
 assert.deepEqual(ack.tombstones['signal:s1'].acknowledgements,['offline-copy']);
 assert.throws(()=>apply(state,control(undefined,{id:'bad',summary:'private original text'})));
});
test('selection requires relevant terms; expiry and rejection do not re-enter a task',()=>{
 let state=populated();assert.equal(selectIssues(state,{now,terms:[]}).length,0);
 assert.equal(selectIssues(state,{now,terms:['stage']})[0].id,'i1');
 assert.equal(selectIssues(state,{now,terms:['unrelated']}).length,0);
 assert.equal(selectIssues(state,{now:Date.parse('2027-01-01'),terms:['stage']}).length,0);
 state=apply(state,issue('i1',['s1'],{revision:2,status:'rejected'}));assert.equal(selectIssues(state,{now,terms:['stage']}).length,0);
});
test('all registered entries have an ephemeral no-increment path; excluded requests leave no file',t=>{
 const home=path.join(tmp(t),'never-created'),store=new FileStore({home,namespace:ns});
 for(const entry of Object.keys(ENTRIES)){
  const context={...ns,lookup_id:'lookup1',request_ref:'request1',purpose:'research',entry,policy,expires_at:common.expires_at};
  const lookup=createLookup(context,{store,now:()=>now});
  lookup.observe({operation:'returned',source:{ref:'source1',version:'v1',stage:'returned'}});
  lookup.observe({operation:'returned',source:{ref:'source1',version:'v1',stage:'returned'}});
  const receipt=lookup.finish();assert.equal(receipt.observation_count,1);assert.equal(receipt.compounding_status,'no_increment');assert.equal(receipt.persisted,false);
 }
 assert.equal(fs.existsSync(home),false);
 for(const p of [{...policy,temporary:true},{...policy,analysis_allowed:false},{...policy,retention_confirmed:false}]){
  const lookup=createLookup({...ns,lookup_id:'lookup1',request_ref:'request1',purpose:'research',entry:'query_api',policy:p,expires_at:common.expires_at},{store,now:()=>now});
  assert.equal(lookup.finish({signals:[signal()]}).compounding_status,'excluded');
 }
 assert.equal(fs.existsSync(home),false);
});
test('transaction rollback, stale writers, retry import, and deletion-before-import',t=>{
 const store=new FileStore({home:path.join(tmp(t),'state'),namespace:ns});
 assert.equal(store.apply([signal(),issue()],{now}).status,'persisted');
 const original=fs.readFileSync(store.file,'utf8');
 assert.throws(()=>store.apply([signal('s2'),issue('bad',['does-not-exist'])],{now}));assert.equal(fs.readFileSync(store.file,'utf8'),original);
 assert.equal(store.apply([signal('s2')],{now,expectedCursor:0}).status,'cursor_conflict');
 const old=store.export({now,exportAllowed:true});assert.throws(()=>store.export({now}));
 const changed=structuredClone(old);changed.records.find(r=>r.type==='signal').assertion.text='tampered';assert.throws(()=>store.import(changed,{now,importAllowed:true}));
 assert.equal(store.import(old,{now,importAllowed:true}).status,'unchanged');
 store.apply([control()],{now});
 const withdrawnBytes=fs.readFileSync(store.file,'utf8');
 assert.equal(store.import(old,{now,importAllowed:true}).persisted,false);assert.equal(fs.readFileSync(store.file,'utf8'),withdrawnBytes);
 assert.ok(!fs.readFileSync(store.file,'utf8').includes('Condition missing from answer'));
 const latest=store.export({now,exportAllowed:true});
 const restored=new FileStore({home:path.join(tmp(t),'restored'),namespace:ns});restored.import(latest,{now,importAllowed:true});
 assert.equal(restored.apply([signal('s1',{revision:11})],{now}).results[0].status,'withdrawn');
 assert.equal(restored.read().schema_version,1);assert.equal(VERSION,latest.core);
});
test('expiry removes content and finite-lived tombstones without reviving old packages',t=>{
 const store=new FileStore({home:path.join(tmp(t),'state'),namespace:ns});
 store.apply([signal(),issue()],{now});const old=store.export({now,exportAllowed:true});
 const later=Date.parse('2026-12-01T00:00:00Z');
 assert.throws(()=>store.export({now:later,exportAllowed:true}),/retention maintenance/);
 assert.equal(store.maintain({now:later,tombstone_retention_ms:60000}).status,'persisted');
 assert.ok(!fs.readFileSync(store.file,'utf8').includes('Condition missing from answer'));
 assert.ok(Object.keys(store.read().tombstones).length>0);
 store.maintain({now:later+60001,tombstone_retention_ms:60000});
 assert.equal(Object.keys(store.read().tombstones).length,0);assert.equal(Object.keys(store.read().records.control).length,0);
 const before=fs.readFileSync(store.file,'utf8');store.import(old,{now:later+60002,importAllowed:true});assert.equal(fs.readFileSync(store.file,'utf8'),before);
 const packet=store.export({now:later+60002,exportAllowed:true});
 const restored=new FileStore({home:path.join(tmp(t),'restored'),namespace:ns});restored.import(packet,{now:later+60002,importAllowed:true});
 restored.import(old,{now:later+60002,importAllowed:true});assert.equal(Object.keys(restored.read().records.signal).length,0);
});
test('policy booleans cannot be string-coerced and excluded direct storage retains nothing',t=>{
 const home=path.join(tmp(t),'never-created'),store=new FileStore({home,namespace:ns});
 for(const p of [{...policy,analysis_allowed:'false'},{...policy,temporary:'false'},{...policy,retention_confirmed:'yes'}])assert.equal(store.apply([signal('s1',{policy:p})],{now}).status,'excluded');
 assert.equal(fs.existsSync(home),false);
 assert.throws(()=>store.apply([{...signal(),schema_version:2}],{now}));assert.equal(fs.existsSync(home),false);
});
test('producer defers retention writes; explicit task finish cleans expiry without creating a new signal',t=>{
 const home=path.join(tmp(t),'private'),store=new FileStore({home,namespace:ns});
 const context={...ns,lookup_id:'lookup1',request_ref:'request1',purpose:'research',entry:'research',policy,expires_at:'2027-01-01T00:00:00Z',retention:{tombstone_retention_ms:60000}};
 const empty=createLookup(context,{store,now:()=>now});assert.equal(empty.finish().compounding_status,'no_increment');assert.equal(fs.existsSync(home),false);
 store.apply([signal()],{now});const before=fs.readFileSync(store.file,'utf8'),later=Date.parse('2026-12-01T00:00:00Z');
 const lookup=createLookup(context,{store,now:()=>later});assert.equal(lookup.finish({defer:true}).assessment,'awaiting_current_agent');assert.equal(fs.readFileSync(store.file,'utf8'),before);
 const result=lookup.finish();assert.equal(result.compounding_status,'no_increment');assert.equal(result.maintenance.persisted,true);assert.equal(Object.keys(store.read().records.signal).length,0);
});
test('storage failure leaves original task available and a bounded pending reference',()=>{
 const lookup=createLookup({...ns,lookup_id:'lookup1',request_ref:'request1',purpose:'research',entry:'query_cli',policy,expires_at:common.expires_at},{store:{apply(){throw Error('disk unavailable');}},now:()=>now});
 const answer='Original answer still delivered';const result=lookup.finish({signals:[signal()],issues:[issue()]});
 assert.equal(answer,'Original answer still delivered');assert.equal(result.compounding_status,'unavailable');assert.equal(result.pending_ref,'request1');
});
test('online bridge refuses browser identity/paths and hides private receipt fields',()=>{
 const trustedContext={...ns,host:'online',view:'public-knowledge',entry:'online',lookup_id:'online-request1',request_ref:'server-request1',purpose:'lookup',authenticated:true,policy,expires_at:common.expires_at,public_snapshot_id:'public-v1'};
 assert.throws(()=>createOnlineLookup({trustedContext:{...trustedContext,authenticated:false}}));
 assert.throws(()=>createOnlineLookup({trustedContext,browserFeedback:{request_id:'online-request1',revision:1,rating:'helpful',payload_ref:'private-file'}}));
 assert.throws(()=>createOnlineLookup({trustedContext,browserFeedback:{request_id:'other-person',revision:1,rating:'helpful'}}));
 const lookup=createOnlineLookup({trustedContext,now:()=>now});const result=lookup.publicReceipt({...lookup.finish(),payload_ref:'secret',path:'private',observations:['hidden']});
 assert.deepEqual(result,{request_id:'online-request1',compounding_status:'no_increment',knowledge_version:'public-v1'});
});
test('finding factory binds mechanical fields to actual receipt and preserves conflicting versions',()=>{
 const lookup=createLookup({...ns,lookup_id:'lookup1',request_ref:'request1',purpose:'research',entry:'research',policy,expires_at:common.expires_at},{now:()=>now});
 lookup.observe({operation:'read',source:{ref:'source-A',version:'v1',stage:'returned'}});
 const receipt=lookup.finish(),finding={id:'finding-A',kind:'answer_omission',summary:'A genuine bounded correction',consumption:[{ref:'source-A',stage:'read'}]};
 const a=recordsForFinding(receipt.continuation,receipt.observations,finding),b=recordsForFinding(receipt.continuation,receipt.observations,finding);
 assert.equal(canonical(a),canonical(b));assert.equal(a.signals[0].sources[0].version,'v1');assert.equal(a.signals[0].occurred_at,new Date(now).toISOString());
 assert.throws(()=>recordsForFinding(receipt.continuation,receipt.observations,{...finding,consumption:[{ref:'not-read',stage:'used'}]}));
 const changed=[...receipt.observations,{operation:'read',source:{ref:'source-A',version:'v2',stage:'returned'}}];
 assert.throws(()=>recordsForFinding(receipt.continuation,changed,finding));
 const selected=recordsForFinding(receipt.continuation,changed,{...finding,consumption:[{ref:'source-A',version:'v2',stage:'read'}]});
 assert.equal(selected.signals[0].sources.length,2);assert.equal(selected.signals[0].sources.find(s=>s.version==='v1').stage,'returned');
});
