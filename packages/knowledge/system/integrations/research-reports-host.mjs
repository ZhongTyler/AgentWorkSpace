/** Local composition: trusted configuration only; native Query stays independent. */
import fs from 'node:fs';
import path from 'node:path';
import {createEvidenceQuery,defaultRoot,normalizeRequest} from '../query/query-evidence.mjs';
import {createResearchLibrary} from './research-reports.mjs';

export function createLocalResearchHost({root=defaultRoot,bindings={},catalogPath,enabled=true,allowedVersionGroups=null}={}){
 const library=createResearchLibrary({root,bindings,catalogPath,enabled,allowedVersionGroups});
 const query=createEvidenceQuery({root,resolveSource:library.resolver});
 return Object.freeze({...query,research:library,
  discover(input){
   // Explicit use is a host planning choice, never a second compulsory search.
   const native=query.discover(input),request=normalizeRequest(input);
   if(!request.sources.knowledge||!enabled)return native;
   const supplement=library.discover(request.need,{request});
   if(!['candidates_found','budget_exhausted'].includes(supplement.status))return {...native,research:supplement};
   const original=native.candidates??[],researchLimit=original.length?Math.ceil(request.budget.max_candidates/2):request.budget.max_candidates;
   const candidates=[...supplement.candidates.slice(0,researchLimit),...original,...supplement.candidates.slice(researchLimit)].slice(0,request.budget.max_candidates);
   const {candidates:reportCandidates,...metadata}=supplement;
   return {...native,status:candidates.length?'candidates_found':native.status,candidates,research:{...metadata,candidates_found:reportCandidates.length},metrics:{...native.metrics,file_reads:(native.metrics?.file_reads??0)+(supplement.metrics?.file_reads??0),bytes_read:(native.metrics?.bytes_read??0)+(supplement.metrics?.bytes_read??0)}};
  }
 });
}

export function localResearchOptions(root=defaultRoot){
 const config=path.join(root,'system/query/research.local.json');
 if(!fs.existsSync(config))return {root,bindings:{},enabled:false};
 const value=JSON.parse(fs.readFileSync(config,'utf8').replace(/^\uFEFF/,''));
 if(value.schema_version!==1||typeof value.enabled!=='boolean'||!value.bindings||typeof value.bindings!=='object')throw Error('invalid_research_binding');
 for(const binding of Object.values(value.bindings))if(typeof binding!=='string'||!path.isAbsolute(binding))throw Error('research_binding_must_be_absolute');
 return {root,bindings:value.bindings,enabled:value.enabled};
}
