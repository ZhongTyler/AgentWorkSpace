import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {repositoryRoot,containedPath,loadCatalogue,loadState,resolveKnowledge,dueReviews,writeJson} from './learning-cli.mjs';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function closed(v,fields,label,optional=[]){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!fields.includes(k)&&!optional.includes(k))||fields.some(k=>!(k in v)))throw new Error('Invalid '+label);}
function nonempty(v){return typeof v==='string'&&!!v.trim();}
export async function planMaintenance({knowledgeRoot=null,now=new Date().toISOString(),leads=[]}={},root=repositoryRoot){
 const state=loadState(root),clock=new Date(now),due=dueReviews(clock,state),cat=loadCatalogue(root);
 if(!Array.isArray(leads)||leads.some(l=>!l||!nonempty(l.id)||!nonempty(l.reason)||!Array.isArray(l.source_refs)||l.source_refs.some(r=>!nonempty(r))||l.kind!==undefined&&!['lead','outcome','counterexample','source_change'].includes(l.kind)||['outcome','counterexample'].includes(l.kind)&&l.source_refs.length===0||l.asset_ids!==undefined&&(!Array.isArray(l.asset_ids)||l.asset_ids.some(id=>!cat.assets.some(a=>a.id===id)))))throw new Error('Invalid proposed leads');
 let domains=[],knowledgeStatus='unavailable';
 if(knowledgeRoot && fs.existsSync(knowledgeRoot)){
  const provider=containedPath(knowledgeRoot,'system/integrations/query-principles.mjs');
  if(fs.existsSync(provider)){
   const api=await import(pathToFileURL(provider).href);knowledgeStatus='available';
   domains=api.listDomains(knowledgeRoot).map(domain=>{
    const current=api.readDomain(domain,knowledgeRoot),ref='knowledge:domain:'+domain;
    const reviews=state.reviews.flatMap(r=>(r.inspections??[]).filter(i=>i.ref===ref).map(i=>({...i,completed_at:r.completed_at}))).sort((a,b)=>Date.parse(b.completed_at)-Date.parse(a.completed_at));
    const last=reviews[0],dependents=cat.assets.filter(a=>a.source_refs.includes(ref)||current.principles.some(p=>a.source_refs.includes(p.ref))).map(a=>a.id);
    return {ref,domain,sha256:current.source_sha256,principle_fingerprints:current.principles.map(p=>({id:p.id,sha256:p.semantic_candidate_sha256})),last_reviewed:last?.completed_at??null,changed_since_review:!last||last.sha256!==current.source_sha256,dependents};
   }).sort((a,b)=>Number(b.changed_since_review)-Number(a.changed_since_review)||(Date.parse(a.last_reviewed??'1970-01-01')-Date.parse(b.last_reviewed??'1970-01-01'))||b.dependents.length-a.dependents.length||a.domain.localeCompare(b.domain,'zh'));
  }
 }
 const sourceLeads=domains.filter(d=>d.changed_since_review).map(d=>({id:d.ref,reason:d.last_reviewed?'Domain bytes changed: inspect actual principle/source meaning before revising':'No semantic review recorded; inspect, do not assume defect',source_refs:[d.ref],dependents:d.dependents}));
 const ordered=[...leads.filter(l=>l.kind==='counterexample'),...leads.filter(l=>l.kind==='outcome'),...leads.filter(l=>!['counterexample','outcome'].includes(l.kind)),...sourceLeads];
 const proposed=ordered.filter((l,i,a)=>a.findIndex(x=>x.id===l.id)===i);
 const eligible=due.weekly?proposed:proposed.filter(l=>l.kind==='counterexample');
 const selected=eligible.slice(0,5),urgent=selected.some(l=>l.kind==='counterexample');
 return {schema_version:2,at:clock.toISOString(),due,trigger:urgent?'counterexample':due.weekly||due.monthly?'scheduled':'none',knowledge_status:knowledgeStatus,weekly_leads:selected,deferred_leads:proposed.filter(l=>!selected.includes(l)).map(l=>l.id),requires_source_reading:true,monthly_domains:due.monthly?domains.slice(0,2):[],uncovered_domains:domains.slice(due.monthly?2:0).map(d=>d.ref),budget:{wall_minutes:45,model_calls:12,tool_calls:40,weekly_deep_changes:1,monthly_domains:2},writes:false,claim:'A bounded reading plan, not completed semantic review. Missing Knowledge is not permission to synthesize its principles.'};
}
function reviewSource(ref,knowledgeRoot,root,evidencePath){
 if(ref.startsWith('knowledge:'))return resolveKnowledge(ref,knowledgeRoot,{maxCharacters:100000});
 if(ref.startsWith('game-analysis-decision:asset:')){
  const id=ref.slice('game-analysis-decision:asset:'.length),asset=loadCatalogue(root).assets.find(a=>a.id===id);
  if(!asset)return {status:'unavailable'};
  return {status:'available',sha256:hash(fs.readFileSync(containedPath(root,asset.path)))};
 }
 if(!evidencePath)throw new Error('External or project source requires captured evidence_path; reference alone is not evidence');
 const bytes=fs.readFileSync(containedPath(root,evidencePath));
 return {status:'available',sha256:hash(bytes),claim:'Checks captured bytes, not source authenticity; inspect the capture and original reference'};
}
export function recordReview(review,{knowledgeRoot=null,apply=false,now=new Date()}={},root=repositoryRoot){
 closed(review,['schema_version','id','kind','completed_at','inspections','evidence_path','evidence_sha256','budget_used','remaining','outcome'],'review');
 if(review.schema_version!==2||!/^REV-[A-Za-z0-9_-]+$/.test(review.id)||!['weekly','monthly'].includes(review.kind))throw new Error('Invalid review identity');
 const at=Date.parse(review.completed_at);if(!Number.isFinite(at)||at>now.getTime()+60000)throw new Error('Invalid or future completion');
 if(!Array.isArray(review.inspections)||!review.inspections.length||!Array.isArray(review.remaining)||!nonempty(review.outcome))throw new Error('Actual inspection and outcome required');
 if(review.kind==='monthly'&&(review.inspections.length>2||review.inspections.some(i=>!i.ref?.startsWith('knowledge:domain:'))))throw new Error('Monthly review must inspect one or two explicit domains; individual principles and leads belong to weekly review');
 if(review.kind==='weekly'&&review.inspections.length>5)throw new Error('Weekly lead cap exceeded');
 const seen=new Set();
 for(const item of review.inspections){
  closed(item,['ref','sha256','verdict','reason','source_checks'],'inspection',['evidence_path']);
  if(!nonempty(item.ref)||seen.has(item.ref)||!['maintain','revise','uncertain'].includes(item.verdict)||!nonempty(item.reason)||!Array.isArray(item.source_checks))throw new Error('Invalid semantic inspection');seen.add(item.ref);
  if(!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('Source version required');
  const source=reviewSource(item.ref,knowledgeRoot,root,item.evidence_path);
  if(source.status!=='available'||source.sha256!==item.sha256)throw new Error('Inspected source unavailable or changed');
  for(const check of item.source_checks){
   closed(check,['ref','sha256','finding'],'source check',['evidence_path']);
   if(!nonempty(check.finding))throw new Error('Actual source finding required');
   const src=reviewSource(check.ref,knowledgeRoot,root,check.evidence_path);
   if(src.status!=='available'||src.sha256!==check.sha256)throw new Error('Supporting source unavailable or changed');
  }
 }
 closed(review.budget_used,['wall_minutes','model_calls','tool_calls','measurement'],'budget');
 for(const k of ['wall_minutes','model_calls','tool_calls'])if(!(review.budget_used[k]===null&&review.budget_used.measurement==='unavailable')&&(!Number.isFinite(review.budget_used[k])||review.budget_used[k]<0))throw new Error('Invalid budget usage');
 if(!['measured','caller_estimate','unavailable'].includes(review.budget_used.measurement))throw new Error('Cost measurement status required');
 if(!/^[a-f0-9]{64}$/.test(review.evidence_sha256))throw new Error('Evidence hash required');
 const bytes=fs.readFileSync(containedPath(root,review.evidence_path));
 if(hash(bytes)!==review.evidence_sha256||!bytes.toString('utf8').trim())throw new Error('Review evidence absent or changed');
 const state=loadState(root),old=state.reviews.find(r=>r.id===review.id);
 if(old){if(JSON.stringify(old)!==JSON.stringify(review))throw new Error('Review records immutable');return {applied:false,unchanged:true};}
 const relative='learning/reviews/'+review.id+'.json',p=containedPath(root,relative);
 if(fs.existsSync(p)&&JSON.stringify(read(p))!==JSON.stringify(review))throw new Error('Review record conflict');
 if(apply){if(!fs.existsSync(p))writeJson(root,relative,review);state.reviews.push(review);writeJson(root,'learning/state.json',state);}
 return {applied:apply,record:relative,claim:'Verifies evidence versions and declared scope, not whether the semantic judgement is correct. No principle or method was adopted by this command.'};
}
async function main(){
 const [action,file,...args]=process.argv.slice(2),opts=file?read(path.resolve(file)):{};
 if(action==='plan'){console.log(JSON.stringify(await planMaintenance(opts),null,2));return;}
 if(action==='record'){console.log(JSON.stringify(recordReview(opts,{apply:args.includes('--apply')}),null,2));return;}
 throw new Error('Usage: maintenance-cli.mjs plan [options.json] | record <review.json> [--apply]');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){try{await main();}catch(e){console.error(e.message);process.exitCode=2;}}
