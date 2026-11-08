/** Deterministic export of a Research-owned, explicitly classified query view. */
import fs from 'node:fs';
import path from 'node:path';
import {researchUnits,researchUnitMetadata,defaultResearchBindings} from './research-reports.mjs';
import {canonical,hash,requireValue as ok,scopedFile} from '../sync/state.mjs';
import {safeContentPath} from '../sync/clients.mjs';

export const RESEARCH_PUBLIC_PROFILE='research-reports/public-view.json';

export function buildResearchPublicView({root,catalogPath=path.join(root,'research-reports/catalog.json'),bindings=defaultResearchBindings(root),plan,authorizationRef}){
 ok(typeof authorizationRef==='string'&&authorizationRef.trim(),'research_public_authorization_required');
 ok(plan?.schema_version===1&&Array.isArray(plan.reports),'research_public_plan_required');
 const catalogBytes=fs.readFileSync(catalogPath),catalog=JSON.parse(catalogBytes.toString('utf8').replace(/^\uFEFF/,''));
 ok(catalog.schema_version===1&&Array.isArray(catalog.reports),'invalid_research_catalog');
 const files=new Map(),reports=[],draftReports=[];
 const add=(relative,source,expected,access='private_evidence')=>{
  ok(safeContentPath(relative),'unsafe_research_public_path:'+relative);
  const stat=fs.statSync(source);ok(stat.isFile(),'research_public_source_missing');
  ok(hash(fs.readFileSync(source))===expected,'research_public_source_changed');
  const prior=files.get(relative);ok(!prior||prior.sha256===expected,'research_public_path_collision');
  files.set(relative,{path:relative,source,sha256:expected,size:stat.size,access,kind:access==='query'?'research':'attachment'});
 };
 add('research-reports/catalog.json',catalogPath,hash(catalogBytes));
 for(const entry of catalog.reports.filter(row=>row.status==='active')){
  ok(entry.format==='research-dossier-v1'&&entry.visibility==='local-owner'&&entry.acceptance?.kind==='original_dossier_check'&&entry.acceptance.status==='pass','research_source_not_accepted');
  const decision=plan.reports.find(row=>row.id===entry.id);
  ok(decision&&decision.manifest_sha256===entry.manifest_sha256&&Array.isArray(decision.files),'research_public_plan_identity');
  const manifestFile=scopedFile(bindings[entry.binding],entry.manifest),manifestBytes=fs.readFileSync(manifestFile);
  ok(hash(manifestBytes)===entry.manifest_sha256,'research_public_manifest_changed');
  const manifest=JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/,''));
  ok(manifest.dossier_id===entry.id,'research_public_report_identity');
  const manifestPath=entry.binding==='knowledge'?entry.manifest:`research-reports/${entry.id}/manifest.json`;
  const base=path.posix.dirname(manifestPath),sourceBase=path.dirname(manifestFile);
  add(manifestPath,manifestFile,entry.manifest_sha256);
  const declared=new Map((manifest.documents??[]).map(relative=>[relative,{sha256:manifest.document_hashes?.[relative],role:'body_document'}]));
  for(const asset of manifest.assets??[])if(asset.accepted===true){
   const prior=declared.get(asset.path);ok(!prior||prior.sha256===asset.sha256,'research_dependency_hash_conflict');
   if(!prior)declared.set(asset.path,{sha256:asset.sha256,role:'accepted_asset'});
  }
  const classifications=[];
  // Include the owner-classified private reader and supporting evidence too.
  // A complete internal sync has a wider byte scope than public Query text.
  const selected=new Map(declared);
  for(const row of decision.files)if(row.private_cloud_disposition==='copy_exact_bytes_private_evidence'&&row.path!=='manifest.json'&&!selected.has(row.path))selected.set(row.path,{sha256:row.sha256,role:'private_support'});
  for(const [relative,dependency] of selected){
   const rows=decision.files.filter(row=>row.path===relative);ok(rows.length===1,'research_dependency_classification_required');
   const row=rows[0],disposition=row.private_cloud_disposition==='copy_exact_bytes_private_evidence'?(row.query_result_visibility==='public-research-projection'?'public':'private_evidence'):row.disposition;
   ok(row.sha256===dependency.sha256&&['public','private_evidence'].includes(disposition)&&typeof row.reason==='string'&&row.reason.trim(),'research_dependency_scope_required');
   ok(dependency.role!=='body_document'||disposition==='public','research_complete_body_required');
   const target=path.posix.join(base,relative),source=scopedFile(sourceBase,relative);
   const queryMaterial=disposition==='public'&&!/\.(json|html|js|mjs|cjs|mp4|webm|mp3|ogg|wav)$/i.test(relative);
   add(target,source,dependency.sha256,queryMaterial?'query':'private_evidence');
   classifications.push({path:target,sha256:dependency.sha256,size:files.get(target).size,role:dependency.role,disposition,reason:row.reason});
  }
  const documentSizes=Object.fromEntries((manifest.documents??[]).map(relative=>[relative,files.get(path.posix.join(base,relative)).size]));
  const units=researchUnitMetadata({reportId:entry.id,title:entry.title,manifest,manifestSha:entry.manifest_sha256,documentSizes});
  reports.push({id:entry.id,source_manifest_sha256:entry.manifest_sha256,manifest_path:manifestPath,manifest_sha256:entry.manifest_sha256,unit_ids:[...researchUnits(manifest).keys()],units,files:classifications.sort((a,b)=>a.path.localeCompare(b.path)),excluded:decision.files.filter(row=>!selected.has(row.path)&&row.path!=='manifest.json').map(row=>({path:row.path,sha256:row.sha256,disposition:'excluded',reason:row.reason}))});
 }
 for(const decision of plan.reports.filter(row=>row.registered===false&&row.draft_entry?.accepted===false)){
  ok(/^[a-z0-9-]+$/.test(decision.id)&&/^[a-z0-9-]+$/.test(decision.directory),'invalid_research_draft_identity');
  const base=`research-reports/${decision.directory}`,classified=[],documents=[],documentHashes={},documentSizes={};
  for(const row of decision.files){
   if(row.private_cloud_disposition!=='copy_exact_bytes_private_evidence')continue;
   const relative=base+'/'+row.path,publicText=row.query_result_visibility==='public-research-projection'&&/\.(md|txt)$/i.test(row.path);
   add(relative,scopedFile(root,relative),row.sha256,publicText?'query':'private_evidence');
   classified.push({path:relative,sha256:row.sha256,size:files.get(relative).size,role:publicText?'body_document':'private_support',disposition:publicText?'public':'private_evidence',reason:row.reason});
   if(publicText){documents.push(row.path);documentHashes[row.path]=row.sha256;documentSizes[row.path]=files.get(relative).size;}
  }
  ok(documents.includes('README.md')&&documents.length>0,'research_draft_body_missing');
  const draftSourceSha=hash(canonical(classified));
  const manifest={schema_version:1,dossier_id:decision.id,game_title:'潜水员戴夫（研究草稿）',dossier_ref:'README.md',documents,document_hashes:documentHashes,coverage_status:'draft_partial',whole_content_exhaustively_tested:false,claims:[],cases:[],assets:[],sources:[],unresolved:[decision.draft_entry.scope],accepted:false,draft_source_sha256:draftSourceSha};
  const manifestBytes=Buffer.from(canonical(manifest)+'\n'),manifestSha=hash(manifestBytes),manifestPath=base+'/draft-view-manifest.json';
  files.set(manifestPath,{path:manifestPath,bytes:manifestBytes,sha256:manifestSha,size:manifestBytes.length,kind:'attachment',access:'private_evidence'});
  const units=researchUnitMetadata({reportId:decision.id,title:manifest.game_title,manifest,manifestSha,documentSizes});
  draftReports.push({id:decision.id,title:manifest.game_title,aliases:['潜水员戴夫','戴夫','Dave the Diver'],accepted:false,status:'draft',draft_source_sha256:draftSourceSha,scope:decision.draft_entry.scope,source_manifest_sha256:manifestSha,manifest_path:manifestPath,manifest_sha256:manifestSha,unit_ids:units.map(unit=>unit.unit),units,files:classified,excluded:decision.files.filter(row=>row.private_cloud_disposition!=='copy_exact_bytes_private_evidence').map(row=>({path:row.path,sha256:row.sha256,disposition:'excluded',reason:row.reason}))});
 }
 const profile={schema_version:1,kind:'research-public-view-v1',authorization_ref:authorizationRef,catalog_sha256:hash(catalogBytes),reports,draft_reports:draftReports};
 const profileBytes=Buffer.from(canonical(profile)+'\n');
 files.set(RESEARCH_PUBLIC_PROFILE,{path:RESEARCH_PUBLIC_PROFILE,bytes:profileBytes,sha256:hash(profileBytes),size:profileBytes.length,access:'private_evidence',kind:'attachment'});
 return {profile,files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),totalBytes:[...files.values()].reduce((total,file)=>total+file.size,0)};
}

export function exportResearchPublicView({output,...options}){
 const view=buildResearchPublicView(options);
 ok(path.isAbsolute(output)&&!fs.existsSync(output),'research_export_new_target_required');
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 for(const file of view.files){
  const target=path.join(output,...file.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
  const bytes=file.bytes??fs.readFileSync(file.source);
  ok(hash(bytes)===file.sha256,'research_export_source_changed');fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
 }
 return {profile:view.profile,files:view.files.map(({source,bytes,...file})=>file),totalBytes:view.totalBytes};
}
