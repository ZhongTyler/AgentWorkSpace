import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
// This provider is also consumed as a standalone file; feedback remains optional.
let observeLookup=(operation,result)=>({...result,compounding:{operation,status:'unavailable',reason:'optional_lookup_adapter_missing',persisted:false}});
let runCliLookup=async callback=>{const result=await callback();return {...result,compounding:{...result.compounding,completion:{compounding_status:'unavailable',persisted:false}}};};
let renderCliResult=result=>JSON.stringify(result,null,2);
try{({observeLookup}=await import('../query/lookup-context.mjs'));}catch{}
try{({runCliLookup,renderCliResult}=await import('./knowledge-feedback.mjs'));}catch{}
export const knowledgeRoot=path.resolve(import.meta.dirname,'../..');
/** Stable domain codes may contain hyphens; this is an identifier, never a path. */
export const isPrincipleId=value=>typeof value==='string'&&value===value.trim()&&/^DPR-[A-Z]+(?:-[A-Z]+)*-\d+$/.test(value);
export const principleIdsFromText=text=>[...text.matchAll(/<!--\s*principle_id:\s*(.*?)\s*-->/g)].map(match=>match[1]).filter(isPrincipleId);
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function safe(root,rel){
 const base=fs.realpathSync(root),filename=fs.realpathSync(path.resolve(root,rel)),r=path.relative(base,filename);
 if(path.isAbsolute(r)||r==='..'||r.startsWith('..'+path.sep))throw new Error('Source path escapes Knowledge');
 return filename;
}
export function listDomains(root=knowledgeRoot){
 return fs.readdirSync(safe(root,'domains')).filter(n=>n.endsWith('.md')&&n!=='README.md'&&!n.endsWith('.template.md')).sort().map(n=>n.slice(0,-3));
}
function readDomainImpl(domain,root=knowledgeRoot){
 if(typeof domain!=='string'||/[\\/:]/.test(domain)||['.','..'].includes(domain))throw new Error('Invalid domain name');
 const p=safe(root,'domains/'+domain+'.md'),body=fs.readFileSync(p,'utf8');
 const section=body.split(/^## 领域设计原则\s*$/m)[1]??'';
 const blocks=section.split(/(?=^\d+\.\s+\*\*)/m),items=[];
 for(const b of blocks){
  const id=principleIdsFromText(b)[0];if(!id)continue;
  const content=b.split(/^###?\s/m)[0].trim();
  const sources=[...content.matchAll(/\[[^\]]+\]\(<?(\.\.\/wiki\/[^)>]+|https:\/\/[^)>]+)>?\)/g)].map(m=>m[1]);
  const normalized=content.replace(/<!--[^]*?-->/g,'').replace(/\s+/g,' ').trim();
  items.push({id,ref:'knowledge:principle:'+id,domain,content,semantic_candidate_sha256:hash(normalized),sources,source_ref:'knowledge:domain:'+domain,source_path:'domains/'+domain+'.md',source_sha256:hash(body),applicability:'requires_task_review',claim_support:'not_verified'});
 }
 const seen=new Set();for(const p of items){if(seen.has(p.id))throw new Error('Duplicate principle ID');seen.add(p.id);}
 return {domain,source_sha256:hash(body),principles:items};
}
function queryPrinciplesImpl({domains=[],ids=[],query=''}={},root=knowledgeRoot){
 if(!Array.isArray(domains)||!Array.isArray(ids)||typeof query!=='string'||[...domains,...ids].some(s=>typeof s!=='string'))throw new Error('Invalid principle query');
 if(ids.some(id=>!isPrincipleId(id)))throw new Error('Invalid principle ID');
 if(!domains.length&&!ids.length)return {principles:[],reason:'No domain or ID selected; ordinary Query need not load principles',writes:false};
 const all=(domains.length?domains:listDomains(root)).flatMap(d=>readDomain(d,root).principles);
 if(new Set(all.map(p=>p.id)).size!==all.length)throw new Error('Duplicate principle IDs across domains');
 const missing=ids.filter(id=>!all.some(p=>p.id===id));if(missing.length)return {principles:[],status:'unavailable',missing,writes:false};
 const tokens=query.split(/[\s,，、]+/u).filter(Boolean);
 return {principles:all.filter(p=>(!ids.length||ids.includes(p.id))&&(!tokens.length||tokens.some(t=>p.content.includes(t)))),writes:false,claim:'Candidates only; read conditions and cited Wiki, trace raw for important claims under Query policy'};
}
export function readDomain(domain,root=knowledgeRoot){return observeLookup('readDomain',readDomainImpl(domain,root),{entry:'principles'});}
export function queryPrinciples(input={},root=knowledgeRoot){return observeLookup('principles',queryPrinciplesImpl(input,root),{entry:'principles'});}
async function main(){
 const [action,arg]=process.argv.slice(2);
 let invoke;
 if(action==='list')invoke=()=>observeLookup('listDomains',{domains:listDomains(),writes:false},{entry:'principles'});
 if(action==='get')invoke=()=>queryPrinciples({ids:[arg.replace(/^knowledge:principle:/,'')]});
 if(action==='query')invoke=()=>queryPrinciples(JSON.parse(fs.readFileSync(arg,'utf8')));
 if(invoke){console.log(renderCliResult(await runCliLookup(invoke,{entry:'principles'})));return;}
 throw new Error('Usage: query-principles.mjs list | get <DPR-ID|knowledge:principle:ID> | query <json>');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await main();}catch(e){console.error(e.message);process.exitCode=2;}}
