/** Read-only Knowledge discovery and evidence transport. Semantic judgments belong to the caller. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {queryPrinciples} from '../integrations/query-principles.mjs';
import {discoverWithRetrieval} from './retrieval-adapter.mjs';
export const defaultRoot = path.resolve(import.meta.dirname, '../..');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const slash = value => value.replaceAll('\\', '/');
const failure = (status, reason, extra={}) => ({schema_version:1,status,reason,writes:false,claim_support:'not_verified',...extra});
const groupsOfSynonyms = [ ['回血','生命恢复','生命回复','治疗'], ['反馈','表现','反馈系统','视听反馈'], ['紧张感','压力','资源压力'], ['脑暴','头脑风暴','创意发散'], ['留存','持续参与','重复游玩'], ['奖励','回报','激励'], ['新手','教学','引导'], ['战斗','作战','交战'] ];
function inside(root, full) { const rel=path.relative(root,full); return rel!== '..'&&!rel.startsWith('..'+path.sep)&&!path.isAbsolute(rel); }
function safe(root, relative) {
  if(typeof relative!=='string'||!relative||relative.includes('\0')||path.isAbsolute(relative)||/^[a-z]:/i.test(relative)) throw new Error('path_outside_root');
  const base=fs.realpathSync(root), lexical=path.resolve(base,relative);
  if(!inside(base,lexical)) throw new Error('path_outside_root');
  const real=fs.realpathSync(lexical);
  if(!inside(base,real)) throw new Error('path_outside_root');
  return real;
}
function classify(ref) {
  if(typeof ref!=='string') throw new Error('invalid_ref');
  if(/^knowledge:principle:DPR-[A-Z]+-\d+$/.test(ref)||/^DPR-[A-Z]+-\d+$/.test(ref))return {kind:'principle',ref:ref.replace(/^knowledge:principle:/,''),relative:null};
  let relative=ref;
  const stable=/^knowledge:(wiki|raw|domain|clipping):(.+)$/.exec(ref);
  if(stable)relative=({wiki:'wiki',raw:'raw-sources',domain:'domains',clipping:'Clippings'}[stable[1]])+'/'+stable[2]+(/\.[a-z0-9]+$/i.test(stable[2])?'':'.md');
  relative=slash(relative);
  const kind=({'wiki':'wiki','raw-sources':'raw','domains':'domain','Clippings':'clipping'})[relative.split('/')[0]];
  if(!kind||relative.split('/').includes('..')||/\/(README\.md|[^/]+\.template\.md)$/i.test(relative))throw new Error('source_scope_denied');
  return {kind,relative,ref:stable?ref:`knowledge:${kind}:${relative.split('/').slice(1).join('/').replace(/\.md$/,'')}`};
}
export function normalizeRequest(input={}) {
  if(input.schema_version!==undefined&&input.schema_version!==1)throw new Error('unsupported request schema_version');
  const need=input.need??{};
  if(typeof need.question!=='string'||!need.question.trim())throw new Error('need.question is required');
  const kind=need.kind??'understanding';
  if(!['fact','understanding','diagnosis','comparison','survey'].includes(kind))throw new Error('invalid need.kind');
  for(const key of ['object','scope'])if(need[key]!==undefined&&typeof need[key]!=='string')throw new Error(`invalid need.${key}`);
  if(need.critical_questions!==undefined&&(!Array.isArray(need.critical_questions)||need.critical_questions.some(q=>typeof q!=='string')))throw new Error('invalid critical_questions');
  const defaults={fact:4,understanding:6,diagnosis:10,comparison:10,survey:18};
  const budget={max_sources:defaults[kind],max_candidates:18,max_body_files:24,max_content_chars:120000,...input.budget};
  for(const [k,v] of Object.entries(budget))if(!['max_sources','max_candidates','max_body_files','max_content_chars'].includes(k)||!Number.isSafeInteger(v)||v<0)throw new Error(`invalid budget.${k}`);
  const sources={knowledge:true,wiki:true,raw:true,domain:true,principle:true,clipping:true,...input.sources};
  for(const [k,v] of Object.entries(sources))if(!['knowledge','wiki','raw','domain','principle','clipping'].includes(k)||typeof v!=='boolean')throw new Error(`invalid sources.${k}`);
  const list=(key)=>{const v=input[key]??[];if(!Array.isArray(v)||v.some(x=>typeof x!=='string'||!x.trim()))throw new Error(`invalid ${key}`);return [...new Set(v)];};
  const normalized={schema_version:1,need:{kind,question:need.question,object:need.object??'',scope:need.scope??'',critical_questions:need.critical_questions??[]},sources,budget,terms:list('terms'),reformulations:list('reformulations'),domains:list('domains'),groups:list('groups'),principle_ids:list('principle_ids'),paths:list('paths'),related_from:list('related_from')};
  return {...normalized,context_sha256:hash(JSON.stringify(normalized.need))};
}
function allowed(req,kind){return req.sources.knowledge&&req.sources[kind]!==false;}
function field(text,key){return new RegExp('^'+key+':\\s*([^\\r\\n]+)','m').exec(text)?.[1].trim().replace(/^['"]|['"]$/g,'')??'';}
function listField(text,key){const v=field(text,key);return v.startsWith('[')?v.slice(1,-1).split(',').map(v=>v.trim().replace(/^['"]|['"]$/g,'')).filter(Boolean):[];}
function headings(text){
 const result=[],lines=text.split('\n');let fence=null;
 for(let i=0;i<lines.length;i++){const line=lines[i].replace(/\r$/,'');const f=/^\s{0,3}(`{3,}|~{3,})/.exec(line);if(f){if(!fence)fence=f[1][0];else if(f[1][0]===fence)fence=null;continue;}if(fence)continue;const m=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);if(m)result.push({level:m[1].length,title:m[2],line:i+1});}
 return result;
}
function termsFor(req){
 const initial=[req.need.question,...req.terms,...req.reformulations].flatMap(t=>t.toLowerCase().split(/[\s，。？！?！,;；、:：]+/u)).filter(t=>t.length>1);
 // Explicit synonyms are discovery hints, never substitutions in an answer.
 for(const group of groupsOfSynonyms)if(initial.some(t=>group.some(s=>t.includes(s))))initial.push(...group);
 for(const t of [...initial]){const stripped=t.replace(/^(为什么|如何|怎么|什么是|请解释|查找|关于)/,'').replace(/(是什么|的机制|有什么|如何设计|怎么设计)$/,'');if(stripped.length>1)initial.push(stripped);}
 return [...new Set(initial)].slice(0,40);
}
function links(text,base){return [...text.matchAll(/\[[^\]]*\]\(<?([^\s)>]+)(?:\s+"[^"]*")?>?\)/g)].map(m=>m[1]).filter(x=>!/^\w+:/.test(x)).map(x=>{try{return slash(path.posix.normalize(path.posix.join(path.posix.dirname(base),decodeURIComponent(x.split('#')[0]))));}catch{return '';}}).filter(x=>x.startsWith('wiki/')&&x.endsWith('.md'));}
function listFiles(root,folder,errors){
 const result=[];let full;
 try{full=safe(root,folder);}catch(e){if(e.code!=='ENOENT')errors.push({path:folder,reason:e.code??e.message});return result;}
 const visit=(dir)=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en'))){const relative=slash(path.relative(fs.realpathSync(root),path.join(dir,entry.name)));try{const actual=safe(root,relative);if(entry.isSymbolicLink()){errors.push({path:relative,reason:'linked_discovery_entry_skipped'});continue;}if(entry.isDirectory())visit(actual);else if(entry.isFile()&&entry.name.endsWith('.md')&&!/^(README\.md|.*\.template\.md)$/i.test(entry.name))result.push(relative);}catch(e){errors.push({path:relative,reason:e.code??e.message});}}};
 visit(full);return result;
}
export function discover(input,root=defaultRoot){return discoverWithRetrieval(input,root,{legacy:discoverLegacy,normalize:normalizeRequest});}
export function discoverLegacy(input,root=defaultRoot){
 const req=normalizeRequest(input);if(!req.sources.knowledge)return failure('disabled','Knowledge disabled',{need:req.need,candidates:[],metrics:{file_reads:0,bytes_read:0}});
 const errors=[],reads=new Map(),terms=termsFor(req),signals=new Map();
 const load=relative=>{if(!reads.has(relative)){const bytes=fs.readFileSync(safe(root,relative));reads.set(relative,bytes);}return reads.get(relative).toString('utf8');};
 const signal=(p,why)=>{try{const item=classify(p);if(item.kind!=='wiki')return;p=item.relative;}catch{return;}signals.set(p,[...(signals.get(p)??[]),why]);};
 // Navigation is bounded and selective; it never turns a candidate into a read receipt.
 for(const p of req.paths)signal(p,'explicit_path');
 for(const d of req.domains){if(!allowed(req,'domain'))break;if(!/^[^\\/:]+$/.test(d))throw new Error('invalid domain');try{for(const p of links(load('domains/'+d+'.md'),'domains/'+d+'.md'))signal(p,'domain:'+d);}catch(e){errors.push({path:'domains/'+d+'.md',reason:e.code??e.message});}}
 for(const start of req.related_from){if(!allowed(req,'wiki'))break;try{const item=classify(start);if(item.kind!=='wiki')throw new Error('related_from requires Wiki');const text=load(item.relative);const hs=headings(text);const section=hs.find(h=>h.title==='相关页面');if(section){const next=hs.find(h=>h.line>section.line&&h.level<=section.level);const end=next?next.line-1:undefined;for(const p of links(text.split('\n').slice(section.line,end).join('\n'),item.relative))signal(p,'related:'+item.relative);}}catch(e){errors.push({path:start,reason:e.code??e.message});}}
 const groupSignals=[];
 if(req.groups.length&&allowed(req,'wiki'))for(const file of listFiles(root,'groups',errors)){const text=load(file);const id=field(text,'id');const match=req.groups.some(g=>[id,field(text,'name'),...listField(text,'aliases')].includes(g));if(!match)continue;const active=field(text,'status')==='active'&&field(text,'approval_status')==='approved';groupSignals.push({id,path:file,status:active?'active':'unavailable'});if(active)signals.set('@group:'+id,[]);}
 if(allowed(req,'wiki'))for(const nav of ['system/registry/quick-reference.md','system/registry/index.md']){try{const text=load(nav);for(const line of text.split('\n'))if(terms.some(t=>line.toLowerCase().includes(t)))for(const p of links(line,nav))signal(p,'index');}catch(e){if(e.code!=='ENOENT')errors.push({path:nav,reason:e.code??e.message});}}
 const catalog=[];
 if(allowed(req,'wiki'))for(const relative of listFiles(root,'wiki',errors)){try{const text=load(relative),hs=headings(text);const meta=[relative,field(text,'aliases'),...hs.map(h=>h.title)].join(' ').toLowerCase();for(const g of listField(text,'groups'))if(signals.has('@group:'+g))signal(relative,'group:'+g);const matched=terms.filter(t=>meta.includes(t));catalog.push({relative,text,headings:hs,matched,score:matched.length*3+(signals.has(relative)?2:0),signals:signals.get(relative)??[]});}catch(e){errors.push({path:relative,reason:e.code??e.message});}}
 // Search at most the declared body budget when metadata does not match or caller requests alternate expressions.
 let bodySearched=0;const bodyNeeded=!catalog.some(c=>c.score>0)||req.reformulations.length>0;
 if(bodyNeeded)for(const c of [...catalog].sort((a,b)=>Number(signals.has(b.relative))-Number(signals.has(a.relative))||a.relative.localeCompare(b.relative,'en')).slice(0,req.budget.max_body_files)){bodySearched++;const m=terms.filter(t=>c.text.toLowerCase().includes(t));if(m.length){c.score+=m.length;c.matched=[...new Set([...c.matched,...m])];c.signals.push('bounded_body');}}
 let candidates=catalog.filter(c=>c.score>0).sort((a,b)=>b.score-a.score||a.relative.localeCompare(b.relative,'en')).map(c=>({ref:classify(c.relative).ref,path:c.relative,title:c.headings[0]?.title??path.basename(c.relative),headings:c.headings,matched_terms:c.matched,discovery_signals:c.signals,source_sha256:hash(reads.get(c.relative)),status:'candidate_found',content_read:false,claim_support:'not_verified'}));
 if(req.principle_ids.length&&allowed(req,'principle')&&allowed(req,'domain')){try{const found=queryPrinciples({ids:req.principle_ids,domains:req.domains},root);for(const p of found.principles??[])candidates.push({ref:p.ref,path:p.source_path,title:p.id,source_sha256:p.source_sha256,status:'candidate_found',content_read:false,claim_support:'not_verified'});if(found.status==='unavailable')errors.push({path:'principles',reason:'unavailable',missing:found.missing});}catch(e){errors.push({path:'principles',reason:e.code??e.message});}}
 const total=candidates.length;candidates=candidates.slice(0,req.budget.max_candidates);
 return {schema_version:1,status:candidates.length?'candidates_found':total?'budget_exhausted':'no_relevant_source',need:req.need,request:req,terms,candidates,group_signals:groupSignals,gaps:candidates.length?[]:[total?'Relevant candidates exist but the candidate return budget is exhausted.':'No relevant candidate found within the explored navigation and body scope; corpus-wide absence is not established.'],stop_reason:total>candidates.length?'candidate_budget_exhausted':candidates.length?'awaiting_semantic_selection':'bounded_discovery_exhausted',discovery_scope:{wiki_metadata_files:catalog.length,body_files:bodySearched,body_files_unsearched:bodyNeeded?Math.max(0,catalog.length-bodySearched):catalog.length,candidates_not_returned:total-candidates.length},unavailable:errors,metrics:{file_reads:reads.size,bytes_read:[...reads.values()].reduce((n,b)=>n+b.length,0),source_content_returns:0},writes:false,claim_support:'not_verified'};
}
function contentSource(item,root){
 if(item.kind==='principle'){const result=queryPrinciples({ids:[item.ref]},root);const p=result.principles?.[0];if(!p)throw new Error('principle_unavailable');const bytes=fs.readFileSync(safe(root,p.source_path));const text=bytes.toString('utf8');const start=text.indexOf(p.content);if(start<0)throw new Error('principle_location_unavailable');return {relative:p.source_path,bytes,text:p.content,fullText:text,lineOffset:text.slice(0,start).split('\n').length-1,sourceIdentity:p.source_ref,ref:p.ref};}
 const resolved=safe(root,item.relative);const sourceBase=fs.realpathSync(path.join(root,item.relative.split('/')[0]));if(!inside(sourceBase,resolved))throw new Error('source_scope_denied');const bytes=fs.readFileSync(resolved);if(!/\.(md|txt)$/i.test(item.relative))throw new Error('media_unreadable');const text=bytes.toString('utf8');return {relative:item.relative,bytes,text,fullText:text,lineOffset:0,sourceIdentity:item.ref,ref:item.ref};
}
function extract(source,selection,req){
 const mode=selection.mode??'full';const lines=source.text.split('\n');let start=1,end=lines.length,heading=null;
 if(mode==='section'){
  if(!['supplement','independent_fact','context_already_read'].includes(selection.reason))throw new Error('section_requires_scope_reason');
  if(req.need.kind!=='fact'&&selection.role!=='supplement'&&selection.reason!=='context_already_read')throw new Error('core_requires_full_read');
  const hs=headings(source.text);const found=hs.filter(h=>h.title===selection.heading);
  if(found.length!==1)throw new Error(found.length?'ambiguous_heading':'anchor_missing');
  heading=found[0];start=heading.line;end=hs.find(h=>h.line>start&&h.level<=heading.level)?.line-1||lines.length;
 }else if(mode!=='full')throw new Error('invalid_read_mode');
 return {content:lines.slice(start-1,end).join('\n'),range:{mode,heading:heading?.title??null,start_line:start+source.lineOffset,end_line:end+source.lineOffset,complete_unit:true,complete_source:mode==='full'&&source.lineOffset===0,scope_reason:selection.reason??'core_full_read',role:selection.role??'core'},selection:{mode,...(mode==='section'?{heading:selection.heading,reason:selection.reason,role:selection.role}: {})}};
}
export function readSource(input,root=defaultRoot){
 const req=normalizeRequest(input.request??input);let item;
 try{item=classify(input.ref);if(!allowed(req,item.kind)||(item.kind==='principle'&&!allowed(req,'domain')))return failure('disabled','Source kind disabled',{ref:input.ref});const source=contentSource(item,root);const unit=extract(source,input.selection??{},req);
 if(req.budget.max_sources===0||unit.content.length>req.budget.max_content_chars)return failure('budget_exhausted','Complete semantic unit exceeds available budget; no content was truncated',{ref:input.ref,required_chars:unit.content.length});
 const hs=headings(source.fullText);return {schema_version:1,status:'source_read',ref:source.ref,source_kind:item.kind,path:source.relative,source_sha256:hash(source.bytes),source_identity:source.sourceIdentity,context_sha256:req.context_sha256,need:req.need,selection:unit.selection,range:unit.range,content:unit.content,content_sha256:hash(unit.content),navigation:{headings:hs,linked_wiki:links(source.fullText,source.relative),source_links:[...new Set([...source.fullText.matchAll(/\[[^\]]*\]\(<?([^)>]+)>?\)/g)].map(m=>m[1]).concat([...source.fullText.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>m[1].split('|')[0])).filter(l=>/raw-sources|Clippings|https?:/.test(l)))]},read_event:'fresh_content_return',applicability:'requires_task_review',claim_support:'not_verified',metrics:{file_reads:1,bytes_read:source.bytes.length,content_chars_returned:unit.content.length},writes:false};
 }catch(e){return failure(e.message==='path_outside_root'||e.message==='source_scope_denied'?'denied':e.code==='ENOENT'?'missing':e.code==='EACCES'||e.code==='EPERM'?'permission_denied':e.message==='media_unreadable'?'media_unreadable':'unavailable',e.message,{ref:input.ref});}
}
export function verifyEvidence(input,root=defaultRoot){
 const req=normalizeRequest(input.request);const receipts=input.receipts??[];if(!Array.isArray(receipts))throw new Error('receipts must be an array');const issues=[],checked=[];
 for(const r of receipts){if(!r||!['source_read','source_reused'].includes(r.status)){issues.push({ref:r?.ref,reason:'not_a_read_receipt'});continue;}const fresh=readSource({request:req,ref:r.ref,selection:r.selection},root);if(fresh.status!=='source_read'){issues.push({ref:r.ref,reason:fresh.status,detail:fresh.reason});continue;}for(const key of ['path','source_sha256','content_sha256','content','context_sha256'])if(r[key]!==fresh[key])issues.push({ref:r.ref,reason:key==='context_sha256'?'applicability_changed':key+'_changed'});if(JSON.stringify(r.range)!==JSON.stringify(fresh.range))issues.push({ref:r.ref,reason:'range_changed'});checked.push({ref:r.ref,source_sha256:fresh.source_sha256,range:fresh.range});}
 for(const c of input.citations??[]){const r=receipts.find(r=>r.ref===c.ref);if(!r)issues.push({ref:c.ref,reason:'citation_not_read'});else if(typeof c.quote!=='string'||!c.quote.trim()||!r.content.includes(c.quote))issues.push({ref:c.ref,reason:'quote_outside_read_range'});}
 return {schema_version:1,status:issues.length?'invalid':'evidence_consistent',checked,issues,claim_support:'not_verified',semantic_review:'required_by_agent',writes:false};
}
export function reuseSource(input,root=defaultRoot){
 const verified=verifyEvidence({request:input.request,receipts:[input.receipt]},root);
 if(verified.status!=='evidence_consistent')return failure('reuse_invalid','Source bytes, scope, permission or applicability changed',{issues:verified.issues});
 return {...input.receipt,status:'source_reused',read_event:'version_checked_prior_content_reused',applicability:'requires_task_review',claim_support:'not_verified',metrics:{version_checks:1,content_chars_returned:input.receipt.content.length},writes:false};
}
export function assembleResult(input,root=defaultRoot){
 const req=normalizeRequest(input.request);const receipts=input.receipts??[],claims=input.claims??[],gaps=input.gaps??[],stop=input.stop_reason;
 if(!['needs_answered','bounded_discovery_exhausted','budget_exhausted','sources_unavailable','user_scope_reached'].includes(stop))throw new Error('explicit stop_reason is required');
 if(!Array.isArray(claims)||!Array.isArray(gaps))throw new Error('claims and gaps must be arrays');
 const citations=claims.flatMap(c=>c.evidence??[]);const verification=verifyEvidence({request:req,receipts,citations},root);
 if(verification.status==='invalid')return failure('invalid_evidence','Cannot assemble changed or out-of-scope evidence',{verification});
 if(new Set(receipts.map(r=>r.ref)).size>req.budget.max_sources||receipts.reduce((n,r)=>n+r.content.length,0)>req.budget.max_content_chars)return failure('budget_exhausted','Read receipts exceed declared task budget; explicitly re-scope before delivery');
 for(const c of claims){if(!c.text||!c.applicability||!['source_statement','agent_inference'].includes(c.kind))throw new Error('Each claim requires text, kind and applicability');if(c.kind==='source_statement'&&!c.evidence?.length)throw new Error('Source statements require actual quoted read evidence');}
 if(stop==='needs_answered'&&gaps.some(g=>g.critical!==false))throw new Error('Critical gaps cannot be marked answered');
 if(['budget_exhausted','sources_unavailable','bounded_discovery_exhausted'].includes(stop)&&!gaps.length)throw new Error('Incomplete stops require explicit gaps');
 return {schema_version:1,kind:'knowledge_query_result',status:'assembled',need:req.need,sources:receipts.map(({content,navigation,...r})=>r),claims:claims.map(c=>({...c,semantic_status:'agent_assessed_not_tool_verified'})),gaps,stop_reason:stop,verification,source_availability:req.sources,source_support:'agent_assessment_required',user_acceptance:'not_requested',writes:false};
}
export function main(argv=process.argv.slice(2)){
 const [action,jsonPath,...rest]=argv;const pos=rest.indexOf('--root');const root=pos>=0?path.resolve(rest[pos+1]):defaultRoot;
 if(!jsonPath||!['discover','read','reuse','verify','assemble'].includes(action))throw new Error('Usage: node system/query/query-evidence.mjs discover|read|reuse|verify|assemble <request.json|-> [--root <Knowledge>]');
 const input=JSON.parse(fs.readFileSync(jsonPath==='-'?0:jsonPath,'utf8').replace(/^\uFEFF/,''));const result=({discover,read:readSource,reuse:reuseSource,verify:verifyEvidence,assemble:assembleResult})[action](input,root);console.log(JSON.stringify(result,null,2));if(['invalid','invalid_evidence','denied','permission_denied'].includes(result.status))process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{main();}catch(e){console.error(JSON.stringify(failure('invalid_request',e.message)));process.exitCode=2;}}
