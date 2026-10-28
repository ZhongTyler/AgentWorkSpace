/** Host-side lookup and persistence adapter; Query and principle providers remain read-only. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {withLookup} from '../query/lookup-context.mjs';
export const knowledgeRoot=path.resolve(import.meta.dirname,'../..');
const unavailable=(context,reason)=>({
 observe(){return {status:'unavailable'};},snapshot(){return {lookup_id:context.lookup_id??null,observations:[]};},pending(){return [];},
 finish(){return {lookup_id:context.lookup_id??null,compounding_status:'unavailable',persisted:false,reason,pending_ref:context.request_ref??null};}
});
export async function createKnowledgeLookup({context,home=null,toolsRoot=path.resolve(knowledgeRoot,'../tools')}={}){
 if(!context||typeof context!=='object')throw Error('Host lookup context required');

 try{
  if(home){if(!path.isAbsolute(home))throw Error('Explicit absolute private home required');const resolved=path.resolve(home);for(const base of [knowledgeRoot,toolsRoot]){const rel=path.relative(path.resolve(base),resolved);if(!rel||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)))throw Error('Private home must be outside managed packages');}}
  const base=path.join(toolsRoot,'integrations/knowledge-feedback');
  const {createLookup}=await import(pathToFileURL(path.join(base,'host.mjs')));
  let store=null;
  if(home&&context.enabled!==false&&context.policy?.analysis_allowed===true&&context.policy?.temporary===false&&context.policy?.retention_confirmed===true){const {FileStore}=await import(pathToFileURL(path.join(base,'store.mjs')));store=new FileStore({home,namespace:context});}
  return createLookup(context,{store});
 }catch(e){return unavailable(context,e.code??e.message);}
}
export function runKnowledgeLookup(lookup,callback){return withLookup(lookup,callback);}
export function localHostContext({root=knowledgeRoot,entry='query_cli',purpose='lookup',lookupId=null,requestRef=null,contextFile=process.env.KNOWLEDGE_LOOKUP_CONTEXT}={}){
 const ref='lookup:'+crypto.randomUUID();
 const fallback={lookup_id:lookupId??ref,request_ref:requestRef??ref,host:'local-cli',library_id:'library-'+crypto.createHash('sha256').update(path.resolve(root)).digest('hex').slice(0,24),view:'local-owner',purpose,entry,policy:null,expires_at:null};
 let config=null,configurationFailure=null;
 const binding=contextFile??path.join(root,'system/query/compounding.local.json');
 if(contextFile||fs.existsSync(binding))try{
  config=JSON.parse(fs.readFileSync(binding,'utf8').replace(/^\uFEFF/,''));
  if(!config.context){
   if(config.schema_version!==1||typeof config.enabled!=='boolean'||!Number.isSafeInteger(config.retention_days)||config.retention_days<1||config.retention_days>365)throw Error('Invalid local host binding');
   if(config.tombstone_retention_days!==undefined&&(!Number.isSafeInteger(config.tombstone_retention_days)||config.tombstone_retention_days<1||config.tombstone_retention_days>365))throw Error('Invalid tombstone retention');
   config={...config,context:{...fallback,host:config.host,library_id:config.library_id,view:config.view,enabled:config.enabled,policy:config.policy,expires_at:new Date(Date.now()+config.retention_days*86400000).toISOString(),...(config.tombstone_retention_days?{retention:{tombstone_retention_ms:config.tombstone_retention_days*86400000}}:{})}};
  }
  if(typeof config.context!=='object')throw Error('Host context object required');
 }catch(e){configurationFailure=e.code??e.message;}
 const context=configurationFailure?fallback:(config?.context??fallback);
 return {context,home:configurationFailure?null:(config?.home??null),toolsRoot:configurationFailure?path.resolve(root,'../tools'):(config?.tools_root??path.resolve(root,'../tools')),configurationFailure,scope:config&&!configurationFailure?'configured_host_task':'ephemeral_per_command_no_analysis_policy'};
}
export function reconcileHostContext(prior,binding){
 if(!prior)return binding.context;
 const context=structuredClone(prior);
 if(binding.configurationFailure){context.policy={...context.policy,analysis_allowed:false};return context;}
 if(binding.scope!=='configured_host_task')return context;
 const current=binding.context;
 if(!['host','library_id','view'].every(k=>context[k]===current[k])){context.policy={...context.policy,analysis_allowed:false};return context;}
 if(current.enabled===false)context.enabled=false;
 if(current.retention)context.retention=current.retention;
 if(current.policy?.analysis_allowed!==true||current.policy?.temporary!==false||current.policy?.retention_confirmed!==true||current.policy?.version!==context.policy?.version){context.policy={...context.policy,analysis_allowed:false};}
 if(Number.isFinite(Date.parse(current.expires_at))&&Date.parse(context.expires_at)>Date.parse(current.expires_at))context.expires_at=current.expires_at;
 return context;
}
export async function runCliLookup(callback,{root=knowledgeRoot,entry='query_cli',purpose='lookup',contextFile=process.env.KNOWLEDGE_LOOKUP_CONTEXT,terms=[]}={}){
 const binding=localHostContext({root,entry,purpose,contextFile});const {context,home,toolsRoot,configurationFailure}=binding;
 let lookup;
 try{lookup=await createKnowledgeLookup({context,home,toolsRoot});}
 catch(e){lookup=unavailable(context,e.code??e.message);}
 const related=lookup.pending({terms,limit:5});
 const result=await runKnowledgeLookup(lookup,callback);
 const full=lookup.finish({outcome:result.status??'completed',defer:true});
 const completion=Object.fromEntries(['compounding_status','assessment','continuation','observations','persisted','reason','pending_ref'].filter(k=>full[k]!==undefined).map(k=>[k,full[k]]));
 return {...result,compounding:{...result.compounding,completion,...(related.length?{related_increments:related}:{}),...(configurationFailure?{configuration_failure:configurationFailure}:{}),scope:binding.scope}};
}
export function renderCliResult(result){
 const {compounding,...body}=result;
 if(!compounding)return JSON.stringify(body,null,2);
 const base=Object.keys(body).length?JSON.stringify(body,null,2).slice(0,-2)+',':'{';
 return base+'\n  "compounding": '+JSON.stringify(compounding)+'\n}';
}
export function observeDirectRead(lookup,{root=knowledgeRoot,relative,entry='direct_read',stage='read',operation='direct_read'}={}){
 if(!['read','used','technical'].includes(stage))throw Error('Direct consumption must be explicitly asserted by its caller');
 if(typeof relative!=='string'||path.isAbsolute(relative)||relative.includes('\0'))throw Error('Knowledge-relative path required');
 const base=fs.realpathSync(root),full=fs.realpathSync(path.resolve(base,relative)),rel=path.relative(base,full);
 if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw Error('Source path escapes Knowledge');
 const parts=rel.replaceAll('\\','/').split('/');
 if(!['wiki','raw-sources','domains','Clippings'].includes(parts[0]))throw Error('Not a Knowledge content path');
 const version=crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
 const kind={wiki:'wiki','raw-sources':'raw',domains:'domain',Clippings:'clipping'}[parts[0]],name=parts.slice(1).join('/').replace(/\.md$/,'');
 const ref='knowledge:'+kind+':'+name;
 lookup.observe({entry,operation,status:'caller_asserted_consumption',source:{ref,version,stage}});
 return {source_ref:ref,source_sha256:version,stage,claim_support:'not_verified',observer:'explicit_current_agent_assertion',writes:false};
}
