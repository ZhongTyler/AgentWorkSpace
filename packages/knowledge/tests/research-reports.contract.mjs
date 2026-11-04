import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createLocalResearchHost,localResearchOptions} from '../system/integrations/research-reports-host.mjs';
import * as native from '../system/query/query-evidence.mjs';
import {createKnowledgeLookup,runKnowledgeLookup} from '../system/integrations/knowledge-feedback.mjs';
import {acceptDossier} from '../system/integrations/research-reports-accept.mjs';
import {anchorHash,withoutResearchNavigation,projectNavigation} from '../system/integrations/research-report-relations.mjs';
import {maintainRelations} from '../system/maintenance/checklists/research-report-links.mjs';
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
function linkedFixture(t){
 const f=fixture(t),revision='a'.repeat(40),definition='b'.repeat(64);
 const group='---\nid: fixture-group\nname: Fixture Group\naliases: [肉鸽]\nstatus: active\napproval_status: approved\nreviewed_revision: '+revision+'\ndefinition_hash: '+definition+'\nlast_review_receipt: docs/group-review.json\n---\n# Fixture Group\n按循环组织的类别。\n<!-- generated:wiki-group-members:start -->\n<!-- generated:wiki-group-members:end -->\n';
 f.write(path.join(f.root,'groups/fixture-group.md'),group);
 f.write(path.join(f.root,'docs/group-review.json'),{group_id:'fixture-group',repository_revision:revision,definition_hash:definition});
 f.write(path.join(f.root,'domains/玩法策划.md'),'# 玩法\n[综合](../wiki/a.md)\n');
 const make=(id,from,file)=>({id,from,unit:'C1',status:'active',relation:'mechanism_example',terms:['支付','启动费'],questions:['为什么净返还也需要先付费？'],purpose:'补行动支付的完整案例',conditions:['本次局面'],exclusions:['不证明最优或无限循环'],evidence:[{path:'docs/systems/01-资源.md',heading:'资源'}],review:{status:'approved',reviewer_id:'fixture-main',reviewed_at:'2026-10-29T00:00:00Z',rationale:'Synthetic bilingual fixture relation, not real game approval',manifest_sha256:f.catalog.reports[0].manifest_sha256,anchor_sha256:anchorHash(fs.readFileSync(path.join(f.root,file),'utf8'))}});
 f.catalog.reports[0].discovery_links=[make('wiki-payment',{kind:'wiki',path:'wiki/a.md'},'wiki/a.md'),make('group-payment',{kind:'group',id:'fixture-group'},'groups/fixture-group.md')];
 f.write(f.catalogPath,f.catalog);
 const request={need:{question:'支付和启动费如何形成可执行循环？',kind:'understanding'},budget:{max_sources:4,max_content_chars:50000}};
 const run=(action,extra={})=>maintainRelations({...f.options,action,...extra});
 return {...f,request,run};
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
 const options={...f.options,checkerRoot:f.research,manifest:'manifest.json',python:process.execPath};
 assert.throws(()=>acceptDossier({...options,expectedId:'different-game'}),/Unexpected dossier identity/);
 // An executable which rejects the checker invocation proves nonzero exit gates writes.
 assert.throws(()=>acceptDossier(options),/Original dossier check failed/);
 assert.equal(fs.readFileSync(f.catalogPath,'utf8'),before);
 assert.throws(()=>acceptDossier({...options,manifest:'../missing.json'}));
 assert.equal(fs.readFileSync(f.catalogPath,'utf8'),before);
});

test('Knowledge-local reports keep stable references without the Research data directory',t=>{
 const f=fixture(t),destination=path.join(f.root,'research-reports/fixture-game');
 fs.cpSync(f.research,destination,{recursive:true});
 fs.renameSync(f.research,f.research+'.historical');
 Object.assign(f.catalog.reports[0],{binding:'knowledge',manifest:'research-reports/fixture-game/manifest.json'});
 f.write(f.catalogPath,f.catalog);
 const q=createLocalResearchHost({root:f.root}),r=q.readSource({request:req,ref:'knowledge:research:fixture-game/C1'});
 assert.equal(r.status,'source_read');assert(r.content.includes('格挡不防偷钱'));
 assert.equal(q.reuseSource({request:req,receipt:r}).status,'source_reused');
 assert.equal(q.verifyEvidence({request:req,receipts:[r]}).status,'evidence_consistent');
 assert(q.discover(req).candidates.some(c=>c.ref===r.ref));
});

test('legacy local bindings retain Knowledge default; checker location is trusted local configuration',t=>{
 const f=fixture(t);
 assert.equal(localResearchOptions(f.root).bindings.knowledge,f.root);
 f.write(path.join(f.root,'system/query/research.local.json'),{schema_version:1,enabled:true,bindings:{research:f.research},checker_root:f.research});
 const options=localResearchOptions(f.root);
 assert.equal(options.bindings.knowledge,f.root);assert.equal(options.bindings.research,f.research);assert.equal(options.checkerRoot,f.research);
 f.write(path.join(f.root,'system/query/research.local.json'),{schema_version:1,enabled:true,bindings:{},checker_root:'relative'});
 assert.throws(()=>localResearchOptions(f.root),/checker_root_must_be_absolute/);
});

test('acceptance runs the trusted tool separately from the report binding',t=>{
 const f=fixture(t),trusted=path.join(f.dir,'TrustedResearch');
 const executable=process.env.RESEARCH_TEST_PYTHON??spawnSync('python',['-c','import sys; print(sys.executable)'],{encoding:'utf8',windowsHide:true}).stdout?.trim();
 if(!executable||!path.isAbsolute(executable)){t.skip('Absolute Python executable unavailable; real dossier acceptance is validated separately');return;}
 f.write(path.join(trusted,'game-research/deep-game-analysis/dossier.py'),'import json\nprint(json.dumps({"status":"pass","counts":{"synthetic":1}}))\n');
 // A malicious tool in the data binding must never be selected for execution.
 const marker=path.join(f.dir,'untrusted-executed');
 f.write(path.join(f.root,'game-research/deep-game-analysis/dossier.py'),'from pathlib import Path\nPath('+JSON.stringify(marker.replaceAll('\\','/'))+').write_text("bad")\nraise RuntimeError("untrusted data tool")\n');
 fs.cpSync(f.research,path.join(f.root,'research-reports/fixture-game'),{recursive:true});
 const result=acceptDossier({root:f.root,binding:'knowledge',manifest:'research-reports/fixture-game/manifest.json',checkerRoot:trusted,python:executable,expectedId:'fixture-game'});
 assert.equal(result.status,'accepted_local');assert.equal(fs.existsSync(marker),false);
 const entry=JSON.parse(fs.readFileSync(f.catalogPath)).reports[0];
 assert.equal(entry.binding,'knowledge');assert.equal(entry.acceptance.checker_sha256,sha(fs.readFileSync(path.join(trusted,'game-research/deep-game-analysis/dossier.py'))));
 assert.equal(createLocalResearchHost({root:f.root}).readSource({request:req,ref:'knowledge:research:fixture-game/C1'}).status,'source_read');
});

test('typed Wiki, Domain and approved Group paths produce one complete research unit per ref',t=>{
 const f=linkedFixture(t);
 for(const nav of [{paths:['wiki/a.md']},{related_from:['knowledge:wiki:a']},{domains:['玩法策划']},{groups:['肉鸽']},{paths:['wiki/a.md'],groups:['fixture-group']}]){
  const request={...f.request,...nav},d=f.q.discover(request),research=d.candidates.filter(c=>c.source_kind==='research');
  assert.equal(research.length,1,JSON.stringify({nav,d}));assert.equal(research[0].unit,'C1');assert.equal(research[0].content_read,false);
  assert(research[0].relations.length>=1);
  const r=f.q.readSource({request,ref:research[0].ref});assert.equal(r.status,'source_read');assert(r.content.includes('格挡不防偷钱'));assert.equal(r.range.complete_unit,true);
  assert.equal(f.q.verifyEvidence({request,receipts:[r]}).status,'evidence_consistent');
 }
 const wiki=f.q.readSource({request:f.request,ref:'knowledge:wiki:a'});
 assert.equal(wiki.navigation.research.candidates[0].unit,'C1');
});

test('same Group but unrelated question, unapproved/retired/stale relations and denied Wiki never expand',t=>{
 for(const change of ['unrelated','unapproved','retired','stale-anchor','stale-manifest','inactive','candidate','missing-receipt','mismatched-receipt','wiki-disabled']){
  const f=linkedFixture(t),request={...f.request,groups:['fixture-group']};
  if(change==='unrelated')request.need={question:'音乐混音如何处理？',kind:'understanding'};
  if(change==='unapproved')f.catalog.reports[0].discovery_links[1].review.status='pending';
  if(change==='retired')f.catalog.reports[0].discovery_links[1].status='retired';
  if(change==='stale-anchor')fs.appendFileSync(path.join(f.root,'groups/fixture-group.md'),'\n新的语义范围');
  if(change==='stale-manifest')f.catalog.reports[0].discovery_links[1].review.manifest_sha256='f'.repeat(64);
  if(change==='inactive'||change==='candidate')f.write(path.join(f.root,'groups/fixture-group.md'),fs.readFileSync(path.join(f.root,'groups/fixture-group.md'),'utf8').replace(change==='inactive'?'status: active':'approval_status: approved',change==='inactive'?'status: inactive':'approval_status: pending'));
  if(change==='missing-receipt')fs.unlinkSync(path.join(f.root,'docs/group-review.json'));
  if(change==='mismatched-receipt')f.write(path.join(f.root,'docs/group-review.json'),{group_id:'other'});
  if(change==='wiki-disabled')request.sources={wiki:false};
  f.write(f.catalogPath,f.catalog);
  assert.equal(f.q.discover(request).candidates.filter(c=>c.source_kind==='research').length,0,change);
 }
});

test('relation discovery obeys candidate/content budget and never reads reports automatically',t=>{
 const f=linkedFixture(t),request={...f.request,paths:['wiki/a.md'],budget:{...f.request.budget,max_candidates:0}};
 assert.equal(f.q.discover(request).candidates.length,0);
 assert.equal(f.q.discover({...request,paths:[],related_from:['wiki/a.md']}).status,'budget_exhausted');
 const normal={...f.request,paths:['wiki/a.md']},d=f.q.discover(normal),candidate=d.candidates.find(c=>c.source_kind==='research');
 assert.equal(d.research.discovery_scope.body_content_returned,false);
 assert.equal(f.q.readSource({request:{...normal,budget:{max_sources:0}},ref:candidate.ref}).status,'budget_exhausted');
 assert.equal(f.q.readSource({request:{...normal,budget:{max_content_chars:1}},ref:candidate.ref}).status,'budget_exhausted');
 assert.deepEqual(createLocalResearchHost({...f.options,enabled:false}).discover(normal),native.discover(normal,f.root));
});

test('catalog projections preserve Wiki/Group bodies, are idempotent and remove retired navigation',t=>{
 const f=linkedFixture(t),files=['wiki/a.md','groups/fixture-group.md'],before=files.map(p=>fs.readFileSync(path.join(f.root,p),'utf8'));
 assert.equal(f.run('check').status,'navigation_drift');
 assert.deepEqual(f.run('sync').changed_paths.sort(),[...files].sort());
 files.forEach((p,i)=>assert.equal(withoutResearchNavigation(fs.readFileSync(path.join(f.root,p),'utf8')),withoutResearchNavigation(before[i])));
 assert.equal(f.run('check').status,'relations_consistent');assert.equal(f.run('sync').writes,false);
 assert.equal(f.q.discover({...f.request,groups:['fixture-group']}).research.relation_issues.length,0);
 f.catalog.reports[0].discovery_links.forEach(l=>l.status='retired');f.write(f.catalogPath,f.catalog);
 f.run('sync');files.forEach(p=>assert(!fs.readFileSync(path.join(f.root,p),'utf8').includes('generated:research-report-links:start')));
 assert.throws(()=>projectNavigation('# page\n<!-- generated:research-report-links:start -->',''),/malformed/);
});

test('generated research navigation stays before Wiki footers without altering their contents',()=>{
 const original='# Page\n\nOriginal prose.\n\n## 相关页面\n\n- peer\n\n## 来源\n\n- raw\n';
 const generated='<!-- generated:research-report-links:start -->\n## 补充案例研究\n\n- candidate\n<!-- generated:research-report-links:end -->';
 const next=projectNavigation(original,generated);
 assert(next.indexOf('generated:research-report-links:start')<next.indexOf('## 相关页面'));
 assert.equal(withoutResearchNavigation(next),withoutResearchNavigation(original));assert.equal(projectNavigation(next,generated),next);
 const legacy=original+'\n'+generated+'\n';assert.equal(projectNavigation(legacy,generated),next);
});

test('handoff is a proposal; only exact main-reviewed versions can mutate the catalog',t=>{
 const f=linkedFixture(t),entry=f.catalog.reports[0],proposed=entry.discovery_links.map(({review,...l})=>l),handoffFile=path.join(f.dir,'handoff.json');
 f.write(handoffFile,{schema_version:1,kind:'research_report_relation_handoff',reports:[{id:entry.id,manifest:entry.manifest,manifest_sha256:entry.manifest_sha256,proposed_links:proposed}]});
 const before=fs.readFileSync(f.catalogPath,'utf8');assert.equal(f.run('inspect-handoff',{handoffFile}).semantic_approval,false);assert.equal(fs.readFileSync(f.catalogPath,'utf8'),before);
 const reviewFile='docs/relation-review.json';
 f.write(path.join(f.root,reviewFile),{schema_version:1,kind:'knowledge_research_relation_review',status:'approved',reviewer_id:'fixture-main',reports:[{id:entry.id,manifest_sha256:entry.manifest_sha256,discovery_links:entry.discovery_links}]});
 assert.throws(()=>f.run('apply',{reviewFile,reviewerId:'other'}),/main_relation_review_required/);
 assert.equal(fs.readFileSync(f.catalogPath,'utf8'),before);
 assert.equal(f.run('apply',{reviewFile,reviewerId:'fixture-main'}).status,'relations_applied');
});

test('natural game name ranks its reviewed mechanism and explicit other game excludes it',t=>{
 const f=linkedFixture(t);f.catalog.reports[0].aliases=['冰霜游戏'];f.write(f.catalogPath,f.catalog);
 const d=f.q.discover({need:{question:'冰霜游戏为什么净返还仍要支付启动费？'}});
 assert.equal(d.candidates[0].ref,'knowledge:research:fixture-game/C1');
 assert(d.candidates[0].discovery_paths.includes('named_report_relation'));
 const another={...f.catalog.reports[0],id:'other-game',title:'另一个游戏',aliases:['别作'],manifest:'other.json',discovery_links:[]};
 const manifest={...f.manifest,dossier_id:'other-game'};f.write(path.join(f.research,'other.json'),manifest);another.manifest_sha256=sha(fs.readFileSync(path.join(f.research,'other.json')));f.catalog.reports.push(another);f.write(f.catalogPath,f.catalog);
 const other=f.q.discover({need:{question:'别作支付启动费的过程是什么？'},paths:['wiki/a.md']});
 assert(other.candidates.filter(c=>c.source_kind==='research').every(c=>c.report_id==='other-game'));
});

test('expired relation removes only its projection; valid direct reading remains available',t=>{
 const f=linkedFixture(t);f.run('sync');
 fs.appendFileSync(path.join(f.root,'wiki/a.md'),'\n实质变化\n');
 const result=f.run('sync');assert.equal(result.status,'relation_issues');
 assert(result.issues.some(i=>i.reason==='relation_anchor_changed'));
 const text=fs.readFileSync(path.join(f.root,'wiki/a.md'),'utf8');assert(text.includes('实质变化'));assert(!text.includes('generated:research-report-links:start'));
 assert.equal(f.read().status,'source_read');
 assert.equal(f.q.discover({...f.request,groups:['fixture-group']}).candidates.filter(c=>c.source_kind==='research').length,1);
});

test('malformed relations do not disable valid direct reports; no-hit reads remain counted',t=>{
 const f=linkedFixture(t);f.catalog.reports[0].discovery_links={malformed:true};f.write(f.catalogPath,f.catalog);
 const direct=f.q.discover(req);assert(direct.candidates.some(c=>c.ref==='knowledge:research:fixture-game/C1'));
 assert(direct.research.relation_issues.some(i=>i.reason==='invalid_discovery_links'));
 assert.equal(f.read().status,'source_read');
 const unrelated={need:{question:'完全无关的音乐混音问题？'}};
 const baseline=native.discover(unrelated,f.root),augmented=f.q.discover(unrelated);
 assert(augmented.metrics.file_reads>baseline.metrics.file_reads);assert(augmented.metrics.bytes_read>baseline.metrics.bytes_read);
});

test('Group-unrelated metadata remains an independent candidate, never a Group relation or automatic read',t=>{
 const f=linkedFixture(t);f.catalog.reports[0].title='音乐混音研究';f.write(f.catalogPath,f.catalog);
 const d=f.q.discover({need:{question:'没有听审时能直接给参数建议吗？'},terms:['音乐'],groups:['fixture-group']});
 const research=d.candidates.filter(c=>c.source_kind==='research');assert(research.length>0);
 assert(research.every(c=>c.relations.length===0&&c.discovery_paths.includes('direct_metadata')&&c.content_read===false));
 assert.equal(d.research.discovery_scope.body_content_returned,false);
});

test('large relation inventory deduplicates candidates and reads each unchanged anchor once per operation',t=>{
 const f=linkedFixture(t),base=f.catalog.reports[0].discovery_links;
 f.catalog.reports[0].discovery_links=Array.from({length:120},(_,i)=>({...base[i%2],id:'scale-'+i}));f.write(f.catalogPath,f.catalog);
 const request={...f.request,paths:['wiki/a.md'],groups:['fixture-group'],budget:{...f.request.budget,max_candidates:2}};
 const first=f.q.research.discover(request.need,{request});
 assert.equal(first.candidates.length,1);assert.equal(first.candidates[0].relations.length,120);
 assert(first.metrics.file_reads<=5,JSON.stringify(first.metrics)); // catalog, manifest, Wiki, Group, receipt
 assert.equal(first.discovery_scope.body_content_returned,false);
 const unrelated=f.q.research.discover({question:'音乐混音如何处理？'},{request:{need:{question:'音乐混音如何处理？'},paths:['wiki/a.md'],groups:['fixture-group']}});
 assert(unrelated.metrics.file_reads<=2,JSON.stringify(unrelated.metrics)); // no irrelevant anchor/body scan
 fs.appendFileSync(path.join(f.root,'wiki/a.md'),'\nChanged between operations.');
 const second=f.q.research.discover(request.need,{request});
 assert(second.relation_issues.some(i=>i.reason==='relation_anchor_changed'));
 assert(second.candidates[0].relations.every(r=>r.from.kind==='group'));
});

test('reviewed question cues work when curated keywords are not literal substrings',t=>{
 const f=linkedFixture(t),link=f.catalog.reports[0].discovery_links[0];
 link.terms=['抽象的语义术语'];link.questions=['为什么余额没变，中途仍会付不起？'];f.write(f.catalogPath,f.catalog);
 const request={need:{question:'为什么余额没变，中途仍会付不起',kind:'understanding'},paths:['wiki/a.md']};
 const d=f.q.discover(request),candidate=d.candidates.find(c=>c.ref==='knowledge:research:fixture-game/C1');
 assert(candidate);assert(candidate.matched_terms.some(t=>t.startsWith('question:')));
 assert.equal(f.q.discover({...request,need:{question:'为什么音乐会被掩盖？'}}).candidates.filter(c=>c.source_kind==='research').length,0);
});
