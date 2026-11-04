/** Local composition: trusted configuration only; native Query stays independent. */
import fs from 'node:fs';
import path from 'node:path';
import {createEvidenceQuery,defaultRoot,normalizeRequest} from '../query/query-evidence.mjs';
import {createResearchLibrary,defaultResearchBindings} from './research-reports.mjs';

export function createLocalResearchHost({root=defaultRoot,bindings=defaultResearchBindings(root),catalogPath,enabled=true,allowedVersionGroups=null}={}){
 const library=createResearchLibrary({root,bindings,catalogPath,enabled,allowedVersionGroups});
 const query=createEvidenceQuery({root,resolveSource:library.resolver});
 return Object.freeze({...query,research:library,
  discover(input){
   // Explicit use is a host planning choice, never a second compulsory search.
   const native=query.discover(input),request=normalizeRequest(input);
   if(!request.sources.knowledge||!enabled)return native;
   const supplement=library.discover(request.need,{request,wiki_candidates:(native.candidates??[]).filter(c=>c.path?.startsWith('wiki/')).map(c=>c.path)});
   const metrics={...native.metrics,file_reads:(native.metrics?.file_reads??0)+(supplement.metrics?.file_reads??0),bytes_read:(native.metrics?.bytes_read??0)+(supplement.metrics?.bytes_read??0)};
   if(!['candidates_found','budget_exhausted'].includes(supplement.status))return {...native,research:supplement,metrics};
   const original=native.candidates??[],researchLimit=original.length?Math.ceil(request.budget.max_candidates/2):request.budget.max_candidates;
   const candidates=[...supplement.candidates.slice(0,researchLimit),...original,...supplement.candidates.slice(researchLimit)].slice(0,request.budget.max_candidates);
   const {candidates:reportCandidates,...metadata}=supplement;
   const status=candidates.length?'candidates_found':supplement.status==='budget_exhausted'?'budget_exhausted':native.status;
   return {...native,status,stop_reason:candidates.length?'awaiting_semantic_selection':status==='budget_exhausted'?'candidate_budget_exhausted':native.stop_reason,candidates,research:{...metadata,candidates_found:reportCandidates.length,candidates_returned:candidates.filter(c=>c.source_kind==='research').length},metrics};
  },
  readSource(input){
   const read=query.readSource(input);
   if(read.status!=='source_read'||read.source_kind!=='wiki'||!enabled)return read;
   const request=normalizeRequest(input.request??input);
   const supplement=library.discover(request.need,{request,wiki_candidates:[read.path],relations_only:true});
   return {...read,navigation:{...read.navigation,research:{status:supplement.status,...(supplement.reason?{reason:supplement.reason}:{}),candidates:(supplement.candidates??[]).filter(c=>c.relations.some(r=>r.from.kind==='wiki'&&r.from.path===read.path)),unavailable:supplement.unavailable??[],relation_issues:supplement.relation_issues??[],content_read:false}},metrics:{...read.metrics,file_reads:(read.metrics?.file_reads??0)+(supplement.metrics?.file_reads??0),bytes_read:(read.metrics?.bytes_read??0)+(supplement.metrics?.bytes_read??0)}};
  }
 });
}

export function localResearchOptions(root=defaultRoot){
 const config=path.join(root,'system/query/research.local.json');
 if(!fs.existsSync(config))return {root,bindings:defaultResearchBindings(root),enabled:false};
 const value=JSON.parse(fs.readFileSync(config,'utf8').replace(/^\uFEFF/,''));
 if(value.schema_version!==1||typeof value.enabled!=='boolean'||!value.bindings||typeof value.bindings!=='object')throw Error('invalid_research_binding');
 for(const binding of Object.values(value.bindings))if(typeof binding!=='string'||!path.isAbsolute(binding))throw Error('research_binding_must_be_absolute');
 if(value.checker_root!==undefined&&(typeof value.checker_root!=='string'||!path.isAbsolute(value.checker_root)))throw Error('research_checker_root_must_be_absolute');
 return {root,bindings:{...defaultResearchBindings(root),...value.bindings},enabled:value.enabled,...(value.checker_root?{checkerRoot:value.checker_root}:{})};
}
