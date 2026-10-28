import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('new Prepare/Seal routing stages producer paths only, after review checks, and never seals on failure',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-auto-stage-')),tools='system/maintenance/checklists',rp='system/run/run.json';
  const put=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof v==='string'?v:JSON.stringify(v));};
  const env={...Object.fromEntries(Object.entries(process.env).filter(([k])=>!['psmodulepath','codex_thread_id'].includes(k.toLowerCase()))),GIT_CONFIG_GLOBAL:'NUL'};
  const git=(...a)=>execFileSync('git',['-C',root,'-c','core.excludesFile=',...a],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
  try{
    put(tools+'/finalize-ingest-stage3.ps1',fs.readFileSync(path.join(project,tools,'finalize-ingest-stage3.ps1'),'utf8'));
    put(rp,{status:'stage2_planned',commits:{stage1:'fixture'},packages:{maintenance:null},package_data:{path:'system/run/data.json'},execution_control:{page_review_contract_version:3,page_review_queue_version:1,wiki_consumption_contract_version:1}});
    put('system/run/data.json',{sections:{stage3:{status:'open'}}});put('system/run/semantic.json',{});put('system/run/gate.json',{});put('raw-sources/a.md','raw');
    for(const name of ['sync-wiki-source-ledgers.ps1','sync-capacity-risks.ps1'])put(tools+'/'+name,'param($Mode)\nexit 0');
    put(tools+'/ingest-control.ps1','param($Action)\nif($Action -eq "record-writer-stage"){exit 99}\nexit 0');
    put(tools+'/run-ingest-maintenance.ps1','exit 29');
    for(const name of ['ingest-stage3-preflight.mjs','ingest-pipeline.mjs'])put(tools+'/'+name,'console.log("ok")');
    put(tools+'/wiki-consumption.mjs',`import fs from 'node:fs';if(process.argv[2]==='diagnose'&&fs.existsSync('fail-review')){console.error('review pending');process.exitCode=1}else console.log('ok');`);
    put(tools+'/ingest-stage3-prepare.mjs',`console.log(JSON.stringify({status:'prepared',semantic_path:'system/run/semantic.json',stage_paths:['system/registry/KNOWLEDGE_STATUS.md']}));`);
    for(const a of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid']])git(...a);
    put('system/registry/KNOWLEDGE_STATUS.md','before');git('add','.');git('commit','-m','fixture');
    put('system/registry/KNOWLEDGE_STATUS.md','after');put('.obsidian/workspace.json','unrelated');put('fail-review','1');
    const args=['-NoProfile','-File',path.join(root,tools,'finalize-ingest-stage3.ps1'),'-Phase','Seal','-RunPath',rp,'-Stage3SemanticPath','system/run/semantic.json','-GateAuditSemanticPath','system/run/gate.json','-AgentIds','w'];
    let result=spawnSync('powershell',args,{cwd:root,env,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/review pending/);assert.equal(git('diff','--cached','--name-only').trim(),'');
    fs.unlinkSync(path.join(root,'fail-review'));
    result=spawnSync('powershell',args,{cwd:root,env,encoding:'utf8'});assert.notEqual(result.status,0);assert.match(result.stderr,/maintenance failed before package sealing/);
    assert.equal(git('diff','--cached','--name-only').trim(),'system/registry/KNOWLEDGE_STATUS.md');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root,rp),'utf8')).status,'stage2_planned');
  }finally{if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('ingest-auto-stage-'))throw Error('Unsafe fixture cleanup');fs.rmSync(root,{recursive:true,force:true});}
});

test('Seal forwards explicit primary authorship before sealing and never invents agent IDs',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-primary-'));
  const tools='system/maintenance/checklists',rp='system/maintenance/ingest-runs/test/run.json';
  const put=(p,t)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),t);};
  try {
    put(tools+'/finalize-ingest-stage3.ps1',fs.readFileSync(path.join(project,tools,'finalize-ingest-stage3.ps1'),'utf8'));
    for(const name of ['sync-wiki-source-ledgers.ps1','sync-capacity-risks.ps1']) put(tools+'/'+name,'param($Mode)\nexit 0');
    put(tools+'/run-ingest-maintenance.ps1',String.raw`param($Stage1Revision,[switch]$Staged,$OutputPath,$OutputMode)
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if(Test-Path -LiteralPath (Join-Path $root 'fail-maintenance')){exit 29}
$full=Join-Path $root $OutputPath
[IO.Directory]::CreateDirectory((Split-Path -Parent $full))|Out-Null
[IO.File]::WriteAllText($full,'{}')
exit 0
`);
    put(tools+'/ingest-stage3-preflight.mjs','console.log("ok")');
    put(tools+'/ingest-control.ps1',String.raw`param($Action,$RunPath,$Package,$SemanticDataPath,$AgentIds,$AfterCount,[switch]$PrimaryWriter)
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
if($Action -eq 'record-writer-stage') {
 [IO.File]::WriteAllText((Join-Path $root 'writer.json'),(@{primary=[bool]$PrimaryWriter;agent_ids=$AgentIds;package=$Package}|ConvertTo-Json))
 exit 0
}
if($Action -eq 'seal-package-section'){exit 23}
exit 0
`);
    put(rp,JSON.stringify({status:'stage2_planned',commits:{stage1:'fixture'},packages:{maintenance:null},package_data:{path:'data.json'}}));
    put('data.json',JSON.stringify({sections:{stage3:{status:'open'}}}));
    put('semantic.json',JSON.stringify({rows:[{path:'wiki/test.md'}]}));
    put('gate.json','{}');put('raw-sources/raw.md','source');put('.gitignore-global','');
    for(const args of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['config','core.excludesFile',path.join(root,'.gitignore-global')],['add','.']]) execFileSync('git',['-C',root,...args],{stdio:'ignore'});
    const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!['psmodulepath','codex_thread_id'].includes(key.toLowerCase()))),GIT_CONFIG_GLOBAL:'NUL'};
    const args=['-NoProfile','-File',path.join(root,tools,'finalize-ingest-stage3.ps1'),'-Phase','Seal','-RunPath',rp,'-Stage3SemanticPath','semantic.json','-GateAuditSemanticPath','gate.json'];
    let result=spawnSync('powershell',args,{encoding:'utf8',env});
    assert.notEqual(result.status,0);assert.match(result.stderr,/explicit PrimaryWriter/);
    assert.equal(fs.existsSync(path.join(root,'writer.json')),false);
    put('fail-maintenance','1');
    result=spawnSync('powershell',[...args,'-PrimaryWriter'],{encoding:'utf8',env});
    assert.notEqual(result.status,0);assert.match(result.stderr,/maintenance failed before package sealing/);
    assert.equal(fs.existsSync(path.join(root,'writer.json')),false);
    fs.unlinkSync(path.join(root,'fail-maintenance'));
    result=spawnSync('powershell',[...args,'-PrimaryWriter'],{encoding:'utf8',env});
    assert.notEqual(result.status,0); // Deliberate downstream gate failure after writer registration.
    assert.match(result.stderr,/ingest-control failed/);
    const writer=JSON.parse(fs.readFileSync(path.join(root,'writer.json'),'utf8'));
    assert.equal(writer.primary,true);assert.equal(writer.package,'stage3');assert.ok(!writer.agent_ids);
    // Exercise real PowerShell routing: preparation tolerates no review, Seal does not.
    const state=JSON.parse(fs.readFileSync(path.join(root,rp),'utf8'));
    state.execution_control={runtime_contract_version:3,wiki_consumption_contract_version:1};
    put(rp,JSON.stringify(state));
    put(tools+'/wiki-consumption.mjs',`if(process.argv[2]!=='prepare'){console.error('risk review missing');process.exitCode=1;}else console.log('prepared');`);
    const prepareArgs=[...args];prepareArgs[prepareArgs.indexOf('Seal')]='Prepare';
    result=spawnSync('powershell',prepareArgs,{encoding:'utf8',env});
    assert.equal(result.status,0,result.stderr);
    assert.equal(JSON.parse(result.stdout).review_status,'not_checked');
    result=spawnSync('powershell',[...args,'-PrimaryWriter'],{encoding:'utf8',env});
    assert.notEqual(result.status,0);assert.match(result.stderr,/wiki_consumption/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('finalizer stops on failed gates and reuses reviewed/completed states without repeated mutation',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-finalizer-'));
  const tools='system/maintenance/checklists', rp='system/maintenance/ingest-runs/test/run.json';
  const put=(p,t)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),t);};
  const cleanEnv={...Object.fromEntries(Object.entries(process.env).filter(([key])=>key.toLowerCase()!=='psmodulepath')),GIT_CONFIG_GLOBAL:'NUL'};
  const invoke=(phase,...args)=>spawnSync('powershell',['-NoProfile','-File',path.join(root,tools,'finalize-ingest-stage3.ps1'),'-Phase',phase,'-RunPath',rp,...args],{encoding:'utf8',env:cleanEnv});
  const get=()=>JSON.parse(fs.readFileSync(path.join(root,rp),'utf8'));
  try{
    for(const name of ['finalize-ingest-stage3.ps1','ingest-close-plan.mjs','ingest-cost-lifecycle.mjs','ingest-session-cost.mjs']) put(tools+'/'+name,fs.readFileSync(path.join(project,tools,name),'utf8'));
    // The control-plane test double records dependency order and changes only fixture state.
    put(tools+'/ingest-control.ps1',String.raw`param($Action,$RunPath,$Stage3Revision,$OutputPath,$ApprovedHash)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$full=Join-Path $root $RunPath
$r=Get-Content -LiteralPath $full -Raw|ConvertFrom-Json
[IO.File]::AppendAllText((Join-Path $root 'calls.txt'),$Action+"\n")
if(Test-Path -LiteralPath (Join-Path $root ('fail-'+$Action))){exit 17}
switch($Action){
 'check-stage3' {if($Stage3Revision -notmatch '^[a-f0-9]{40}$'){exit 18};$r.status='stage3_completed'}
 'render-final-review' {$p=Join-Path $root $OutputPath;[IO.File]::WriteAllText($p,'approved fixture');$r.status='awaiting_final_review';$r.final_review=[pscustomobject]@{path=$OutputPath;sha256=(Get-FileHash -LiteralPath $p).Hash.ToLowerInvariant();approved_sha256=$null}}
 'verify-final-review' {exit 0}
 'finish' {if($r.final_review.sha256 -ne $ApprovedHash){exit 19};$r.status='completed';$r.final_review.approved_sha256=$ApprovedHash;[IO.File]::WriteAllText((Join-Path $root 'system/maintenance/ingest-runs/index.json'),'{}')}
 default {exit 20}
}
[IO.File]::WriteAllText($full,($r|ConvertTo-Json -Depth 10))
`);
    put(rp,JSON.stringify({batch_id:'fixture',started_at:'2026-01-01T00:00:00Z',status:'stage2_planned',commits:{stage1:null,stage3:null},counts:{before:1,after:1},final_review:null}));
    put('raw-sources/raw.md','content');put('.gitignore-global','');
    for(const args of [['init'],['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['config','core.excludesFile',path.join(root,'.gitignore-global')],['add','.'],['commit','-m','fixture']]) execFileSync('git',['-C',root,...args],{stdio:'ignore'});
    // A stale ledger must stop Seal before any controller mutation or writer hash binding.
    put(tools+'/sync-wiki-source-ledgers.ps1','param($Mode)\nif($Mode -ne "Check"){exit 18}\nexit 17');
    put(tools+'/sync-capacity-risks.ps1','param($Mode)\nexit 0');
    let seal=invoke('Seal','-Stage3SemanticPath','not-read.json','-GateAuditSemanticPath','not-read.json');
    assert.notEqual(seal.status,0);assert.match(seal.stderr,/sync-wiki-source-ledgers\.ps1/);
    assert.equal(fs.existsSync(path.join(root,'calls.txt')),false);assert.equal(get().status,'stage2_planned');
    put(tools+'/sync-wiki-source-ledgers.ps1','param($Mode)\nexit 0');
    put(tools+'/sync-capacity-risks.ps1','param($Mode)\nexit 17');
    seal=invoke('Seal','-Stage3SemanticPath','not-read.json','-GateAuditSemanticPath','not-read.json');
    assert.notEqual(seal.status,0);assert.equal(fs.existsSync(path.join(root,'calls.txt')),false);
    put(tools+'/sync-capacity-risks.ps1','param($Mode)\nexit 0');
    put(tools+'/ingest-stage3-preflight.mjs','console.log("registration missing");process.exitCode=2;');
    seal=invoke('Seal');assert.notEqual(seal.status,0);assert.match(seal.stderr,/Registration preflight failed/);
    assert.equal(fs.existsSync(path.join(root,'calls.txt')),false);
    seal=invoke('Seal','-PrimaryWriter','-AgentIds','invented');
    assert.notEqual(seal.status,0);assert.match(seal.stderr,/mutually exclusive/);
    assert.equal(fs.existsSync(path.join(root,'calls.txt')),false);
    put('fail-check-stage3','1');assert.notEqual(invoke('Review').status,0);assert.equal(get().status,'stage2_planned');
    assert.equal(fs.readFileSync(path.join(root,'calls.txt'),'utf8'),'check-stage3\\n');
    fs.unlinkSync(path.join(root,'fail-check-stage3'));
    let result=invoke('Review');assert.equal(result.status,0,result.stderr+result.stdout);assert.equal(get().status,'awaiting_final_review');
    const report=path.join(root,get().final_review.path), original=fs.readFileSync(report,'utf8');
    result=invoke('Review');assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(report,'utf8'),original);
    assert.notEqual(invoke('Finish','-ApprovedHash','b'.repeat(64)).status,0);assert.equal(get().status,'awaiting_final_review');
    const ready=get();ready.execution_control={runtime_contract_version:3,host_cost:{parent_session_id:'fixture-parent'}};put(rp,JSON.stringify(ready));
    put('sessions/parent.jsonl',[
      {timestamp:'2026-01-01T00:00:00Z',type:'session_meta',payload:{id:'fixture-parent'}},
      {timestamp:'2026-01-01T00:00:01Z',type:'event_msg',payload:{type:'token_count',info:{total_token_usage:{input_tokens:100,cached_input_tokens:80,output_tokens:10}}}}
    ].map(x=>JSON.stringify(x)).join('\n'));
    const costArgs=['-ParentSessionId','fixture-parent','-HostSessionRoot',path.join(root,'sessions')];
    const hash=get().final_review.sha256;result=invoke('Finish','-ApprovedHash',hash,...costArgs);assert.equal(result.status,0,result.stderr+result.stdout);
    assert.ok(JSON.parse(result.stdout).stage_paths.includes('system/maintenance/ingest-runs/index.json'));
    const timingFile=path.join(root,path.dirname(rp),'lifecycle-timing.json');
    const timing=JSON.parse(fs.readFileSync(timingFile,'utf8'));
    assert.ok(timing.review_ready_at);assert.ok(timing.finish_started_at);assert.ok(timing.finish_completed_at);
    assert.ok(Date.parse(timing.finish_completed_at)>=Date.parse(timing.finish_started_at));
    const costFile=path.join(root,path.dirname(rp),'cost-final.json'),bytes=fs.readFileSync(costFile,'utf8');
    assert.equal(JSON.parse(bytes).total.known_usage.input_tokens,100);
    const calls=fs.readFileSync(path.join(root,'calls.txt'),'utf8');result=invoke('Finish','-ApprovedHash',hash,...costArgs);assert.equal(result.status,0,result.stderr);assert.equal(fs.readFileSync(path.join(root,'calls.txt'),'utf8'),calls);
    assert.notEqual(invoke('Finish','-ApprovedHash','b'.repeat(64)).status,0);
    assert.deepEqual(JSON.parse(fs.readFileSync(timingFile,'utf8')),timing);
    result=invoke('Costs',...costArgs);assert.equal(result.status,0,result.stderr+result.stdout);
    assert.equal(JSON.parse(bytes).total.known_usage.input_tokens,100);
    assert.equal(JSON.parse(bytes).lifecycle_complete,false);
    assert.equal(invoke('Costs',...costArgs).status,0);assert.equal(fs.readFileSync(costFile,'utf8'),bytes);
    result=invoke('CostsSnapshot',...costArgs);assert.equal(result.status,0,result.stderr+result.stdout);
    assert.equal(JSON.parse(result.stdout).status,'snapshot');assert.equal(JSON.parse(result.stdout).path,null);
    assert.equal(fs.readFileSync(costFile,'utf8'),bytes);
    result=invoke('Inspect');assert.equal(result.status,0,result.stderr);
    assert.ok(JSON.parse(result.stdout).stage_paths.some(x=>x.endsWith('/cost-final.json')));
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
