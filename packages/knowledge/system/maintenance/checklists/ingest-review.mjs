import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateStage3} from './ingest-runtime-contract.mjs';
import {checkConsumption,consumptionMetrics} from './wiki-consumption.mjs';
import {verifiedCaptureEvidence} from './ingest-maintenance-scope.mjs';
import {verifyPresealMaintenance} from './ingest-preseal-maintenance.mjs';

const own=fileURLToPath(import.meta.url);
export const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function safe(root,rel,{exists=true}={}) {
  if(typeof rel!=='string'||!rel.trim()) throw Error('Required path missing');
  const base=fs.realpathSync(root), full=path.resolve(base,rel);
  const inside=p=>p.startsWith(base+path.sep);
  if(!inside(full)) throw Error(`Path escapes Knowledge: ${rel}`);
  let parent=full;
  while(!fs.existsSync(parent)) { const next=path.dirname(parent);if(next===parent)throw Error('No safe ancestor');parent=next; }
  const actual=fs.realpathSync(parent);
  if(actual!==base&&!inside(actual)) throw Error(`Link escapes Knowledge: ${rel}`);
  // Reject reparse paths altogether for writes and evidence, including internal links.
  for(let part=parent;part!==base;part=path.dirname(part)) if(fs.lstatSync(part).isSymbolicLink()) throw Error(`Linked evidence path: ${rel}`);
  if(exists&&!fs.existsSync(full))throw Error(`Missing evidence: ${rel}`);
  return full;
}
const read=(root,rel)=>JSON.parse(fs.readFileSync(safe(root,rel),'utf8').replace(/^\uFEFF/,''));
const relative=(root,p)=>path.relative(root,p).split(path.sep).join('/');
const record=(root,rel)=>{const full=safe(root,rel,{exists:false});return {path:relative(root,full),exists:fs.existsSync(full),sha256:fs.existsSync(full)?sha(fs.readFileSync(full)):null};};
const rulePaths=['system/protocols/INGEST_PROTOCOL.md','system/protocols/SCORING_SYSTEM.md','raw-sources/README.md','wiki/README.md','system/maintenance/checklists/source-content-audit-standard-v1.md','system/maintenance/checklists/ingest-control.ps1','system/maintenance/checklists/raw-review-control.mjs','system/maintenance/checklists/ingest-review.mjs','system/maintenance/checklists/render-ingest-package.ps1','system/registry/ingest-semantic-review-policy.json','system/maintenance/checklists/raw-standard-v2.md','system/maintenance/checklists/raw-writing-v2.md','system/maintenance/checklists/raw-quality.mjs'];
rulePaths.push('system/maintenance/checklists/ingest-runtime-contract.mjs');
rulePaths.push('system/maintenance/checklists/reviewer-route.mjs');
rulePaths.push('system/maintenance/checklists/review-bundle-input.mjs');
rulePaths.push('system/maintenance/checklists/compile-core-bundle.mjs');
function collectReferences(value,result=new Set()) {
  if(Array.isArray(value)){for(const item of value)collectReferences(item,result);return result;}
  if(value&&typeof value==='object')for(const [key,v] of Object.entries(value)){
    if(typeof v==='string'&&/^(?:Clippings|raw-sources|wiki|domains|groups|system)\/.+\.(?:md|json|png|jpg|jpeg|webp|svg|txt)$/i.test(v)&& !/(?:^|\/)run\.json$/.test(v))result.add(v);
    else if(v&&typeof v==='object')collectReferences(v,result);
  }
  return result;
}
export function snapshot(root,run,stage,semantic={}) {
  const refs=new Set(run.items.filter(x=>typeof x==='string'&&/^(Clippings|raw-sources)\//.test(x)));
  if(run.execution_control?.workflow_revision===2)refs.add('system/maintenance/checklists/ingest-semantic-reuse.mjs');
  if(run.raw_v2_migration){
    refs.add('system/maintenance/checklists/migrate-raw-v2.mjs');
    refs.add(run.raw_v2_migration.intent_path);
    refs.add(path.posix.join(path.posix.dirname(run.package_data.path),'raw-v2-migration.json'));
  }
  if(stage!=='scoring')for(const a of run.artifacts??[])refs.add(a.path);
  for(const ref of collectReferences(semantic))refs.add(ref);
  // Consumption verification is only an input to Stage3 disposition checks;
  // binding it to scoring/Raw/Stage2 made unrelated code fixes invalidate them.
  if(['stage3','gate_audit'].includes(stage))refs.add('system/maintenance/checklists/wiki-consumption.mjs');
  if(run.execution_control?.reviewer_route_version===3) {
    if(run.execution_control?.execution_profile==='consolidated-v1')for(const module of ['ingest-advance.mjs','ingest-execution-state.mjs','ingest-page-prepare.mjs','ingest-stage3-prepare.mjs','ingest-git-commit.mjs','ingest-navigation.mjs','ingest-skipped-sources.mjs','ingest-structure-verify.mjs','ingest-capacity-decision.mjs'])refs.add('system/maintenance/checklists/'+module);
    refs.add('system/maintenance/checklists/ingest-pipeline.mjs');
    refs.add('system/maintenance/checklists/ingest-page-review.mjs');
    if(run.execution_control?.page_review_contract_version>=3)refs.add('system/maintenance/checklists/ingest-wiki-inputs.mjs');
    if(semantic.consumption_review?.path)for(const ref of collectReferences(read(root,semantic.consumption_review.path)))refs.add(ref);
  }
  if(stage!=='scoring')for(const audit of run.content_audits??[]){refs.add(audit.path);for(const ref of collectReferences(read(root,audit.path)))refs.add(ref);}
  // For consolidated runs, execution plumbing is not a semantic dependency.
  // Pin content rules/validators here; pin the final renderer at review time.
  const operational=new Set(['ingest-control.ps1','ingest-review.mjs','render-ingest-package.ps1','ingest-advance.mjs','ingest-execution-state.mjs','ingest-stage3-prepare.mjs','ingest-git-commit.mjs','ingest-navigation.mjs','ingest-skipped-sources.mjs','ingest-structure-verify.mjs','ingest-capacity-decision.mjs','ingest-pipeline.mjs','ingest-page-prepare.mjs','ingest-page-review.mjs','ingest-wiki-inputs.mjs']);
  if(run.execution_control?.execution_profile==='consolidated-v1')for(const ref of [...refs])if(ref.startsWith('system/maintenance/checklists/')&&operational.has(path.posix.basename(ref)))refs.delete(ref);
  for(const rule of rulePaths)if(fs.existsSync(safe(root,rule,{exists:false}))&&!(run.execution_control?.execution_profile==='consolidated-v1'&&operational.has(path.posix.basename(rule))))refs.add(rule);
  const records=[...refs].sort().map(rel=>record(root,rel));
  // Earlier judgments refer to the observed Wiki version; fusion may replace it.
  if(['scoring','stage1','stage2'].includes(stage))for(let i=0;i<records.length;i++){
    const r=records[i];if(!r.path.startsWith('wiki/')||r.path==='wiki/README.md'||!r.exists)continue;
    const snapshotPath=path.posix.join(path.posix.dirname(run.package_data.path),'evidence',r.sha256+'.md');
    const destination=safe(root,snapshotPath,{exists:false});fs.mkdirSync(path.dirname(destination),{recursive:true});
    if(!fs.existsSync(destination))fs.copyFileSync(safe(root,r.path),destination);
    if(sha(fs.readFileSync(destination))!==r.sha256)throw Error('Frozen Wiki evidence drift');
    records[i]={...record(root,snapshotPath),source_path:r.path,source_sha256:r.sha256};
  }
  for(const r of records)if(!r.exists&&!(stage==='stage2'&&r.path.startsWith('wiki/')))throw Error(`Missing stage evidence: ${r.path}`);
  return records;
}
export function verifyRecords(root,records) {
  const errors=[];
  for(const old of records){const current=record(root,old.path);if(current.exists!==old.exists||current.sha256!==old.sha256)errors.push(old.path);}
  if(errors.length)throw Error(`Evidence changed; re-evaluate affected section: ${errors.join(', ')}`);
  return {status:'verified',file_count:records.length};
}
export function verifySection(root,run,stage,{afterWriting=false}={}) {
  const data=read(root,run.package_data.path), section=data.sections[stage];
  if(!section||section.status!=='sealed'||!Array.isArray(section.derived.dependencies))throw Error(`Unsealed or unbound section: ${stage}`);
  const records=section.derived.dependencies.filter(r=>
    !(['scoring','stage1','stage2'].includes(stage)&&r.path==='system/maintenance/checklists/wiki-consumption.mjs')&&
    !(afterWriting&&stage==='stage2'&&!r.exists&&r.path.startsWith('wiki/'))
  );
  verifyRecords(root,records);
  if(!afterWriting)verifyRecords(root,records.filter(r=>r.source_path).map(r=>({path:r.source_path,exists:true,sha256:r.source_sha256})));
  return {status:'verified',file_count:records.length};
}
const cell=x=>String(x??'').replaceAll('|','\\|').replace(/\r?\n/g,'<br>');
const labels={source:'来源',total:'评分',decision:'处理决定',confidence:'把握程度',evidence:'判断依据',artifact:'Wiki页面',knowledge_summary:'本批知识增量',source_boundary:'来源与适用边界',disposition:'实际处置',verification:'验证结果',before:'拆分前',after:'拆分后',reason:'拆分原因',content_destination:'内容去向',source_destination:'来源去向',stage:'阶段',kind:'类型',detail:'具体情况'};
const table=(rows,columns)=>rows.length?['| '+columns.map(c=>labels[c]??c).join(' | ')+' |','| '+columns.map(()=>'---').join(' | ')+' |',...rows.map(r=>'| '+columns.map(c=>cell(r[c])).join(' | ')+' |')].join('\n'):'本项无记录。';
function link(root,out,rel,label=rel){safe(root,rel);return `[${String(label).replace(/[\[\]]/g,'')}](${path.relative(path.dirname(out),safe(root,rel)).split(path.sep).map(encodeURIComponent).join('/')})`;}
function git(root,args){return execFileSync('git',['-C',root,'-c',`safe.directory=${root.replaceAll('\\','/')}`,'-c','core.quotepath=false',...args],{encoding:'utf8',maxBuffer:32*1024*1024}).trimEnd();}
function assertAncestry(root,from,to){if(!/^[a-f0-9]{40}$/i.test(from??'')||!/^[a-f0-9]{40}$/i.test(to??''))throw Error('Checkpoint revisions must be full Git hashes');git(root,['merge-base','--is-ancestor',from,to]);}
function changedWiki(root,base){return [...new Set([...git(root,['diff','--name-only',base,'--','wiki']).split('\n'),...git(root,['ls-files','--others','--exclude-standard','--','wiki']).split('\n')])].filter(x=>x&&x!=='wiki/README.md'&&!x.endsWith('.template.md')).sort();}
export function maintenanceWikiExplanations(root,run,semantic,backtestWiki,wikiPaths=changedWiki(root,run.base_revision)) {
  const semanticPaths=new Set(semantic.rows.map(row=>row.artifact));
  const uncovered=wikiPaths.filter(w=>!semanticPaths.has(w)&&!backtestWiki.has(w));
  const receiptPath=path.posix.join('system/maintenance/ingest-runs',run.batch_id,'maintenance-wiki-explanations.json');
  if(!fs.existsSync(safe(root,receiptPath,{exists:false}))) {
    if(uncovered.length)throw Error(`Actual Wiki change lacks knowledge explanation: ${uncovered[0]}`);
    return {entries:[],references:[]};
  }
  const receipt=read(root,receiptPath);
  if(receipt.successors?.length){
    const successorCheck=verifyPresealMaintenance(root,run,wikiPaths,receiptPath);
    if(successorCheck.status!=='verified'||
       JSON.stringify([...successorCheck.maintenance].sort())!==JSON.stringify([...uncovered].sort()))
      throw Error('Successor maintenance pre-Seal scope differs from final Wiki scope');
  }
  if(!/^[a-f0-9-]{36}$/i.test(run.execution_control?.parent_reviewer?.agent_id??'')||
     receipt.schema_version!==1||receipt.kind!=='independent_wiki_maintenance'||receipt.batch_id!==run.batch_id||
     receipt.base_revision!==run.base_revision||receipt.stage3_revision!==run.commits.stage3||
     receipt.review_mode!=='parent_non_author'||receipt.reviewer_agent_id!==run.execution_control?.parent_reviewer?.agent_id||
     !Array.isArray(receipt.entries))throw Error('Maintenance Wiki receipt identity mismatch');
  const found=receipt.entries.map(e=>e.path).sort();
  if(JSON.stringify(found)!==JSON.stringify(uncovered))throw Error('Maintenance Wiki receipt does not exactly cover unexplained changed pages');
  const references=new Set([receiptPath]);
  for(const item of receipt.successor_scope?.files??[])references.add(item.path);
  for(const successor of receipt.successors??[]){
    for(const ref of Object.values(successor.audit??{}))references.add(ref.path);
    for(const ref of successor.reviews??[])references.add(ref.path);
  }
  for(const entry of receipt.entries){
    const w=entry.path;
    if(!w.startsWith('wiki/')||!w.endsWith('.md')||semanticPaths.has(w)||backtestWiki.has(w)||
       entry.classification!=='maintenance_only_not_new_raw'||!entry.explanation?.trim()||
       !entry.scope?.trim()||!entry.verification?.trim()||!Array.isArray(entry.commits)||!entry.commits.length||
       !Array.isArray(entry.reviews)||!entry.reviews.length||!(/^[a-f0-9]{64}$/i.test(entry.current_sha256??'')))
      throw Error(`Invalid independent maintenance explanation: ${w}`);
    if(record(root,w).sha256!==entry.current_sha256)throw Error(`Maintenance Wiki page drift: ${w}`);
    const staged=execFileSync('git',['-C',root,'-c',`safe.directory=${root.replaceAll('\\','/')}`,'show',`${run.commits.stage3}:${w}`],{maxBuffer:32*1024*1024});
    if(sha(staged)!==entry.current_sha256)throw Error(`Maintenance Wiki differs from Stage3 checkpoint: ${w}`);
    for(const commit of entry.commits){
      if(!/^[a-f0-9]{40}$/i.test(commit)||commit===run.base_revision||commit===run.commits.stage3)
        throw Error(`Invalid maintenance commit: ${w}`);
      try{assertAncestry(root,run.base_revision,commit);assertAncestry(root,commit,run.commits.stage3);}
      catch{throw Error(`Maintenance commit outside checkpoint chain: ${w}`);}
      if(!git(root,['diff-tree','--no-commit-id','--name-only','-r',commit,'--',w]).split('\n').includes(w))
        throw Error(`Maintenance commit did not change page: ${w}`);
    }
    for(const review of entry.reviews){
      if(typeof review.path!=='string'||!(/^(system\/maintenance\/|docs\/audits\/)/.test(review.path))||
         !/^[a-f0-9]{64}$/i.test(review.sha256??'')||record(root,review.path).sha256!==review.sha256)
        throw Error(`Independent maintenance review drift: ${w}`);
      references.add(review.path);
    }
  }
  let resolution=null;
  if(receipt.current_resolution){
    resolution=receipt.current_resolution;
    const aggregate=semantic.consumption_review,maintenance=run.packages?.maintenance;
    if(!aggregate?.path||!maintenance?.path||resolution.aggregate?.path!==aggregate.path||
       resolution.aggregate?.sha256!==aggregate.sha256||resolution.maintenance?.path!==maintenance.path||
       resolution.maintenance?.sha256!==maintenance.sha256||!Array.isArray(resolution.resolved)||!resolution.resolved.length)
      throw Error('Current maintenance resolution evidence mismatch');
    const aggregateResult=read(root,aggregate.path),maintenanceResult=read(root,maintenance.path);
    if(record(root,aggregate.path).sha256!==aggregate.sha256||record(root,maintenance.path).sha256!==maintenance.sha256||
       aggregateResult.status!=='passed'||aggregateResult.reviewer_agent_id!==receipt.reviewer_agent_id||
       maintenanceResult.status!=='passed')throw Error('Current aggregate or maintenance result is not verified');
    references.add(aggregate.path);references.add(maintenance.path);
    for(const item of resolution.resolved){
      if(!item.description?.trim()||!Array.isArray(item.evidence)||!item.evidence.length)throw Error('Current maintenance resolution lacks evidence');
      for(const ref of item.evidence){
        if(typeof ref.path!=='string'||!(/^(system\/maintenance\/|docs\/audits\/)/.test(ref.path))||
           !/^[a-f0-9]{64}$/i.test(ref.sha256??'')||record(root,ref.path).sha256!==ref.sha256)
          throw Error('Current maintenance resolution evidence drift');
        references.add(ref.path);
      }
    }
  }
  return {entries:receipt.entries,references:[...references],resolution};
}
export function verifyCheckpoint(root,runPath,stage,revision){
 root=fs.realpathSync(root);runPath=relative(root,safe(root,runPath));
 const run=read(root,runPath),data=read(root,run.package_data.path),stage1=stage==='stage1',stages=stage1?['scoring','stage1']:['scoring','stage1','stage2','stage3','gate_audit'];
 // Stage 1 captures the source/Raw material only. Its run manifest, package ledger and audit
 // receipts are written after the Raw-only checkpoint and are verified by the control gate.
 const refs=stage1
  ?new Set([...
      run.items.filter(x=>typeof x==='string'&&/^(Clippings|raw-sources)\//.test(x)),
      ...(run.artifacts??[]).filter(a=>a.kind==='input'||a.kind==='raw').map(a=>a.path)
    ])
  :new Set([runPath,run.package_data.path,...run.items.filter(x=>typeof x==='string'&&/^(Clippings|raw-sources)\//.test(x)),...(run.artifacts??[]).map(a=>a.path)]);
 if(!stage1)for(const key of stages){if(run.packages[key])refs.add(run.packages[key].path);for(const r of data.sections[key]?.derived.dependencies??[])if(r.exists)refs.add(r.path);}
 if(stage==='stage3'){for(const w of changedWiki(root,run.base_revision))refs.add(w);if(run.packages.maintenance)refs.add(run.packages.maintenance.path);for(const b of run.backtests??[])refs.add(b.path);}
 for(const rel of refs){safe(root,rel,{exists:false});if(!fs.existsSync(safe(root,rel,{exists:false}))){let present=false;try{git(root,['cat-file','-e',`${revision}:${rel}`]);present=true;}catch{}if(present)throw Error('Checkpoint still contains deleted file: '+rel);continue;}
  let committed;try{committed=git(root,['rev-parse',`${revision}:${rel}`]);}catch{throw Error('Checkpoint missing evidence: '+rel);}
  const current=git(root,['hash-object','--path='+rel,rel]);if(current!==committed)throw Error('Checkpoint differs from current evidence: '+rel);
 }
 return {status:'verified',stage,revision,file_count:refs.size};
}
export function backtestDisplayStatus(root, receipt) {
  const ref=receipt.content_review;
  if(ref) {
    if(!ref.path || record(root,ref.path).sha256!==ref.sha256) throw Error('Backtest content receipt drift');
    const actual=read(root,ref.path);
    if(actual.status!==ref.status || (receipt.status && receipt.status!==actual.status)) throw Error('Conflicting backtest status');
    if(actual.status!=='passed') throw Error('Backtest content review not passed');
    return actual.status;
  }
  if(!receipt.status) throw Error('Backtest status missing; cannot render as not_run');
  return receipt.status;
}
export function backtestWikiExplanations(root, run) {
  const byWiki=new Map();
  for(const bound of run.backtests??[]) {
    const anchor=read(root,bound.path);
    if(record(root,bound.path).sha256!==bound.sha256)throw Error('Backtest receipt drift');
    if(backtestDisplayStatus(root,anchor)!=='passed'||!anchor.content_review?.path)continue;
    const content=read(root,anchor.content_review.path);
    if(content.report_path&&record(root,content.report_path).sha256!==content.report_sha256)throw Error('Backtest report drift');
    for(const impact of content.raw_wiki_impacts??[]) {
      if(impact.wiki_review!=='已补充')continue;
      if(!impact.raw?.startsWith('raw-sources/')||!impact.wiki_disposition?.trim())throw Error('Backtest Wiki repair lacks source or explanation');
      if(impact.current_sha256&&record(root,impact.raw).sha256!==impact.current_sha256)throw Error('Backtest repaired Raw drift: '+impact.raw);
      for(const wiki of String(impact.related_wiki??'').split(/、(?=wiki\/)/)) {
        if(!wiki.startsWith('wiki/')||!wiki.endsWith('.md'))throw Error('Backtest Wiki repair path is invalid: '+wiki);
        if(!byWiki.has(wiki))byWiki.set(wiki,[]);
        byWiki.get(wiki).push({anchor:bound.anchor,raw:impact.raw,explanation:impact.wiki_disposition,receipt:anchor.content_review.path});
      }
    }
  }
  return byWiki;
}
export function render(root,runPath,output) {
  root=fs.realpathSync(root);const run=read(root,runPath);
  if(![7,8].includes(run.schema_version))throw Error('Review v2 requires run schema 7 or 8');
  if(!['stage3_completed','awaiting_final_review'].includes(run.status))throw Error('Final review requires completed content stages');
  assertAncestry(root,run.base_revision,run.commits.stage1);assertAncestry(root,run.commits.stage1,run.commits.stage3);
  const out=safe(root,output,{exists:false}),runDir=path.dirname(safe(root,runPath));
  if(path.dirname(out)!==runDir)throw Error('Final report must be a direct run-local file');
  const data=read(root,run.package_data.path);
  if(data.schema_version!==2||data.renderer_version!=='ingest-package-renderer-v2')throw Error('Unsupported package semantics');
  for(const stage of ['scoring','stage1','stage2','stage3','gate_audit'])verifySection(root,run,stage,{afterWriting:true});
  const refs=new Set([run.package_data.path,'system/maintenance/checklists/ingest-review.mjs']);
  const captureChanged=git(root,['diff','--name-only',run.commits.stage1,run.commits.stage3,'--','Clippings/_source-captures']).trim();
  const captureRunDir=relative(root,runDir);
  const captured=captureChanged?verifiedCaptureEvidence(root,captureRunDir):[];
  if(captured.length){
    for(const rel of captured)refs.add(rel);
    refs.add(path.posix.join(captureRunDir,'capture-admission.json'));
  }
  for(const p of Object.values(run.packages)){if(!p)throw Error('Final report requires all recorded packages');const now=record(root,p.path);if(now.sha256!==p.sha256)throw Error(`Package drift: ${p.path}`);refs.add(p.path);}
  for(const section of Object.values(data.sections))for(const r of section.derived.dependencies??[])if(r.exists||fs.existsSync(safe(root,r.path,{exists:false})))refs.add(r.path);
  const wikiPaths=changedWiki(root,run.base_revision);
  for(const w of wikiPaths)refs.add(w);
  validateStage3(data.sections.stage3.semantic);
  const consumptionCheck=checkConsumption(root,run,data.sections.stage3.semantic);
  const backtestWiki=backtestWikiExplanations(root,run);
  const maintenanceWiki=maintenanceWikiExplanations(root,run,data.sections.stage3.semantic,backtestWiki,wikiPaths);
  for(const ref of maintenanceWiki.references)refs.add(ref);
  for(const b of run.backtests??[]){refs.add(b.path);for(const r of collectReferences(read(root,b.path)))refs.add(r);}
  const mode=run.review_policy==='interactive'?'标准消化':'自动消化';
  const lines=[`# ${mode} · 最终内容审核`,'',`批次：${run.batch_id}。状态：awaiting_final_review。内容执行完成，尚待用户批准本报告及所引用版本。`,'', '## 1. 评分结果','',data.sections.scoring.semantic.summary,'',table(data.sections.scoring.semantic.rows,['source','total','decision','confidence','evidence']),'','## 2. 新增 raw 内容',''];
  for(const row of data.sections.stage1.semantic.rows){if(!row.raw)throw Error('Raw row missing path');lines.push(`### ${row.raw}`,'',row.content_summary??row.writing_skeleton,'',`保真：${row.coverage}；边界：${row.boundary}；处置：${row.disposition}。`,'',link(root,out,row.raw,'查看完整 raw'), '');}
  if(!data.sections.stage1.semantic.rows.length)lines.push('本批无新增 raw。','');
  lines.push('## 3. Wiki 补充与融合','',data.sections.stage3.semantic.summary,'','下表保留 Stage3 封存时各页的复核措辞；其中关于“全批聚合仍待核对”的句子是该阶段的历史时点记录，当前结论见本节后的复核状态。','',table(data.sections.stage3.semantic.rows,['artifact','knowledge_summary','source_boundary','disposition','verification']),'');
  if(run.execution_control?.page_review_contract_version>=2){
    const m=consumptionMetrics(data.sections.stage3.semantic);
    lines.push(`机械计数：${m.raw_count} 篇 Raw → ${m.wiki_page_count} 个 Wiki 页面 / ${m.destination_count} 条落点；${m.mapped_claim_count} 个映射命题；${m.multi_page_raw_count} 篇一对多。计数不代表语义通过。`,'');
  }
  if(consumptionCheck.status==='passed') {
    lines.push('### Raw 知识消费去向','', '下表只证明去向记录通过机械校验，不等于独立语义通过。完整逐命题处置见已封存语义；页面数量不是质量指标。','',table(consumptionCheck.rows,['raw','claims','wiki_pages','deferred','risks']),'');
    if(run.execution_control?.reviewer_route_version===3)lines.push('本批由同一子 writer 写 Raw/Wiki、主会话非作者全文复核；review_mode=parent_non_author，fresh_context=false，不是独立新上下文盲审。','');
    for(const row of data.sections.stage3.semantic.consumption) lines.push(`- ${row.raw}：${row.coverage_reason}`, ...row.decisions.filter(d=>['deferred','not_applicable'].includes(d.disposition)).map(d=>`  - ${d.claim_ids.join(', ')} / ${d.disposition}：${d.reason}；重开：${d.review_when??'不适用'}`));
  }
  const changedBacktestWiki=[...backtestWiki].filter(([wiki])=>wikiPaths.includes(wiki));
  if(changedBacktestWiki.length) {
    lines.push('### 周期回测修复的既有 Wiki','', '下表来自已验证的回测收据，不算作本批新增 Raw 的 Wiki 消费，也不改变本批 writer／主会话复核归属。','');
    for(const [wiki,impacts] of changedBacktestWiki.sort(([a],[b])=>a.localeCompare(b))) {
      lines.push(`- ${link(root,out,wiki)}：${impacts.map(i=>`锚点 ${i.anchor}，${link(root,out,i.raw,'来源 Raw')} 的跨页处置总述为“${i.explanation}”（${link(root,out,i.receipt,'回测收据')}）`).join('；')}。本页具体改动见下方差异。`);
    }
    lines.push('');
  }
  if(maintenanceWiki.entries.length){
    lines.push('### 独立维护的既有 Wiki','', '下列页面由本批期间的独立维护提交更改，逐页绑定实际提交、当前字节和非作者复核证据；这些改动不算作本批新增 Raw 的知识消费，也不继承 Stage3 新知识页审。','');
    for(const entry of maintenanceWiki.entries)lines.push(`- ${link(root,out,entry.path)}：${entry.scope}；验证：${entry.verification}；维护提交：${entry.commits.join('、')}；独立复核：${entry.reviews.map(r=>link(root,out,r.path)).join('、')}。`);
    lines.push('');
  }
  if(maintenanceWiki.entries.length&&read(root,path.posix.join('system/maintenance/ingest-runs',run.batch_id,'maintenance-wiki-explanations.json')).successors?.length){
    const independent=read(root,path.posix.join('system/maintenance/ingest-runs',run.batch_id,'maintenance-wiki-explanations.json'));
    const scope=independent.successor_scope;
    const rawFiles=scope.files.filter(x=>x.path.startsWith('raw-sources/'));
    const latest=scope.latest_health;
    if(!latest||!scope.files.some(x=>x.path===latest.path&&x.sha256===latest.sha256)||
       record(root,latest.path).sha256!==latest.sha256)throw Error('Successor latest health report is not bound to exact scope');
    const latestHealth=read(root,latest.path);
    const successorHealth=independent.successors.map(x=>{
      if(record(root,x.audit.health.path).sha256!==x.audit.health.sha256)throw Error('Successor health audit drift');
      return {receipt:x,health:read(root,x.audit.health.path)};
    });
    lines.push('### 后继独立治理的证据边界','',
      `本批 ${data.sections.stage1.semantic.rows.length} 篇新增 Raw 与后继治理的 ${rawFiles.length} 篇既有 Raw 修订分开计算。后继 ${independent.successors.length} 次治理的版本依据：${independent.successors.map(x=>`${link(root,out,x.audit.bindings.path,'逐页版本绑定')}、${link(root,out,x.audit.validation.path,'范围交付验证')}`).join('；')}。${scope.files.length} 个后继变更文件已逐字节列入内容清单，含既有 Raw、registry、规则、审计材料与 Wiki；范围交付验证不等于全页或全媒体重新认证。`,
      `后继原健康报告：${successorHealth.map(x=>`${x.health.status}、${(x.health.findings??[]).length} 条发现（${link(root,out,x.receipt.audit.health.path,'原报告')}）`).join('；')}。最新健康报告：${latestHealth.status}、${(latestHealth.findings??[]).length} 条发现、${(latestHealth.unchecked??[]).length} 项 unchecked（${link(root,out,latest.path,'查看报告')}）。正文定点复验与未读媒体边界仍依各后继审阅记录；${independent.successors.map(x=>x.semantic_boundary).filter(Boolean).join('；')}。`, '');
  }
  if(maintenanceWiki.resolution){
    const current=maintenanceWiki.resolution;
    lines.push('### 当前复核与已解决事项','',`本批新增知识落点的非作者跨页聚合为 passed（${link(root,out,current.aggregate.path,'聚合审阅')}）；本批 Stage3 机械维护为 passed（${link(root,out,current.maintenance.path,'维护检查')}）。两份结果均按当前 SHA-256 绑定；这不表示已试玩、全库健康或用户终审批准。`,'');
    for(const item of current.resolved)lines.push(`- ${item.description} 证据：${item.evidence.map(r=>link(root,out,r.path)).join('、')}。`);
    lines.push('');
  }
  if(captured.length)lines.push('### 来源捕获字节保全','',
    `本批 ${captured.length} 个捕获文件已逐字节列入内容版本清单；${link(root,out,path.posix.join(captureRunDir,'capture-admission.json'),'逐文件准入清单')}记录来源与 SHA-256。原 capture manifest 另校验 source HTML 和已下载媒体；body/manifest 的准入字节不能单独证明来源语义。`, '');
  for(const w of wikiPaths){const diff=git(root,['diff','--no-ext-diff','--no-color',run.base_revision,'--',w]);const diffRel=relative(root,path.join(runDir,'diffs',sha(w).slice(0,16)+'.diff.txt'));const file=safe(root,diffRel,{exists:false});fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,diff+'\n');refs.add(diffRel);lines.push(`### ${w}`,'',fs.existsSync(safe(root,w,{exists:false}))?link(root,out,w,'查看完整 Wiki'):'该页已删除；请检查拆分去向。','',link(root,out,diffRel,'查看本批完整差异'),'');}
  if(!wikiPaths.length)lines.push('本批没有实际 Wiki 正文差异。','');
  lines.push('## 4. Wiki 拆分结果','');
  const splits=data.sections.stage3.semantic.splits;
  if(!Array.isArray(splits))throw Error('stage3.semantic.splits must explicitly list completed splits or []');
  if(!splits.length)lines.push('本批无已执行拆分。');
  for(const split of splits){for(const key of ['before','after','reason','content_destination','source_destination','verification'])if(!split[key])throw Error(`Split result missing ${key}`);lines.push('',table([split],['before','after','reason','content_destination','source_destination','verification']));}
  lines.push('','## 5. 回测结果','');
  const required=run.counts.required_backtest_anchors??[];
  lines.push(`触发依据：raw 数量 ${run.counts.before} → ${run.counts.after}；当前合同要求跨越的锚点：${required.join(', ')||'无'}。`,'');
  if(!required.length)lines.push('状态：not_triggered。没有触发本次锚点回测；不代表全库质量通过。');
  for(const anchor of required){const b=run.backtests.find(b=>b.anchor===anchor);if(!b)throw Error(`Required backtest not_run: ${anchor}`);const receipt=read(root,b.path);if(record(root,b.path).sha256!==b.sha256)throw Error('Backtest receipt drift');lines.push(`- 锚点 ${anchor}：${backtestDisplayStatus(root,receipt)}；${link(root,out,b.path,'查看范围、结果与修复证据')}。`);}
  lines.push('','## 6. 例外、未消费与待决定','');
  const exceptions=[];for(const [stage,section] of Object.entries(data.sections))for(const field of ['semantic_exceptions','unresolved_risks','structure_change_requests','micro_failures','unconsumed'])for(const item of section.semantic[field]??[])exceptions.push({stage,kind:field,detail:typeof item==='string'?item:JSON.stringify(item)});
  lines.push('下表原样保留各阶段封存时登记的例外、风险和失败；“待维护”“待 Seal”“待聚合”等历史措辞不能视为当前待办，已解决项以上方当前复核及绑定收据为准。真实未试玩、效果未经验证和容量 defer 边界仍保留。','');
  lines.push(table(exceptions,['stage','kind','detail']),'','## 7. 已审结果、恢复与版本','',`Stage1：${run.commits.stage1}；Stage3：${run.commits.stage3}。`,'');
  for(const [stage,approval] of Object.entries(run.approvals??{}))if(approval)lines.push(`- ${stage} 已在标准阶段审核：${approval.sha256}；未变内容可复用，该记录不代替本批最终闭合。`);
  for(const [stage,p] of Object.entries(run.packages))lines.push(`- ${stage}：${link(root,out,p.path)}。`);
  const manifestPath=relative(root,path.join(runDir,'final-review-content.json'));
  if(run.execution_control?.review_migration?.path){
    const migration=run.execution_control.review_migration;
    if(record(root,migration.path).sha256!==migration.sha256)throw Error('Review evidence migration drift');
    refs.add(migration.path);
    lines.push('',`本批审核规则的受控证据重绑：${link(root,out,migration.path,'迁移记录')}；仅重绑已封存章节对最终审核渲染器的依赖，原语义判断和回测收据未改写。`);
  }
  lines.push('',`批准绑定本报告字节及 ${link(root,out,run.package_data.path,'已封存语义')} 和内容版本清单。任一相关正文或规则变化均需复验。`,'','通过 verify-final-review 后，用户批准当前 SHA-256，再执行 finish。');
  const text=lines.join('\n')+'\n';fs.writeFileSync(out,text);
  const manifest={schema_version:2,batch_id:run.batch_id,review_path:relative(root,out),review_sha256:sha(text),base_revision:run.base_revision,stage1_revision:run.commits.stage1,stage3_revision:run.commits.stage3,wiki_paths:wikiPaths,files:[...refs].sort().map(rel=>record(root,rel))};
  fs.writeFileSync(safe(root,manifestPath,{exists:false}),JSON.stringify(manifest,null,2)+'\n');
  return {path:relative(root,out),sha256:sha(text),content_manifest:manifestPath,content_manifest_sha256:record(root,manifestPath).sha256};
}
export function verify(root,runPath){const run=read(root,runPath),f=run.final_review;const m=read(root,f.content_manifest);if(record(root,f.content_manifest).sha256!==f.content_manifest_sha256)throw Error('Content manifest drift');if(m.batch_id!==run.batch_id||m.review_path!==f.path||m.review_sha256!==f.sha256)throw Error('Review identity mismatch');if(m.base_revision!==run.base_revision||m.stage1_revision!==run.commits.stage1||m.stage3_revision!==run.commits.stage3)throw Error('Checkpoint identity changed');if(record(root,f.path).sha256!==f.sha256)throw Error('Final report drift');if(JSON.stringify(changedWiki(root,run.base_revision))!==JSON.stringify(m.wiki_paths))throw Error('Wiki change scope drift');verifyRecords(root,m.files);for(const s of ['scoring','stage1','stage2','stage3','gate_audit'])verifySection(root,run,s,{afterWriting:true});return {status:'verified',sha256:f.sha256,content_manifest_sha256:f.content_manifest_sha256,file_count:m.files.length};}
if(process.argv[1]&&path.resolve(process.argv[1])===own){try{const [action,...argv]=process.argv.slice(2),args={};for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||argv[i+1]===undefined)throw Error('Expected --key value');args[argv[i].slice(2)]=argv[i+1];}const root=path.resolve(args.root??path.join(path.dirname(own),'../../..'));let result;if(action==='render')result=render(root,args.run,args.output);else if(action==='verify')result=verify(root,args.run);else if(action==='snapshot')result=snapshot(root,read(root,args.run),args.stage,read(root,args.semantic));else if(action==='verify-checkpoint')result=verifyCheckpoint(root,args.run,args.stage,args.revision);else if(action==='verify-section')result=verifySection(root,read(root,args.run),args.stage,{afterWriting:args['after-writing']==='true'});else throw Error('Unknown review action');console.log(JSON.stringify(result));}catch(e){console.error('INGEST_REVIEW_FAILED: '+e.message);process.exitCode=1;}}
