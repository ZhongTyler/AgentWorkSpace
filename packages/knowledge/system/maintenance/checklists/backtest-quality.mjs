import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';

const own=fileURLToPath(import.meta.url);
export const VERSION='RAW_STANDARD_V2';
export const RULESET='core-semantic-20260910';
export const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
export function safe(root,rel,exists=true){
  if(typeof rel!=='string'||!rel.trim())throw Error('Required path missing');
  const base=fs.realpathSync(root),full=path.resolve(base,rel),prefix=base+path.sep;
  if(!full.startsWith(prefix))throw Error('Path escapes project: '+rel);
  let probe=full;
  while(!fs.existsSync(probe))probe=path.dirname(probe);
  if(probe!==base&&!fs.realpathSync(probe).startsWith(prefix))throw Error('Linked path escapes project');
  for(let p=probe;p!==base;p=path.dirname(p))if(fs.lstatSync(p).isSymbolicLink())throw Error('Linked path rejected');
  if(exists&&(!fs.existsSync(full)||!fs.statSync(full).isFile()))throw Error('Missing file: '+rel);
  return full;
}
const rel=(root,p)=>path.relative(root,p).split(path.sep).join('/');
const text=(root,p)=>fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,'');
const read=(root,p)=>JSON.parse(text(root,p));
const hash=(root,p)=>sha(fs.readFileSync(safe(root,p)));
const record=(root,p)=>({path:rel(root,safe(root,p)),sha256:hash(root,p)});
const assert=(ok,message)=>{if(!ok)throw Error(message);};
const norm=s=>s.trim().replace(/\s+/g,' ');
function output(root,p,value){
  const full=safe(root,p,false);
  assert(!/^(Clippings|raw-sources|wiki|domains|released|release-input)\//.test(rel(root,full)),'Output cannot overwrite knowledge or release files');
  assert(!/system\/registry\//.test(rel(root,full)),'Output cannot overwrite registry');
  const data=JSON.stringify(value,null,2)+'\n';
  if(fs.existsSync(full)){assert(fs.readFileSync(full,'utf8')===data,'Evidence already exists with different content; use a new revision');return;}
  fs.mkdirSync(path.dirname(full),{recursive:true});fs.writeFileSync(full,data);
}
function bodyStart(lines){
  if(lines[0]?.trim()!=='---')return 0;
  const end=lines.findIndex((l,i)=>i>0&&l.trim()==='---');
  assert(end>0,'Unclosed YAML');return end+1;
}
export function rawUnits(value){
  const lines=value.split(/\r?\n/),units=[];let start=-1,buf=[];
  function flush(end){if(buf.length){units.push({id:'R'+String(units.length+1).padStart(4,'0'),line_start:start+1,line_end:end,text:buf.join('\n')});buf=[];start=-1;}}
  for(let i=bodyStart(lines);i<lines.length;i++){
    const l=lines[i];
    if(!l.trim()||/^\s*(?:---+|\|[\s:|\-]+)\s*$/.test(l)||/^>\s*📍/.test(l)){flush(i);continue;}
    if(/^#{1,6}\s|^\s*(?:[-*+]\s|\d+[.)]\s)|^\|/.test(l)){flush(i);start=i;buf=[l];flush(i+1);}
    else{if(start<0)start=i;buf.push(l);}
  }flush(lines.length);return units;
}
export function styleCheck(value){
  const lines=value.split(/\r?\n/),findings=[];
  const add=(line,detail)=>findings.push({rule:'R12',raw_ranges:[[line,line]],source_ids:[],detail});
  if(lines[0]?.trim()!=='---')add(1,'Missing YAML frontmatter');
  const start=bodyStart(lines),fm=lines.slice(0,start).join('\n');
  lines.slice(start).forEach((l,i)=>{if(/!\[[^\]]*\]|!\[\[|<img\b/i.test(l))findings.push({rule:'R08',raw_ranges:[[start+i+1,start+i+1]],source_ids:[],detail:'Raw must transcribe image knowledge or disclose 未转录, not embed images'});});
  for(const key of ['source','source_url','date','domains'])if(!new RegExp('^'+key+':','m').test(fm))add(1,'Missing metadata: '+key);
  if(!lines.slice(start).some(l=>/^# [^#]/.test(l)))add(start+1,'Missing document title');
  const heads=lines.map((l,i)=>/^## /.test(l)?i:-1).filter(i=>i>=0);
  if(!heads.length)add(start+1,'Missing content sections');
  for(const [n,i] of heads.entries()){
    const heading=lines[i].replace(/^##\s+/,'').trim();
    const section=lines.slice(i+1,heads[n+1]??lines.length);
    if(/^(?:批注|AI\s*批注|AI\s*辅助意见|未消费清单|覆盖自检矩阵)$/.test(heading)){
      findings.push({rule:'R13',raw_ranges:[[i+1,i+1]],source_ids:[],detail:'AI/consumption appendix belongs outside Raw'});continue;
    }
    if(heading==='来源'&&n===heads.length-1&&section.some(l=>/https?:|\[\[Clippings\//.test(l))){findings.push({rule:'R13',raw_ranges:[[i+1,lines.length]],source_ids:[],detail:'Repeated source footer'});continue;}
    const first=section.find(l=>l.trim());
    if(!first||!/^>\s*📍\s*原文/.test(first))add(i+1,'Section needs an actual source location marker');
  }
  return {status:findings.length?'failed':'passed',findings,scope:'mechanical_format_only',semantic_status:'not_checked'};
}
export function sourcePaths(raw){
  const lines=raw.split(/\r?\n/),fm=lines.slice(0,bodyStart(lines)).join('\n');
  const block=fm.match(/^source_clipping:\s*([\s\S]*?)(?=^\S[^:\n]*:|^---|$(?![\s\S]))/m)?.[1]??'';
  return [...new Set([...block.matchAll(/\[\[([^\]]+)\]\]/g)].map(m=>m[1].replace(/\.md$/,'')+'.md'))];
}
function verifyManifest(root,manifest){
  assert(manifest.schema_version===2&&Array.isArray(manifest.units)&&manifest.units.length,'Unsupported/empty manifest');
  assert(Array.isArray(manifest.sources)&&manifest.sources.length,'Missing manifest sources');
  const seen=new Set();
  for(const source of manifest.sources){
    assert(hash(root,source.source_path)===source.source_sha256,'Source hash drift: '+source.source_path);
    const lines=text(root,source.source_path).split(/\r?\n/),covered=new Set();
    const units=manifest.units.filter(u=>u.source_path===source.source_path);
    assert(units.length===source.unit_count,'Source unit count differs');
    for(const u of units){
      assert(!seen.has(u.id),'Duplicate source ID');seen.add(u.id);
      assert(Number.isInteger(u.line_start)&&Number.isInteger(u.line_end)&&u.line_start>=1&&u.line_end>=u.line_start&&u.line_end<=lines.length,'Invalid source range');
      let expected=norm(lines.slice(u.line_start-1,u.line_end).join(' '));
      if(u.kind==='heading')expected=expected.replace(/^#{1,6}\s+/,'').replace(/^\*\*([\s\S]*)\*\*$/,'$1').trim();
      assert(expected===norm(u.text)&&sha(norm(u.text))===u.text_sha256,'Manifest text differs from source: '+u.id);
      for(let i=u.line_start;i<=u.line_end;i++)covered.add(i);
    }
    for(let i=bodyStart(lines);i<lines.length;i++)if(lines[i].trim()&&!/^\s*(?:---+|\|[\s:|\-]+)\s*$/.test(lines[i]))assert(covered.has(i+1),'Manifest omitted source line: '+(i+1));
  }
  assert(seen.size===manifest.units.length,'Manifest contains foreign source units');
}
const dependencies=['system/maintenance/checklists/raw-standard-v2.md','system/maintenance/checklists/raw-writing-v2.md','system/maintenance/checklists/backtest-quality.mjs','system/maintenance/checklists/source-content-audit.ps1'];
export function prepare(root,{raw,manifest,request,producer,config='fresh-context-default',baseline=null}){
  assert(typeof producer==='string'&&producer.trim(),'Producer context required');
  const m=read(root,manifest);verifyManifest(root,m);
  const body=text(root,raw),declared=sourcePaths(body);
  if(declared.length)assert(JSON.stringify([...declared].sort())===JSON.stringify(m.sources.map(s=>s.source_path).sort()),'Manifest must contain every declared clipping');
  const fullSourceUnits=m.units,fullRawUnits=rawUnits(body),allRaw=fullRawUnits.map(u=>u.text).join('\n');
  const baselineContract=baseline?(read(root,baseline.request).evidence_contract_version??1):0;
  const compatibleBaseline=baseline&&baselineContract>=2?baseline:null;
  const plan=compatibleBaseline?targetPlan(root,manifest,m,fullRawUnits,compatibleBaseline):null;
  const source_units=plan?.source_units??fullSourceUnits,raw_units=plan?.raw_units??fullRawUnits;
  const signals=source_units.flatMap(u=>(u.numbers??[]).filter(n=>!allRaw.includes(n)).map(n=>({source_id:u.id,kind:'number_not_literal_in_raw',value:n,meaning:'candidate_only'})));
  const q={schema_version:2,standard:VERSION,ruleset:RULESET,evidence_contract_version:2,producer_context_id:producer,audit_config:config,report_format:'compact-v1',
    raw:record(root,raw),manifest:record(root,manifest),dependencies:dependencies.map(p=>record(root,p)),
    sources:m.sources.map(s=>record(root,s.source_path)),source_units,raw_units,raw_line_count:body.split(/\r?\n/).length,
    mechanical:styleCheck(body),signals,review_instructions:'system/maintenance/checklists/raw-writing-v2.md'};
  if(plan){
    q.review_scope='targeted_recheck';q.raw_inventory=plan.raw_inventory;q.target_core_claims=plan.target_core_claims;q.target_summary=plan.target_summary;
    q.baseline={request:record(root,compatibleBaseline.request),review:record(root,compatibleBaseline.review),receipt:record(root,compatibleBaseline.receipt)};
  }else q.review_scope='full_text_bidirectional';
  output(root,request,q);return {status:'needs_review',review_scope:q.review_scope,request_path:request,request_sha256:hash(root,request),source_units:source_units.length,raw_units:raw_units.length,signals:signals.length,...(plan?{target_summary:plan.target_summary}:{})};
}
function verifyRequest(root,q){
  assert(q.schema_version===2&&q.standard===VERSION&&q.ruleset===RULESET,'Wrong request standard/ruleset');
  assert(q.evidence_contract_version===undefined||q.evidence_contract_version===1||q.evidence_contract_version===2,'Unsupported evidence contract version');
  assert(JSON.stringify(q.dependencies.map(x=>x.path).sort())===JSON.stringify([...dependencies].sort()),'Required dependency set changed');
  for(const r of [q.raw,q.manifest,...q.sources,...q.dependencies])assert(hash(root,r.path)===r.sha256,'Request dependency drift: '+r.path);
  const m=read(root,q.manifest.path);verifyManifest(root,m);
  assert(['full_text_bidirectional','targeted_recheck'].includes(q.review_scope),'Unknown review scope');
  assert(JSON.stringify(q.sources.map(x=>[x.path,x.sha256]))===JSON.stringify(m.sources.map(x=>[x.source_path,x.source_sha256])),'Request source set drift');
  const currentRawUnits=rawUnits(text(root,q.raw.path));
  if(q.review_scope==='targeted_recheck'){
    for(const item of [q.baseline?.request,q.baseline?.review,q.baseline?.receipt])assert(item?.path&&hash(root,item.path)===item.sha256,'Targeted baseline evidence drift');
    const plan=targetPlan(root,q.manifest.path,m,currentRawUnits,{request:q.baseline.request.path,review:q.baseline.review.path,receipt:q.baseline.receipt.path});
    assert(JSON.stringify(q.source_units)===JSON.stringify(plan.source_units),'Targeted source inventory drift');
    assert(JSON.stringify(q.raw_units)===JSON.stringify(plan.raw_units),'Targeted Raw inventory drift');
    assert(JSON.stringify(q.raw_inventory)===JSON.stringify(plan.raw_inventory),'Full Raw fingerprint inventory drift');
    assert(JSON.stringify(q.target_core_claims)===JSON.stringify(plan.target_core_claims),'Target core-claim inventory drift');
    assert(JSON.stringify(q.target_summary)===JSON.stringify(plan.target_summary),'Target summary drift');
  }else{
    assert(JSON.stringify(q.source_units)===JSON.stringify(m.units),'Request source inventory drift');
    assert(JSON.stringify(q.raw_units)===JSON.stringify(currentRawUnits),'Request Raw inventory drift');
  }
  assert(q.raw_line_count===text(root,q.raw.path).split(/\r?\n/).length,'Raw line count drift');
  assert(JSON.stringify(q.mechanical)===JSON.stringify(styleCheck(text(root,q.raw.path))),'Mechanical result drift');
}
const nonempty=x=>typeof x==='string'&&x.trim().length>0&&x!=='TODO';
const statuses=['complete','partial','missing','distorted','uncertain','marker_only','not_applicable'];
function ranges(value,max){assert(Array.isArray(value),'Ranges must be an array');for(const r of value)assert(Array.isArray(r)&&r.length===2&&r.every(Number.isInteger)&&r[0]>0&&r[1]>=r[0]&&r[1]<=max,'Invalid Raw range');}
function exactChecks(checks,units){assert(Array.isArray(checks)&&checks.length===units.length,'Incomplete full-text checks');const ids=new Set(checks.map(c=>c.id));assert(ids.size===units.length&&units.every(u=>ids.has(u.id)),'Missing/duplicate/foreign review unit');}
function inventory(units){
  const seen=new Map();
  return units.map(unit=>{
    const fingerprint=unit.text_sha256??sha(norm(unit.text));
    const occurrence=(seen.get(fingerprint)??0)+1;seen.set(fingerprint,occurrence);
    return {id:unit.id,line_start:unit.line_start,line_end:unit.line_end,text_sha256:fingerprint,key:fingerprint+':'+occurrence};
  });
}
function overlaps(range,unit){return range[0]<=unit.line_end&&range[1]>=unit.line_start;}
function remapRanges(value,oldInventory,newByKey,oldLines,newLines){
  return value.map(range=>{
    const matches=oldInventory.filter(unit=>overlaps(range,unit));
    if(!matches.length){
      const sequence=oldLines.slice(range[0]-1,range[1]),candidates=[];
      for(let index=0;index<=newLines.length-sequence.length;index++)if(sequence.every((line,offset)=>newLines[index+offset]===line))candidates.push(index);
      assert(sequence.length&&candidates.length===1,'Baseline non-unit range is not uniquely unchanged');
      return [candidates[0]+1,candidates[0]+sequence.length];
    }
    const mapped=matches.map(unit=>newByKey.get(unit.key));
    assert(mapped.every(Boolean),'A carried judgment overlaps changed Raw content');
    return [Math.min(...mapped.map(unit=>unit.line_start)),Math.max(...mapped.map(unit=>unit.line_end))];
  });
}
function remapCheck(check,oldInventory,newByKey,oldLines,newLines){
  const copy=structuredClone(check);
  const walk=value=>{
    if(!value||typeof value!=='object')return;
    for(const [key,item] of Object.entries(value)){
      if(key==='raw_ranges')value[key]=remapRanges(item,oldInventory,newByKey,oldLines,newLines);
      else walk(item);
    }
  };
  walk(copy);return copy;
}
function requestRawInventory(q){return q.review_scope==='targeted_recheck'?q.raw_inventory:inventory(q.raw_units);}
function materializeReport(root,q,r){
  if(q.review_scope!=='targeted_recheck')return r;
  const baselineRequest=read(root,q.baseline.request.path),baselineReport=read(root,q.baseline.review.path);
  const prior=materializeReport(root,baselineRequest,baselineReport);
  const oldInventory=requestRawInventory(baselineRequest),newInventory=q.raw_inventory;
  const oldLines=text(root,baselineRequest.raw.path).split(/\r?\n/),newLines=text(root,q.raw.path).split(/\r?\n/);
  const oldByKey=new Map(oldInventory.map(unit=>[unit.key,unit])),newByKey=new Map(newInventory.map(unit=>[unit.key,unit]));
  const targetedSources=new Map(r.source_checks.map(check=>[check.id,check]));
  const source_checks=read(root,q.manifest.path).units.map(unit=>{
    if(targetedSources.has(unit.id))return targetedSources.get(unit.id);
    const carried=prior.source_checks.find(check=>check.id===unit.id);assert(carried,'Targeted review baseline lacks source judgment: '+unit.id);
    return remapCheck(carried,oldInventory,newByKey,oldLines,newLines);
  });
  const targetedRaw=new Map(r.raw_checks.map(check=>[check.id,check]));
  const priorRaw=new Map(prior.raw_checks.map(check=>[check.id,check]));
  const raw_checks=newInventory.map(unit=>{
    if(targetedRaw.has(unit.id))return targetedRaw.get(unit.id);
    const old=oldByKey.get(unit.key),check=old&&priorRaw.get(old.id);
    assert(check,'Targeted review omitted a changed or previously unresolved Raw unit: '+unit.id);
    return {...structuredClone(check),id:unit.id};
  });
  const targetClaimIds=new Set(q.target_core_claims.map(claim=>claim.id));
  for(const id of targetClaimIds)assert(r.core_claims.some(claim=>claim.id===id),'Targeted review omitted an affected core claim: '+id);
  const carriedClaims=prior.core_claims.filter(claim=>!targetClaimIds.has(claim.id)).map(claim=>remapCheck(claim,oldInventory,newByKey,oldLines,newLines));
  const core_claims=[...carriedClaims,...r.core_claims];
  return {...r,core_claims,source_checks,raw_checks};
}
function readBaselineReceipt(root,baseline){
  const receipt=read(root,baseline.receipt);
  assert(receipt.schema_version===6&&receipt.standard===VERSION&&receipt.ruleset===RULESET,'Targeted baseline receipt is not current Raw v2 evidence');
  assert(receipt.request_path===baseline.request&&receipt.request_sha256===hash(root,baseline.request),'Targeted baseline request binding mismatch');
  assert(receipt.decision_path===baseline.review&&receipt.decision_sha256===hash(root,baseline.review),'Targeted baseline report binding mismatch');
  assert(receipt.host_path&&receipt.host_sha256===hash(root,receipt.host_path),'Targeted baseline host binding mismatch');
  return receipt;
}
function targetPlan(root,manifestPath,manifest,currentRawUnits,baseline){
  const bq=read(root,baseline.request),brRaw=read(root,baseline.review),receipt=readBaselineReceipt(root,baseline);
  assert(['failed','needs_review','media_limited'].includes(receipt.status),'Targeted recheck requires an unresolved baseline receipt');
  assert(bq.manifest.sha256===hash(root,manifestPath),'Targeted recheck requires the unchanged source manifest');
  const br=materializeReport(root,bq,brRaw),oldInventory=requestRawInventory(bq),newInventory=inventory(currentRawUnits);
  const oldById=new Map(oldInventory.map((unit,index)=>[unit.id,{...unit,index}]));
  const newByKey=new Map(newInventory.map((unit,index)=>[unit.key,{...unit,index}]));
  const targetRaw=new Set(),targetSources=new Set();
  const addRawIndex=index=>{for(const offset of [-1,0,1])if(newInventory[index+offset])targetRaw.add(newInventory[index+offset].id);};
  for(const [index,unit] of newInventory.entries())if(!oldInventory.some(old=>old.key===unit.key))addRawIndex(index);
  const addOldRange=range=>{
    for(const old of oldInventory.filter(unit=>overlaps(range,unit))){const current=newByKey.get(old.key);if(current)addRawIndex(current.index);}
  };
  for(const finding of [...(br.findings??[]),...(br.style?.findings??[])]){
    for(const id of finding.source_ids??[])targetSources.add(id);
    for(const range of finding.raw_ranges??[])addOldRange(range);
  }
  for(const check of br.source_checks){
    const unresolved=check.status!=='complete'||(check.elements??[]).some(element=>element.status!=='complete'&&element.status!=='not_applicable');
    const touchesChanged=(check.elements??[]).some(element=>(element.raw_ranges??[]).some(range=>oldInventory.some(unit=>!newByKey.has(unit.key)&&overlaps(range,unit))));
    if(unresolved||touchesChanged)targetSources.add(check.id);
  }
  for(const id of receipt.failed_units??[]){if(manifest.units.some(unit=>unit.id===id))targetSources.add(id);const old=oldById.get(id);if(old){const current=newByKey.get(old.key);if(current)addRawIndex(current.index);}}
  for(const old of oldInventory.filter(unit=>!newByKey.has(unit.key))){
    for(const id of br.raw_checks.find(check=>check.id===old.id)?.source_ids??[])targetSources.add(id);
    for(const claim of br.core_claims??[])if((claim.raw_ranges??[]).some(range=>overlaps(range,old)))for(const id of claim.source_ids??[])targetSources.add(id);
  }
  for(const id of targetRaw){
    const current=newInventory.find(unit=>unit.id===id),old=oldInventory.find(unit=>unit.key===current.key);
    if(old)for(const sourceId of br.raw_checks.find(check=>check.id===old.id)?.source_ids??[])targetSources.add(sourceId);
  }
  if(br.manifest_review?.status!=='complete')for(const unit of manifest.units)targetSources.add(unit.id);
  if(!targetSources.size)for(const unit of manifest.units)targetSources.add(unit.id);
  const target_core_claims=(br.core_claims??[]).filter(claim=>claim.source_ids.some(id=>targetSources.has(id))||(claim.raw_ranges??[]).some(range=>oldInventory.some(unit=>!newByKey.has(unit.key)&&overlaps(range,unit)))).map(claim=>({id:claim.id,meaning:claim.meaning,source_ids:claim.source_ids}));
  return {
    source_units:manifest.units.filter(unit=>targetSources.has(unit.id)),
    raw_units:currentRawUnits.filter(unit=>targetRaw.has(unit.id)),
    raw_inventory:newInventory,
    target_core_claims,
    target_summary:{source_unit_count:targetSources.size,raw_unit_count:targetRaw.size,core_claim_count:target_core_claims.length,full_source_unit_count:manifest.units.length,full_raw_unit_count:currentRawUnits.length}
  };
}
export function evaluate(root,{request,review,host,mode='stage1'}){
  assert(['stage1','backtest'].includes(mode),'Invalid mode');
  const q=read(root,request);verifyRequest(root,q);
  const manifest=read(root,q.manifest.path),fullSourceUnits=manifest.units,fullRawUnits=rawUnits(text(root,q.raw.path));
  const base={schema_version:6,standard:VERSION,ruleset:RULESET,mode,raw_path:q.raw.path,raw_sha256:q.raw.sha256,sources:q.sources.map(s=>({source_path:s.path,source_sha256:s.sha256})),manifest_path:q.manifest.path,manifest_sha256:q.manifest.sha256,
    request_path:request,request_sha256:hash(root,request),unit_count:fullSourceUnits.length,review_persistence:'compiled_in_memory',scope:q.review_scope==='targeted_recheck'?'full_text_bidirectional_compiled':'full_text_bidirectional',mechanical:q.mechanical,
    coverage_counts:Object.fromEntries(statuses.map(s=>[s,0])),retention_policy_counts:{},context_omissions:[],media_disclosures:[],failed_unit_count:0,anomaly_count:0,findings:[]};
  if(!review||!host)return {...base,status:'needs_review',semantic_status:'not_executed',reason:'Independent report and host invocation evidence required'};
  const submitted=read(root,review),h=read(root,host);
  assert(submitted.schema_version===2&&submitted.ruleset===RULESET&&submitted.request_sha256===base.request_sha256,'Review request/version mismatch');
  assert(h.schema_version===1&&h.request_sha256===base.request_sha256&&h.report_sha256===hash(root,review),'Host invocation binding mismatch');
  assert(['host_observed','reviewer_attested','contract_fixture'].includes(h.evidence_class),'Explicit backtest evidence class required');
  assert(nonempty(h.invocation_id)&&nonempty(h.reviewer_context_id)&&h.reviewer_context_id===submitted.reviewer_context_id&&h.reviewer_context_id!==q.producer_context_id&&h.producer_context_id===q.producer_context_id,'Independent context evidence missing');
  const contextMode=h.context_mode??(h.fresh_context===true?'fresh_full_review':null);
  if(contextMode==='fresh_full_review')assert(h.fresh_context===true,'Fresh full review requires a fresh context');
  else if(contextMode==='sample_blind_reuse'){
    assert(q.review_scope==='full_text_bidirectional'&&h.fresh_context===false&&h.prior_context_reused===true&&h.sample_blind===true&&h.scoring_blind===true&&h.independent_from_writer===true&&h.prior_artifact_exposure===false,'Sample-blind reuse evidence is incomplete');
  }else if(contextMode==='cross_targeted_recheck'){
    assert(q.review_scope==='targeted_recheck'&&h.fresh_context===false&&h.prior_context_reused===true&&h.cross_reviewer===true&&h.independent_from_writer===true,'Cross-targeted recheck evidence is incomplete');
    const baselineReceipt=read(root,q.baseline.receipt.path);
    assert(nonempty(baselineReceipt.reviewer_context_id)&&baselineReceipt.reviewer_context_id!==h.reviewer_context_id,'The original reviewer cannot approve their own repair finding');
    assert(h.baseline_reviewer_context_id===baselineReceipt.reviewer_context_id,'Cross-review baseline identity mismatch');
  }else throw Error('Unsupported backtest context mode');
  assert(nonempty(h.model)&&h.audit_config===q.audit_config,'Model/config evidence missing');
  assert(Number.isFinite(Date.parse(h.started_at))&&Number.isFinite(Date.parse(h.ended_at))&&Date.parse(h.ended_at)>=Date.parse(h.started_at),'Invalid invocation time');
  assert(h.provenance?.path&&hash(root,h.provenance.path)===h.provenance.sha256,'Missing host provenance');
  const p=read(root,h.provenance.path);
  if(h.evidence_class==='reviewer_attested'){
    assert(p.evidence_class==='reviewer_attested'&&nonempty(h.submission_id)&&p.submission_id===h.submission_id&&p.reviewer_context_id===h.reviewer_context_id&&p.request_sha256===h.request_sha256&&p.report_sha256===h.report_sha256,'Reviewer attestation does not identify this invocation');
  }else assert(p.invocation_id===h.invocation_id&&p.reviewer_context_id===h.reviewer_context_id&&p.request_sha256===h.request_sha256,'Provenance does not identify this invocation');
  exactChecks(submitted.source_checks,q.source_units);exactChecks(submitted.raw_checks,q.raw_units);
  const r=materializeReport(root,q,submitted);
  exactChecks(r.source_checks,fullSourceUnits);exactChecks(r.raw_checks,fullRawUnits);
  const ids=new Set(fullSourceUnits.map(u=>u.id)),rawUnitsById=new Map(fullRawUnits.map(u=>[u.id,u]));
  const rawLines=text(root,q.raw.path).split(/\r?\n/);
  const requiresRawQuote=(q.evidence_contract_version??1)>=2;
  const rawQuoteInRanges=(quote,rs)=>nonempty(quote)&&rs.some(([a,b])=>norm(rawLines.slice(a-1,b).join('\n')).includes(norm(quote)));
  let limited=false,uncertain=false;
  const failures=new Set();
  assert(Array.isArray(r.core_claims)&&r.core_claims.length,'Core claim inventory required');
  const claimIds=new Set();
  for(const c of r.core_claims){
    assert(nonempty(c.id)&&!claimIds.has(c.id)&&nonempty(c.meaning)&&Array.isArray(c.source_ids)&&c.source_ids.length&&c.source_ids.every(id=>ids.has(id)),'Invalid core claim');
    claimIds.add(c.id);ranges(c.raw_ranges,q.raw_line_count);
    if(!c.raw_ranges.length)failures.add('core:'+c.id);
  }
  base.core_claim_count=r.core_claims.length;
  const justify=(j,label)=>assert(j&&nonempty(j.reason)&&Array.isArray(j.claim_ids)&&j.claim_ids.length&&j.claim_ids.every(id=>claimIds.has(id)),label+' needs a specific rationale linked to core claims');
  const omitted=e=>e.status==='not_applicable'&&e.retention==='context';
  for(const u of fullSourceUnits){
    const c=r.source_checks.find(c=>c.id===u.id);
    assert(statuses.includes(c.status)&&(c.status==='complete'||nonempty(c.reason)),'Source judgment needs a valid status and failures need a reason: '+u.id);
    assert(['required','structure','omit_metadata','omit_duplicate','omit_nonsemantic_media','omit_context','media'].includes(c.policy),'Unsupported retention policy');
    base.coverage_counts[c.status]++;base.retention_policy_counts[c.policy]=(base.retention_policy_counts[c.policy]??0)+1;
    if(c.policy==='required'){
      assert(Array.isArray(c.elements)&&c.elements.length,'Required unit needs independent information elements: '+u.id);
      for(const e of c.elements){
        assert(nonempty(e.source_quote)&&norm(u.text).includes(norm(e.source_quote))&&(e.status==='complete'||nonempty(e.reason)),'Missing/unsupported source element or unexplained failure: '+u.id);
        assert(['complete','partial','missing','distorted','uncertain'].includes(e.status)||omitted(e),'Invalid element status');ranges(e.raw_ranges,q.raw_line_count);
        if(omitted(e)){justify(e.omission,'Context omission');assert(!e.raw_ranges.length,'Omitted context cannot claim a Raw range');base.context_omissions.push({source_id:u.id,meaning:nonempty(e.meaning)?e.meaning:e.source_quote,...e.omission});continue;}
        if(['complete','partial','distorted'].includes(e.status)){
          assert(e.raw_ranges.length,'Located element needs Raw range');
          if(requiresRawQuote)assert(rawQuoteInRanges(e.raw_quote,e.raw_ranges),'Located element needs an actual Raw quote inside its claimed range: '+u.id);
        }
        if(e.status==='missing')assert(e.raw_ranges.length===0,'Missing element cannot claim a Raw range');
        if(e.status!=='complete')failures.add(u.id);if(e.status==='uncertain')uncertain=true;
      }
      if(c.status!=='complete')failures.add(u.id);
      assert(c.status!=='complete'||c.elements.every(e=>e.status==='complete'||omitted(e)),'Unit complete contradicts elements');
      assert(c.elements.some(e=>!omitted(e)),'Whole contextual unit must use omit_context');
    }else if(c.policy==='structure')assert(u.kind==='heading'&&c.status==='complete','Only headings may be structural');
    else if(c.policy==='media'){
      assert(u.kind==='media'&&['marker_only','missing','uncertain'].includes(c.status),'Invalid media policy');
      if(c.status==='marker_only'){
        ranges(c.raw_ranges,q.raw_line_count);assert(c.raw_ranges.length,'Media marker needs location');
        const rawLines=text(root,q.raw.path).split(/\r?\n/);
        assert(c.raw_ranges.some(([a,b])=>rawLines.slice(a-1,b).join('\n').includes('未转录')),'Media marker not found');
        if(c.nonessential)justify(c.nonessential,'Nonessential media');else limited=true;
        base.media_disclosures.push({source_id:u.id,raw_ranges:c.raw_ranges,essential:!c.nonessential,reason:c.nonessential?.reason??c.reason,claim_ids:c.nonessential?.claim_ids??[]});
      }else failures.add(u.id);
    }else{
      assert(c.status==='not_applicable','Omission must retain actual not_applicable status');
      if(c.policy==='omit_context'){justify(c.omission,'Context omission');base.context_omissions.push({source_id:u.id,...c.omission});}
      if(c.policy==='omit_nonsemantic_media')assert(u.kind==='media','Nonmedia cannot be omitted as media');
      if(c.policy==='omit_duplicate'){
        const target=r.source_checks.find(x=>x.id===c.duplicate_of);
        assert(target&&target.id!==c.id&&target.policy==='required'&&target.status==='complete','Duplicate must point to retained content');
      }
    }
    if(c.status==='uncertain')uncertain=true;
  }
  for(const c of r.raw_checks){
    assert(['supported','unsupported','uncertain'].includes(c.status)&&(c.status==='supported'||nonempty(c.reason))&&Array.isArray(c.source_ids)&&c.source_ids.every(id=>ids.has(id)),'Invalid or unexplained reverse judgment');
    if(c.status==='supported'){
      assert(c.source_ids.length,'Supported Raw needs source');
      if(requiresRawQuote)assert(nonempty(c.raw_quote)&&norm(rawUnitsById.get(c.id)?.text??'').includes(norm(c.raw_quote)),'Supported Raw needs an actual Raw quote from its own unit: '+c.id);
    }
    if(c.status!=='supported')failures.add(c.id);if(c.status==='uncertain')uncertain=true;
  }
  for(const key of ['manifest_review','style','cross_section']){
    assert(['complete','partial','uncertain'].includes(r[key]?.status)&&(r[key].status==='complete'||nonempty(r[key]?.reason)),'Missing or unexplained holistic review: '+key);
    if(r[key].status!=='complete')failures.add(key);if(r[key].status==='uncertain')uncertain=true;
  }
  assert(Array.isArray(r.findings)&&Array.isArray(r.style.findings),'Findings arrays required');
  for(const f of [...r.findings,...r.style.findings]){
    assert(/^R(?:0[1-9]|1[0-3])$/.test(f.rule)&&nonempty(f.detail)&&Array.isArray(f.source_ids)&&f.source_ids.every(id=>ids.has(id)),'Invalid finding');ranges(f.raw_ranges,q.raw_line_count);assert(f.source_ids.length||f.raw_ranges.length,'Finding needs location');
    if(f.resolution!==undefined){
      assert(['repair','semantic_dispute'].includes(f.resolution),'Invalid finding resolution');
      if(f.resolution==='semantic_dispute')assert(/^R0[1-5]$/.test(f.rule)&&f.source_ids.length,'Semantic dispute must concern an evidenced R01-R05 interpretation');
    }
  }
  base.evidence_class=h.evidence_class;base.context_mode=contextMode;
  base.context_disclosures={prior_context_reused:h.prior_context_reused===true,sample_blind:h.sample_blind===true,scoring_blind:h.scoring_blind===true,cross_reviewer:h.cross_reviewer===true,independent_from_writer:h.independent_from_writer===true,prior_artifact_exposure:h.prior_artifact_exposure===true};
  base.findings=[...q.mechanical.findings,...r.findings,...r.style.findings];
  const status=failures.size||base.findings.length?(uncertain&&!base.findings.length?'needs_review':'failed'):limited?'media_limited':'passed';
  return {...base,status,semantic_status:'reviewed',failed_unit_count:failures.size,failed_units:[...failures],decision_path:review,decision_sha256:hash(root,review),host_path:host,host_sha256:hash(root,host),host_provenance:h.provenance,reviewer_context_id:h.reviewer_context_id,model:h.model,audit_config:q.audit_config,review_scope:q.review_scope,target_summary:q.target_summary??null,baseline_receipt:q.baseline?.receipt??null,elapsed_ms:Date.parse(h.ended_at)-Date.parse(h.started_at),trust_boundary:'host attests actual invocation; hashes do not prove semantic truth'};
}
export function verify(root,receipt){
  const saved=read(root,receipt);assert(saved.schema_version===6&&saved.standard===VERSION&&saved.ruleset===RULESET,'Not a v2 current-ruleset quality receipt');
  const current=evaluate(root,{request:saved.request_path,review:saved.decision_path,host:saved.host_path,mode:saved.mode});
  assert(JSON.stringify(current)===JSON.stringify(saved),'Receipt differs from recomputed judgments/dependencies');return current;
}
export function buildManifest(root,raw,manifest,sources){
  const declared=sourcePaths(text(root,raw)),paths=sources??declared;
  assert(paths.length,'No sources: provide --sources for non-clipping input');
  for(const s of paths)safe(root,s);
  const dest=safe(root,manifest,false);assert(!fs.existsSync(dest),'Manifest output already exists; preserve prior version');
  execFileSync(process.platform==='win32'?'powershell.exe':'pwsh',['-NoProfile','-ExecutionPolicy','Bypass','-File',safe(root,'system/maintenance/checklists/source-content-audit.ps1'),'-Action','manifest','-SourcePath',paths.join(';'),'-ManifestPath',manifest],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024});
}
if(process.argv[1]&&path.resolve(process.argv[1])===own){
  try{
    const [action,...args]=process.argv.slice(2),o={};for(let i=0;i<args.length;i+=2){assert(args[i].startsWith('--')&&args[i+1]!==undefined,'Expected --key value');o[args[i].slice(2)]=args[i+1];}
    const root=fs.realpathSync(o.root??path.resolve(path.dirname(own),'../../..'));let result;
    if(action==='prepare'){if(!fs.existsSync(safe(root,o.manifest,false)))buildManifest(root,o.raw,o.manifest,o.sources?.split(';'));result=prepare(root,o);}
    else if(action==='validate'){result=evaluate(root,o);if(o.receipt)output(root,o.receipt,result);}
    else if(action==='verify')result=verify(root,o.receipt);
    else if(action==='style')result=styleCheck(text(root,o.raw));
    else throw Error('Actions: prepare, validate, verify, style');
    console.log(JSON.stringify(result,null,2));
    if(['validate','verify','style'].includes(action)&&result.status!=='passed')process.exitCode=2;
  }catch(e){console.error('RAW_QUALITY_FAILED: '+e.message);process.exitCode=1;}
}
