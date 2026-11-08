/** Read-only verification of the normal installer's flat mechanical runtime. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const assert=(condition,message)=>{if(!condition)throw Error(message);};
const entries=['runner.mjs','health.mjs','query-package-local.mjs','query-package.mjs'];
const dynamicLocal={'runner.mjs':['publication-maintenance.mjs'],'query-package-sync.mjs':['query-package-local.mjs','query-package.mjs']};
const toolsFiles=['core.mjs','store.mjs','host.mjs'];

export async function verifyRuntimeClosure({sourceRoot,files,toolsRoot,layout='source'}){
 assert(path.isAbsolute(sourceRoot)&&path.isAbsolute(toolsRoot)&&Array.isArray(files)&&files.length>0,'Explicit runtime roots and files required');
 assert(['source','installed'].includes(layout),'Unknown runtime layout');
 const sources=new Map(),edges=[];
 for(const relative of files){
  assert(/^system\/(sync|integrations)\/[a-z-]+\.(mjs|ps1)$/.test(relative),'Invalid runtime source path');
  const installed=path.posix.basename(relative),file=layout==='installed'?path.join(sourceRoot,installed):path.join(sourceRoot,...relative.split('/'));
  assert(!sources.has(installed),'Ambiguous flat runtime name');
  const stat=fs.lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink(),'Runtime source must be a regular file');
  const bytes=fs.readFileSync(file);
  sources.set(installed,{source:relative,installed,sha256:hash(bytes),body:bytes.toString('utf8'),file});
 }
 const add=(from,to,kind)=>{
  assert(sources.has(to),'Missing installed dependency '+from+' -> '+to);
  edges.push({from,to,kind});
 };
 for(const [name,source] of sources){
  if(!name.endsWith('.mjs'))continue;
  const imports=source.body.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g);
  for(const match of imports){
   const specifier=match[1];if(specifier.startsWith('node:'))continue;
   assert(specifier.startsWith('./'),'Unexpected mechanical module reference '+specifier);
   add(name,path.posix.normalize(specifier),'relative_import');
  }
 }
 for(const [from,dependencies] of Object.entries(dynamicLocal))for(const to of dependencies)add(from,to,'fixed_dynamic_import');
 for(const entry of entries)assert(sources.has(entry),'Missing mechanical entry '+entry);
 const tools=[];
 for(const name of toolsFiles){
  const file=path.join(toolsRoot,'integrations/knowledge-feedback',name),bytes=fs.readFileSync(file);
  tools.push({source:'integrations/knowledge-feedback/'+name,sha256:hash(bytes),integrity:name==='host.mjs'?'observed_current_owner_module':'verified_by_original_core_pin'});
 }
 // Importing these modules has no job execution or persistence side effects.
 // Check the original external Core pins as an actual runtime consumer too.
 for(const entry of entries)await import(pathToFileURL(sources.get(entry).file));
 const {coreStoreFactory}=await import(pathToFileURL(sources.get('clients.mjs').file));
 await coreStoreFactory(toolsRoot);
 for(const name of toolsFiles)await import(pathToFileURL(path.join(toolsRoot,'integrations/knowledge-feedback',name)));
 return {layout,files:[...sources.values()].map(({body,file,...source})=>source),entries,edges,externalTools:tools,importsVerified:true,writes:0};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{console.log(JSON.stringify(await verifyRuntimeClosure(JSON.parse(fs.readFileSync(0,'utf8')))));}
 catch(error){console.error(JSON.stringify({status:'invalid_runtime_closure',reason:error.message,writes:0}));process.exitCode=1;}
}
