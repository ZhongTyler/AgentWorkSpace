/** Explicit maintenance for reviewed report relations; lookup never calls mutation actions. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {defaultRoot} from '../../query/query-evidence.mjs';
import {researchUnits} from '../../integrations/research-reports.mjs';
import {localResearchOptions} from '../../integrations/research-reports-host.mjs';
import {checkRelation,relationShape,relationAnchor,safeRelationFile,navigationBlock,projectNavigation,withoutResearchNavigation} from '../../integrations/research-report-relations.mjs';
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const within=(base,file)=>{const rel=path.relative(base,file);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('maintenance_path_outside_root');return file;};
function accepted(root,entry,bindings){
 if(entry.status!=='active'||entry.acceptance?.status!=='pass'||entry.acceptance?.kind!=='original_dossier_check'||entry.visibility!=='local-owner')throw Error('report_not_accepted');
 const binding=bindings[entry.binding];if(!binding)throw Error('binding_unavailable');
 const file=safeRelationFile(binding,entry.manifest),bytes=fs.readFileSync(file);
 if(sha(bytes)!==entry.manifest_sha256)throw Error('accepted_manifest_changed');
 const manifest=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
 if(manifest.dossier_id!==entry.id)throw Error('dossier_identity_mismatch');
 return {file,base:path.dirname(file),manifest,units:researchUnits(manifest),binding};
}
function target(root,entry,link,bindings,{reviewed=true,cache}={}){
 const key=entry.id+':'+entry.manifest_sha256;
 let data=cache?.data.get(key);if(!data){data=accepted(root,entry,bindings);cache?.data.set(key,data);}
 const read=cache?(file=>cache.readBytes(file).toString('utf8')):undefined;
 const bytes=file=>cache?cache.readBytes(file):fs.readFileSync(file);
 const anchor=reviewed?checkRelation(root,entry,link,{read,anchors:cache?.anchors}):relationAnchor(root,link.from,read);
 const unit=data.units.get(link.unit);if(!unit)throw Error('relation_unit_missing');
 for(const p of unit.paths){
  if(!data.manifest.documents.includes(p))throw Error('undeclared_relation_document');
  if(sha(bytes(safeRelationFile(data.binding,path.relative(data.binding,path.resolve(data.base,p)))))!==data.manifest.document_hashes?.[p])throw Error('relation_document_changed');
 }
 for(const evidence of link.evidence){
  const p=evidence.path;
  if(!data.manifest.documents.includes(p))throw Error('undeclared_relation_evidence');
  const file=safeRelationFile(data.binding,path.relative(data.binding,path.resolve(data.base,p))),body=bytes(file);
  if(sha(body)!==data.manifest.document_hashes?.[p])throw Error('relation_evidence_changed');
  if(!body.toString('utf8').split(/\r?\n/).some(l=>/^#{1,6} /.test(l)&&l.replace(/^#{1,6} /,'')===evidence.heading))throw Error('relation_evidence_heading_missing');
 }
 const first=safeRelationFile(data.binding,path.relative(data.binding,path.resolve(data.base,unit.paths[0])));
 return {anchor,unit,first};
}
function atomic(file,bytes,expected){
 if(!fs.readFileSync(file).equals(expected))throw Error('maintenance_input_changed');
 const temporary=file+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temporary,bytes,{flag:'wx'});if(!fs.readFileSync(file).equals(expected))throw Error('maintenance_input_changed');fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
}
export function maintainRelations({root=defaultRoot,action='check',reviewFile,handoffFile,bindings=localResearchOptions(root).bindings,reviewerId=process.env.CODEX_THREAD_ID}={}){
 const catalogFile=path.join(root,'research-reports/catalog.json'),before=fs.readFileSync(catalogFile),catalog=JSON.parse(before);
 const cache={data:new Map(),anchors:new Map(),bytes:new Map()};cache.readBytes=file=>{if(!cache.bytes.has(file))cache.bytes.set(file,fs.readFileSync(file));return cache.bytes.get(file);};
 if(catalog.schema_version!==1||!Array.isArray(catalog.reports))throw Error('invalid_research_catalog');
 if(action==='inspect-handoff'){
  const handoff=json(handoffFile);
  if(handoff.schema_version!==1||handoff.kind!=='research_report_relation_handoff'||!Array.isArray(handoff.reports))throw Error('invalid_relation_handoff');
  let count=0;
  for(const r of handoff.reports){
   const entry=catalog.reports.find(e=>e.id===r.id);
   if(!entry||r.manifest!==entry.manifest||r.manifest_sha256!==entry.manifest_sha256||!Array.isArray(r.proposed_links))throw Error('handoff_report_version_mismatch');
   for(const p of r.proposed_links){
    if(p.review)throw Error('handoff_cannot_approve_relations');
    relationShape({...p,id:p.id??'proposal'});target(root,entry,p,bindings,{reviewed:false,cache});count++;
   }
  }
  return {status:'handoff_inspected',proposals:count,semantic_approval:false,writes:false};
 }
 if(action==='apply'){
  const file=within(fs.realpathSync(root),fs.realpathSync(path.resolve(root,reviewFile))),review=json(file);
  if(!reviewerId||review.schema_version!==1||review.kind!=='knowledge_research_relation_review'||review.status!=='approved'||review.reviewer_id!==reviewerId||!Array.isArray(review.reports))throw Error('main_relation_review_required');
  const seenReports=new Set();
  for(const r of review.reports){
   if(seenReports.has(r.id))throw Error('duplicate_review_report');seenReports.add(r.id);
   const entry=catalog.reports.find(e=>e.id===r.id);
   if(!entry||!Array.isArray(r.discovery_links)||entry.manifest_sha256!==r.manifest_sha256)throw Error('review_report_version_mismatch');
   const ids=new Set();
   for(const link of r.discovery_links){
    if(ids.has(link.id))throw Error('duplicate_relation_id');ids.add(link.id);
    if(link.status==='retired'){relationShape(link);continue;}
    if(link.review?.reviewer_id!==reviewerId)throw Error('relation_reviewer_mismatch');
    target(root,entry,link,bindings,{cache});
   }
   entry.discovery_links=r.discovery_links;
  }
  atomic(catalogFile,Buffer.from(JSON.stringify(catalog,null,2)+'\n'),before);
  return {status:'relations_applied',reports:review.reports.map(r=>r.id),review: path.relative(root,file).replaceAll('\\','/'),review_sha256:sha(fs.readFileSync(file)),writes:true};
 }
 if(!['sync','check'].includes(action))throw Error('unknown_relation_action');
 const rows=new Map(),issues=[];
 for(const entry of catalog.reports){
  const rawLinks=entry.discovery_links??[],links=Array.isArray(rawLinks)?rawLinks:[];
  if(!Array.isArray(rawLinks))issues.push({report_id:entry.id,reason:'invalid_discovery_links'});
  const idCounts=new Map();for(const l of links)idCounts.set(l?.id,(idCounts.get(l?.id)??0)+1);
  for(const link of links)try{
   if(link?.status==='retired')continue;
   if(idCounts.get(link?.id)!==1)throw Error('duplicate_relation_id');
   const {anchor,first}=target(root,entry,link,bindings,{cache});
   if(!rows.has(anchor.path))rows.set(anchor.path,[]);
   rows.get(anchor.path).push({entry,link:{...link,navigation_target:path.relative(path.dirname(path.join(root,anchor.path)),first).replaceAll('\\','/')}});
  }catch(e){issues.push({report_id:entry.id,relation_id:link?.id,reason:e.message});}
 }
 // Also remove stale projections after explicit relation retirement, without touching unmarked content.
 for(const folder of ['wiki','groups'])if(fs.existsSync(path.join(root,folder)))for(const name of fs.readdirSync(path.join(root,folder))){
  if(!name.endsWith('.md'))continue;
  const relative=folder+'/'+name,file=safeRelationFile(root,relative);
  if(!rows.has(relative)&&fs.readFileSync(file,'utf8').includes('<!-- generated:research-report-links:start -->'))rows.set(relative,[]);
 }
 const changes=[];
 for(const [relative,links] of rows){
  const file=safeRelationFile(root,relative),bytes=fs.readFileSync(file),text=bytes.toString('utf8'),next=projectNavigation(text,navigationBlock(root,relative,links));
  if(withoutResearchNavigation(text)!==withoutResearchNavigation(next))throw Error('navigation_would_change_semantic_content');
  if(text!==next)changes.push({path:relative,file,before:bytes,after:Buffer.from(next)});
 }
 if(action==='sync'){
  // Resolve/validate the entire batch before mutation. Recheck each owned path against its read bytes.
  for(const c of changes)if(!fs.readFileSync(c.file).equals(c.before))throw Error('navigation_input_changed');
  const applied=[];
  try{for(const c of changes){atomic(c.file,c.after,c.before);applied.push(c);}}catch(e){for(const c of applied.reverse())if(fs.readFileSync(c.file).equals(c.after))atomic(c.file,c.before,c.after);throw e;}
 }
 return {status:issues.length?'relation_issues':changes.length&&action==='check'?'navigation_drift':'relations_consistent',relations:[...rows.values()].reduce((n,r)=>n+r.length,0),issues,changed_paths:changes.map(c=>c.path),writes:action==='sync'&&changes.length>0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 try{
  const options={action:process.argv[2]??'check'};
  for(let i=3;i<process.argv.length;i+=2){const key={'--root':'root','--review':'reviewFile','--handoff':'handoffFile'}[process.argv[i]];if(!key||!process.argv[i+1])throw Error('Usage: <inspect-handoff|apply|sync|check> [--root ...] [--review <Knowledge review>] [--handoff <Research proposal>]');options[key]=process.argv[i+1];}
  const result=maintainRelations(options);console.log(JSON.stringify(result));if(['relation_issues','navigation_drift'].includes(result.status))process.exitCode=2;
 }catch(e){console.error(JSON.stringify({status:'relation_maintenance_failed',reason:e.message}));process.exitCode=2;}
}
