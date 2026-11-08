/** Explicit local maintenance inventory. Ordinary Query keeps relevance selection. */
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {coreStoreFactory} from '../sync/clients.mjs';

export async function maintenanceIssues({context,home,toolsRoot,limit=5,now=Date.now()}={}){
 if(context?.host!=='local-agent'||!context.library_id||context.view!=='local-owner')return {status:'disabled',issues:[],reason:'local_owner_required'};
 const policy=context.policy;
 if(context.enabled===false||context.knowledge_allowed===false||policy?.analysis_allowed!==true||policy.temporary!==false||policy.retention_confirmed!==true||policy.withdrawn===true||!policy.version||!Number.isFinite(Date.parse(context.expires_at))||Date.parse(context.expires_at)<=now)return {status:'disabled',issues:[],reason:'maintenance_permission_required'};
 if(!Number.isSafeInteger(limit)||limit<1||limit>50)throw Error('Invalid maintenance selection budget');
 try{
  const factory=await coreStoreFactory(toolsRoot);
  const {selectIssues}=await import(pathToFileURL(path.join(toolsRoot,'integrations/knowledge-feedback/core.mjs')));
  const state=factory(home,context).read(),rows=Object.values(state.records.issue);
  const selected=[];
  // Reuse the original controls, signal eligibility and outcome selection in
  // bounded slices. A no-term relevance result cannot establish an empty queue.
  for(let at=0;at<rows.length;at+=50){
   const slice=rows.slice(at,at+50);
   const subset={...state,records:{...state.records,issue:Object.fromEntries(slice.map(row=>[row.id,row]))}};
   selected.push(...selectIssues(subset,{now,terms:slice.map(row=>row.subject),limit:50}));
  }
  selected.sort((a,b)=>a.id.localeCompare(b.id));
  const statuses={};for(const row of rows)statuses[row.status]=(statuses[row.status]??0)+1;
  return {status:'selected',scope:'all_local_owner_eligible_issues',total:selected.length,returned:Math.min(limit,selected.length),remaining:Math.max(0,selected.length-limit),stored_total:rows.length,nonterminal_total:rows.filter(row=>!['rejected','deferred','resolved'].includes(row.status)).length,status_counts:statuses,issues:selected.slice(0,limit),writes:false};
 }catch(error){return {status:'unavailable',scope:'all_local_owner_eligible_issues',total:null,issues:[],reason:error.code??error.message,writes:false};}
}
