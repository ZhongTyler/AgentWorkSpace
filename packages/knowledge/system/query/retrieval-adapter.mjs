/** Thin consumer of Tools. Original Query owns navigation, source reading and evidence. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
// Classify only known, path-free backend messages; never return raw stderr/config.
function backendFailure(run) {
 let reason='backend_unavailable_or_stale',recovery='inspect_local_backend';
 if(run.error){reason=run.error.code==='ETIMEDOUT'?'backend_timeout':'backend_runtime_unavailable';recovery='repair_local_runtime';}
 else {
  let message;try{const out=JSON.parse(run.stdout);if(out.status==='unavailable')message=out.reason;}catch{}
  if(['source changed/missing; rebuild or fall back to Query','source inventory changed; rebuild a reviewed version or use original Query'].includes(message)){reason='backend_source_stale';recovery='refresh_reviewed_index';}
  else if(message==='pack changed; activate a complete verified version'){reason='backend_pack_changed';recovery='restore_or_rebuild_verified_index';}
  else if(['hybrid runtime unavailable','hybrid unavailable; select bm25 explicitly','pack has no vectors'].includes(message)){reason='backend_hybrid_unavailable';recovery='use_bm25_or_restore_hybrid';}
 }
 return Object.assign(new Error(reason),{backend_exit_code:run.status??null,recovery});
}
export function discoverWithRetrieval(input,root,{legacy,normalize}) {
 if(input.retrieval!==undefined&&(!input.retrieval||typeof input.retrieval!=='object'||Array.isArray(input.retrieval)))throw new Error('invalid retrieval options');
 const req=normalize(input),mode=input.retrieval?.mode??'bm25';
 if(!['bm25','hybrid','legacy'].includes(mode)||input.retrieval&&Object.keys(input.retrieval).some(k=>k!=='mode'))throw new Error('invalid retrieval mode');
 const base=legacy(input,root); // Preserve Domain/Group/principle/navigation behavior and fallback.
 if(mode==='legacy'||!req.sources.knowledge||!req.sources.wiki)return {...base,retrieval:{requested_mode:mode,used_mode:'legacy',reason:mode==='legacy'?'explicit_original_query':'source_disabled',model_loaded:false}};
 const configPath=process.env.KNOWLEDGE_RETRIEVAL_CONFIG??path.join(root,'system/query/retrieval.local.json');
 try {
  if(!fs.existsSync(configPath))return {...base,retrieval:{requested_mode:mode,used_mode:'legacy',reason:'optional_local_binding_absent',model_loaded:false}};
  const binding=JSON.parse(fs.readFileSync(configPath,'utf8')),folder=path.dirname(path.resolve(configPath));
  const resolve=value=>path.resolve(folder,value);
  if(binding.schema_version!==1||!binding.python||!binding.tools_root||!binding.runtime_config)throw new Error('invalid_binding');
  const tools=resolve(binding.tools_root),runtime=resolve(mode==='hybrid'?(binding.hybrid_runtime_config??binding.runtime_config):binding.runtime_config),cfg=JSON.parse(fs.readFileSync(runtime,'utf8'));
  if(!cfg.source_root||fs.realpathSync(path.resolve(path.dirname(runtime),cfg.source_root))!==fs.realpathSync(root))throw new Error('source_root_mismatch');
  const program=path.join(tools,'integrations/retrieval/cli.py');
  // Agent-selected search expressions keep task instructions out of lexical scoring.
  // The original need remains unchanged for reading, reuse and answer review.
  const focus=[...req.terms,...req.reformulations].filter(t=>t.trim()).slice(0,40),focused=focus.join(' '),useFocus=focused.length>0&&focused.length<=2000;
  const request={question:useFocus?focused:req.need.question,terms:[],limit:Math.min(100,Math.max(0,req.budget.max_candidates*4))};
  const run=spawnSync(mode==='hybrid'?(binding.hybrid_python??binding.python):binding.python,['-X','utf8','-B',program,'search','--config',runtime,'--mode',mode],{input:JSON.stringify(request),encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,windowsHide:true});
  if(run.error||run.status!==0)throw backendFailure(run);
  let found;try{found=JSON.parse(run.stdout);}catch{throw new Error('invalid_backend_output');}
  if(!Array.isArray(found.candidates)||found.used_mode!==mode)throw new Error('invalid_backend_output');
  const seen=new Set(),ranked=[];let returnedBytes=0,reads=0;
  // Explicit navigation retains precedence. Non-Wiki principle candidates remain eligible.
  const priority=base.candidates.filter(c=>c.discovery_signals?.some(s=>s==='explicit_path'||s.startsWith('group:')||s.startsWith('domain:'))||c.ref.startsWith('knowledge:principle:'));
  const push=c=>{if(!seen.has(c.ref)){seen.add(c.ref);ranked.push(c);}};priority.forEach(push);
  const wiki=fs.realpathSync(path.join(root,'wiki'));
  for(const c of found.candidates){
   if(typeof c.path!=='string'||!c.path.startsWith('wiki/')||!c.path.endsWith('.md')||c.path.split('/').includes('..'))throw new Error('backend_path_scope');
   const file=fs.realpathSync(path.join(root,c.path)),relative=path.relative(wiki,file);
   if(relative==='..'||relative.startsWith('..'+path.sep)||path.isAbsolute(relative))throw new Error('backend_path_scope');
   const expected='knowledge:wiki:'+c.path.slice(5,-3);if(c.source_id!==expected)throw new Error('backend_identity');
   const bytes=fs.readFileSync(file);reads++;returnedBytes+=bytes.length;
   if(hash(bytes)!==c.source_sha256)throw new Error('source_changed');
   const previous=base.candidates.find(p=>p.ref===c.source_id);
   push({...previous,ref:c.source_id,path:c.path,title:previous?.title??path.basename(c.path,'.md'),headings:previous?.headings??[],matched_terms:previous?.matched_terms??[],discovery_signals:[...(previous?.discovery_signals??[]),'retrieval:'+mode],source_sha256:c.source_sha256,status:'candidate_found',content_read:false,claim_support:'not_verified'});
  }
  base.candidates.forEach(push);const candidates=ranked.slice(0,req.budget.max_candidates);
  return {...base,status:candidates.length?'candidates_found':base.status,candidates,gaps:candidates.length?[]:base.gaps,stop_reason:candidates.length?'awaiting_semantic_selection':base.stop_reason,metrics:{...base.metrics,file_reads:base.metrics.file_reads+reads,bytes_read:base.metrics.bytes_read+returnedBytes,source_content_returns:0},retrieval:{requested_mode:mode,used_mode:mode,query_strategy:useFocus?'agent_terms':'question',core:'tools/retrieval-core-v1',snapshot_id:found.snapshot_id,source_commit:found.source_commit,index_documents:found.scope_documents,candidate_units:found.candidates.length,agent_content_read:false,model_loaded:mode==='hybrid',validation_note:'Backend validates allowed snapshot sources; candidate verification adds the recorded Node file reads. Neither is Agent full reading.'}};
 } catch(e) {
  // An index/model/config failure cannot remove the original navigation or widen source access.
  return {...base,retrieval:{requested_mode:mode,used_mode:'legacy',reason:String(e.code??e.message),model_loaded:mode==='bm25'?false:'unknown_after_failed_backend',...(e.recovery?{backend_exit_code:e.backend_exit_code,recovery:e.recovery}:{}),fallback:'original Query; no automatic rebuild or external provider'}};
 }
}
