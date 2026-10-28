import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {VERSION,initialState} from './core.mjs';
import {FileStore} from './store.mjs';
import {createLookup,ENTRIES} from './host.mjs';
export function execute(action,input={},options={}){
 if(action==='health')return {core:VERSION,status:'available',entries:ENTRIES,collection_enabled_by_health:false,model_calls:0,writes:false,semantic_effect:'not_measured'};
 const {context}=input;if(!context)throw Error('Explicit host context required');
 initialState(context);
 if(!options.home&&action!=='finish')return {status:'unavailable',reason:'host_private_home_required',writes:false};
 const store=options.home?new FileStore({home:path.resolve(options.home),namespace:context}):null;
 if(action==='finish'){
  const lookup=createLookup(context,{store});
  for(const event of input.observations??[])lookup.observe(event);
  return lookup.finish({signals:input.signals??[],issues:input.issues??[],outcomes:input.outcomes??[],outcome:input.outcome??'completed',usage:input.usage??null});
 }
 if(action==='select')return {status:'selected',issues:store.select({now:Date.now(),terms:input.terms??[],limit:input.limit??5}),writes:false};
 if(action==='status'){
  const state=store.read();return {core:VERSION,cursor:state.cursor,counts:Object.fromEntries(Object.entries(state.records).map(([t,rows])=>[t,Object.keys(rows).length])),tombstones:Object.keys(state.tombstones).length,writes:false};
 }
 if(action==='export')return store.export({now:Date.now(),exportAllowed:options.privateTransfer===true});
 if(action==='import')return store.import(input.package,{now:Date.now(),importAllowed:options.privateTransfer===true});
 if(action==='maintain'){
  if(context.policy?.retention_confirmed!==true)throw Error('Confirmed host retention required');
  return store.maintain({now:Date.now(),tombstone_retention_ms:input.tombstone_retention_ms});
 }
 throw Error('Unknown feedback action');
}
export function main(argv=process.argv.slice(2)){
 const [action,file,...args]=argv;
 if(!['health','finish','select','status','export','import','maintain'].includes(action))throw Error('Fixed feedback action required');
 const options={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--home'){if(!args[i+1])throw Error('Home required');options.home=args[++i];}
  else if(args[i]==='--allow-private-transfer')options.privateTransfer=true;
  else throw Error('Unknown option '+args[i]);
 }
 const input=action==='health'?{}:JSON.parse(fs.readFileSync(file==='-'?0:file,'utf8').replace(/^\uFEFF/,''));
 const result=execute(action,input,options);console.log(JSON.stringify(result,null,2));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{main();}catch(e){console.error(JSON.stringify({status:'rejected',reason:e.code??e.message,writes:'no successful transaction'}));process.exitCode=2;}}
