import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe,sha} from './raw-quality.mjs';
import {parentReview,assertReviewOwnership} from './reviewer-route.mjs';
import {reviewerConfiguration,boundReviewerLog} from './ingest-runtime-contract.mjs';
import {decisionFingerprint,inputFingerprint,checkWikiInput} from './ingest-wiki-inputs.mjs';
import {applySelection} from './review-evidence-selection.mjs';

export function compilePageSelections(root,report){
  const result=structuredClone(report);
  for(const comparison of result.comparisons??[]){
    for(const [side,file] of [['source',comparison.raw],['wiki',result.page]]){
      applySelection(root,comparison,side,file,result.input_hashes?.find(x=>x.path===file)?.sha256);
    }
  }
  return result;
}

const read=(root,p)=>JSON.parse(fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,''));
// Evidence makes the judgment inspectable; it cannot prove that a model read or understood it.
export function verifyComparisons(root,scope,report){
  const expected=scope.flatMap(row=>row.decisions.map(d=>({raw:row.raw,claim_ids:d.claim_ids})));
  const key=x=>JSON.stringify([x.raw,[...x.claim_ids].sort()]);
  const comparisons=report.comparisons;
  if(!Array.isArray(comparisons)||comparisons.length!==expected.length||new Set(comparisons.map(key)).size!==expected.length||comparisons.some(x=>!expected.some(y=>key(x)===key(y))))throw Error('Page comparisons must cover each Raw decision exactly once');
  const body=p=>fs.readFileSync(safe(root,p),'utf8').replace(/\r\n/g,'\n').replace(/^\uFEFF/,'').replace(/^---\n[\s\S]*?\n---\n/,'');
  const wiki=body(report.page);
  for(const c of comparisons){
    for(const field of ['source_quote','wiki_quote','assessment'])if(typeof c[field]!=='string'||!c[field].trim())throw Error('Missing page comparison '+field);
    if(!body(c.raw).includes(c.source_quote.replace(/\r\n/g,'\n'))||!wiki.includes(c.wiki_quote.replace(/\r\n/g,'\n')))throw Error('Page comparison quote not found in bound body');
  }
  if(typeof report.context_check!=='string'||!report.context_check.trim())throw Error('Page needs existing-context and attribution check');
}
export function pageScope(consumption,page){
  return consumption.flatMap(row=>{
    const decisions=row.decisions.filter(d=>(d.destinations??[]).some(x=>x.path===page)).map(d=>({...d,destinations:d.destinations.filter(x=>x.path===page)}));
    return decisions.length?[{raw:row.raw,ledger:row.ledger,decisions}]:[];
  });
}
export function verifyPageReview(root,run,consumption,ref,reviewer){
  const bytes=fs.readFileSync(safe(root,ref.path));
  if(sha(bytes)!==ref.sha256)throw Error('Page review evidence changed: '+ref.path);
  const report=JSON.parse(bytes.toString('utf8'));
  if(![1,2,3].includes(report.schema_version)||report.review_mode!=='parent_non_author')throw Error('Invalid parent page review contract');
  const version=run.execution_control?.page_review_contract_version;
  if(version>=2&&report.schema_version!==version)throw Error('New runs require evidence-bearing page review v'+version);
  if(report.reviewer_agent_id!==reviewer||report.status!=='passed'||!Array.isArray(report.findings)||report.findings.length||!report.coverage_summary?.trim())throw Error('Page review lacks actual reviewer PASS');
  const scope=pageScope(consumption,report.page);
  if(!scope.length||(report.schema_version===3?decisionFingerprint(scope):sha(JSON.stringify(scope)))!==report.scope_sha256)throw Error('Page decisions changed: '+report.page);
  if(report.schema_version===3)checkWikiInput(root,report.page,scope);
  const paths=[...new Set([report.page,...scope.map(x=>x.raw)])].sort();
  if(JSON.stringify(report.input_hashes.map(x=>x.path).sort())!==JSON.stringify(paths))throw Error('Page review inputs incomplete');
  assertReviewOwnership(run,reviewer,paths.filter(p=>p.startsWith('raw-sources/')||run.execution_control.artifact_authors?.[p]));
  for(const input of report.input_hashes){
    const matches=report.schema_version===3?inputFingerprint(root,input.path)===input.canonical_sha256:sha(fs.readFileSync(safe(root,input.path)))===input.sha256;
    if(!matches)throw Error('Re-review affected page/input: '+input.path);
  }
  if(report.schema_version>=2)verifyComparisons(root,scope,report);
  return report;
}
export function preparePageReview(root,run,semantic,page,{verifyRuntime=true}={}){
  if(!parentReview(run)||run.status!=='stage2_planned')throw Error('Page review requires parent route and Stage2 plan');
  const reviewer=run.execution_control.parent_reviewer?.agent_id;
  if(verifyRuntime)reviewerConfiguration({run,agent:reviewer,log:boundReviewerLog(run,reviewer)});
  const scope=pageScope(semantic.consumption,page);if(!scope.length)throw Error('Page has no consumption decisions');
  const version=run.execution_control?.page_review_contract_version>=3?3:2;
  if(version===3)checkWikiInput(root,page,scope);
  if(semantic.rows.some(x=>x.artifact===page)) {
    const author=run.execution_control.artifact_authors?.[page];
    if(!run.execution_control.deliveries?.some(x=>x.dispatch_id===author?.dispatch_id&&x.agent_id===author?.agent_id&&x.outputs.some(y=>y.path===page)))throw Error('Page has not been delivered');
  }
  const paths=[...new Set([page,...scope.map(x=>x.raw)])].sort();
  assertReviewOwnership(run,reviewer,paths.filter(p=>p.startsWith('raw-sources/')||semantic.rows.some(x=>x.artifact===p)));
  return {schema_version:version,review_mode:'parent_non_author',reviewer_agent_id:reviewer,page,scope_sha256:version===3?decisionFingerprint(scope):sha(JSON.stringify(scope)),input_hashes:paths.map(p=>({path:p,sha256:sha(fs.readFileSync(safe(root,p))),...(version===3?{canonical_sha256:inputFingerprint(root,p)}:{})})),status:'pending',findings:[],coverage_summary:'',comparisons:scope.flatMap(row=>row.decisions.map(d=>({raw:row.raw,claim_ids:d.claim_ids,source_quote:'',wiki_quote:'',assessment:''}))),context_check:'',requirements:scope,instruction:'Read complete relevant Raw, all changed Wiki prose and affected existing context. Check every must_preserve dimension, numerical assumptions, causal direction, attribution and omissions beyond the ledger. Fill status/findings/coverage_summary plus source_selection/wiki_selection {start_line,end_line} on one-based inclusive full-file lines (compiler extracts quotes from bound versions), or legacy exact quotes, and assessment for each comparison, and context_check. Quotes are inspectable evidence, not automated semantic proof. Reuse previously read unchanged context; expand to full page if conflict or placement is uncertain. Review this delivered page before accumulating a batch of PASS declarations. Changed inputs need a new report; unrelated pages do not.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [action,...argv]=process.argv.slice(2),a={};for(let i=0;i<argv.length;i+=2)a[argv[i].replace(/^--/,'')]=argv[i+1];
    const root=fs.realpathSync(a.root),run=read(root,a.run),semantic=read(root,a.semantic);
    if(action==='prepare'){
      const output=safe(root,a.output,false);if(!output.startsWith(path.dirname(safe(root,a.run))+path.sep))throw Error('Page report must be run-local');
      const report=preparePageReview(root,run,semantic,a.page);fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:'pending',path:a.output,page:a.page}));
    }else if(action==='verify'){
      const report=verifyPageReview(root,run,semantic.consumption,{path:a.report,sha256:sha(fs.readFileSync(safe(root,a.report)))},run.execution_control.parent_reviewer.agent_id);console.log(JSON.stringify({status:'passed',page:report.page,report:a.report}));
    }else throw Error('Actions: prepare, verify');
  }catch(e){console.error(e.message);process.exitCode=1;}
}
