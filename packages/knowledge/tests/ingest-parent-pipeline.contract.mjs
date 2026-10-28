import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pipeline} from '../system/maintenance/checklists/ingest-pipeline.mjs';
import {pageScope,preparePageReview,verifyPageReview} from '../system/maintenance/checklists/ingest-page-review.mjs';
import {sha} from '../system/maintenance/checklists/raw-quality.mjs';
import {snapshot,verifySection} from '../system/maintenance/checklists/ingest-review.mjs';

test('dispatch is pre-send, stage boundary enforced, page evidence survives unrelated work',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'parent-pipeline-'));
  const put=(p,v)=>{fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});fs.writeFileSync(path.join(root,p),typeof v==='string'?v:JSON.stringify(v));};
  const digest=p=>sha(fs.readFileSync(path.join(root,p)));
  try{
    const runPath='system/run/run.json',page='wiki/a.md',raw='raw-sources/a.md';
    const run={status:'running_scoring',items:[],commits:{},package_data:{path:'system/run/package.json'},execution_control:{reviewer_route_version:3,parent_reviewer:{agent_id:'p',role:'core_reviewer',model:'sol',reasoning_effort:'medium'},agent_sessions:[{agent_id:'w',role:'content_writer',status:'active',model:'gpt-5.6-luna',reasoning_effort:'max'}],artifact_authors:{},dispatches:[],deliveries:[]}};
    put(runPath,run);put('system/run/task.json',{stage:'stage1',outputs:[raw],instructions:'Write body only'});
    run.execution_control.writer_config={model:'gpt-6-luna',reasoning_effort:'xhigh'};put(runPath,run);
    assert.throws(()=>pipeline(root,'dispatch',{run:runPath,agent:'w',task:'system/run/task.json'}),/pinned gpt-6-luna\/xhigh/);
    delete run.execution_control.writer_config;put(runPath,run);
    const dispatch=pipeline(root,'dispatch',{run:runPath,agent:'w',task:'system/run/task.json'});
    assert.ok(Date.parse(dispatch.dispatched_at)<=Date.now());assert.equal(dispatch.preflight.at(-1),dispatch.dispatched_at);
    put('system/run/wiki.json',{stage:'stage3',outputs:[page],instructions:'Write assigned page'});
    assert.throws(()=>pipeline(root,'dispatch',{run:runPath,agent:'w',task:'system/run/wiki.json'}),/Stage1 checkpoint/);
    Object.assign(run,{status:'stage2_planned'});run.commits.stage1='checkpoint';
    for(const p of [page,raw])run.execution_control.artifact_authors[p]={agent_id:'w'};
    const consumption=[{raw,ledger:'system/run/ledger.json',decisions:[{claim_ids:['C1'],must_preserve:['condition'],disposition:'absorbed',destinations:[{path:page,heading:'A',quote:'knowledge'}]}]}];
    put(page,'# A\nknowledge');put(raw,'complete source');put('system/run/ledger.json',{});
    const report={schema_version:1,review_mode:'parent_non_author',reviewer_agent_id:'p',page,status:'passed',findings:[],coverage_summary:'Synthetic fixture judgment, not business evidence',scope_sha256:sha(JSON.stringify(pageScope(consumption,page))),input_hashes:[page,raw].sort().map(p=>({path:p,sha256:digest(p)}))};
    put('system/run/page.json',report);const ref={path:'system/run/page.json',sha256:digest('system/run/page.json')};
    verifyPageReview(root,run,consumption,ref,'p');
    run.execution_control.page_review_contract_version=2;
    assert.throws(()=>verifyPageReview(root,run,consumption,ref,'p'),/evidence-bearing/);
    delete run.execution_control.page_review_contract_version;
    consumption.push({raw:'raw-sources/b.md',decisions:[{claim_ids:['C2'],destinations:[{path:'wiki/b.md'}]}]});
    verifyPageReview(root,run,consumption,ref,'p');
    consumption[0].decisions[0].must_preserve.push('new condition');
    assert.throws(()=>verifyPageReview(root,run,consumption,ref,'p'),/decisions changed/);consumption[0].decisions[0].must_preserve.pop();
    put(page,'changed content');assert.throws(()=>verifyPageReview(root,run,consumption,ref,'p'),/Re-review affected/);put(page,'# A\nknowledge');
    // New runs keep an explicit per-delivery review queue. A generated report
    // must be completed and recorded before the final queue check can pass.
    run.execution_control.page_review_contract_version=2;run.execution_control.page_review_queue_version=1;run.execution_control.page_reviews=[];
    run.execution_control.artifact_authors[page]={agent_id:'w',dispatch_id:'d-page'};
    run.execution_control.deliveries=[{dispatch_id:'d-page',agent_id:'w',stage:'stage3',outputs:[{path:page,sha256:digest(page)}]}];
    const semantic={rows:[{artifact:page}],consumption};put('system/run/semantic.json',semantic);
    const queued=preparePageReview(root,run,semantic,page,{verifyRuntime:false});
    queued.status='passed';queued.coverage_summary='Complete synthetic decision reviewed';queued.context_check='Synthetic existing context checked';
    for(const comparison of queued.comparisons){comparison.source_selection={start_line:1,end_line:1};comparison.wiki_selection={start_line:2,end_line:2};comparison.assessment='Synthetic claim and condition preserved';}
    put('system/run/page-queued.json',queued);
    run.execution_control.page_reviews=[{dispatch_id:'d-page',page,report_path:'system/run/page-queued.json',prepared_at:'2026-01-01T00:00:00Z',status:'pending'}];put(runPath,run);
    assert.throws(()=>pipeline(root,'check-page-reviews',{run:runPath,semantic:'system/run/semantic.json'}),/lacks recorded/);
    const recorded=pipeline(root,'record-page-review',{run:runPath,semantic:'system/run/semantic.json',report:'system/run/page-queued.json'});assert.equal(recorded.status,'passed');
    const checked=pipeline(root,'check-page-reviews',{run:runPath,semantic:'system/run/semantic.json'});assert.deepEqual(checked.reviewed_pages,[page]);
    run.execution_control=JSON.parse(fs.readFileSync(path.join(root,runPath),'utf8')).execution_control;
    // New rule modules must be present in an actual snapshot; fixture placeholders suffice here.
    put('system/maintenance/checklists/ingest-pipeline.mjs','fixture');put('system/maintenance/checklists/ingest-page-review.mjs','fixture');put('system/maintenance/checklists/wiki-consumption.mjs','fixture');
    put('system/run/aggregate.json',{page_reviews:[ref]});
    const deps=snapshot(root,run,'stage3',{consumption_review:{path:'system/run/aggregate.json'}});
    assert.ok(deps.some(x=>x.path===ref.path&&x.sha256===ref.sha256));
    const hasConsumptionRule=stage=>snapshot(root,run,stage).some(x=>x.path==='system/maintenance/checklists/wiki-consumption.mjs');
    assert.equal(hasConsumptionRule('scoring'),false);
    assert.equal(hasConsumptionRule('stage1'),false);
    assert.equal(hasConsumptionRule('stage2'),false);
    assert.equal(hasConsumptionRule('stage3'),true);
    assert.equal(hasConsumptionRule('gate_audit'),true);
    // Older sealed runs accidentally bound the Stage3-only verifier into earlier phases.
    put('system/run/package.json',{sections:Object.fromEntries(['scoring','stage1','stage2','stage3'].map(stage=>[stage,{status:'sealed',derived:{dependencies:[{path:'system/maintenance/checklists/wiki-consumption.mjs',exists:true,sha256:sha(Buffer.from('old validator'))}]}}]))});
    const legacyRun={package_data:{path:'system/run/package.json'}};
    put('system/maintenance/checklists/wiki-consumption.mjs','new validator');
    for(const stage of ['scoring','stage1','stage2'])assert.doesNotThrow(()=>verifySection(root,legacyRun,stage));
    assert.throws(()=>verifySection(root,legacyRun,'stage3'),/Evidence changed/);
    run.status='completed';put(runPath,run);
    assert.throws(()=>pipeline(root,'dispatch',{run:runPath,agent:'w',task:'system/run/task.json'}),/terminal/);
  }finally{
    if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('parent-pipeline-'))throw Error('Unsafe fixture cleanup');
    fs.rmSync(root,{recursive:true,force:true});
  }
});
