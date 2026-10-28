import fs from 'node:fs';
import path from 'node:path';
import {safe,sha} from './raw-quality.mjs';
import {sectionInventory} from './core-review-control.mjs';
import {assertReviewOwnership, assertDelivered, parentReview} from './reviewer-route.mjs';
import {applySelection} from './review-evidence-selection.mjs';
import {streamlined,rawPresentation} from './ingest-semantic-reuse.mjs';

export function prepareBundle(root,{run:runPath,source,raw,agent,output}) {
  const run=JSON.parse(fs.readFileSync(safe(root,runPath),'utf8').replace(/^\uFEFF/,''));
  if(!['running_scoring','scoring_approved'].includes(run.status))throw Error('Bundle preparation requires open Stage1');
  const session=assertReviewOwnership(run,agent,[raw]);
  assertDelivered(root,run,[raw]);
  if(session.status!=='active')throw Error('Active reviewer required');
  if(!run.items?.includes(source)||!run.artifacts?.some(x=>x.path===raw&&x.kind==='raw'&&x.disposition==='ingested'))throw Error('Bundle input outside registered scope');
  const target=safe(root,output,false);
  if(!target.startsWith(path.dirname(safe(root,runPath))+path.sep))throw Error('Bundle must be run-local');
  const bind=p=>({path:p,sha256:sha(fs.readFileSync(safe(root,p)))});
  const inventory=p=>sectionInventory(fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,''));
  const sourceSections=inventory(source),rawSections=inventory(raw);
  const bundle={schema_version:2,reviewer_agent_id:agent,...(streamlined(run)?{presentation:rawPresentation()}:{}),
    ledger:{schema_version:1,ruleset:'core-claim-bidirectional-20260914',source:bind(source),raw:bind(raw),claims:[],exclusion_policy:{version:1,categories:[]}},
    section_inventory:{source_sections:sourceSections,raw_sections:rawSections},
    decisions:{fresh_context:!parentReview(run),checks:[],coverage:{ledger_complete:null,missing_claims:[],source_sections:sourceSections.map(x=>({id:x.id,status:null,claim_ids:[],reason:''})),raw_sections:rawSections.map(x=>({id:x.id,status:null,reason:''}))},findings:[]}};
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,JSON.stringify(bundle,null,2)+'\n',{flag:'wx'});
  return {status:'prepared',path:output,source,raw,sections:{source:sourceSections.length,raw:rawSections.length},next_action:'Read full inputs; fill claims, source_selection/raw_selection {start_line,end_line} using one-based inclusive full-file lines, exclusion policy and decisions. Compiler extracts exact quotes from bound versions. Legacy exact quotes remain supported. No default PASS.'};
}

// Only exact, unambiguous evidence is mechanically located. No fuzzy quote repair.
export function quoteRanges(text,quote,declared) {
  text=text.replace(/\r\n/g,'\n');
  if(typeof quote!=='string'||!quote.trim())throw Error('Exact nonempty quote required');
  const rows=text.split('\n');
  if(Array.isArray(declared)&&declared.length&&declared.every(r=>Array.isArray(r)&&r.length===2&&r.every(Number.isInteger)&&r[0]>=1&&r[1]>=r[0]&&r[1]<=rows.length)&&declared.some(([a,b])=>rows.slice(a-1,b).join('\n').includes(quote)))return declared;
  const start=text.indexOf(quote);
  if(start<0)throw Error('Quote not found; reviewer must select exact evidence');
  if(text.indexOf(quote,start+1)>=0)throw Error('Ambiguous quote; supply a longer exact quote or valid disambiguating ranges');
  const first=text.slice(0,start).split('\n').length;
  return [[first,first+quote.split('\n').length-1]];
}

export function normalizeBundle(root,bundle) {
  const result=structuredClone(bundle);
  if(bundle.schema_version!==2)return result;
  const texts={};
  for(const side of ['source','raw']) {
    const ref=bundle.ledger[side],bytes=fs.readFileSync(safe(root,ref.path));
    if(sha(bytes)!==ref.sha256)throw Error('Bundle input hash drift');
    texts[side]=bytes.toString('utf8').replace(/^\uFEFF/,'');
    if(JSON.stringify(bundle.section_inventory?.[side+'_sections'])!==JSON.stringify(sectionInventory(texts[side])))throw Error('Bundle section inventory drift');
  }
  for(const claim of result.ledger.claims)for(const side of ['source','raw']){
    applySelection(root,claim,side,result.ledger[side].path,result.ledger[side].sha256);
    claim[side+'_ranges']=quoteRanges(texts[side],claim[side+'_quote'],claim[side+'_ranges']);
  }
  for(const check of result.decisions?.checks??[]) {
    const claim=result.ledger.claims.find(x=>x.id===check.id);
    if(check.raw_quote===undefined && claim)check.raw_quote=claim.raw_quote;
  }
  return result;
}
