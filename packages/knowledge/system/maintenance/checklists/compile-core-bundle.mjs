import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe,sha} from './raw-quality.mjs';
import {prepareCoreReview,compileCoreReport,bundleDecisionErrors,sectionInventory} from './core-review-control.mjs';
import {reviewerConfiguration,findReviewerLog} from './ingest-runtime-contract.mjs';
import {parentReview, assertReviewOwnership} from './reviewer-route.mjs';
import {prepareBundle,normalizeBundle} from './review-bundle-input.mjs';

// The non-author reviewer authors BOTH the complete ledger and decisions in one read.
// The controller only binds these to the existing request/report/receipt pipeline.
export function compileBundle(root,options) {
  const read=p=>JSON.parse(fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,''));
  const run=read(options.run), directory=path.dirname(safe(root,options.run));
  if(!['running_scoring','scoring_approved'].includes(run.status))throw Error('Bundle requires an open Stage1');
  const bundlePath=safe(root,options.bundle);
  if(!bundlePath.startsWith(directory+path.sep))throw Error('Bundle must be run-local');
  const bundle=normalizeBundle(root,read(options.bundle)), session=assertReviewOwnership(run,options.agent,[bundle.ledger.raw.path]);
  if(session.status!=='active' || bundle.reviewer_agent_id!==options.agent)throw Error('Active reviewer identity required');
  reviewerConfiguration({run,agent:options.agent,log:options.log||findReviewerLog(options.agent)});
  for(const input of [bundle.ledger?.source,bundle.ledger?.raw]) {
    if(!input || sha(fs.readFileSync(safe(root,input.path)))!==input.sha256)throw Error('Bundle input hash drift');
  }
  if(!bundle.decisions || bundle.decisions.fresh_context!==!parentReview(run))throw Error('Reviewer decisions must declare the actual context boundary');
  const sourceText=fs.readFileSync(safe(root,bundle.ledger.source.path),'utf8').replace(/^\uFEFF/,'');
  const rawText=fs.readFileSync(safe(root,bundle.ledger.raw.path),'utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n');
  const errors=bundleDecisionErrors({review_mode:parentReview(run)?'parent_non_author':'independent_child',claims:bundle.ledger.claims,source_sections:sectionInventory(sourceText),raw_sections:sectionInventory(rawText)},bundle.decisions,rawText);
  if(errors.length)return {status:'failed',error_count:errors.length,errors,next_action:'Correct only the reported bundle fields. No review attempt or report has been allocated.'};
  const base=path.join(directory,'review-bundles',sha(fs.readFileSync(bundlePath)).slice(0,16));
  const rel=p=>path.relative(root,p).split(path.sep).join('/');
  const write=(name,value)=>{const p=path.join(base,name),s=JSON.stringify(value,null,2)+'\n';safe(root,rel(p),false);if(fs.existsSync(p)){if(fs.readFileSync(p,'utf8')!==s)throw Error('Evidence drift');}else{fs.mkdirSync(base,{recursive:true});fs.writeFileSync(p,s,{flag:'wx'});}return rel(p);};
  const ledger=write('ledger.json',bundle.ledger), decisions=write('decisions.json',bundle.decisions);
  const raw=bundle.ledger.raw.path;
  const existing=run.execution_control.core_review_attempts?.find(x=>x.raw_path===raw&&x.status==='prepared'&&x.ledger_path===ledger);
  if(!existing)prepareCoreReview(root,{...options,raw,ledger});
  return {...compileCoreReport(root,{...options,raw,decisions}),raw,ledger,decisions,bundle:options.bundle,next_action:'complete-core-review and record-content-audit; structural pass is not semantic approval'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];const r=a.action==='prepare'?prepareBundle(a.root,a):compileBundle(a.root,a);console.log(JSON.stringify(r,null,2));if(!['passed','prepared'].includes(r.status))process.exitCode=2;}
  catch(e){console.error(e.message);process.exitCode=2;}
}
