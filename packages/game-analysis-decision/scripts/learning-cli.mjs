import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export const repositoryRoot=path.resolve(import.meta.dirname,'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const protectedNames=new Set(['clippings','raw','raw-sources','wiki']);
const inside=(root,p)=>{const rel=path.relative(root,p);return rel===''||(!path.isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+path.sep));};
function object(v,keys,label,required=keys) {
 if(!v||typeof v!=='object'||Array.isArray(v))throw new Error(label+': object required');
 for(const k of Object.keys(v))if(!keys.includes(k))throw new Error(label+': unknown '+k);
 for(const k of required)if(!(k in v))throw new Error(label+': missing '+k);
}
function text(v,label){if(typeof v!=='string'||!v.trim())throw new Error(label+': nonempty string required');}
function list(v,label){if(!Array.isArray(v)||!v.length||v.some(x=>typeof x!=='string'||!x.trim()))throw new Error(label+': nonempty string list required');}
function digest(v,label){if(!/^[a-f0-9]{64}$/.test(v??''))throw new Error(label+': SHA256 required');}
function physical(p){
 let head=path.resolve(p),tail=[];
 while(!fs.existsSync(head)){const parent=path.dirname(head);if(parent===head)throw new Error('No resolvable ancestor');tail.unshift(path.basename(head));head=parent;}
 return path.join(fs.realpathSync.native(head),...tail);
}
export function containedPath(root,relative){
 text(relative,'relative path');
 if(path.isAbsolute(relative))throw new Error('Absolute path is not a repository reference');
 const resolved=physical(path.resolve(root,relative)),base=physical(root);
 if(!inside(base,resolved))throw new Error('Path escapes allowed root: '+relative);
 return resolved;
}
export function assertKnowledgeWrite(knowledgeRoot,target){
 const base=physical(knowledgeRoot),dest=physical(path.resolve(knowledgeRoot,target));
 if(!inside(base,dest))throw new Error('Knowledge write escapes root');
 const first=path.relative(base,dest).split(path.sep)[0].toLowerCase();
 if(protectedNames.has(first))throw new Error('Protected Knowledge material is read-only: '+first);
 if(!['domains','system'].includes(first))throw new Error('Not in authorized Knowledge maintenance scope');
 return dest;
}
export function loadCatalogue(root=repositoryRoot){
 const cat=read(containedPath(root,'agents/catalogue.json'));
 object(cat,['schema_version','policy','assets','retired_ids'],'catalogue');
 if(cat.schema_version!==2||!Array.isArray(cat.assets)||!Array.isArray(cat.retired_ids))throw new Error('Unsupported catalogue');
 const ids=new Set();
 for(const a of cat.assets){
  object(a,['id','kind','path','version','roles','topics','eligibility','source_refs','legacy_path','default_use'],'asset',['id','kind','path','version','roles','topics','eligibility','source_refs']);
  text(a.id,'asset id');if(ids.has(a.id)||cat.retired_ids.includes(a.id))throw new Error('Duplicate or retired active id');ids.add(a.id);
  if(!['expert','context','method','procedure'].includes(a.kind)||a.version!==2||!['candidate','scoped','disabled'].includes(a.eligibility))throw new Error('Invalid asset kind/version/eligibility');
  if('default_use' in a&&typeof a.default_use!=='boolean')throw new Error('default_use must be boolean');
  if(!Array.isArray(a.roles)||!Array.isArray(a.source_refs))throw new Error('Asset lists required');
  list(a.topics,'asset topics');if(!fs.statSync(containedPath(root,a.path)).isFile())throw new Error('Asset file missing');
 }
 return cat;
}
export function loadState(root=repositoryRoot){
 const p=containedPath(root,'learning/state.json');
 if(!fs.existsSync(p))return {schema_version:2,assets:{},reviews:[]};
 const s=read(p);object(s,['schema_version','assets','reviews'],'state');
 if(s.schema_version!==2||!s.assets||typeof s.assets!=='object'||Array.isArray(s.assets)||!Array.isArray(s.reviews))throw new Error('Invalid state');
 return s;
}
function qualificationHealth(entry,asset,root){
 try{
  if(!/^CHG-[A-Za-z0-9_-]+$/.test(entry.change_id??''))return 'learning_record_missing_recheck_required';
  const change=read(containedPath(root,'learning/changes/'+entry.change_id+'.json'));
  if(entry.record_sha256!==hash(JSON.stringify(change))||change.target_id!==asset.id||change.candidate_sha256!==entry.content_sha256||change.decision!==entry.eligibility||JSON.stringify(change.scope)!==JSON.stringify(entry.scope))return 'learning_record_changed_recheck_required';
  for(const check of change.checks??[]){
   if(hash(fs.readFileSync(containedPath(root,check.evidence_path)))!==check.evidence_sha256)return 'learning_evidence_changed_recheck_required';
  }
  if(change.reentry&&hash(fs.readFileSync(containedPath(root,change.reentry.evidence_path)))!==change.reentry.evidence_sha256)return 'learning_evidence_changed_recheck_required';
  return null;
 }catch{return 'learning_evidence_missing_recheck_required';}
}
function loadProblemRoutes(root,cat){
 const file=containedPath(root,'agents/problem-routes.json');
 if(!fs.existsSync(file))return [];
 const data=read(file);object(data,['schema_version','routes'],'problem routes');
 if(data.schema_version!==2||!Array.isArray(data.routes))throw new Error('Invalid problem routes');
 const seen=new Set(),aliases=new Set();
 for(const route of data.routes){
  object(route,['id','title','aliases','ids','operation'],'problem route');
  text(route.id,'problem id');text(route.title,'problem title');text(route.operation,'problem operation');list(route.aliases,'problem aliases');list(route.ids,'problem assets');
  if(seen.has(route.id)||new Set(route.ids).size!==route.ids.length)throw new Error('Duplicate problem route or asset');seen.add(route.id);
  for(const alias of route.aliases){if(aliases.has(alias))throw new Error('Ambiguous problem alias');aliases.add(alias);}
  if(route.ids.some(id=>!cat.assets.some(a=>a.id===id)))throw new Error('Unknown or retired problem asset');
 }
 return data.routes;
}
export function resolveSelection(request={},root=repositoryRoot){
 if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['query','ids','roles','includeCandidates','contextTags','problem'].includes(k)))throw new Error('Unknown professional selection field');
 const {query='',ids=[],roles=[],includeCandidates=false,contextTags=[],problem=''}=request;
 const cat=loadCatalogue(root),state=loadState(root);
 if(typeof problem!=='string'||typeof query!=='string'||typeof includeCandidates!=='boolean'||![ids,roles,contextTags].every(a=>Array.isArray(a)&&a.every(x=>typeof x==='string')))throw new Error('Invalid lookup values');
 const missing=ids.filter(id=>!cat.assets.some(a=>a.id===id));
 if(missing.length)throw new Error('Unknown or retired requested asset: '+missing.join(','));
 const routes=loadProblemRoutes(root,cat),route=problem?routes.find(r=>r.id===problem):routes.find(r=>r.aliases.some(alias=>query.includes(alias)));
 if(problem&&!route)throw new Error('Unknown or unavailable problem route: '+problem);
 const tokens=query.toLowerCase().split(/[\s,，、]+/u).filter(Boolean);
 const matchesQuery=a=>tokens.some(t=>[a.id,...a.topics].join(' ').toLowerCase().includes(t));
 let matches=ids.length?[...new Set(ids)].map(id=>cat.assets.find(a=>a.id===id)):cat.assets.filter(a=>{
  if(!tokens.length&&!roles.length)return false;
  return a.roles.some(r=>roles.includes(r))||matchesQuery(a);
 });
 // Explicit order is intentional; a role fallback must not crowd out the named topic.
 if(!ids.length&&tokens.length)matches=[...matches.filter(matchesQuery),...matches.filter(a=>!matchesQuery(a))];
 if(!ids.length&&route){const routed=route.ids.map(id=>cat.assets.find(a=>a.id===id));matches=[...routed,...matches.filter(a=>!route.ids.includes(a.id))];}
 const items=matches.map(a=>{
  const s=state.assets[a.id],withdrawn=a.eligibility==='disabled'||s?.eligibility==='disabled';
  const sha256=withdrawn?null:hash(fs.readFileSync(containedPath(root,a.path)));
  let eligibility=a.eligibility,scope=null,reason='catalogue_default';
  if(withdrawn){eligibility='disabled';reason='withdrawn';}
  else if(s){
   if(s.content_sha256!==sha256){eligibility='candidate';reason='content_changed_recheck_required';}
   else {const health=qualificationHealth(s,a,root);eligibility=health?'candidate':s.eligibility;scope=s.scope;reason=health??'learning_record';}
  }
  if(scope&&(scope.exclude.some(x=>contextTags.includes(x))||!scope.include.some(x=>contextTags.includes(x)))){eligibility='candidate';if(reason==='learning_record')reason='outside_supported_scope';}
  const use_status=eligibility==='disabled'?'disabled':a.default_use===true||eligibility==='scoped'?'normal':'trial';
  const available=use_status==='normal'||use_status==='trial'&&includeCandidates;
  const selection_reason=use_status==='disabled'?'withdrawn':use_status==='normal'?(a.default_use===true?'owner_enabled':'supported_scope'):includeCandidates?'explicit_trial':'trial_requires_opt_in';
  return {...a,eligibility,scope,sha256,reason,use_status,available,selection_reason,sole_basis_for_important_decision:false};
 });
 return {schema_version:2,problem:route?.id??null,operation:route?.operation??null,items};
}
export function lookup(request={},root=repositoryRoot){
 return resolveSelection(request,root).items.filter(a=>a.available);
}
export function validateChange(change,root=repositoryRoot,{forAdoption=false}={}){
 object(change,[...['schema_version','id','target_id','author_context','claim','validation_class','base','candidate_sha256','scope','sources','checks','decision','reason'],'reentry'],'change',['schema_version','id','target_id','author_context','claim','validation_class','base','candidate_sha256','scope','sources','checks','decision','reason']);
 if(change.schema_version!==2||!/^CHG-[A-Za-z0-9_-]+$/.test(change.id))throw new Error('Invalid change identity');
 const cat=loadCatalogue(root),asset=cat.assets.find(a=>a.id===change.target_id);
 if(!asset||cat.retired_ids.includes(change.target_id))throw new Error('Unknown or retired target');
 text(change.author_context,'author_context');text(change.claim,'claim');text(change.reason,'reason');
 if(!['correction','local_method','broad_strategy'].includes(change.validation_class))throw new Error('Unknown validation class');
 if(!['candidate','scoped','disabled'].includes(change.decision))throw new Error('Unknown decision');
 digest(change.candidate_sha256,'candidate_sha256');
 if(hash(fs.readFileSync(containedPath(root,asset.path)))!==change.candidate_sha256)throw new Error('Candidate hash drift');
 object(change.base,['revision','path','sha256'],'base');
 if(!/^[a-f0-9]{40}$/.test(change.base.revision))throw new Error('Full base Git revision required');
 containedPath(root,change.base.path);digest(change.base.sha256,'base.sha256');
 const blob=execFileSync('git',['-C',root,'show',change.base.revision+':'+change.base.path],{maxBuffer:16*1024*1024});
 if(hash(blob)!==change.base.sha256)throw new Error('Base Git content hash mismatch');
 object(change.scope,['include','exclude'],'scope');list(change.scope.include,'scope.include');
 if(!Array.isArray(change.scope.exclude)||change.scope.exclude.some(s=>typeof s!=='string'||!s.trim()))throw new Error('scope.exclude must be strings');
 if(!Array.isArray(change.sources)||!change.sources.length)throw new Error('Sources required');
 for(const s of change.sources){object(s,['ref','support'],'source');text(s.ref,'source ref');text(s.support,'source support');}
 if(!Array.isArray(change.checks))throw new Error('checks required');
 const covered=new Set(),kinds=new Set(),ids=new Set();
 for(const check of change.checks){
  object(check,['id','kind','coverage','result','context_id','evidence_path','evidence_sha256'],'check');
  text(check.id,'check id');if(ids.has(check.id))throw new Error('Duplicate check id');ids.add(check.id);
  if(!['deterministic','independent_review','comparison','real_task'].includes(check.kind))throw new Error('Unknown check kind');
  if(!['passed','failed','inconclusive'].includes(check.result))throw new Error('Unknown check result');
  list(check.coverage,'check coverage');if(check.coverage.some(c=>!['correctness','improvement','misuse','regression','scope'].includes(c)))throw new Error('Unknown coverage');
  text(check.context_id,'check context');
  if(['independent_review','comparison'].includes(check.kind)&&check.context_id===change.author_context)throw new Error('Independent check reuses author context');
  digest(check.evidence_sha256,'evidence hash');
  if(hash(fs.readFileSync(containedPath(root,check.evidence_path)))!==check.evidence_sha256)throw new Error('Evidence hash drift');
  if(check.result==='passed'){check.coverage.forEach(c=>covered.add(c));kinds.add(check.kind);}
 }
 if(change.reentry){
  object(change.reentry,['retraction_evidence_sha256','addresses','review_context','evidence_path','evidence_sha256'],'reentry');
  digest(change.reentry.retraction_evidence_sha256,'retraction evidence hash');text(change.reentry.addresses,'addressed counterexample');
  text(change.reentry.review_context,'re-entry review context');
  if(change.reentry.review_context===change.author_context)throw new Error('re-entry requires an independent review context');
  digest(change.reentry.evidence_sha256,'re-entry evidence hash');
  if(hash(fs.readFileSync(containedPath(root,change.reentry.evidence_path)))!==change.reentry.evidence_sha256)throw new Error('re-entry evidence changed');
  if(change.decision!=='scoped'||!change.checks.some(c=>['independent_review','comparison'].includes(c.kind)&&c.result==='passed'&&c.coverage.includes('misuse')&&c.context_id===change.reentry.review_context))throw new Error('re-entry needs passed independent counterexample coverage and scoped adoption');
 }
 if(forAdoption){
  if(change.decision!=='scoped')throw new Error('Adoption requires scoped decision');
  if(change.checks.some(c=>c.result!=='passed'))throw new Error('Unresolved failed or inconclusive check prevents adoption');
  const required=change.validation_class==='correction'?['correctness']:['improvement','misuse','regression'];
  if(required.some(c=>!covered.has(c)))throw new Error('Missing relevant validation coverage');
  if(change.validation_class==='correction'&&!kinds.has('deterministic'))throw new Error('Correction needs direct verification');
  if(change.validation_class==='local_method'&&!kinds.has('deterministic')&&!kinds.has('independent_review')&&!kinds.has('comparison'))throw new Error('Local method needs independently checkable evidence');
  if(change.validation_class==='broad_strategy'&&!kinds.has('comparison'))throw new Error('Broad strategy requires independent comparison');
 }
 return {asset,content_sha256:change.candidate_sha256,claim_boundary:'Validates recorded identity, hashes, declared independence and coverage, not the truth or quality of the evidence. Read evidence before adopting.'};
}
export function writeJson(root,relative,value){
 const p=containedPath(root,relative);
 if(!relative.startsWith('learning/'))throw new Error('Learning writer is restricted to learning/');
 fs.mkdirSync(path.dirname(p),{recursive:true});
 const temp=containedPath(root,relative+'.tmp');
 if(fs.existsSync(temp))throw new Error('Unfinished temporary write; recover before retry');
 fs.writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 fs.renameSync(temp,p);
}
export function saveChange(change,root=repositoryRoot,{apply=false}={}){
 const valid=validateChange(change,root,{forAdoption:change.decision==='scoped'});
 if(change.decision==='disabled')throw new Error('Use retract with counterexample evidence');
 const relative='learning/changes/'+change.id+'.json';
 const p=containedPath(root,relative);
 if(fs.existsSync(p)&&JSON.stringify(read(p))!==JSON.stringify(change))throw new Error('Change record is immutable; use a new change id');
 const state=loadState(root);
 const existing=state.assets[change.target_id];
 const same=existing?.change_id===change.id&&existing?.eligibility===change.decision&&existing?.content_sha256===change.candidate_sha256;
 const recordHash=hash(JSON.stringify(change));
 if(same&&existing.record_sha256===recordHash)return {applied:false,unchanged:true,record:relative,entry:existing,claim_boundary:valid.claim_boundary};
 if(!same){
  if(existing?.eligibility==='disabled'){
   if(!change.reentry||change.reentry.retraction_evidence_sha256!==existing.retraction?.evidence_sha256)throw new Error('Disabled assets require reviewed re-entry addressing the exact recorded counterexample');
  }else if(change.reentry)throw new Error('re-entry supplied without an active withdrawal');
 }
 const next=same?{...existing,record_sha256:recordHash}:{eligibility:change.decision,content_sha256:valid.content_sha256,scope:change.scope,change_id:change.id,record_sha256:recordHash,updated_at:new Date().toISOString(),...(change.reentry?{previous:existing,reentry:change.reentry}:{})};
 if(apply){
  if(!fs.existsSync(p))writeJson(root,relative,change);
  state.assets[change.target_id]=next;writeJson(root,'learning/state.json',state);
 }
 return {applied:apply,record:relative,entry:next,claim_boundary:valid.claim_boundary};
}
export function retract({target_id,reason,evidence_path,evidence_sha256},root=repositoryRoot,{apply=false}={}){
 text(reason,'retraction reason');digest(evidence_sha256,'retraction evidence hash');
 if(hash(fs.readFileSync(containedPath(root,evidence_path)))!==evidence_sha256)throw new Error('Retraction evidence hash drift');
 const asset=loadCatalogue(root).assets.find(a=>a.id===target_id);if(!asset)throw new Error('Unknown target');
 const state=loadState(root),before=state.assets[target_id]??null;
 if(before?.eligibility==='disabled'&&before?.retraction?.reason===reason&&before?.retraction?.evidence_path===evidence_path&&before?.retraction?.evidence_sha256===evidence_sha256)return {applied:false,unchanged:true,entry:before};
 const entry={eligibility:'disabled',content_sha256:hash(fs.readFileSync(containedPath(root,asset.path))),scope:before?.scope??null,change_id:before?.change_id??null,updated_at:new Date().toISOString(),retraction:{reason,evidence_path,evidence_sha256},previous:before};
 if(apply){state.assets[target_id]=entry;writeJson(root,'learning/state.json',state);}
 return {applied:apply,entry};
}
export function resolveKnowledge(ref,knowledgeRoot,{maxCharacters=16000}={}){
 text(ref,'source ref');if(!Number.isInteger(maxCharacters)||maxCharacters<1||maxCharacters>100000)throw new Error('Invalid read limit');
 if(ref.startsWith('knowledge:principle:')){
  if(!/^knowledge:principle:DPR-[A-Z]+-\d+$/.test(ref))throw new Error('Invalid stable principle reference');
  if(!knowledgeRoot||!fs.existsSync(knowledgeRoot))return {ref,status:'unavailable',reason:'knowledge_root_missing'};
  const module=containedPath(knowledgeRoot,'system/integrations/query-principles.mjs');
  if(!fs.existsSync(module))return {ref,status:'unavailable',reason:'principle_provider_missing'};
  const result=JSON.parse(execFileSync(process.execPath,[module,'get',ref],{encoding:'utf8',maxBuffer:2*1024*1024}));
  const item=result.principles?.[0];if(!item)return {ref,status:'unavailable',reason:'principle_missing'};
  return {ref,status:'available',sha256:item.source_sha256,semantic_candidate_sha256:item.semantic_candidate_sha256,content:item.content.slice(0,maxCharacters),truncated:item.content.length>maxCharacters,sources:item.sources,source_ref:item.source_ref,source_write:false,claim_support:'not_verified_by_resolver'};
 }
 const match=/^knowledge:(domain|wiki|raw):([^/\\:]+)$/.exec(ref);
 if(!match||match[2]==='.'||match[2]==='..')throw new Error('Unsupported or unsafe stable Knowledge reference');
 const folder={domain:'domains',wiki:'wiki',raw:'raw-sources'}[match[1]];
 if(!knowledgeRoot||!fs.existsSync(knowledgeRoot))return {ref,status:'unavailable',reason:'knowledge_root_missing'};
 const file=containedPath(knowledgeRoot,folder+'/'+match[2]+(match[2].endsWith('.md')?'':'.md'));
 if(!fs.existsSync(file))return {ref,status:'unavailable',reason:'source_missing'};
 const bytes=fs.readFileSync(file),body=bytes.toString('utf8');
 return {ref,status:'available',sha256:hash(bytes),content:body.slice(0,maxCharacters),truncated:body.length>maxCharacters,source_write:false,claim_support:'not_verified_by_resolver'};
}
export function dueReviews(now=new Date(),state=loadState(),{timeZone='Asia/Shanghai'}={}){
 if(!Number.isFinite(now.getTime()))throw new Error('Invalid review clock');
 const period=(date,kind)=>{
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'numeric',day:'numeric'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
  if(kind==='monthly')return parts.year*12+parts.month;
  const day=new Date(Date.UTC(parts.year,parts.month-1,parts.day)),offset=(day.getUTCDay()+6)%7;
  return day.getTime()-offset*86400000;
 };
 const latest=kind=>state.reviews.filter(r=>r.kind===kind).map(r=>Date.parse(r.completed_at)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
 const due=kind=>{const previous=latest(kind);return previous===undefined||period(now,kind)>period(new Date(previous),kind);};
 return {weekly:due('weekly'),monthly:due('monthly'),period_basis:'calendar_week_monday_and_month',time_zone:timeZone,limits:{weekly_leads:5,weekly_deep_changes:1,monthly_domains:2},state_changed:false};
}
function main(){
 const [action,...args]=process.argv.slice(2);const apply=args.includes('--apply');const params=args.filter(a=>a!=='--apply');
 if(action==='resolve'){console.log(JSON.stringify(resolveSelection(params[0]?read(params[0]):{}),null,2));return;}
 if(action==='lookup'){console.log(JSON.stringify(lookup(params[0]?read(params[0]):{}),null,2));return;}
 if(action==='validate'||action==='record'){if(!params[0])throw new Error('Change JSON required');const c=read(params[0]);console.log(JSON.stringify(action==='validate'?validateChange(c,repositoryRoot,{forAdoption:c.decision==='scoped'}):saveChange(c,repositoryRoot,{apply}),null,2));return;}
 if(action==='retract'){console.log(JSON.stringify(retract(read(params[0]),repositoryRoot,{apply}),null,2));return;}
 if(action==='source'){if(params.length!==2)throw new Error('source <ref> <Knowledge-root>');console.log(JSON.stringify(resolveKnowledge(params[0],params[1]),null,2));return;}
 if(action==='due'){console.log(JSON.stringify(dueReviews(),null,2));return;}
 if(action==='audit'){const cat=loadCatalogue();console.log(JSON.stringify({version:2,assets:cat.assets.length,retired:cat.retired_ids,claim:'catalogue integrity only'}));return;}
 throw new Error('Usage: learning-cli.mjs resolve [query.json] | lookup [query.json] | validate <change.json> | record <change.json> [--apply] | retract <request.json> [--apply] | source <ref> <Knowledge-root> | due | audit');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{main();}catch(e){console.error(e.message);process.exitCode=2;}}
