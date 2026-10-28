import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {ownedPaths} from '../system/maintenance/checklists/ingest-execution-state.mjs';
import {stagePaths} from '../system/maintenance/checklists/ingest-stage3-prepare.mjs';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),tools='system/maintenance/checklists';
const workspace=[path.dirname(project),path.dirname(path.dirname(project))].find(p=>fs.existsSync(path.join(p,'WorkspaceOrchestration/scripts/execution-check.ps1')));
const rp='system/maintenance/ingest-runs/flow/run.json',dir=path.posix.dirname(rp);
const parent='11111111-1111-4111-8111-111111111111',writer='22222222-2222-4222-8222-222222222222';
const prose='Choices have costs and consequences. The applicable boundary is limited resources.';
function fixture({nested=false}={}){
  const container=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-consolidated-'));
  const root=nested?path.join(container,'middle','Knowledge'):container;
  fs.mkdirSync(root,{recursive:true});
  const put=(p,value)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');};
  const get=p=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>k.toLowerCase()!=='psmodulepath')),GIT_CONFIG_GLOBAL:'NUL',CODEX_THREAD_ID:parent};
  const git=(...args)=>execFileSync('git',['-C',root,'-c','core.excludesFile=',...args],{encoding:'utf8',env,stdio:['ignore','pipe','pipe']}).trim();
  const ps=(...args)=>spawnSync('powershell',['-NoProfile','-File',path.join(root,tools,'ingest-control.ps1'),...args],{encoding:'utf8',env});
  const host=(id,model,effort,completed=false)=>{
    const p=`host/${id}.jsonl`,at=new Date().toISOString();
    const old=fs.existsSync(path.join(root,p))?fs.readFileSync(path.join(root,p),'utf8'):JSON.stringify({type:'session_meta',timestamp:at,payload:{id}})+'\n';
    put(p,old+[{type:'event_msg',timestamp:at,payload:{type:'task_started'}},{type:'turn_context',timestamp:at,payload:{model,effort}},...(completed?[{type:'event_msg',timestamp:at,payload:{type:'task_complete'}}]:[])].map(JSON.stringify).join('\n')+'\n');
  };
  const step=(extra=[])=>{
    const r=spawnSync(process.execPath,[path.join(root,tools,'ingest-advance.mjs'),'--root',root,'--run',rp,'--sessions',path.join(root,'host'),...extra],{encoding:'utf8',env,maxBuffer:8*1024*1024});
    assert.ok(r.stdout,r.stderr);return JSON.parse(r.stdout);
  };
  const reply=(r,fn)=>{const form=get(r.response_path);fn(form.payload);form.state='ready';put(r.response_path,form);};
  const close=()=>{if(path.dirname(container)!==os.tmpdir()||!path.basename(container).startsWith('ingest-consolidated-'))throw Error('Unsafe fixture');fs.rmSync(container,{recursive:true,force:true});};
  return {root,put,get,git,ps,host,step,reply,close,env,parents:nested?[path.dirname(root),container]:[]};
}
function setup(f,{mapped=false,capacity=false,baselineCount=1,revision=1}={}){
  const {root,put,git,ps}=f;
  if(f.parents.length){
    // Standalone recipient: no author workspace checker is installed.
  }
  fs.cpSync(path.join(project,tools),path.join(root,tools),{recursive:true});
  fs.cpSync(path.join(project,'system/maintenance/schemas'),path.join(root,'system/maintenance/schemas'),{recursive:true});
  fs.cpSync(path.join(project,'system/protocols'),path.join(root,'system/protocols'),{recursive:true});
  fs.cpSync(path.join(project,'system/query'),path.join(root,'system/query'),{recursive:true});
  fs.cpSync(path.join(project,'system/integrations'),path.join(root,'system/integrations'),{recursive:true});
  for(const p of ['groups/README.md','system/maintenance/receipts/wiki-group-query-selection.template.json'])put(p,fs.readFileSync(path.join(project,p),'utf8'));
  put('.gitignore','host/\n');
  put('system/maintenance/wiki-split-closures.json',{schema_version:1,records:[]});
  put('system/registry/quick-reference.md','# Quick Reference\n\n## Domains\n\n- test\n\n## Wiki\n\n## Wiki Group 索引\n\n<!-- generated:approved-active-wiki-groups; 不按 Wiki 关键词推断成员 -->\n\n');
  put('system/registry/ingest-auto-review-state.json',{schema_version:1,status:'inactive',stage:'none',batch_id:null,items:[],started_at:null,last_completed_batch:null,last_completed_at:null});
  put('system/registry/skipped-sources.md','# skipped\n');
  put('system/registry/ingest-semantic-review-policy.json',{schema_version:2,mode:'disabled',default_mode:'disabled',precision_mode:'enforced'});
  for(const p of ['raw-sources/README.md','wiki/README.md','domains/README.md'])put(p,fs.readFileSync(path.join(project,p),'utf8'));
  put('domains/test.md','# Test domain\n');
  const header='---\nsource: Fixture\nsource_url: https://example.invalid/source\ndate: 2026-09-23\ncreated: 2026-09-23\ndescription: Synthetic source only\ntags: [test]\ntype: article\n---\n';
  put('Clippings/20260923-test.md',header+'# Test\n\n## Mechanism\n'+prose+'\n');
  if(mapped)put('Clippings/20260923-test2.md',header.replace('/source','/source2')+'# Test two\n\n## Mechanism\n'+prose+'\n');
  const sample='从0到1创造开放世界设计流程-天美江岸栖-20260705.md';
  put('raw-sources/'+sample,header.replace('tags: [test]','tags: [test]\ndomains: [test]')+'# Sample\n\n## Mechanism\n\n> 📍 原文：全文\n\n'+prose+'\n');
  const rows=[`| ${sample} | Fixture | choice | Synthetic | 0 ⚪ 孤立 | 无 | 7.0/10 |`];
  for(let i=1;i<baselineCount;i++){const name=`baseline-${String(i).padStart(2,'0')}.md`;put('raw-sources/'+name,header.replace('/source',`/baseline-${i}`).replace('tags: [test]','tags: [test]\ndomains: [test]')+`# Baseline ${i}\n\n## Mechanism\n\n> 📍 原文：全文\n\n${prose}\n`);rows.push(`| ${name} | Fixture | choice | Synthetic | 0 ⚪ 孤立 | 无 | 7.0/10 |`);}
  put('system/registry/raw-list.md',`# Raw\n\n### 设计理论与方法论\n\n（共 ${baselineCount} 篇）\n| 文件 | 来源 | 关键词 | 简介 | 次数 | 未消费 | 质量 |\n|---|---|---|---|---|---|---|\n${rows.join('\n')}\n\n### 游戏分析与拆解\n\n（共 0 篇）\n| 文件 | 来源 | 关键词 | 简介 | 次数 | 未消费 | 质量 |\n|---|---|---|---|---|---|---|\n`);
  for(const p of ['NOW.md','system/registry/KNOWLEDGE_STATUS.md'])put(p,`# State\n\n- raw：${baselineCount}\n`);
  put('system/registry/KNOWLEDGE_STATUS.md',`# State\n\n- raw：${baselineCount}\n\n## 三、内容健康\n\n### 容量风险\n\n| 页面 | 行数 | 依据 | 处置 |\n|---|---|---|---|\n`);
  for(const p of ['system/registry/index.md','system/maintenance/CHANGELOG.md'])put(p,'# Registry\n');
  if(mapped){
    for(const page of ['Alpha','Beta'])put('wiki/'+page+'.md',`---\ndomains: [test]\nsources:\n  - raw-sources/${sample}\ndate: 2026-09-23\ntype: concept\ngroups: []\n---\n# ${page}\n\n## Mechanism\n\nAn existing independently supported context is retained.\n${capacity&&page==='Alpha'?'\n'+Array.from({length:325},(_,i)=>`Existing supported detail ${i+1}.`).join('\n')+'\n':''}\n## 来源\n\n- [[raw-sources/${sample.slice(0,-3)}]]\n`);
    put('domains/test.md','# Test domain\n\n## 相关 Wiki 页面\n\n- [Alpha](../wiki/Alpha.md)\n');
    put('system/registry/index.md','# Registry\n\n## Wiki 页面\n\n- `wiki/Alpha.md` Synthetic Alpha\n');
    put('system/registry/quick-reference.md',fs.readFileSync(path.join(root,'system/registry/quick-reference.md'),'utf8').replace('## Wiki\n','## Wiki\n\n- Alpha\n'));
    execFileSync('powershell',['-NoProfile','-File',path.join(root,tools,'sync-wiki-source-ledgers.ps1'),'-Mode','Sync'],{env:f.env,encoding:'utf8'});
  }
  execFileSync('powershell',['-NoProfile','-File',path.join(root,tools,'sync-quick-reference-groups.ps1'),'-Mode','Sync'],{env:f.env,encoding:'utf8'});
  for(const a of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['config','core.excludesFile',path.join(root,'.gitignore')],['add','.'],['commit','-m','fixture baseline']])git(...a);
  // Real clippings commonly arrive untracked; Stage1 must capture them.
  git('rm','--cached','-r','--','Clippings');git('commit','-m','fixture new untracked sources');
  let child=root;
  for(const parentPath of f.parents){
    for(const a of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['config','core.excludesFile',path.join(root,'.gitignore')],['add','--',path.basename(child)],['commit','-m','fixture parent baseline']])execFileSync('git',['-C',parentPath,...a],{env:f.env,stdio:['ignore','pipe','pipe']});
    child=parentPath;
  }
  const start=ps('-Action','start','-RunPath',rp,'-BatchId','flow','-Items',mapped?'Clippings/20260923-test.md|Clippings/20260923-test2.md':'Clippings/20260923-test.md','-ReviewPolicy','deferred');
  assert.equal(start.status,0,start.stderr+start.stdout);assert.deepEqual(f.get(rp).execution_control.writer_config,{model:'gpt-6.1-terra',reasoning_effort:'xhigh'});
  assert.equal(f.get(rp).execution_control.workflow_revision,2,'fresh consolidated runs use the streamlined revision');
  if(revision===1){const old=f.get(rp);delete old.execution_control.workflow_revision;f.put(rp,old);}
  f.host(parent,'gpt-5.6-sol','medium');
}
function articleDecision(source){return {source,disposition:'ingested',raw_name:path.posix.basename(source),type:'article',ingest_verdict:'pass',domains:['test'],registration:{category:'设计理论与方法论',source:'Fixture',keywords:'choice',summary:'Synthetic bounded mechanism',unconsumed:'无'},content_summary:'Synthetic complete mechanism and boundary'};}
function scoreSource(row){Object.assign(row,{A1:4,A2:3,A3:1,B1:2,B2:1,decision:'ingest',confidence:'fixture',evidence:'Synthetic source contains a mechanism and boundary'});if(row.source_decision){row.source_decision=articleDecision(row.source);row.wiki_coverage={summary:'Synthetic library coverage inspected; the complete claim still needs a disposition',candidates:[]};}}
function describeRaw(bundle){if(bundle.presentation)Object.assign(bundle.presentation,{content_summary:'Synthetic complete mechanism and resource boundary',writing_skeleton:'Mechanism then resource condition',coverage:'Complete synthetic source',boundary:'Limited resources',disposition:'retain'});}
function describeAggregate(report){if(report.page_summaries)for(const row of report.page_summaries)Object.assign(row,{knowledge_summary:'Bounded resource mechanism',source_boundary:'Synthetic source only',disposition:'updated',verification:'Actual synthetic page comparison'});}

test('owned scope follows registered references, never adopts arbitrary run-local files',()=>{
  const f=fixture();try{
    f.put(rp,{execution_control:{execution_profile:'consolidated-v1',advance:{outputs:[dir+'/a.json']}},package_data:{path:dir+'/package.json'}});
    f.put(dir+'/a.json',{report_path:dir+'/b.json'});f.put(dir+'/b.json',{});f.put(dir+'/package.json',{});f.put(dir+'/unowned-secret.txt','untouched');
    assert.ok(ownedPaths(f.root,rp).includes(dir+'/b.json'));
    assert.ok(!stagePaths(f.root,rp,{rows:[]}).includes(dir+'/unowned-secret.txt'));
    assert.deepEqual(stagePaths(f.root,rp,{rows:[]}),stagePaths(f.root,rp,{rows:[]}));
  }finally{f.close();}
});

test('unchanged failed inputs are suppressed; corrected inputs resume the same run',()=>{
  const f=fixture();try{
    setup(f);const response=f.step();f.reply(response,p=>{p.rows[0].A1='invalid';});
    const first=f.step();assert.equal(first.type,'blocked');assert.equal(first.task_id,'scoring');
    const after=fs.readFileSync(path.join(f.root,rp),'utf8');
    const again=f.step();assert.equal(again.retry_suppressed,true);assert.equal(fs.readFileSync(path.join(f.root,rp),'utf8'),after);
    f.reply(response,p=>{p.summary='Corrected synthetic scoring';Object.assign(p.rows[0],{A1:4,A2:3,A3:1,B1:2,B2:1,decision:'ingest',confidence:'fixture',evidence:'Synthetic mechanism and condition'});});
    assert.equal(f.step().task_id,'source-decisions');
  }finally{f.close();}
});

for(const revision of [1,2])test(`mixed source decisions record skipped history once (revision ${revision})`,()=>{
  const f=fixture();try{
    setup(f,{mapped:true,revision});
    f.put('Clippings/20260923-test2.md',fs.readFileSync(path.join(f.root,'Clippings/20260923-test2.md'),'utf8').replace('source: Fixture','source: "https://example.invalid/skipped"'));
    let r=f.step();assert.equal(r.task_id,'scoring');
    f.reply(r,p=>{p.summary='Synthetic scoring';for(const row of p.rows)scoreSource(row);if(revision===2){p.rows[1].decision='skip';p.rows[1].source_decision.skip_reason='No independent explanatory value';}});
    if(revision===1){r=f.step();assert.equal(r.task_id,'source-decisions');f.reply(r,p=>{
      Object.assign(p[0],{disposition:'ingested',raw_name:'20260923-test.md',type:'article',ingest_verdict:'pass',domains:['test'],registration:{category:'设计理论与方法论',source:'Fixture',keywords:'choice',summary:'Synthetic boundary',unconsumed:'无'},content_summary:'Synthetic mechanism'});
      Object.assign(p[1],{disposition:'skipped',registration:{source:'Fixture'},skip_reason:'No independent explanatory value'});
    });}
    r=f.step();assert.equal(r.task_id,'writer-identity',JSON.stringify(r));
    const skipped='system/registry/skipped-sources.md',bytes=fs.readFileSync(path.join(f.root,skipped),'utf8');
    assert.match(bytes,/Clippings\/20260923-test2/);
    assert.equal(f.get(rp).artifacts.filter(a=>a.kind==='input').length,2);
    assert.equal(f.step().task_id,'writer-identity');
    assert.equal(fs.readFileSync(path.join(f.root,skipped),'utf8'),bytes);
  }finally{f.close();}
});

test('all-skipped revision2 stops explicitly without Raw or a writer',()=>{
  const f=fixture();try{
    setup(f,{revision:2});let r=f.step();f.reply(r,p=>{p.summary='Synthetic no-ingest decision';scoreSource(p.rows[0]);p.rows[0].decision='skip';p.rows[0].source_decision.skip_reason='Synthetic source adds no usable knowledge';});
    r=f.step();assert.equal(r.task_id,'all-skipped',JSON.stringify(r));assert.equal(f.get(rp).execution_control.agent_sessions.length,0);assert.equal(f.get(rp).artifacts.filter(a=>a.kind==='raw').length,0);
  }finally{f.close();}
});

test('merged source validation fails before sealing and the same scoring response can be corrected',()=>{
  const f=fixture();try{
    setup(f,{revision:2});const response=f.step();f.reply(response,p=>{p.summary='Synthetic scoring';scoreSource(p.rows[0]);p.rows[0].source_decision.domains=['missing'];});
    let r=f.step();assert.equal(r.type,'blocked');assert.equal(r.task_id,'scoring');assert.equal(f.get(rp).packages.scoring,null);
    f.reply(response,p=>{p.rows[0].source_decision.domains=['test'];});r=f.step();assert.equal(r.task_id,'writer-identity',JSON.stringify(r));
  }finally{f.close();}
});

for(const [baselineCount,revision] of [[1,1],[29,1],[1,2],[29,2]])test(`real start through final review preserves semantic gates (baseline ${baselineCount}, revision ${revision})`,()=>{
  const f=fixture();try{
    setup(f,{baselineCount,revision});
    let r=f.step();assert.equal(r.task_id,'scoring',JSON.stringify(r));
    const before=fs.readFileSync(path.join(f.root,rp),'utf8');assert.deepEqual(f.step(),r);assert.equal(fs.readFileSync(path.join(f.root,rp),'utf8'),before);
    f.reply(r,p=>{p.summary='Synthetic scoring, not production evidence';scoreSource(p.rows[0]);});
    if(revision===1){r=f.step();assert.equal(r.task_id,'source-decisions',JSON.stringify(r));f.reply(r,p=>Object.assign(p[0],articleDecision(p[0].source)));}
    r=f.step();assert.equal(r.task_id,'writer-identity',JSON.stringify(r));
    f.reply(r,p=>{p.agent_id=writer;});f.host(writer,'gpt-6.1-terra','xhigh');
    r=f.step();assert.equal(r.type,'needs_agent',JSON.stringify(r));assert.match(r.task_id,/dispatch-/);
    const id=r.task_id;const initial=f.get(rp).execution_control.dispatches.length;
    assert.equal(f.step().task_id,id);assert.equal(f.get(rp).execution_control.dispatches.length,initial);
    f.reply(r,p=>{p.sent=true;});assert.equal(f.step().type,'waiting_agent');
    const source=f.get(rp).execution_control.advance.sources[0];
    f.put(source.body,{schema_version:1,title:'Test',sections:[{heading:'Mechanism',source_locator:'Mechanism',body:prose}]});
    f.host(writer,'gpt-6.1-terra','xhigh',true);f.reply(r,p=>{p.completed=true;});
    r=f.step();assert.equal(r.type,'needs_review',JSON.stringify(r));assert.ok(r.review_path);
    const bundle=f.get(r.review_path);bundle.ledger.claims=[{id:'C1',meaning:'Choices have costs and bounded consequences',source_quote:prose,raw_quote:prose}];
    bundle.ledger.exclusion_policy.categories=['frontmatter','navigation','nonsemantic_media'];
    bundle.decisions={fresh_context:false,checks:[{id:'C1',source_status:'complete',raw_status:'supported',note:'Synthetic fixture judgment'}],coverage:{ledger_complete:true,missing_claims:[],source_sections:bundle.section_inventory.source_sections.map(s=>({id:s.id,status:'covered',claim_ids:['C1'],reason:'Synthetic full coverage'})),raw_sections:bundle.section_inventory.raw_sections.map(s=>({id:s.id,status:'supported',reason:'Synthetic source supported'}))},findings:[]};
    describeRaw(bundle);f.put(r.review_path,bundle);f.reply(r,p=>{p.completed=true;});
    if(revision===1){r=f.step();assert.equal(r.task_id,'stage1-summary',JSON.stringify(r));f.reply(r,p=>{p.summary='Synthetic actual Raw';Object.assign(p.rows[0],{writing_skeleton:'Mechanism then condition',coverage:'Complete synthetic source',boundary:'Limited resources',disposition:'retain'});});}
    r=f.step();assert.equal(r.task_id,'wiki-plan',JSON.stringify(r));
    assert.equal(f.get(rp).status,'stage1_committed');assert.ok(f.get(rp).commits.stage1);
    if(revision===2){assert.ok(r.coverage_reuse);assert.equal(f.get(f.get(rp).package_data.path).sections.stage1.semantic.rows[0].content_summary,bundle.presentation.content_summary);}
    assert.ok(f.git('show',f.get(rp).commits.stage1+':Clippings/20260923-test.md').includes(prose));
    // All-not-applicable is a valid zero-Wiki branch, not a fabricated empty page.
    f.reply(r,p=>{p.summary='Synthetic no Wiki increment';p.consumption[0].coverage_reason='Synthetic exclusion exercised';Object.assign(p.consumption[0].decisions[0],{disposition:'not_applicable',reason:'Synthetic branch only',must_preserve:['resource boundary']});});
    if(revision===1){r=f.step();assert.equal(r.task_id,'consumption-final',JSON.stringify(r));f.reply(r,p=>{p.summary='Synthetic final exclusion';});}
    assert.equal(f.get(rp).execution_control.dispatches.length,1);
    r=f.step();assert.notEqual(r.type,'blocked',JSON.stringify(r));
    assert.equal(r.task_id,'aggregate',JSON.stringify(r));
    assert.equal(r.semantic_response_path,dir+'/semantic-stage3-final.json','semantic corrections must target the owned canonical input, not a generated prepared file');
    assert.equal(f.get(rp).execution_control.page_reviews.length,0);
    const aggregate=f.get(r.response_path);assert.equal(aggregate.status,'pending','bookkeeping never approves the aggregate');aggregate.status='passed';aggregate.coverage_summary='Synthetic full exclusion and no hidden increment';describeAggregate(aggregate);f.put(r.response_path,aggregate);
    if(baselineCount===29){r=f.step();assert.equal(r.task_id,'backtest-30',JSON.stringify(r));assert.equal(r.type,'needs_decision');assert.equal(f.get(rp).backtests.length,0);return;}
    if(revision===1){r=f.step();assert.equal(r.task_id,'gate-summary',JSON.stringify(r));f.reply(r,p=>{p.summary='Synthetic actual exceptions reviewed';});}
    r=f.step();
    if(r.type==='blocked'&&fs.existsSync(path.join(f.root,dir,'maintenance.json'))){const m=f.get(dir+'/maintenance.json');for(const c of m.checks?.filter(c=>c.passed===false)??[]){let details=c.details;try{const h=JSON.parse(details);details=h.checks?.filter(x=>x.exit_code!==0).map(x=>({id:x.id,status:x.status,findings:x.findings}));}catch{}console.error(JSON.stringify({id:c.id,details}));}}
    assert.equal(r.type,'awaiting_final_review',JSON.stringify(r));
  }finally{f.close();}
});

test('shared-page and one-to-many delivery, capacity decision, approval and direct-parent closure use real components',()=>{
  const f=fixture({nested:true});try{
    setup(f,{mapped:true,capacity:true,revision:2});
    let r,finished=false,injectedRawFailure=false,heldSecond=false,waitedForSecond=false;
    f.put(dir+'/unregistered-note.txt','not task output');
    for(let turn=0;turn<60;turn++){
      r=f.step();
      if(r.type==='blocked'&&fs.existsSync(path.join(f.root,dir,'maintenance.json'))){const m=f.get(dir+'/maintenance.json');console.error(JSON.stringify(m.health?.checks.filter(c=>c.exit_code!==0).map(c=>({id:c.id,findings:c.findings}))))}
      assert.notEqual(r.type,'blocked',JSON.stringify(r));
      if(r.type==='awaiting_final_review'){finished=true;break;}
      if(r.task_id==='scoring')f.reply(r,p=>{p.summary='Synthetic scoring';for(const row of p.rows){scoreSource(row);row.wiki_coverage.candidates=[{path:'wiki/Alpha.md',heading:'Mechanism',assessment:'Existing independent context; resource-boundary increment needed'}];}});
      else if(r.task_id==='source-decisions')f.reply(r,p=>{for(const row of p)Object.assign(row,{disposition:'ingested',raw_name:path.posix.basename(row.source),type:'article',ingest_verdict:'pass',domains:['test'],registration:{category:'设计理论与方法论',source:'Fixture',keywords:'choice',summary:'Synthetic bounded mechanism',unconsumed:'无'},content_summary:'Synthetic complete mechanism and boundary'});});
      else if(r.task_id==='writer-identity'){f.reply(r,p=>{p.agent_id=writer;});f.host(writer,'gpt-6.1-terra','xhigh');}
      else if(r.type==='needs_agent'){
        const assignment=f.get(r.inputs[0]);f.reply(r,p=>{p.sent=true;});
        if(assignment.stage==='stage1'){
          const item=f.get(rp).execution_control.advance.sources.find(s=>assignment.outputs.includes(s.output));
          const body=!injectedRawFailure?prose.replace('limited resources','unlimited resources'):prose;injectedRawFailure=true;
          f.put(item.body,{schema_version:1,title:'Test',sections:[{heading:'Mechanism',source_locator:'Mechanism',body}]});
        }else{
          const page=assignment.outputs[0],related=f.get(rp).execution_control.advance.sources.filter((s,i)=>page==='wiki/Alpha.md'||i===0);
          const before=fs.readFileSync(path.join(f.root,page),'utf8');
          f.put(page,before.replace('## 来源',prose+'\n\n## 来源')+related.map(s=>'- [['+s.output.slice(0,-3)+']]\n').join(''));
        }
        if(r.task_id==='dispatch-2'&&!heldSecond){heldSecond=true;continue;}
        f.host(writer,'gpt-6.1-terra','xhigh',true);f.reply(r,p=>{p.completed=true;});
      }
      else if(r.type==='waiting_agent'){
        assert.equal(r.task_id,'dispatch-2');assert.equal(f.get(rp).execution_control.dispatches.length,2,'repair must not interrupt an active writing turn');
        waitedForSecond=true;f.host(writer,'gpt-6.1-terra','xhigh',true);f.reply(r,p=>{p.completed=true;});
      }
      else if(r.review_path){
        const b=f.get(r.review_path),raw=fs.readFileSync(path.join(f.root,b.ledger.raw.path),'utf8'),wrong=raw.includes('unlimited resources'),actual=wrong?prose.replace('limited resources','unlimited resources'):prose;
        b.ledger.claims=[{id:'C1',meaning:'Choices have costs and bounded consequences',source_quote:prose,raw_quote:actual}];b.ledger.exclusion_policy.categories=['frontmatter','navigation','nonsemantic_media'];
        b.decisions={fresh_context:false,checks:[{id:'C1',source_status:'complete',raw_status:wrong?'unsupported':'supported',note:wrong?'Synthetic source states limited, not unlimited resources':'Synthetic fixture judgment'}],coverage:{ledger_complete:true,missing_claims:[],source_sections:b.section_inventory.source_sections.map(s=>({id:s.id,status:'covered',claim_ids:['C1'],reason:'Synthetic full coverage'})),raw_sections:b.section_inventory.raw_sections.map(s=>({id:s.id,status:wrong?'unsupported':'supported',reason:wrong?'Synthetic unsupported resource boundary':'Synthetic source support'}))},findings:[]};
        describeRaw(b);f.put(r.review_path,b);f.reply(r,p=>{p.completed=true;});
      }
      else if(r.task_id.startsWith('repair-'))f.reply(r,p=>{p.action='content';p.instructions='Correct unlimited resources to limited resources from the source. Preserve the rest of the complete article.';});
      else if(r.task_id==='stage1-summary')f.reply(r,p=>{p.summary='Synthetic Raw contents reviewed';for(const row of p.rows)Object.assign(row,{writing_skeleton:'Mechanism then boundary',coverage:'Full synthetic source',boundary:'Limited resources',disposition:'retain'});});
      else if(r.task_id==='wiki-plan')f.reply(r,p=>{p.summary='Synthetic shared page and second destination';for(const [i,row] of p.consumption.entries()){row.coverage_reason='Synthetic coverage at each required destination';Object.assign(row.decisions[0],{disposition:'planned',reason:'Add resource boundary in the appropriate contexts',must_preserve:['resource boundary'],destinations:(i===0?['wiki/Alpha.md','wiki/Beta.md']:['wiki/Alpha.md']).map(path=>({path,heading:'Mechanism',quote:''}))});}});
      else if(r.task_id.startsWith('page-')||r.task_id==='affected-pages'){
        for(const p of r.response_paths??[r.response_path]){const report=f.get(p);Object.assign(report,{status:'passed',coverage_summary:'Synthetic required boundary retained',context_check:'Existing independently supported context is unchanged'});for(const c of report.comparisons)Object.assign(c,{source_quote:prose,wiki_quote:prose,assessment:'Synthetic exact mechanism and resource-boundary comparison'});f.put(p,report);}
      }
      else if(r.task_id==='consumption-final')f.reply(r,p=>{p.summary='Synthetic completed additions';for(const row of p.rows)Object.assign(row,{knowledge_summary:'Bounded resource mechanism',source_boundary:'Synthetic source only',disposition:'updated',verification:'Full synthetic comparison'});for(const row of p.consumption)for(const d of row.decisions)d.disposition='absorbed';});
      else if(r.task_id==='capacity')f.reply(r,p=>{for(const row of p.rows)Object.assign(row,{action:'defer',reason:'Synthetic topic remains coherent after complete writing',review_when:'Next independent source'});});
      else if(r.task_id==='aggregate'){const report=f.get(r.response_path);describeAggregate(report);Object.assign(report,{status:'passed',coverage_summary:'Synthetic cross-page coverage includes both Alpha and Beta; no required destination omitted'});f.put(r.response_path,report);}
      else if(r.task_id==='gate-summary')f.reply(r,p=>{p.summary='Synthetic actual exceptions reviewed';});
      else assert.fail('Unexpected response '+JSON.stringify(r));
    }
    assert.ok(finished,'Driver must reach final review');
    assert.ok(!f.get(rp).execution_control.advance.outputs.some(p=>/work\/(source-decisions|stage1-summary|consumption-final|gate-summary)-/.test(p)),'streamlined flow has no duplicate semantic slots');
    assert.equal(waitedForSecond,true,'actual waiting branch is exercised with synthetic host completion');
    const run=f.get(rp);
    assert.equal(run.execution_control.dispatches.filter(d=>d.stage==='stage3').length,2,'shared page dispatched once');
    assert.equal(run.execution_control.page_reviews.filter(p=>p.status==='passed').length,2);
    assert.ok(run.execution_control.advance.navigation_outputs.includes('domains/test.md'));
    assert.ok(run.execution_control.advance.capacity_identity,'capacity decision is bound to the affected page version');
    assert.match(fs.readFileSync(path.join(f.root,'domains/test.md'),'utf8'),/\.\.\/wiki\/Beta\.md/);
    assert.equal(run.execution_control.core_review_history.filter(a=>a.status==='failed').length,1,'failed judgment remains in history');
    assert.equal(f.git('ls-files','--',dir+'/unregistered-note.txt'),'');
    const stable=fs.readFileSync(path.join(f.root,rp),'utf8');
    const rejected=f.step(['--approved','0'.repeat(64)]);assert.equal(rejected.type,'blocked');assert.equal(fs.readFileSync(path.join(f.root,rp),'utf8'),stable);
    // Stop after child exit commit with an unrelated parent index entry, then
    // resume from a clean child. The persisted scope must still cover evidence.
    const direct=f.parents[0],parentGit=(...a)=>execFileSync('git',['-C',direct,...a],{env:f.env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
    fs.writeFileSync(path.join(direct,'parallel.txt'),'other owner');parentGit('add','--','parallel.txt');
    const interrupted=f.step(['--approved',r.sha256]);assert.equal(interrupted.type,'blocked');assert.match(interrupted.reason,/Unrelated parent index/);
    const exitHead=f.git('rev-parse','HEAD');assert.ok(f.get(rp).execution_control.advance.exit_scope.length);
    parentGit('reset','--','parallel.txt');
    const closed=f.step();assert.equal(closed.type,'closed',JSON.stringify(closed));
    assert.equal(f.git('rev-parse','HEAD'),exitHead,'resuming does not create a duplicate child exit commit');
    assert.equal(f.get(rp).status,'completed');
    assert.ok(['passed','unavailable_standalone'].includes(closed.workspace_closure.status));
    let child=f.root;
    for(const parentPath of f.parents){const revision=execFileSync('git',['-C',child,'rev-parse','HEAD'],{env:f.env,encoding:'utf8'}).trim();const entry=execFileSync('git',['-C',parentPath,'ls-tree','HEAD','--',path.basename(child)],{env:f.env,encoding:'utf8'});assert.match(entry,new RegExp('^160000 commit '+revision+'\\t'));child=parentPath;}
    assert.equal(f.git('ls-files','--',dir+'/unregistered-note.txt'),'');
  }finally{f.close();}
});
