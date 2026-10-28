/** Common host entry for real Query, direct/cached reads, consumption and feedback. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const workspace=path.resolve(import.meta.dirname,'../..');
export async function execute(packet,options={}){
 let {knowledgeRoot=workspace,toolsRoot=path.resolve(workspace,'../tools'),moduleRoot=knowledgeRoot,home=null}=options;
 const {operation,input={}}=packet;
 const adapter=await import(pathToFileURL(path.join(moduleRoot,'system/integrations/knowledge-feedback.mjs')));
 const given=packet.context??packet.continuation;
 const binding=adapter.localHostContext({root:knowledgeRoot,entry:packet.entry??'query_api',purpose:packet.purpose??'lookup',lookupId:packet.lookup_id??null,requestRef:packet.request_ref??null});
 const context=adapter.reconcileHostContext(given,binding);
 if(!Object.hasOwn(options,'home')&&binding.home)home=binding.home;
 if(!Object.hasOwn(options,'toolsRoot')&&binding.scope==='configured_host_task'&&binding.toolsRoot)toolsRoot=binding.toolsRoot;
 const lookup=await adapter.createKnowledgeLookup({context,home,toolsRoot});
 if(operation==='pending')return {status:'selected',issues:lookup.pending({terms:packet.terms??[],limit:packet.limit??5}),compounding:lookup.finish({defer:true}),writes:false};
 if(operation==='finish'){
  const qualified=lookup.finish({defer:true});
  if(['excluded','disabled','unavailable'].includes(qualified.compounding_status))return qualified;
  for(const event of packet.observations??[])lookup.observe(event);
  let records={signals:packet.signals??[],issues:packet.issues??[],outcomes:packet.outcomes??[]};
  if(packet.finding){const {recordsForFinding}=await import(pathToFileURL(path.join(toolsRoot,'integrations/knowledge-feedback/host.mjs')));records=recordsForFinding(context,packet.observations??[],packet.finding);}
  return lookup.finish({...records,outcome:packet.outcome??'completed',usage:packet.usage??null});
 }
 if(context?.knowledge_allowed===false)return {status:'disabled',reason:'Knowledge disabled by task',compounding:lookup.finish({outcome:'disabled'}),writes:false};
 let result;
 if(operation==='confirm_read')result=adapter.observeDirectRead(lookup,{root:knowledgeRoot,relative:packet.relative,entry:context.entry,stage:packet.stage??'read'});
 else if(operation==='observe_cache'){
  if(typeof input.ref!=='string'||typeof input.version!=='string')throw Error('Actual cache source and version required');
  lookup.observe({entry:'rag_cache',operation:'cache_return',status:'cached_version',source:{ref:input.ref,version:input.version,stage:'returned'}});
  result={status:'observed_cache',source_ref:input.ref,source_version:input.version,version_scope:'actual_cache_not_assumed_current',writes:false};
 }else if(operation==='principles'){
  const provider=await import(pathToFileURL(path.join(moduleRoot,'system/integrations/query-principles.mjs')));
  result=adapter.runKnowledgeLookup(lookup,()=>provider.queryPrinciples(input,knowledgeRoot));
 }else{
  let query=await import(pathToFileURL(path.join(moduleRoot,'system/query/query-evidence.mjs')));
  const researchRef=ref=>typeof ref==='string'&&ref.startsWith('knowledge:research:');
  const hasResearchEvidence=researchRef(input.ref)||researchRef(input.receipt?.ref)||(Array.isArray(input.receipts)&&input.receipts.some(r=>researchRef(r?.ref)));
  const needsResearch=packet.research===true||hasResearchEvidence;
  if(needsResearch){
   try{
    const provider=await import(pathToFileURL(path.join(moduleRoot,'system/integrations/research-reports-host.mjs')));
    query=provider.createLocalResearchHost({...provider.localResearchOptions(knowledgeRoot),...(options.researchOptions??{})});
   }catch(e){
    if(!hasResearchEvidence){
     const nativeActions={discover:query.discover,read:query.readSource,reuse:query.reuseSource,verify:query.verifyEvidence,review:query.reviewAnswer,assemble:query.assembleResult};
     if(!nativeActions[operation])throw Error('Unknown host operation');
     const ordinary=adapter.runKnowledgeLookup(lookup,()=>nativeActions[operation](input,knowledgeRoot));
     return {...ordinary,research:{status:'unavailable',reason:e.code??e.message},compounding:{...(ordinary.compounding??{}),completion:lookup.finish({defer:true})}};
    }
    return {status:'unavailable',reason:'research_provider_unavailable',detail:e.code??e.message,writes:false,compounding:{completion:lookup.finish({defer:true})}};
   }
  }
  const actions={discover:query.discover,read:query.readSource,reuse:query.reuseSource,verify:query.verifyEvidence,review:query.reviewAnswer,assemble:query.assembleResult};
  if(!Object.hasOwn(actions,operation))throw Error('Unknown host operation');
  result=adapter.runKnowledgeLookup(lookup,()=>actions[operation](input,knowledgeRoot));
 }
 return {...result,compounding:{...(result.compounding??{}),completion:lookup.finish({outcome:result.status??'completed',defer:true})}};
}
export async function main(argv=process.argv.slice(2)){
 if(!argv.length||argv[0]==='--help'){
  const help={usage:'node system/integrations/lookup-host.mjs <host-packet.json|-> [--knowledge-root ...] [--tools-root ...] [--home ...]',operations:['discover','read','reuse','verify','review','assemble','principles','confirm_read','observe_cache','pending','finish'],read_packet:{operation:'read',entry:'research',purpose:'research',input:{request:'original Query request',ref:'actual Knowledge ref',selection:{mode:'full'}}},finish_packet:{operation:'finish',continuation:'copy actual producer completion.continuation',observations:'copy actual producer observations',finding:{id:'stable finding name',kind:'answer_omission',summary:'actual bounded observation; not a fabricated source claim',consumption:[{ref:'actually observed ref',stage:'read'}],issue:'optional original owner/handoff/action/evidence',increment:'optional condition/basis/consumer fields'}},no_increment:'No new record or per-query report required; explicit finish without finding returns no_increment.',side_effects:'Reads remain read-only. Only eligible host finish/control persists private state. No model/network/scheduler.'};console.log(JSON.stringify(help,null,2));return help;
 }
 const [file,...args]=argv;const options={};
 for(let i=0;i<args.length;i++){
  const key={'--knowledge-root':'knowledgeRoot','--tools-root':'toolsRoot','--module-root':'moduleRoot','--home':'home'}[args[i]];
  if(!key||!args[i+1])throw Error('Unknown or incomplete option');options[key]=path.resolve(args[++i]);
 }
 const packet=JSON.parse(fs.readFileSync(file==='-'?0:file,'utf8').replace(/^\uFEFF/,''));
 const result=await execute(packet,options);console.log(JSON.stringify(result,null,2));
 if(['denied','invalid','invalid_request','invalid_evidence','answer_revision_required'].includes(result.status))process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await main();}catch(e){console.error(JSON.stringify({status:'rejected',reason:e.message}));process.exitCode=2;}}
