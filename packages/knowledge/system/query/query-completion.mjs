/** Host-owned mechanical completion only; never evidence or semantic truth. */
export const queryStopReasons=Object.freeze(['needs_answered','bounded_discovery_exhausted','budget_exhausted','sources_unavailable','user_scope_reached','critical_gaps_remaining']);
export const incompleteGapStopReasons=Object.freeze(['budget_exhausted','sources_unavailable','bounded_discovery_exhausted','critical_gaps_remaining']);
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const validGaps=v=>Array.isArray(v)&&v.every(g=>object(g)&&typeof g.text==='string'&&g.text.trim()&&(g.critical===undefined||typeof g.critical==='boolean'));
/** Legacy callers opt into final normalization; Native also normalizes early conflicts.
 * Invalid payloads are untouched so their original validator still rejects them.
 */
export function compileCompletion(input,{finalGenerationSpent=false,normalizeCritical=false,hasSources=true,readConstraintsMet=true}={}){
 if((!finalGenerationSpent&&!normalizeCritical)||!object(input)||!validGaps(input.gaps))return {args:input,audit:null};
 if(input.stop_reason!==undefined&&!queryStopReasons.includes(input.stop_reason))return {args:input,audit:null};
 const critical=input.gaps.filter(g=>g.critical!==false).length,missing=!hasSources||!readConstraintsMet;
 if(!finalGenerationSpent){
  if(input.stop_reason!=='needs_answered'||!critical)return {args:input,audit:null};
  return {args:{...input,stop_reason:'critical_gaps_remaining'},audit:{origin:'host',proposed_stop_reason:input.stop_reason,critical_gap_count:critical,unmet_read_constraints:missing,stop_reason:'critical_gaps_remaining',single_final_generation_limit:false}};
 }
 const incomplete=input.stop_reason!==undefined&&input.stop_reason!=='needs_answered';
 const stop=incomplete?input.stop_reason:critical||missing?'budget_exhausted':'needs_answered';
 return {args:{...input,stop_reason:stop},audit:{origin:'host',proposed_stop_reason:input.stop_reason??null,critical_gap_count:critical,unmet_read_constraints:missing,stop_reason:stop,single_final_generation_limit:true}};
}
