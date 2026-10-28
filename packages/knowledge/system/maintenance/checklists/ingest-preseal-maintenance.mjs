// Exact-byte, independently reviewed Wiki maintenance scope for the Stage 3 pre-Seal gate.
// The final-review receipt remains owned by ingest-review.mjs after a Stage 3 checkpoint exists.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hex40 = value => /^[a-f0-9]{40}$/i.test(value ?? '');
const hex64 = value => /^[a-f0-9]{64}$/i.test(value ?? '');
const sorted = values => [...values].sort();
const same = (a,b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const readJson = file => JSON.parse(fs.readFileSync(file,'utf8'));
const git = (root,args,encoding='utf8') => execFileSync('git',
  ['-C',root,'-c','safe.directory=' + root.replaceAll('\\','/'),'-c','core.quotepath=false',...args],
  {encoding,maxBuffer:64*1024*1024});
function local(root,rel) {
  if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('\\')||
     rel.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe maintenance evidence path');
  const full=path.resolve(root,rel);
  if(!full.startsWith(root+path.sep))throw Error('Maintenance evidence outside Knowledge');
  return full;
}
function atCommit(root,revision,rel) {
  try{return git(root,['show',revision+':'+rel],null);}
  catch{throw Error('Maintenance evidence absent from governance commit: '+rel);}
}
function exactAudit(root,revision,ref) {
  if(!ref||typeof ref.path!=='string'||!ref.path.startsWith('docs/audits/')||!hex64(ref.sha256))
    throw Error('Incomplete governance audit reference');
  const file=local(root,ref.path);
  if(!fs.existsSync(file)||hash(fs.readFileSync(file))!==ref.sha256||
     hash(atCommit(root,revision,ref.path))!==ref.sha256)
    throw Error('Governance audit bytes drift: '+ref.path);
  return readJson(file);
}
function ancestor(root,a,b) {
  try{git(root,['merge-base','--is-ancestor',a,b]);}
  catch{throw Error('Governance commit outside current checkpoint ancestry');}
}

export function verifyPresealMaintenance(root,run,changedWiki,receiptRel) {
  root=fs.realpathSync(root);
  const rel=receiptRel ?? path.posix.join('system/maintenance/ingest-runs',run.batch_id,'maintenance-wiki-explanations.json');
  const receiptFile=local(root,rel);
  if(!fs.existsSync(receiptFile))return {status:'absent',maintenance:[],newKnowledge:changedWiki,classifiedFindings:[]};
  const receipt=readJson(receiptFile);
  const reviewer=run.execution_control?.parent_reviewer?.agent_id;
  if(receipt.schema_version!==1||receipt.kind!=='independent_wiki_maintenance'||
     receipt.batch_id!==run.batch_id||receipt.base_revision!==run.base_revision||
     (receipt.stage3_revision!==null&&receipt.stage3_revision!==run.commits?.stage3)||
     receipt.review_mode!=='parent_non_author'||
     !/^[a-f0-9-]{36}$/i.test(reviewer??'')||receipt.reviewer_agent_id!==reviewer||
     !hex40(receipt.governance_commit)||!Array.isArray(receipt.entries))
    throw Error('Pre-Seal maintenance receipt identity mismatch');
  const head=git(root,['rev-parse','HEAD']).trim();
  if(receipt.stage3_revision!==null) {
    if(!hex40(receipt.stage3_revision))throw Error('Pre-Seal receipt Stage3 checkpoint mismatch');
    ancestor(root,receipt.stage3_revision,head);
  }
  ancestor(root,run.base_revision,receipt.governance_commit);
  ancestor(root,receipt.governance_commit,head);
  const actual=git(root,['diff','--name-only',run.base_revision,'--','wiki'], 'utf8')
    .split(/\r?\n/).filter(x=>x.endsWith('.md')&&x!=='wiki/README.md'&&!x.endsWith('.template.md'));
  if(!same(actual,changedWiki)||new Set(changedWiki).size!==changedWiki.length)
    throw Error('Pre-Seal Wiki paths differ from actual Git changes');
  const runDir=path.posix.join('system/maintenance/ingest-runs',run.batch_id);
  const prepared=readJson(local(root,path.posix.join(runDir,'stage3-prepared.json')));
  const semantic=readJson(local(root,path.posix.join(runDir,'semantic-stage3-final.json')));
  const pages=x=>Array.isArray(x.rows)?x.rows.map(row=>row.artifact):[];
  const newKnowledge=pages(prepared);
  if(!newKnowledge.length||!same(newKnowledge,pages(semantic))||
     new Set(newKnowledge).size!==newKnowledge.length||
     newKnowledge.some(p=>!changedWiki.includes(p)))
    throw Error('Pre-Seal semantic batch pages do not match prepared review');
  const expected=changedWiki.filter(p=>!newKnowledge.includes(p));
  const entries=receipt.entries;
  if(!same(entries.map(e=>e.path),expected)||new Set(entries.map(e=>e.path)).size!==entries.length)
    throw Error('Pre-Seal maintenance receipt does not exactly cover independent pages');
  const binding=exactAudit(root,receipt.governance_commit,receipt.audit?.bindings);
  const validation=exactAudit(root,receipt.governance_commit,receipt.audit?.validation);
  if(validation.content_status!=='completed'||validation.health?.errors!==0||
     validation.health?.tool_failed!==0||
     validation.health?.report!==receipt.audit?.health?.path)
    throw Error('Governance review or health report is not verified');
  const priorHealth=exactAudit(root,receipt.governance_commit,receipt.audit.health);
  if(priorHealth.status!==validation.health.status||
     priorHealth.summary?.tool_failed!==validation.health.tool_failed||
     (priorHealth.findings??[]).filter(f=>f.severity==='error').length!==validation.health.errors||
     (priorHealth.findings??[]).filter(f=>f.severity==='warning').length!==validation.health.warnings)
    throw Error('Governance health receipt does not match final validation');
  const manual=exactAudit(root,receipt.governance_commit,
    {path:binding.manual_input,sha256:binding.manual_sha256});
  const successors=receipt.successors??[];
  if(!Array.isArray(successors))throw Error('Invalid successor maintenance receipts');
  const successorPages=new Map();
  let priorCommit=receipt.governance_commit;
  for(const successor of successors){
    if(!hex40(successor.commit)||successor.commit===priorCommit||!successor.audit||
       !Array.isArray(successor.reviews)||!successor.reviews.length)
      throw Error('Incomplete successor maintenance receipt');
    ancestor(root,priorCommit,successor.commit);ancestor(root,successor.commit,head);
    const successorBinding=exactAudit(root,successor.commit,successor.audit.bindings);
    const successorValidation=exactAudit(root,successor.commit,successor.audit.validation);
    const successorHealth=exactAudit(root,successor.commit,successor.audit.health);
    if(successorValidation.status!=='passed'||successorValidation.baseline!==priorCommit||
       successorValidation.main_reviewed_wiki_changes!==Object.keys(successorBinding.pages??{}).length||
       successorValidation.raw_media_complete!==false||
       successorHealth.status!=='needs_review'||successorHealth.summary?.tool_failed!==0)
      throw Error('Successor scope or health evidence mismatch');
    const successorEvidence=[...Object.values(successor.audit),...successor.reviews];
    for(const review of successorEvidence)exactAudit(root,successor.commit,review);
    const changed=git(root,['diff-tree','--no-commit-id','--name-only','-r',successor.commit,'--','wiki'])
      .split(/\r?\n/).filter(Boolean);
    if(!same(changed,Object.keys(successorBinding.pages??{})))
      throw Error('Successor Wiki paths differ from committed governance scope');
    for(const [p,boundPage] of Object.entries(successorBinding.pages)){
      if(newKnowledge.includes(p)||!changedWiki.includes(p)||!hex64(boundPage.baseline_sha256)||
         !hex64(boundPage.current_sha256)||!boundPage.reason?.trim()||
         !boundPage.review_scope?.includes('changed arguments')||
         !boundPage.historical_full_read?.full_read_receipt)
        throw Error('Invalid successor maintenance page: '+p);
      const historical=boundPage.historical_full_read;
      if(historical.path!==p||!hex64(historical.original_full_read_sha256)||
         !hex64(historical.current_sha256)||
         !historical.full_read_receipt.startsWith('docs/audits/')||
         !Array.isArray(boundPage.h2_before)||!Array.isArray(boundPage.h2_current))
        throw Error('Incomplete historical full-read binding: '+p);
      const historicalFile=local(root,historical.full_read_receipt);
      const historicalAudit=exactAudit(root,priorCommit,{path:historical.full_read_receipt,
        sha256:hash(fs.readFileSync(historicalFile))});
      if(historicalAudit.full_page_reads?.[p]!==historical.original_full_read_sha256)
        throw Error('Historical full-read receipt does not cover page: '+p);
      const preceding=hash(atCommit(root,priorCommit,p));
      if(boundPage.baseline_sha256!==preceding||
         hash(atCommit(root,successor.commit,p))!==boundPage.current_sha256)
        throw Error('Successor page version chain drift: '+p);
      const headings=bytes=>bytes.toString('utf8').split(/\r?\n/).filter(line=>/^## [^#]/.test(line));
      if(JSON.stringify(headings(atCommit(root,priorCommit,p)))!==JSON.stringify(boundPage.h2_before)||
         JSON.stringify(headings(atCommit(root,successor.commit,p)))!==JSON.stringify(boundPage.h2_current))
        throw Error('Successor heading evidence differs from committed pages: '+p);
      const earlier=successorPages.get(p);
      successorPages.set(p,{current_sha256:boundPage.current_sha256,
        commits:[...(earlier?.commits??[]),successor.commit],
        reviews:[...(earlier?.reviews??[]),...successorEvidence.map(ref=>({...ref,commit:successor.commit}))],
        historical_full_read:historical.full_read_receipt,
        headings_unchanged:JSON.stringify(boundPage.h2_before)===JSON.stringify(boundPage.h2_current)});
    }
    priorCommit=successor.commit;
  }
  if(successors.length){
    const scope=receipt.successor_scope;
    if(!scope||scope.from!==receipt.governance_commit||!hex40(scope.through)||
       !hex40(scope.integration_commit)||
       !scope.description?.trim()||!Array.isArray(scope.files))
      throw Error('Successor independent-maintenance scope missing');
    ancestor(root,priorCommit,scope.through);ancestor(root,scope.through,scope.integration_commit);
    ancestor(root,scope.integration_commit,head);
    const mergeParents=git(root,['show','-s','--format=%P',scope.integration_commit]).trim().split(/\s+/);
    if(mergeParents.length!==2||mergeParents[1]!==scope.through)
      throw Error('Successor scope is not bound to the integrated governance merge');
    const actualScope=git(root,['diff','--name-only',scope.from+'..'+scope.through])
      .split(/\r?\n/).filter(Boolean);
    if(!same(actualScope,scope.files.map(x=>x.path))||
       new Set(scope.files.map(x=>x.path)).size!==scope.files.length)
      throw Error('Successor scope does not match exact committed delta');
    const integrationDeltas=scope.files.filter(x=>x.commit_sha256!==x.integrated_sha256);
    if(!Array.isArray(scope.integration_overlap)||
       !same(scope.integration_overlap.map(x=>x.path),integrationDeltas.map(x=>x.path)))
      throw Error('Successor integration changed unreviewed source bytes');
    for(const overlap of scope.integration_overlap){
      const item=integrationDeltas.find(x=>x.path===overlap.path);
      if(!item||overlap.source_sha256!==item.commit_sha256||
         overlap.integrated_sha256!==item.integrated_sha256||!overlap.reason?.trim()||
         !overlap.path.startsWith('system/registry/'))
        throw Error('Successor integration overlap is not explained');
    }
    for(const item of scope.files){
      const current=fs.readFileSync(local(root,item.path));
      const integrated=atCommit(root,scope.integration_commit,item.path);
      if(!hex64(item.sha256)||!hex64(item.commit_sha256)||!hex64(item.integrated_sha256)||
         hash(atCommit(root,scope.through,item.path))!==item.commit_sha256||
         hash(integrated)!==item.integrated_sha256||hash(current)!==item.sha256||
         (item.worktree_eol==='crlf_checkout'
           ? (!item.path.endsWith('.txt')||!current.includes(Buffer.from('\r\n'))||
              !Buffer.from(current.toString('utf8').replaceAll('\r\n','\n')).equals(integrated))
           : item.sha256!==item.integrated_sha256))
        throw Error('Successor scoped file drift: '+item.path);
      if(receipt.stage3_revision!==null&&hash(atCommit(root,receipt.stage3_revision,item.path))!==item.integrated_sha256)
        throw Error('Successor scoped file differs from Stage3 checkpoint: '+item.path);
    }
  }
  const originalChanged=git(root,['diff-tree','--no-commit-id','--name-only','-r',receipt.governance_commit,'--','wiki'])
    .split(/\r?\n/).filter(Boolean);
  const expectedPaths=new Set([...originalChanged,...successorPages.keys()]
    .filter(p=>!newKnowledge.includes(p)));
  if(!same([...expectedPaths],expected))throw Error('Successor maintenance does not exactly cover Wiki scope');
  const maintenance=[];
  for(const entry of entries) {
    const p=entry.path, bound=originalChanged.includes(p)?binding.pages?.[p]:null;
    const later=successorPages.get(p);
    const currentExpected=later?.current_sha256??bound?.current_sha256;
    const followup=manual.post_batch_followups?.[p];
    const followupBound=typeof bound?.post_batch_followup==='string'&&
      bound.post_batch_followup.trim()&&followup===bound.post_batch_followup;
    if(!p.startsWith('wiki/')||!p.endsWith('.md')||newKnowledge.includes(p)||
       entry.classification!=='maintenance_only_not_new_raw'||!entry.explanation?.trim()||
       !entry.scope?.trim()||!entry.verification?.trim()||!hex64(entry.current_sha256)||
       !currentExpected||currentExpected!==entry.current_sha256||
       (bound&&bound.latest_block_receipt
         ? bound.latest_block_receipt.current_sha256!==bound.current_sha256&&!followupBound
         : bound&&!followupBound)||
       (bound?.post_batch_followup&&!followupBound)||
       !Array.isArray(entry.commits)||!same(entry.commits,
         [...(bound?[receipt.governance_commit]:[]),...(later?.commits??[])])||
       !Array.isArray(entry.reviews)||entry.reviews.length<2)
      throw Error('Incomplete or forged pre-Seal maintenance entry: '+p);
    const file=local(root,p);
    if(!fs.existsSync(file)||hash(fs.readFileSync(file))!==entry.current_sha256||
       (bound&&hash(atCommit(root,receipt.governance_commit,p))!==bound.current_sha256))
      throw Error('Pre-Seal maintenance page drift: '+p);
    if(receipt.stage3_revision!==null&&hash(atCommit(root,receipt.stage3_revision,p))!==entry.current_sha256)
      throw Error('Maintenance page differs from Stage3 checkpoint: '+p);
    if(bound){
      const governanceChanges=git(root,['diff-tree','--no-commit-id','--name-only','-r',receipt.governance_commit,'--',p]).split(/\r?\n/);
      if(!governanceChanges.includes(p))throw Error('Governance commit did not change maintenance page: '+p);
    }
    const required=bound?[bound.prior_full_read?.full_read_receipt,
      bound.latest_block_receipt?.receipt ?? receipt.audit.bindings.path]:[];
    if(later)required.push(later.historical_full_read,...later.reviews.map(x=>x.path));
    if(required.some(x=>!x||!entry.reviews.some(r=>r.path===x)))
      throw Error('Pre-Seal maintenance review coverage missing: '+p);
    for(const review of entry.reviews){
      const successorRef=later?.reviews.find(x=>x.path===review.path);
      exactAudit(root,successorRef?.commit??receipt.governance_commit,review);
    }
    maintenance.push(p);
  }
  const reviewedNumbering=(priorHealth.checks??[])
    .filter(c=>c.id==='page_health').flatMap(c=>c.findings??[])
    .filter(f=>f.code==='wiki_h2_numbering_gap'&&maintenance.includes(f.path)&&
      (successorPages.get(f.path)?.headings_unchanged??true))
    .map(f=>({path:f.path,code:f.code,detail:f.detail}));
  return {status:'verified',maintenance,newKnowledge,reviewedNumbering,
    classifiedFindings:['wiki_h2_numbering_gap','reviewed_whole_page_link_without_anchor'],
    audit:receipt.audit,governance_commit:receipt.governance_commit};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const [root,runFile,...changedWiki]=process.argv.slice(2);
    const run=readJson(runFile);
    process.stdout.write(JSON.stringify(verifyPresealMaintenance(root,run,changedWiki))+'\n');
  } catch(error){process.stderr.write('PRESEAL_MAINTENANCE_FAILED: '+error.message+'\n');process.exitCode=2;}
}
