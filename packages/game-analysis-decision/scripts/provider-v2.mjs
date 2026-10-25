import fs from 'node:fs';
import {resolveSelection,containedPath,repositoryRoot,resolveKnowledge} from './learning-cli.mjs';
export function selectProfessional(query={},root=repositoryRoot,{maxAssets=3,maxCharacters=20000}={}){
 if(!Number.isInteger(maxAssets)||maxAssets<1||maxAssets>100||!Number.isInteger(maxCharacters)||maxCharacters<100||maxCharacters>100000)throw new Error('Invalid reading budget');
 const resolution=resolveSelection(query,root),matches=resolution.items.filter(a=>a.available),selected=[];let used=0;
 for(const item of matches){
  if(selected.length>=maxAssets)break;
  const content=fs.readFileSync(containedPath(root,item.path),'utf8');
  if(used+content.length>maxCharacters)continue;
  selected.push({...item,content});used+=content.length;
 }
 return {schema_version:2,problem:resolution.problem,operation:resolution.operation,status:matches.length===selected.length?'complete':'partial',candidate_policy:query.includeCandidates===true?'explicit_opt_in':selected.some(a=>a.default_use===true)?'default_use_enabled':'excluded_by_default',usage:resolution.items.map(a=>({id:a.id,status:a.use_status,available:a.available,reason:a.selection_reason,evidence_reason:a.reason})),default_use_ids:selected.filter(a=>a.default_use===true).map(a=>a.id),assets:selected,not_loaded:matches.filter(m=>!selected.some(s=>s.id===m.id)).map(m=>m.id),content_characters:used,source_plan:[...new Set(selected.flatMap(a=>a.source_refs))],sources_read:false,host_write:false,claim:'Matched professional content with actual current eligibility. Items marked default_use are available for relevant tasks without opt-in or evidence-scope gating; other candidates require explicit opt-in and other scoped content requires matching context. Evidence eligibility and scope remain disclosed; normal use does not certify efficacy. Selection is not expertise or quality certification; read scope and verify critical conclusions.'};
}
export {resolveKnowledge as resolveSourceV2};
