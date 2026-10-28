// Projections of actual reviewer decisions. These helpers never decide semantic PASS.
import fs from 'node:fs';
import {safe,sha} from './raw-quality.mjs';
import {substantiveSection} from './ingest-wiki-inputs.mjs';

export const streamlined=run=>run.execution_control?.execution_profile==='consolidated-v1'&&run.execution_control?.workflow_revision===2;
const need=(ok,message)=>{if(!ok)throw Error('Semantic reuse: '+message);};
const nonempty=x=>typeof x==='string'&&x.trim();
export const wikiPaths=root=>fs.readdirSync(safe(root,'wiki',false)).filter(p=>p.endsWith('.md')).map(p=>'wiki/'+p).sort();
export const sourceDecision=source=>({source,raw_name:'',type:'',domains:[],registration:{category:'',source:'',keywords:'',summary:'',unconsumed:''},content_summary:'',skip_reason:''});
export const rawPresentation=()=>({content_summary:'',writing_skeleton:'',coverage:'',boundary:'',disposition:''});
export function requirePresentation(row,keys=Object.keys(rawPresentation())){
  need(row&&keys.every(k=>nonempty(row[k])),'reviewer must supply actual content presentation: '+keys.join(', '));
  return Object.fromEntries(keys.map(k=>[k,row[k]]));
}
export function scoringSources(root,run,semantic){
  need(semantic.rows.length===run.items.length&&run.items.every(p=>semantic.rows.filter(r=>r.source===p).length===1),'exact source set required');
  return semantic.rows.map(row=>{
    need(['ingest','conditional','skip'].includes(row.decision),'decision must be ingest/conditional/skip');
    const item=row.source_decision;
    need(item?.source===row.source,'source decision identity mismatch');
    need(nonempty(row.wiki_coverage?.summary)&&Array.isArray(row.wiki_coverage.candidates),'actual B1 coverage explanation required, including when no candidate is found');
    const seen=new Set();
    const candidates=row.wiki_coverage.candidates.map(c=>{
      need(/^wiki\/[^/\\]+\.md$/.test(c.path)&&!seen.has(c.path+'\0'+c.heading),'invalid/duplicate Wiki coverage candidate');seen.add(c.path+'\0'+c.heading);
      need(nonempty(c.heading)&&nonempty(c.assessment),'read section and explain existing/new/uncertain coverage');
      need(substantiveSection(fs.readFileSync(safe(root,c.path),'utf8'),c.heading).trim().length>=12,'coverage candidate must name an actual substantive section');
      return {...c,sha256:sha(fs.readFileSync(safe(root,c.path)))};
    });
    if(row.decision==='skip')need(nonempty(item.skip_reason),'skipped source needs a concrete reason');
    else{
      need(/^[^<>:"/\\|?*]+\.md$/.test(item.raw_name??'')&&!/^README\.md$/i.test(item.raw_name)&&!item.raw_name.endsWith('.template.md'),'valid Raw basename required before scoring seal');
      need(!fs.existsSync(safe(root,'raw-sources/'+item.raw_name,false)),'Raw output already exists; resolve source identity');
      need(Array.isArray(item.domains)&&item.domains.length&&item.domains.every(d=>typeof d==='string'&&d!=='README'&&/^[^/\\]+$/.test(d)&&fs.existsSync(safe(root,'domains/'+d+'.md',false))),'exact existing domain choices required before scoring seal');
      need(['article','video','paper','book'].includes(item.type),'source type required before scoring seal');
      need(['category','source','keywords','summary','unconsumed'].every(k=>nonempty(item.registration?.[k])),'registration semantics must be supplied once before scoring seal');
    }
    return {...item,disposition:row.decision==='skip'?'skipped':'ingested',ingest_verdict:row.decision==='conditional'?'conditional':'pass',wiki_coverage:{summary:row.wiki_coverage.summary,candidates}};
  });
}
export function coverageReuse(root,sources){
  return sources.filter(s=>s.disposition==='ingested').map(s=>({source:s.source,raw:s.output,summary:s.wiki_coverage.summary,candidates:s.wiki_coverage.candidates.map(c=>({...c,reuse_status:fs.existsSync(safe(root,c.path,false))&&sha(fs.readFileSync(safe(root,c.path)))===c.sha256?'unchanged_evidence':'reread_changed_section'}))}));
}
export function reviewedRawSemantic(root,run,rows){
  return {summary:'Content summaries and boundaries projected from the accepted non-author Raw reviews.',rows:rows.map(row=>{
    const ref=run.execution_control.advance.raw_presentations?.[row.output],audit=run.content_audits.find(a=>a.raw_path===row.output);
    need(ref&&audit,'accepted Raw presentation binding missing');
    need(sha(fs.readFileSync(safe(root,audit.path)))===audit.sha256,'Raw receipt drift');
    const bytes=fs.readFileSync(safe(root,ref.bundle));need(sha(bytes)===ref.bundle_sha256,'Raw presentation bundle drift');
    const receipt=JSON.parse(fs.readFileSync(safe(root,audit.path),'utf8'));
    need(receipt.status==='passed'&&receipt.manifest_path.includes('/review-bundles/'+ref.bundle_sha256.slice(0,16)+'/'),'presentation must belong to the accepted review, not another attempt');
    const bundle=JSON.parse(bytes.toString('utf8'));
    for(const side of ['source','raw'])need(sha(fs.readFileSync(safe(root,bundle.ledger[side].path)))===bundle.ledger[side].sha256,'reviewed input drift');
    return {raw:row.output,...requirePresentation(bundle.presentation)};
  }),semantic_exceptions:[],unresolved_risks:[],structure_change_requests:[],micro_failures:[]};
}
const pageKeys=['knowledge_summary','source_boundary','disposition','verification'];
export function aggregatePresentation(semantic){
  return {page_summaries:semantic.rows.map(r=>({artifact:r.artifact,...Object.fromEntries(pageKeys.map(k=>[k,r[k]??'']))})),semantic_exceptions:semantic.semantic_exceptions??[],unresolved_risks:semantic.unresolved_risks??[],structure_change_requests:semantic.structure_change_requests??[],micro_failures:semantic.micro_failures??[]};
}
export function projectAggregate(semantic,report){
  need(report.status==='passed'&&nonempty(report.coverage_summary)&&Array.isArray(report.findings)&&!report.findings.length,'actual aggregate review must pass without findings');
  need(Array.isArray(report.page_summaries)&&report.page_summaries.length===semantic.rows.length,'aggregate must describe the exact output pages');
  const result=structuredClone(semantic);result.summary=report.coverage_summary;
  result.rows=semantic.rows.map(row=>{
    const matches=report.page_summaries.filter(r=>r.artifact===row.artifact);need(matches.length===1,'missing/duplicate page summary');
    return {...row,...requirePresentation(matches[0],pageKeys)};
  });
  for(const field of ['semantic_exceptions','unresolved_risks','structure_change_requests','micro_failures']){
    need(Array.isArray(report[field]),'aggregate needs '+field);
    // Structural authority is established before this report, not granted by it.
    if(field==='structure_change_requests')need(JSON.stringify(report[field])===JSON.stringify(semantic[field]??[]),'structural decisions changed; resolve the structure contract before aggregate review');
    result[field]=structuredClone(report[field]);
  }
  return result;
}
export function gateProjection(semantic){
  need(semantic.consumption_review?.path,'gate projection requires the bound actual aggregate');
  return {summary:semantic.summary,rows:[],...Object.fromEntries(['semantic_exceptions','unresolved_risks','structure_change_requests','micro_failures'].map(k=>[k,semantic[k]??[]]))};
}
