import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {agentPolicy,taskDispatch} from '../system/maintenance/checklists/ingest-agent-routing.mjs';
import {preparePostReread,advancePostReread,postRereadCost} from '../system/maintenance/checklists/ingest-post-reread.mjs';
import {agentConfiguration} from '../system/maintenance/checklists/ingest-runtime-contract.mjs';
import {sha} from '../system/maintenance/checklists/raw-quality.mjs';
import {validateTextReview} from '../system/maintenance/checklists/raw-fidelity.mjs';
const parent=process.env.CODEX_THREAD_ID??'11111111-1111-4111-8111-111111111111',writer='22222222-2222-4222-8222-222222222222',worker='33333333-3333-4333-8333-333333333333';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-role-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof v==='string'?v:JSON.stringify(v,null,2)+'\n');};
 const read=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
 const git=(...args)=>execFileSync('git',['-c','safe.directory=*','-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const policy=agentPolicy(root,{codex:false});
 put('Clippings/source.md','# Source\nA measured gain is conditional; a counterexample remains.');
 put('raw-sources/a.md','---\nsource: Original\nsource_url: https://example.invalid\nsource_clipping: "[[Clippings/source]]"\ndate: 2026-10-27\ndomains: [test]\n---\n# Raw\n\n## Mechanism\n\n> 📍 原文：全文\n\nA measured gain is conditional.');
 put('raw-sources/other.md','# Previously reviewed unrelated Raw');
 put('wiki/one.md','---\nsources:\n  - raw-sources/a.md\n---\n# Wiki one\nA conditional gain.\n## 来源\n- [[raw-sources/a]]\n');
 put('wiki/two.md','---\nsources:\n  - raw-sources/a.md\n---\n# Wiki two\nA limitation.\n## 来源\n- [[raw-sources/a]]\n');
 put('wiki/unrelated.md','---\nsources:\n  - raw-sources/other.md\n---\n# Unrelated old page\nA different topic.\n## 来源\n- [[raw-sources/other]]\n');
 put('system/registry/raw-list.md','| a.md | Original | topic | test | 2 | no | 7 |\n| other.md | Other | topic | test | 1 | no | 7 |\n');
 const rp='system/maintenance/ingest-runs/batch/run.json',report='system/maintenance/ingest-runs/batch/final-review.md';put(report,'# Approved original');
 const bindings={host:'codex',writer:{thread_id:writer},post_ingest_reread:{thread_id:worker}};
 const manifestPath='system/maintenance/ingest-runs/batch/final-review-content.json';put(manifestPath,{batch_id:'fixture-batch',review_sha256:sha('# Approved original'),files:['Clippings/source.md','raw-sources/a.md','wiki/one.md','wiki/two.md'].map(p=>({path:p,exists:true,sha256:sha(fs.readFileSync(path.join(root,p)))}))});
 const run={batch_id:'fixture-batch',status:'completed',artifacts:[{kind:'raw',disposition:'ingested',path:'raw-sources/a.md'}],execution_control:{writer_config:policy.writer_config,post_ingest_reread:{...policy.post_ingest_reread,enabled:true},task_session_bindings:bindings,artifact_authors:{'raw-sources/a.md':{agent_id:writer}},parent_reviewer:{agent_id:parent}},final_review:{path:report,sha256:sha('# Approved original'),approved_sha256:sha('# Approved original'),content_manifest:manifestPath,content_manifest_sha256:sha(fs.readFileSync(path.join(root,manifestPath)))}};put(rp,run);
 for(const args of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['add','.'],['commit','-m','fixture']])git(...args);
 const prepare=()=>preparePostReread(root,{run:rp,parent});
 const complete=(r,{limits=false,candidate=false,model='gpt-6-astra'}={})=>{
  const state=read(r.state),file=state.worker_report,data=read(file);data.summary='Actual fixture full reading; no product effect inference';data.full_reads.forEach(x=>x.read=true);
  for(const row of data.rows){for(const k of Object.keys(row.checks))row.checks[k]=true;row.media={status:limits?'material_limited':'not_necessary',basis:'Fixture source contains plain text only',limitations:limits?['Fixture unavailable diagram']:[]};}
  if(candidate){const p=path.posix.dirname(r.state)+'/candidates/raw-sources/a.md';put(p,fs.readFileSync(path.join(root,'raw-sources/a.md'),'utf8')+'\nThe counterexample remains.');data.candidates=[{path:'raw-sources/a.md',candidate:p}];}
  put(file,data);put(state.host_event,{agent_id:worker,sent:true,completed:true});
  const stamp=new Date(Date.parse(state.dispatched_at)+1000).toISOString();put('host/worker.jsonl',[{type:'session_meta',timestamp:stamp,payload:{id:worker}},{type:'turn_context',timestamp:stamp,payload:{model,effort:'medium'}}].map(JSON.stringify).join('\n')+'\n');
  return {state,log:path.join(root,'host/worker.jsonl')};
 };
 const mainReady=r=>{const s=read(r.state),m=read(s.main_review);m.state='ready';m.decision='passed';m.findings_resolved=true;m.summary='Main reread verified the actual source and all candidates';m.exceptions_disposition='No rule-external change';m.full_readback.forEach(x=>x.reviewed=true);put(s.main_review,m);return m;};
 return {root,rp,run,put,read,git,prepare,complete,mainReady};
}
test('policy pins Terra xhigh / optional Astra medium; bindings are local and caller-independent',t=>{
 const f=fixture(t),p=agentPolicy(f.root,{codex:false});assert.deepEqual(p.writer_config,{model:'gpt-6.1-terra',reasoning_effort:'xhigh'});assert.deepEqual(p.post_ingest_reread,{enabled:false,model:'gpt-6-astra',reasoning_effort:'medium'});assert.equal(p.task_session_bindings,null);
 f.put('system/maintenance/ingest-agent-bindings.local.json',{schema_version:1,host:'codex',enabled:true,writer:{thread_id:writer},post_ingest_reread:{thread_id:worker}});
 const bound=agentPolicy(f.root,{codex:true});assert.equal(bound.task_session_bindings.writer.thread_id,writer);const dispatch=taskDispatch(bound.task_session_bindings.writer,p.writer_config,'Exact message');assert.equal(dispatch.arguments.model,'gpt-6.1-terra');assert.equal(dispatch.arguments.thinking,'xhigh');assert.equal(dispatch.arguments.prompt,'Exact message');
 assert.equal(agentPolicy(f.root,{codex:false}).task_session_bindings,null);
 const local=f.read('system/maintenance/ingest-agent-bindings.local.json');local.post_ingest_reread.enabled=true;f.put('system/maintenance/ingest-agent-bindings.local.json',local);assert.equal(agentPolicy(f.root,{codex:true}).post_ingest_reread.enabled,true);assert.equal(agentPolicy(f.root,{codex:false}).post_ingest_reread.enabled,false);
});
test('disabled makes no maintenance files; old unapproved runs cannot enter',t=>{
 const f=fixture(t);f.run.execution_control.post_ingest_reread.enabled=false;f.put(f.rp,f.run);assert.equal(f.prepare().type,'disabled');assert.equal(fs.existsSync(path.join(f.root,'system/maintenance/post-ingest-rereads')),false);
 f.run.status='awaiting_final_review';f.put(f.rp,f.run);assert.throws(()=>preparePostReread(f.root,{run:f.rp,parent,enabled:true}),/Finish/);
});
test('actual controller start pins the Codex bindings and explicit optional flag without migrating old runs',t=>{
 const f=fixture(t),project=path.resolve(import.meta.dirname,'..'),tools='system/maintenance/checklists',original=fs.readFileSync(path.join(f.root,f.rp),'utf8');
 fs.cpSync(path.join(project,tools),path.join(f.root,tools),{recursive:true});
 fs.cpSync(path.join(project,'system/maintenance/schemas'),path.join(f.root,'system/maintenance/schemas'),{recursive:true});
 f.put('system/registry/ingest-auto-review-state.json',{schema_version:1,status:'inactive',stage:'none',batch_id:null,items:[],started_at:null,last_completed_batch:null,last_completed_at:null});
 f.put('system/registry/ingest-semantic-review-policy.json',{schema_version:2,mode:'disabled',default_mode:'disabled',precision_mode:'enforced'});
 for(const p of ['domains/README.md','raw-sources/README.md','wiki/README.md'])f.put(p,'# Rules');
 f.put('Clippings/20261027-new.md','# New source');
 f.put('system/maintenance/ingest-agent-bindings.local.json',{schema_version:1,host:'codex',enabled:true,writer:{thread_id:writer},post_ingest_reread:{thread_id:worker,enabled:true}});
 const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='psmodulepath')),CODEX_THREAD_ID:parent,GIT_CONFIG_GLOBAL:'NUL'};
 f.git('add','.');f.git('commit','-m','fixture controller setup');
 const run='system/maintenance/ingest-runs/new/run.json';
 const r=spawnSync('powershell',['-NoProfile','-File',path.join(f.root,tools,'ingest-control.ps1'),'-Action','start','-RunPath',run,'-BatchId','new','-Items','Clippings/20261027-new.md','-BeforeCount','2','-ReviewPolicy','deferred'],{encoding:'utf8',env});
 assert.equal(r.status,0,r.stderr+r.stdout);const state=f.read(run).execution_control;
 assert.deepEqual(state.writer_config,{model:'gpt-6.1-terra',reasoning_effort:'xhigh'});assert.equal(state.post_ingest_reread.enabled,true);assert.equal(state.task_session_bindings.writer.thread_id,writer);assert.equal(state.task_session_bindings.post_ingest_reread.thread_id,worker);assert.equal(fs.readFileSync(path.join(f.root,f.rp),'utf8'),original);
});
test('changed approved bytes cannot be silently accepted as the post-reread baseline',t=>{
 const f=fixture(t);f.put('raw-sources/a.md','Changed since approval');assert.throws(()=>f.prepare(),/source set|Approved content drift/);assert.equal(fs.existsSync(path.join(f.root,'system/maintenance/post-ingest-rereads')),false);
});
test('one-to-many full scope, immutable old approval, exact model dispatch and bounded wait',t=>{
 const f=fixture(t),before=fs.readFileSync(path.join(f.root,f.rp),'utf8'),r=f.prepare(),s=f.read(r.state);assert.equal(r.host_dispatch.arguments.threadId,worker);assert.equal(r.host_dispatch.arguments.model,'gpt-6-astra');assert.equal(r.host_dispatch.arguments.thinking,'medium');assert.deepEqual(s.baseline.filter(x=>x.kind==='wiki').map(x=>x.path),['wiki/one.md','wiki/two.md']);assert(!s.baseline.some(x=>x.path.includes('unrelated')||x.path.includes('other.md')));
 f.put(s.host_event,{agent_id:worker,sent:true,completed:false});assert.equal(advancePostReread(f.root,{state:r.state}).type,'waiting_agent');assert.equal(fs.readFileSync(path.join(f.root,f.rp),'utf8'),before);
});
test('new task windows ignore old inherited models but reject wrong current turn',t=>{
 const f=fixture(t),r=f.prepare(),s=f.read(r.state),old='2026-01-01T00:00:00Z',now=new Date(Date.parse(s.dispatched_at)+1000).toISOString(),log=path.join(f.root,'models.jsonl');
 f.put('models.jsonl',[{type:'session_meta',timestamp:old,payload:{id:worker}},{type:'turn_context',timestamp:old,payload:{model:'gpt-6-sol',effort:'medium'}},{type:'turn_context',timestamp:now,payload:{model:'gpt-6-astra',effort:'medium'}}].map(JSON.stringify).join('\n'));
 const run={execution_control:{task_session_bindings:{host:'codex',reread:{thread_id:worker}},agent_sessions:[{agent_id:worker,role:'content_writer',model:'gpt-6-astra',reasoning_effort:'medium',started_at:s.dispatched_at}]}};
 assert.equal(agentConfiguration({run,agent:worker,log,turnStartedAt:s.dispatched_at}).status,'passed');
 f.put('models.jsonl',fs.readFileSync(log,'utf8').replace('gpt-6-astra','gpt-6-sol'));assert.throws(()=>agentConfiguration({run,agent:worker,log,turnStartedAt:s.dispatched_at}),/mismatch/);
});
test('worker alone cannot apply; missing full reads, wrong model and drift reject',t=>{
 const f=fixture(t),r=f.prepare(),{state,log}=f.complete(r),data=f.read(state.worker_report);data.full_reads[0].read=false;f.put(state.worker_report,data);assert.throws(()=>advancePostReread(f.root,{state:r.state,log}),/Complete/);
 f.complete(r,{model:'gpt-6-sol'});assert.throws(()=>advancePostReread(f.root,{state:r.state,log}),/mismatch/);
 f.complete(r);assert.equal(advancePostReread(f.root,{state:r.state,log}).type,'needs_review');assert.equal(advancePostReread(f.root,{state:r.state,action:'apply',log}).type,'needs_review');
 f.put('Clippings/source.md','drift');assert.throws(()=>advancePostReread(f.root,{state:r.state,log}),/baseline drift/);
});
test('main reread applies exact candidates, emits reusable text scope, closes only after actual commit',t=>{
 const f=fixture(t),r=f.prepare(),before=fs.readFileSync(path.join(f.root,f.rp),'utf8'),{log}=f.complete(r,{candidate:true});assert.equal(advancePostReread(f.root,{state:r.state,log}).type,'needs_review');f.mainReady(r);
 const applied=advancePostReread(f.root,{state:r.state,action:'apply',log});assert.equal(applied.type,'needs_closure');assert(fs.readFileSync(path.join(f.root,'raw-sources/a.md'),'utf8').includes('counterexample'));
 const record=f.read(path.posix.dirname(r.state)+'/text-review.json').entries[0],read=p=>fs.readFileSync(path.join(f.root,p)),fingerprint=p=>sha(read(p));assert.equal(validateTextReview(record,{raw_path:'raw-sources/a.md',raw_sha256:fingerprint('raw-sources/a.md'),declared_sources:['Clippings/source.md']},fingerprint,read).reusable,true);assert.equal(record.full_media_certified,false);
 assert.equal(fs.readFileSync(path.join(f.root,f.rp),'utf8'),before);assert.equal(advancePostReread(f.root,{state:r.state,log}).type,'needs_closure');
 f.git('add','--',...applied.stage_paths);f.git('commit','-m','fixture repair');assert.equal(advancePostReread(f.root,{state:r.state,log}).type,'closed');
});
test('candidate drift, metadata changes and silent material PASS are blocked',t=>{
 const f=fixture(t),r=f.prepare(),{state,log}=f.complete(r,{candidate:true,limits:true});advancePostReread(f.root,{state:r.state,log});const m=f.mainReady(r);assert.throws(()=>advancePostReread(f.root,{state:r.state,action:'apply',log}),/cannot be certified/);
 m.decision='limited';m.limitations=['Media remains unavailable'];f.put(state.main_review,m);
 const report=f.read(state.worker_report),c=report.candidates[0].candidate;f.put(c,fs.readFileSync(path.join(f.root,c),'utf8').replace('source: Original','source: Invented'));assert.throws(()=>advancePostReread(f.root,{state:r.state,action:'apply',log}),/Metadata/);
});
test('revisions preserve prior evidence, invalidate old approval and cap substantive retries',t=>{
 const f=fixture(t),r=f.prepare(),{state,log}=f.complete(r,{candidate:true});advancePostReread(f.root,{state:r.state,log});f.mainReady(r);
 const revised=advancePostReread(f.root,{state:r.state,action:'revise',reason:'Restore the remaining condition'});assert.equal(revised.type,'needs_agent');assert.equal(fs.existsSync(path.join(f.root,state.main_review)),false);assert(f.read(r.state).history.length>=3);
 advancePostReread(f.root,{state:r.state,action:'revise',reason:'Second bounded repair'});assert.throws(()=>advancePostReread(f.root,{state:r.state,action:'revise',reason:'Third'}),/at most two/);
});
test('post-reread cost uses its own window and preserves missing host usage as partial',async t=>{
 const f=fixture(t),r=f.prepare(),s=f.read(r.state);s.finished_at=new Date(Date.parse(s.started_at)+3000).toISOString();f.put(r.state,s);
 const stamp=ms=>new Date(Date.parse(s.started_at)+ms).toISOString();
 const event=(ms,type,payload)=>({timestamp:stamp(ms),type,payload});
 f.put('cost/worker.jsonl',[event(0,'session_meta',{id:worker}),event(1,'turn_context',{model:'gpt-6-astra',effort:'medium'}),event(1000,'event_msg',{type:'token_count',info:{total_token_usage:{input_tokens:10,cached_input_tokens:5,output_tokens:2},last_token_usage:{input_tokens:10,cached_input_tokens:5,output_tokens:2}}})].map(JSON.stringify).join('\n'));
 const missing=await postRereadCost(f.root,{state:r.state,sessions:path.join(f.root,'cost')});assert.equal(missing.total.status,'unknown');assert.equal(missing.total.known_usage,null);
 f.put('cost/parent.jsonl',[event(0,'session_meta',{id:parent}),event(1,'turn_context',{model:'gpt-6-sol',effort:'medium'})].map(JSON.stringify).join('\n'));
 const cost=await postRereadCost(f.root,{state:r.state,sessions:path.join(f.root,'cost')});assert.equal(cost.window.start,s.started_at);assert.equal(cost.window.end,s.finished_at);assert.equal(cost.total.status,'partial');assert.equal(cost.children.known_usage.input_tokens,10);
});
test('a semantic Wiki omission can expand only the affected existing page without reauditing other Raw',t=>{
 const f=fixture(t),r=f.prepare(),{state,log}=f.complete(r);advancePostReread(f.root,{state:r.state,log});
 const expanded=advancePostReread(f.root,{state:r.state,action:'expand',paths:'wiki/unrelated.md',reason:'A concrete mechanism now has an additional relevant consumer'});assert.equal(expanded.type,'needs_agent');
 const next=f.read(r.state),report=f.read(next.worker_report);assert(next.baseline.some(row=>row.path==='wiki/unrelated.md'));assert(!next.baseline.some(row=>row.path==='raw-sources/other.md'));assert.equal(report.full_reads.find(row=>row.path==='wiki/unrelated.md').read,false);assert.equal(report.rows[0].checks.raw_to_wiki,false);
 assert.throws(()=>advancePostReread(f.root,{state:r.state,action:'expand',paths:'domains/test.md',reason:'Not an allowed Wiki'}),/existing Wiki/);
});
test('Wiki repair reuses the existing ledger tool before main review and synchronizes only its real registry impact',t=>{
 const f=fixture(t),r=f.prepare(),project=path.resolve(import.meta.dirname,'..');f.complete(r);
 advancePostReread(f.root,{state:r.state,action:'expand',paths:'wiki/unrelated.md',reason:'A source-grounded missing consumer found in this fixture'});
 const {state,log}=f.complete(r);
 const tool='system/maintenance/checklists/sync-wiki-source-ledgers.ps1';fs.mkdirSync(path.dirname(path.join(f.root,tool)),{recursive:true});fs.copyFileSync(path.join(project,tool),path.join(f.root,tool));
 const report=f.read(state.worker_report),candidate=path.posix.dirname(r.state)+'/candidates/wiki/unrelated.md';
 f.put(candidate,fs.readFileSync(path.join(f.root,'wiki/unrelated.md'),'utf8').replace('A different topic.','A related conditional gain and counterexample. [[raw-sources/a]]'));
 report.candidates=[{path:'wiki/unrelated.md',candidate}];f.put(state.worker_report,report);
 assert.equal(advancePostReread(f.root,{state:r.state,log}).type,'needs_preparation');assert.equal(advancePostReread(f.root,{state:r.state,action:'prepare-candidates',log}).type,'needs_review');f.mainReady(r);
 const result=advancePostReread(f.root,{state:r.state,action:'apply',log});assert.equal(result.type,'needs_closure');assert(fs.readFileSync(path.join(f.root,'wiki/unrelated.md'),'utf8').includes('  - raw-sources/a.md'));assert.equal(f.read(r.state).registry_preparation.status,'synced');assert.equal(f.read(r.state).registry_preparation.raw_list_updates,1);assert.match(fs.readFileSync(path.join(f.root,'system/registry/raw-list.md'),'utf8'),/\| a\.md \| Original \| topic \| test \| 3 \|/);
});
