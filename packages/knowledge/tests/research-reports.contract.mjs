import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createLocalResearchHost} from '../system/integrations/research-reports-host.mjs';
import * as native from '../system/query/query-evidence.mjs';
import {createKnowledgeLookup,runKnowledgeLookup} from '../system/integrations/knowledge-feedback.mjs';
import {acceptDossier} from '../system/integrations/research-reports-accept.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const req={need:{question:'冰霜资源取舍',kind:'understanding'},terms:['C1'],budget:{max_sources:4,max_content_chars:50000}};
function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'research-library-')),root=path.join(dir,'Knowledge'),research=path.join(dir,'Research');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const write=(p,v)=>{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof v==='string'?v:JSON.stringify(v));};
 write(path.join(root,'wiki/a.md'),'# 基础知识\n资源并非只有存量。\n');
 const documents={'docs/README.md':'# 冰霜档案\n整作仍partial。\n','docs/systems/01-资源.md':'# 资源\n冰霜增加格挡；集中改变产出；球位限制容量。\n## 限制\n未知build，只有局部观察，不保证最优。\n','docs/systems/02-无结论章.md':'# 研究方法\n没有claim仍有完整正文和研究限制。\n','docs/cases/E1.md':'# 案例E1\n先消耗球体，再获得格挡。\n## 反例\n格挡不防偷钱。\n'};
 for(const [rel,body] of Object.entries(documents))write(path.join(research,rel),body);
 write(path.join(research,'media/frame.txt'),'fixture-observed-frame');
 const manifest={schema_version:1,dossier_id:'fixture-game',game_id:'fixture-game',game_title:'冰霜游戏',dossier_ref:'docs/README.md',coverage_status:'partial',whole_content_exhaustively_tested:false,documents:Object.keys(documents),document_hashes:Object.fromEntries(Object.entries(documents).map(([k,v])=>[k,sha(v)])),domains:[{chapter:'systems/01-资源.md',evidence:['C1']}],claims:[{id:'C1',text:'资源取舍',chapter:'systems/01-资源.md',kind:'observed_sequence_analysis',conditions:'两段观察',limits:'未知build',version_groups:['v1'],support_status:'supported_with_conditions',evidence:['E1']}],cases:[{id:'E1',path:'cases/E1.md',status:'answered',evidence:['S1'],frames:['A1']}],assets:[{id:'A1',path:'media/frame.txt',source_id:'S1',accepted:true,sha256:sha('fixture-observed-frame'),role:'video_frame'}],sources:[{id:'S1',read_status:'partial_read',read_scope:'bounded footage'}],unresolved:['无精确听音']};
 const manifestPath=path.join(research,'manifest.json'),catalogPath=path.join(root,'research-reports/catalog.json');
 let catalog={schema_version:1,reports:[{id:'fixture-game',title:'冰霜研究',aliases:[],format:'research-dossier-v1',status:'active',visibility:'local-owner',binding:'research',manifest:'manifest.json',acceptance:{status:'pass',kind:'original_dossier_check',scope:'synthetic fixture, not actual Research acceptance'}}]};
 const accept=()=>{write(manifestPath,manifest);catalog.reports[0].manifest_sha256=sha(fs.readFileSync(manifestPath));write(catalogPath,catalog);};accept();
 const options={root,bindings:{research},enabled:true},q=createLocalResearchHost(options);
 const read=(ref='knowledge:research:fixture-game/C1',request=req)=>q.readSource({request,ref});
 return {dir,root,research,write,manifest,manifestPath,catalog,catalogPath,accept,options,q,read};
}
test('native Query independent; absent and disabled module preserve original discovery',t=>{
 const f=fixture(t),baseline=native.discover(req,f.root);
 fs.renameSync(f.catalogPath,f.catalogPath+'.old');
 assert.deepEqual(f.q.discover(req).candidates,baseline.candidates);
 assert.deepEqual(createLocalResearchHost({...f.options,enabled:false}).discover(req),baseline);
 assert.equal(native.readSource({request:req,ref:'knowledge:research:fixture-game/C1'},f.root).status,'denied');
});
test('discovery is metadata; explicit ID ranks selected claim; full no-claim chapter readable',t=>{
 const f=fixture(t),d=f.q.research.discover(req.need,{request:req});assert.equal(d.candidates[0].unit,'C1');assert(d.candidates.every(c=>c.content_read===false));
 const r=f.read();assert.equal(r.status,'source_read');assert(r.content.includes('未知build'));assert(r.content.includes('格挡不防偷钱'));assert.equal(r.research.evidence.length,4);
 const noClaim=f.read('knowledge:research:fixture-game/chapter%3A02');assert.equal(noClaim.status,'source_read');assert(noClaim.content.includes('没有claim'));
});
test('real original verify/review/assemble accept mixed native + research and retain scope',t=>{
 const f=fixture(t),r=f.read(),w=f.q.readSource({request:req,ref:'knowledge:wiki:a'}),receipts=[r,w];
 const quote='冰霜增加格挡',answer='该研究只做局部观察：冰霜增加格挡，不保证最优。';
 const answer_checks=['condition','counterexample','provenance'].map(kind=>({kind,applicability:'applicable',reason:'actual fixture scope',items:[{id:kind,requirement:'Preserve conditions and provenance',evidence:[{ref:r.ref,quote}],status:'covered',rationale:'Current semantic assertion by test caller; no model benefit inference',answer_quote:'局部观察'}]}));
 const result=f.q.assembleResult({request:req,receipts,claims:[{text:'冰霜增加格挡',kind:'source_statement',applicability:'局部观察',evidence:[{ref:r.ref,quote}]}],gaps:[],stop_reason:'needs_answered',answer,answer_checks});
 assert.equal(result.status,'assembled');assert.equal(result.answer_review.status,'answer_review_ready');assert.equal(result.sources[0].source_kind,'research');assert.equal(result.sources[0].research.coverage_status,'partial');
 assert.equal(f.q.reuseSource({request:req,receipt:r}).status,'source_reused');
});
test('fresh reread rejects forged text, properties, scope, quote and unrecognized refs',t=>{
 const f=fixture(t),r=f.read();
 for(const mutation of [{content:'invented'}, {source_kind:'wiki'}, {source_identity:'forged'}, {research:{...r.research,coverage_status:'complete'}},{ref:'knowledge:research:fixture-game/unknown'}])assert.equal(f.q.verifyEvidence({request:req,receipts:[{...r,...mutation}]}).status,'invalid');
 assert.equal(f.q.verifyEvidence({request:req,receipts:[r],citations:[{ref:r.ref,quote:'never read'}]}).status,'invalid');
 assert.equal(f.q.verifyEvidence({request:{...req,need:{question:'other object'}},receipts:[r]}).status,'invalid');
});
test('manifest, document, asset drift and retirement invalidate reuse without altering original bytes',t=>{
 for(const change of ['manifest','document','asset','retire']){
  const f=fixture(t),r=f.read();assert.equal(r.status,'source_read');
  if(change==='manifest')f.write(f.manifestPath,{...f.manifest,unresolved:['changed']});
  if(change==='document')f.write(path.join(f.research,'docs/systems/01-资源.md'),'changed');
  if(change==='asset')f.write(path.join(f.research,'media/frame.txt'),'changed');
  if(change==='retire'){f.catalog.reports[0].status='retired';f.write(f.catalogPath,f.catalog);}
  assert.equal(f.q.reuseSource({request:req,receipt:r}).status,'reuse_invalid',change);
  assert.equal(f.q.readSource({request:req,ref:'knowledge:wiki:a'}).status,'source_read');
 }
});
test('permissions, complete-unit budgets and unknown scope fail explicitly',t=>{
 const f=fixture(t);
 assert.equal(f.read(undefined,{...req,sources:{knowledge:false}}).status,'disabled');
 assert.equal(f.read(undefined,{...req,budget:{max_content_chars:1}}).status,'budget_exhausted');
 assert.equal(f.q.research.read({ref:'knowledge:research:fixture-game/C1'},{request:req,allowed_version_groups:['v2']}).reason,'research_version_scope_mismatch');
 const read=f.read();assert.equal(f.q.research.verify([read],{request:req,allowed_version_groups:['v2']}).status,'invalid');
 assert.equal(createLocalResearchHost({...f.options,allowedVersionGroups:['v2']}).verifyEvidence({request:req,receipts:[read]}).status,'invalid');
 assert.equal(f.q.research.read({ref:'knowledge:research:fixture-game/C1',mode:'section'},{request:req}).status,'denied');
 f.catalog.reports[0].visibility='public';f.write(f.catalogPath,f.catalog);assert.equal(f.read().status,'unavailable');
});
test('closure refuses unread, rejected, cyclic and undeclared evidence',t=>{
 for(const bad of ['unread','rejected','cycle','unknown']){
  const f=fixture(t);
  if(bad==='unread')f.manifest.sources[0].read_status='unread';
  if(bad==='rejected')f.manifest.assets[0].accepted=false;
  if(bad==='cycle')f.manifest.cases[0].evidence=['C1'];
  if(bad==='unknown')f.manifest.claims[0].evidence=['missing'];
  f.accept();assert.equal(f.read().status,'unavailable',bad);
 }
});
test('catalog paths and symlink escape never expand host binding',t=>{
 const f=fixture(t);f.catalog.reports[0].manifest='../outside.json';f.write(path.join(f.dir,'outside.json'),f.manifest);f.write(f.catalogPath,f.catalog);
 assert.equal(f.read().reason,'path_outside_binding');
 f.catalog.reports[0].manifest='escape.json';f.write(f.catalogPath,f.catalog);
 fs.symlinkSync(path.join(f.dir,'outside.json'),path.join(f.research,'escape.json'),'file');assert.equal(f.read().reason,'path_outside_binding');
});
test('shared lookup observes actual returned research; absent feedback does not block reading',async t=>{
 const f=fixture(t),workspace=path.resolve(import.meta.dirname,'..');
 const context={host:'fixture-local',library_id:'fixture',view:'owner',lookup_id:'lookup-research',request_ref:'request-research',entry:'research',purpose:'research',policy:{version:'test',analysis_allowed:true,temporary:false,retention_confirmed:true},expires_at:new Date(Date.now()+3600000).toISOString()};
 const lookup=await createKnowledgeLookup({context,toolsRoot:(process.env.FEEDBACK_TOOLS_ROOT??path.resolve(workspace,'../tools'))});
 const r=runKnowledgeLookup(lookup,()=>f.read());assert.equal(r.status,'source_read');assert(lookup.snapshot().observations.some(o=>o.source?.ref===r.ref&&o.source.stage==='returned'));
 assert.equal(lookup.finish().compounding_status,'no_increment');
 const unavailable=await createKnowledgeLookup({context,toolsRoot:path.join(f.dir,'no-tools')});assert.equal(runKnowledgeLookup(unavailable,()=>f.read()).status,'source_read');
});
test('common host routes research read/verify with same lookup and ordinary input remains native',async t=>{
 const workspace=path.resolve(import.meta.dirname,'..'),{execute}=await import(pathToFileURL(path.join(workspace,'system/integrations/lookup-host.mjs'))),f=fixture(t);
 const options={knowledgeRoot:f.root,moduleRoot:workspace,toolsRoot:(process.env.FEEDBACK_TOOLS_ROOT??path.resolve(workspace,'../tools')),researchOptions:f.options};
 const r=await execute({operation:'read',input:{request:req,ref:'knowledge:research:fixture-game/C1'}},options);assert.equal(r.status,'source_read');
 const v=await execute({operation:'verify',input:{request:req,receipts:[r]}},options);assert.equal(v.status,'evidence_consistent');
 const ordinary=await execute({operation:'read',input:{request:req,ref:'knowledge:wiki:a'}},options);assert.equal(ordinary.source_kind,'wiki');
 const discover=await execute({operation:'discover',research:true,input:req},options);assert(discover.candidates.some(c=>c.source_kind==='research'));
});
test('research finding uses original persistence once and survives as an owner pending item',async t=>{
 const workspace=path.resolve(import.meta.dirname,'..'),{execute}=await import(pathToFileURL(path.join(workspace,'system/integrations/lookup-host.mjs'))),f=fixture(t),home=path.join(f.dir,'private-feedback');
 const config={schema_version:1,enabled:true,host:'research-fixture',library_id:'research-fixture',view:'owner',retention_days:1,home,tools_root:(process.env.FEEDBACK_TOOLS_ROOT??path.resolve(workspace,'../tools')),policy:{version:'fixture-v1',analysis_allowed:true,temporary:false,retention_confirmed:true}};
 f.write(path.join(f.root,'system/query/compounding.local.json'),config);
 const options={knowledgeRoot:f.root,moduleRoot:workspace,toolsRoot:(process.env.FEEDBACK_TOOLS_ROOT??path.resolve(workspace,'../tools')),researchOptions:f.options};
 const r=await execute({operation:'read',entry:'research',purpose:'research',input:{request:req,ref:'knowledge:research:fixture-game/C1'}},options);
 const completion=r.compounding.completion;
 const packet={operation:'finish',continuation:completion.continuation,observations:completion.observations,finding:{id:'fixture-condition',kind:'answer_omission',summary:'Fixture draft omitted the unknown-build qualification',consumption:[{ref:r.ref,stage:'read'}],issue:{subject:'unknown-build fixture scope',condition_key:'fixture-v1',owner:'Research',next_action:'Check fixture original owner scope before changing content',review_when:'next fixture review',status:'needs_evidence'}}};
 assert.equal((await execute(packet,options)).persisted,true);assert.equal((await execute(packet,options)).persisted,false);
 const pending=await execute({operation:'pending',entry:'research',purpose:'research',terms:['unknown-build'],limit:5},options);assert(pending.issues.length>0);
 config.enabled=false;f.write(path.join(f.root,'system/query/compounding.local.json'),config);assert.equal((await execute(packet,options)).compounding_status,'disabled');
});
test('host with no research code and host with malformed binding keep original lookup available',async t=>{
 const workspace=path.resolve(import.meta.dirname,'..'),{execute}=await import(pathToFileURL(path.join(workspace,'system/integrations/lookup-host.mjs'))),f=fixture(t),moduleRoot=path.join(f.dir,'native-only');
 fs.mkdirSync(path.join(moduleRoot,'system/integrations'),{recursive:true});
 fs.cpSync(path.join(workspace,'system/query'),path.join(moduleRoot,'system/query'),{recursive:true,filter:p=>!p.endsWith('.local.json')});
 for(const name of ['query-principles.mjs','knowledge-feedback.mjs'])fs.copyFileSync(path.join(workspace,'system/integrations',name),path.join(moduleRoot,'system/integrations',name));
 const options={knowledgeRoot:f.root,moduleRoot,toolsRoot:(process.env.FEEDBACK_TOOLS_ROOT??path.resolve(workspace,'../tools'))};
 const d=await execute({operation:'discover',research:true,input:req},options);assert.equal(d.research.status,'unavailable');assert.deepEqual(d.candidates,native.discover(req,f.root).candidates);
 const r=await execute({operation:'read',research:true,input:{request:req,ref:'knowledge:wiki:a'}},options);assert.equal(r.status,'source_read');
 assert.equal((await execute({operation:'read',input:{request:req,ref:'knowledge:research:fixture-game/C1'}},options)).status,'unavailable');
 f.write(path.join(f.root,'system/query/research.local.json'),'{bad');
 const bad=await execute({operation:'discover',research:true,input:req},{...options,moduleRoot:workspace});assert.deepEqual(bad.candidates,native.discover(req,f.root).candidates);
});
test('acceptance failure and identity mismatch preserve the previous accepted catalog',t=>{
 const f=fixture(t),before=fs.readFileSync(f.catalogPath,'utf8');
 const options={...f.options,manifest:'manifest.json',python:process.execPath};
 assert.throws(()=>acceptDossier({...options,expectedId:'different-game'}),/Unexpected dossier identity/);
 // An executable which rejects the checker invocation proves nonzero exit gates writes.
 assert.throws(()=>acceptDossier(options),/Original dossier check failed/);
 assert.equal(fs.readFileSync(f.catalogPath,'utf8'),before);
 assert.throws(()=>acceptDossier({...options,manifest:'../missing.json'}));
 assert.equal(fs.readFileSync(f.catalogPath,'utf8'),before);
});

test('invalid private store location does not block ordinary source reading',async t=>{
 const f=fixture(t),moduleRoot=path.resolve(import.meta.dirname,'..');
 const {execute}=await import(pathToFileURL(path.join(moduleRoot,'system/integrations/lookup-host.mjs')));
 const result=await execute({operation:'read',input:{request:req,ref:'knowledge:wiki:a'}},{knowledgeRoot:f.root,moduleRoot,home:moduleRoot,toolsRoot:process.env.FEEDBACK_TOOLS_ROOT??path.resolve(moduleRoot,'../tools')});
 assert.equal(result.status,'source_read');assert.equal(result.compounding.completion.compounding_status,'unavailable');
 assert.equal(result.compounding.completion.persisted,false);
});
