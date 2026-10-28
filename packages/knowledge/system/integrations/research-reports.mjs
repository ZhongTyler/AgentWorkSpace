/** Optional read-only dossier provider. Catalog and storage bindings belong to the host. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizeRequest,createEvidenceQuery,defaultRoot} from '../query/query-evidence.mjs';
import {observeLookup} from '../query/lookup-context.mjs';

const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const slash=x=>x.replaceAll('\\','/');
const json=bytes=>JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));
const failed=(status,reason,extra={})=>({schema_version:1,status,reason,writes:false,claim_support:'not_verified',...extra});
const refFor=(id,unit)=>`knowledge:research:${id}/${encodeURIComponent(unit)}`;
function bounded(root,base,relative){
 if(typeof relative!=='string'||!relative||path.isAbsolute(relative)||/^[a-z]:/i.test(relative)||relative.includes('\0'))throw Error('invalid_source_path');
 const realRoot=fs.realpathSync(root),full=fs.realpathSync(path.resolve(base,relative)),rel=path.relative(realRoot,full);
 if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('path_outside_binding');
 if(!fs.statSync(full).isFile())throw Error('source_not_file');
 return full;
}
function units(manifest){
 const result=new Map([['overview',{paths:[manifest.dossier_ref],seeds:[]}]]),docRoot=path.posix.dirname(slash(manifest.dossier_ref));
 const documentFor=relative=>path.posix.normalize(path.posix.join(docRoot,slash(relative)));
 for(const rel of manifest.documents??[]){
  const name=slash(path.posix.relative(docRoot,slash(rel)));
  const match=/^systems\/(\d+)-/.exec(name);
  result.set(match?'chapter:'+match[1]:'document:'+name,{paths:[rel],seeds:[]});
 }
 for(const row of manifest.claims??[]){
  const cases=(manifest.cases??[]).filter(c=>row.evidence?.includes(c.id));
  result.set(row.id,{paths:[documentFor(row.chapter),...cases.map(c=>documentFor(c.path))],seeds:[row.id]});
 }
 for(const row of manifest.cases??[])result.set(row.id,{paths:[documentFor(row.path)],seeds:[row.id]});
 // Chapter reads carry every declared claim/domain dependency in that chapter, including no-claim chapters.
 for(const [id,unit] of result)for(const rel of /^[CE]\d+$/.test(id)?[]:unit.paths){
  const name=path.posix.relative(docRoot,slash(rel));
  for(const c of manifest.claims??[])if(c.chapter===name)unit.seeds.push(c.id);
  for(const c of manifest.cases??[])if(c.path===name)unit.seeds.push(c.id);
  for(const d of manifest.domains??[])if(d.chapter===name)unit.seeds.push(...(d.evidence??[]));
 }
 return result;
}
function closure(manifest,seeds){
 const nodes=new Map();
 for(const kind of ['sources','assets','cases','claims'])for(const row of manifest[kind]??[]){if(nodes.has(row.id))throw Error('duplicate_evidence_id');nodes.set(row.id,{kind,row});}
 const used=new Map(),visiting=new Set();
 const visit=id=>{
  if(visiting.has(id))throw Error('evidence_cycle');if(used.has(id))return;
  const node=nodes.get(id);if(!node)throw Error('unknown_evidence:'+id);const {kind,row}=node;
  if(kind==='assets'&&row.accepted!==true)throw Error('rejected_asset:'+id);
  if(kind==='sources'&&!['read','partial_read','cached_read'].includes(row.read_status))throw Error('unread_source:'+id);
  visiting.add(id);
  const children=[...(row.evidence??[]),...(row.frames??[]),...(row.segments??[]),...(row.continuous_segment_asset?[row.continuous_segment_asset]:[]),...(kind==='assets'?[row.source_id]:[])];
  for(const child of children)visit(child);visiting.delete(id);used.set(id,node);
 };
 seeds.forEach(visit);return [...used.values()];
}

export function createResearchLibrary({root=defaultRoot,catalogPath=path.join(root,'research-reports/catalog.json'),bindings={},enabled=true,allowedVersionGroups=null}={}){
 let activeMetrics=null;
 const readBytes=file=>{const bytes=fs.readFileSync(file);if(activeMetrics){activeMetrics.file_reads++;activeMetrics.bytes_read+=bytes.length;}return bytes;};
 const wrap=(operation,fn)=>{
  const previous=activeMetrics;activeMetrics={file_reads:0,bytes_read:0};let result;
  try{result=fn();}catch(e){result=failed('unavailable',e.code??e.message);}
  result={...result,metrics:{...result.metrics,...activeMetrics}};activeMetrics=previous;
  return observeLookup(operation,result,{entry:'research'});
 };
 function catalog(){
  if(!enabled)throw Error('research_disabled');
  const c=json(readBytes(catalogPath));
  if(c.schema_version!==1||!Array.isArray(c.reports)||new Set(c.reports.map(r=>r.id)).size!==c.reports.length)throw Error('invalid_research_catalog');
  return c.reports;
 }
 function load(id,knownEntry){
  const entry=knownEntry??catalog().find(r=>r.id===id);
  if(!entry||entry.status!=='active')throw Error('research_not_active');
  if(entry.format!=='research-dossier-v1'||entry.visibility!=='local-owner')throw Error('unsupported_research_view');
  if(entry.acceptance?.status!=='pass'||entry.acceptance?.kind!=='original_dossier_check')throw Error('unaccepted_dossier');
  const binding=bindings[entry.binding];if(!binding)throw Error('binding_unavailable');
  const manifestFile=bounded(binding,binding,entry.manifest),bytes=readBytes(manifestFile);
  if(sha(bytes)!==entry.manifest_sha256)throw Error('accepted_manifest_changed');
  const manifest=json(bytes);
  if(manifest.schema_version!==1||manifest.dossier_id!==id)throw Error('dossier_identity_mismatch');
  return {entry,manifest,base:path.dirname(manifestFile),binding,unitMap:units(manifest)};
 }
 function permitted(context){
  const request=normalizeRequest(context.request??context);
  if(!enabled||!request.sources.knowledge||context.research_allowed===false)return {request,error:failed('disabled','Research source disabled')};
  return {request};
 }
 function discover(need,context={}){return wrap('discover',()=>{
  const {request,error}=permitted({...context,request:context.request??{need}});if(error)return {...error,candidates:[]};
  const tokens=[need.question,...(request.terms??[]),...(request.reformulations??[])].flatMap(s=>s.toLowerCase().split(/[\s，。？！?！,;；、:：]+/u)).filter(x=>x.length>1);
  const candidates=[],unavailable=[];let count=0;
  for(const entry of catalog())try{
   const data=load(entry.id,entry);count++;
   const meta=[entry.title,...(entry.aliases??[]),data.manifest.game_title].join(' ').toLowerCase();
   for(const [unit,selection] of data.unitMap){
    if(unit.startsWith('document:')&&(data.manifest.cases??[]).some(c=>data.unitMap.get(c.id)?.paths[0]===selection.paths[0]))continue;
    const claim=data.manifest.claims?.find(c=>c.id===unit),cs=data.manifest.cases?.find(c=>c.id===unit);
    const title=claim?.text??cs?.answer_scope??selection.paths.join(' ');
    const text=[meta,unit,title].join(' ').toLowerCase();
    const matched=tokens.filter(t=>text.includes(t)||t.includes(unit.toLowerCase())&&/^[CE]\d+$/.test(unit));
    if(!matched.length)continue;
    candidates.push({ref:refFor(entry.id,unit),provider:'research-dossier-v1',source_kind:'research',report_id:entry.id,unit,title:`${entry.title} · ${unit} · ${title}`,matched_terms:matched,discovery_score:matched.length+(tokens.some(t=>t.includes(unit.toLowerCase()))&&/^[CE]\d+$/.test(unit)?10:0),content_read:false,status:'candidate_found',claim_support:'not_verified',coverage_status:data.manifest.coverage_status,manifest_sha256:entry.manifest_sha256});
   }
  }catch(e){unavailable.push({report_id:entry.id,reason:e.message});}
  candidates.sort((a,b)=>b.discovery_score-a.discovery_score||a.ref.localeCompare(b.ref));
  return {schema_version:1,status:candidates.length?(request.budget.max_candidates?'candidates_found':'budget_exhausted'):!count&&unavailable.length?'unavailable':'no_relevant_source',candidates:candidates.slice(0,request.budget.max_candidates),unavailable,discovery_scope:{accepted_manifests:count,body_content_returned:false},metrics:{accepted_manifests:count},writes:false,claim_support:'not_verified'};
 });}
 function read(selection,context={}){return wrap('read',()=>{
  const {request,error}=permitted(context);if(error)return error;
  if(request.budget.max_sources===0)return failed('budget_exhausted','No source budget remaining');
  const ref=selection.ref??refFor(selection.report_id,selection.unit??'overview');
  const match=/^knowledge:research:([a-z0-9-]+)\/([^\s]+)$/.exec(ref);if(!match)return failed('denied','invalid_research_ref');
  const data=load(match[1]),unit=decodeURIComponent(match[2]);const chosen=data.unitMap.get(unit);if(!chosen)return failed('missing','unknown_research_unit',{ref});
  if(selection.mode&&selection.mode!=='full')return failed('denied','research_requires_complete_unit',{ref});
  const dependencies=closure(data.manifest,[...new Set(chosen.seeds)]),claims=dependencies.filter(x=>x.kind==='claims').map(x=>x.row);
  for(const versions of [allowedVersionGroups,context.allowed_version_groups])if(versions&&claims.some(c=>!c.version_groups?.every(v=>versions.includes(v))))return failed('denied','research_version_scope_mismatch',{ref});
  const documents=[],contents=[];
  for(const relative of [...new Set(chosen.paths)]){
   if(!data.manifest.documents.includes(relative))throw Error('undeclared_document');
   const bytes=readBytes(bounded(data.binding,data.base,relative));
   if(sha(bytes)!==data.manifest.document_hashes?.[relative])throw Error('accepted_document_changed:'+relative);
   if(!/\.(md|txt)$/i.test(relative))throw Error('unsupported_document_media');
   documents.push({path:relative,sha256:sha(bytes),bytes:bytes.length});contents.push(bytes.toString('utf8'));
  }
  const content=contents.join('\n\n<!-- complete related research unit -->\n\n');
  if(content.length>request.budget.max_content_chars)return failed('budget_exhausted','Complete research unit exceeds remaining budget; nothing truncated',{ref,required_chars:content.length});
  const evidence=[];
  for(const {kind,row} of dependencies){
   if(kind==='assets'){
    const bytes=readBytes(bounded(data.binding,data.base,row.path));
    if(sha(bytes)!==row.sha256)throw Error('accepted_asset_changed:'+row.id);
   }
   const detail=Object.fromEntries(['id','role','source_id','path','sha256','url','read_status','read_scope','version_group','accepted','media_time_seconds','status','answer_scope','continuity','gaps','kind','conditions','limits','version_groups','support_status'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
   evidence.push({...detail,node_kind:kind,content_read:false,observation_scope:'original_research_record_not_current_agent_media_review'});
  }
  const research={provider:'research-dossier-v1',report_id:match[1],unit,manifest_sha256:data.entry.manifest_sha256,view:'local-owner',complete_dossier:false,whole_content_exhaustively_tested:data.manifest.whole_content_exhaustively_tested===true,coverage_status:data.manifest.coverage_status,unresolved:data.manifest.unresolved??[],documents,claims,evidence,media_review:'not_performed_by_this_read',semantic_support:'requires_current_agent_review'};
  return {schema_version:1,status:'source_read',ref,source_kind:'research',source_identity:ref,path:`research-reports/${match[1]}/${encodeURIComponent(unit)}`,source_sha256:sha(JSON.stringify({manifest:data.entry.manifest_sha256,documents})),content,content_sha256:sha(content),context_sha256:request.context_sha256,need:request.need,selection:{mode:'full'},range:{mode:'full',heading:unit,complete_unit:true,complete_source:unit==='overview',start_line:1,end_line:content.split('\n').length},research,read_event:'fresh_content_return',claim_support:'not_verified',applicability:'requires_task_review',metrics:{content_chars_returned:content.length},writes:false};
 });}
 const resolverFor=(context={})=>({handles:ref=>typeof ref==='string'&&ref.startsWith('knowledge:research:'),read:input=>read({...input.selection,ref:input.ref},{...context,request:input.request})});
 const resolver=resolverFor();
 return Object.freeze({discover,read,verify:(receipts,context)=>createEvidenceQuery({root,resolveSource:resolverFor(context)}).verifyEvidence({request:context.request??context,receipts}),resolver});
}
