/** Ephemeral producer scope only. Never opens a store or persists a query. */
import {AsyncLocalStorage} from 'node:async_hooks';
const scopes=new AsyncLocalStorage();
export function withLookup(lookup,callback){return scopes.run(lookup,callback);}
export function observeLookup(operation,result,{entry='query_api'}={}){
 const lookup=scopes.getStore();
 const rows=operation==='principles'?(result.principles??[]).map(p=>({ref:p.ref,version:p.source_sha256??null,stage:'returned',range:{mode:'principle',principle_id:p.id,complete_source:false}}))
  :operation==='readDomain'?[{ref:'knowledge:domain:'+result.domain,version:result.source_sha256??null,stage:'returned',range:{mode:'extracted_principles',complete_source:false}}]
  :['read','reuse'].includes(operation)&&result.ref&&result.source_sha256?[{ref:result.ref,version:result.source_sha256,stage:'returned',range:result.range??null}]:[];
 const technical=['verify','review','assemble','listDomains'].includes(operation);
 let status='host_context_required',lookup_id=null;
 if(lookup){
  try{
   const receipts=[];
   if(!rows.length)receipts.push(lookup.observe({entry,operation,status:result.status??(technical?'technical':'returned'),...(result.retrieval?{knowledge:result.retrieval}:{})}));
   for(const source of rows)receipts.push(lookup.observe({entry,operation,status:result.status??'returned',source}));
   lookup_id=lookup.snapshot().lookup_id;status=receipts.every(r=>r?.status==='observed')?'observed':'unavailable';
  }catch{status='unavailable';}
 }
 return {...result,compounding:{schema_version:1,producer:entry,operation,status,lookup_id,persisted:false,source_stage:technical?'technical':rows.length?'returned':'none',semantic_increment:'requires_current_agent_review'}};
}
