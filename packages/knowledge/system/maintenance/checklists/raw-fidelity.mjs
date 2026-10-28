// Read-only evidence inventory. This module never creates a semantic PASS.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {sourcePaths,verify as verifyRaw,RULESET} from './raw-quality.mjs';
import {verifyCoreReceipt} from './core-review-control.mjs';
import {sourceByteIdentity} from './source-byte-identity.mjs';
import {metadataSuccessor} from './raw-metadata-successor.mjs';
import {baselineDelta} from './raw-fidelity-baseline.mjs';

const own=fileURLToPath(import.meta.url),digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export const CATEGORIES=['reusable_current','partial_review','changed_dependencies','legacy_review','needs_full_review','material_limited'];
export function classifyEvidence(input={}){
  const keys=['sourceMissing','verifiedCurrent','currentFailure','partial','changed','legacy'];
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.entries(input).some(([k,v])=>!keys.includes(k)||typeof v!=='boolean'))throw Error('Classification requires known boolean flags');
  const {sourceMissing=false,verifiedCurrent=false,currentFailure=false,partial=false,changed=false,legacy=false}=input;
  if(sourceMissing)return 'material_limited';
  if(currentFailure)return 'partial_review';
  if(verifiedCurrent)return 'reusable_current';
  if(partial)return 'partial_review';
  if(changed)return 'changed_dependencies';
  if(legacy)return 'legacy_review';
  return 'needs_full_review';
}
// A scoped maintenance reading is reusable text evidence, never a native V2/full-media PASS.
export function validateTextReview(entry,row,fingerprint,read){
  if(entry?.metadata_successor)return metadataSuccessor(entry,row,read,validateTextReview);
  const errors=[];
  const versionMatches=(actual,expected,variants)=>typeof expected==='string'&&/^[a-f0-9]{64}$/.test(expected)&&(actual===expected||Array.isArray(variants)&&variants.length>0&&variants.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))&&variants.includes(actual));
  const check=(p,h,variants)=>{try{return typeof p==='string'&&versionMatches(fingerprint(p),h,variants);}catch{return false;}};
  if(entry?.scope!=='complete_raw_and_local_source_text'||!['accepted_text','no_change_text'].includes(entry?.outcome))errors.push('Unsupported text scope or outcome');
  if(entry?.reviewer?.kind!=='host_direct_analysis'||!entry?.reviewer?.session_id)errors.push('Missing actual host reviewer identity');
  if(entry?.raw_path!==row.raw_path||!versionMatches(row.raw_sha256,entry?.raw_sha256,entry?.checkout_byte_sha256))errors.push('Raw version changed');
  const sources=Array.isArray(entry?.source_fingerprints)?entry.source_fingerprints:[];
  if(!sources.every(s=>s&&typeof s.path==='string')||!row.declared_sources.length||JSON.stringify([...new Set(sources.map(s=>s?.path))].sort())!==JSON.stringify([...new Set(row.declared_sources)].sort()))errors.push('Incomplete declared source set');
  if(!sources.every(s=>check(s?.path,s?.sha256,s?.checkout_byte_sha256)))errors.push('Source version changed');
  if(entry?.auxiliary_evidence!==undefined){
    const auxiliary=entry.auxiliary_evidence;
    const valid=Array.isArray(auxiliary)&&auxiliary.length>0&&auxiliary.every(e=>e&&typeof e.path==='string'&&e.path.startsWith('docs/audits/')&&!e.path.includes('\\')&&!e.path.split('/').some(p=>['','..','.','.git'].includes(p))&&['source_media','source_media_observation','source_text','source_text_observation'].includes(e.kind)&&check(e.path,e.sha256));
    if(!valid||new Set(auxiliary?.map?.(e=>e?.path)??[]).size!==auxiliary?.length)errors.push('Missing, malformed or changed auxiliary source evidence');
  }
  if(!check(entry?.decision_path,entry?.decision_sha256))errors.push('Missing or changed manual decision');
  if(!Array.isArray(entry?.limitations)||!entry.limitations.length||entry?.full_media_certified!==false)errors.push('Missing explicit certification boundary');
  return {reusable:errors.length===0,errors,not_native_v2_certification:true};
}
function safe(root,rel){
  if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('\\')||rel.split('/').some(p=>['','..','.','.git'].includes(p)))throw Error('Unsafe relative path');
  const full=path.resolve(root,rel);if(!full.startsWith(root+path.sep))throw Error('Escaped root');
  if(fs.existsSync(full)&&!fs.realpathSync(full).startsWith(root+path.sep))throw Error('Linked path escaped root');return full;
}
function walk(root,dir){
  if(!fs.existsSync(path.join(root,dir)))return [];
  return fs.readdirSync(path.join(root,dir),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name,'en')).flatMap(e=>{
    if(e.isSymbolicLink())throw Error('Linked evidence directory/file: '+dir+'/'+e.name);
    const p=dir+'/'+e.name;return e.isDirectory()?walk(root,p):e.isFile()&&p.endsWith('.json')?[p]:[];
  });
}
export function inventory(root){
  root=fs.realpathSync(root);const begun=Date.now(),cache=new Map(),hashes=new Map();
  const bytes=p=>{if(!cache.has(p))cache.set(p,fs.readFileSync(safe(root,p)));return cache.get(p);};
  const hash=p=>{if(!hashes.has(p))hashes.set(p,digest(bytes(p)));return hashes.get(p);};
  const json=p=>JSON.parse(bytes(p).toString('utf8').replace(/^\uFEFF/,''));
  const migrations=new Map(json('system/registry/clipping-path-migrations.json').migrations.map(x=>[x.old_path,x.new_path]));
  const resolve=p=>{const seen=new Set();while(!fs.existsSync(safe(root,p))&&migrations.has(p)){if(seen.has(p))throw Error('Migration cycle');seen.add(p);p=migrations.get(p);}
    // Obsidian permits an unqualified basename. Only the exact Clippings filename is resolved here.
    if(!p.includes('/')&&!fs.existsSync(safe(root,p))&&fs.existsSync(safe(root,'Clippings/'+p)))p='Clippings/'+p;
    return p;};
  const reference=(p,expected,isSource=false)=>{
    try{const actual=resolve(p);const identity=isSource?sourceByteIdentity(bytes(actual),expected,actual):null;return {path:p,current_path:actual,exists:fs.existsSync(safe(root,actual)),matches:identity?identity.matches:hash(actual)===expected,...(identity?{byte_identity:identity}:{})};}
    catch(error){return {path:p,exists:false,matches:false,reason:error.message};}
  };
  const names=fs.readdirSync(path.join(root,'raw-sources')).filter(n=>n.endsWith('.md')&&n!=='README.md'&&!n.endsWith('.template.md')).sort();
  const rows=names.map(n=>{
    const p='raw-sources/'+n,text=bytes(p).toString('utf8').replace(/^\uFEFF/,'');let declared=[],metadataError=null;
    try{declared=sourcePaths(text).map(s=>resolve(s));}catch(e){metadataError=e.message;}
    return {raw_path:p,raw_sha256:hash(p),raw_bytes:bytes(p).length,declared_sources:declared,metadata_error:metadataError,evidence:[],scoped_evidence:[]};
  });
  const byRaw=new Map(rows.map(r=>[r.raw_path,r]));const failures=[];let scanned=0,candidates=0;
  for(const p of [...walk(root,'system/maintenance'),...walk(root,'docs/audits')]){
    scanned++;let r;try{r=json(p);}catch(e){failures.push({path:p,reason:'JSON parse: '+e.message});continue;}
    if(r?.kind==='raw_text_review'&&r.schema_version===1&&Array.isArray(r.entries)){
      for(const entry of r.entries){const row=byRaw.get(entry.raw_path);if(!row)continue;
        const validation=validateTextReview(entry,row,hash,bytes);
        row.scoped_evidence.push({path:p,sha256:hash(p),scope:entry.scope,outcome:entry.outcome,validation,raw_matches:entry.raw_sha256===row.raw_sha256,not_full_certification:true});
      }
    }
    if(!r||typeof r!=='object'||!byRaw.has(r.raw_path)||typeof r.raw_sha256!=='string'||typeof r.manifest_path!=='string'||typeof r.status!=='string')continue;
    candidates++;const row=byRaw.get(r.raw_path),refs=[['manifest',r.manifest_path,r.manifest_sha256],['request',r.request_path,r.request_sha256],['review',r.review_path,r.review_sha256],['decision',r.decision_path,r.decision_sha256],['host',r.host_path,r.host_sha256]].filter(x=>x[1]);
    const bindings=refs.map(([kind,p,h])=>({kind,...reference(p,h)})),sources=(r.sources??[]).map(s=>reference(s.source_path,s.source_sha256,true));
    const rawMatches=row.raw_sha256===r.raw_sha256,sourceMatches=sources.length>0&&sources.every(s=>s.matches),artifactMatches=bindings.length>0&&bindings.every(b=>b.matches);
    let verified=false,verifyError=null;
    const modern=r.standard==='RAW_STANDARD_V2'&&[6,7].includes(r.schema_version);
    if(modern&&r.status==='passed'&&rawMatches&&sourceMatches&&artifactMatches){
      try{
        if(row.declared_sources.length&&JSON.stringify([...new Set(row.declared_sources)].sort())!==JSON.stringify([...new Set(sources.map(s=>s.current_path))].sort()))throw Error('Receipt does not cover the full declared source set');
        if(r.schema_version===7){if(r.coverage_contract!==2)throw Error('Core receipt lacks section coverage contract 2');verifyCoreReceipt(root,{receipt:p});}
        else {if(r.ruleset!==RULESET)throw Error('Old ruleset');const result=verifyRaw(root,p);if(result.status!=='passed'||result.evidence_class!=='host_observed')throw Error('No passed host-observed result');}
        verified=true;
      }catch(e){verifyError=e.message;}
    }
    row.evidence.push({path:p,sha256:hash(p),schema_version:r.schema_version,status:r.status,standard:r.standard??'legacy',scope:r.scope??r.audit_scope??'legacy_source_mapping',recorded_raw_sha256:r.raw_sha256,raw_matches:rawMatches,source_bindings:sources,artifact_bindings:bindings,verified_current:verified,verification_error:verifyError,recorded_marker_only:r.coverage_counts?.marker_only??0,recorded_media_disclosures:r.media_disclosures??[],historical_only:!verified});
  }
  // Explicit scope prevents the seven-article repair package from becoming seven full certifications.
  const scoped='docs/audits/source-gap-remediation-20261013/review-round02.json';
  if(fs.existsSync(safe(root,scoped))){const r=json(scoped);for(const entry of r.second_group??[]){if(byRaw.has(entry.file))byRaw.get(entry.file).scoped_evidence.push({path:scoped,id:entry.id,scope:entry.review_scope,limitation:entry.certification_limit??entry.remaining_problem,not_full_certification:true});}}
  const repairBindings='docs/audits/source-gap-remediation-20261013/current-bindings.json';
  if(fs.existsSync(safe(root,repairBindings)))for(const [p,version] of Object.entries(json(repairBindings).raw_changes??{}))if(byRaw.has(p))byRaw.get(p).scoped_evidence.push({path:repairBindings,raw_matches:byRaw.get(p).raw_sha256===version.current_sha256,scope:'Previously repaired findings only; exact semantic scopes remain in review-round02/03/04',followup_evidence:['docs/audits/source-gap-remediation-20261013/review-round03.json','docs/audits/source-gap-remediation-20261013/review-round04.json'],not_full_certification:true});
  const categories=Object.fromEntries(CATEGORIES.map(c=>[c,0]));
  for(const row of rows){
    const validSources=row.declared_sources.length?row.declared_sources:row.evidence.flatMap(e=>e.source_bindings.map(s=>s.current_path??s.path));
    const missing=validSources.length===0||validSources.some(p=>!fs.existsSync(safe(root,p))||/^capture_status:\s*(?:missing|unavailable)\s*$/m.test(bytes(p).toString('utf8')));
    const exact=row.evidence.filter(e=>e.raw_matches);
    const currentFailure=exact.some(e=>['failed','needs_review','media_limited'].includes(e.status)&&e.source_bindings.length&&e.source_bindings.every(s=>s.matches));
    const flags={sourceMissing:missing,verifiedCurrent:exact.some(e=>e.verified_current),currentFailure,partial:row.scoped_evidence.length>0,changed:row.evidence.length>0&&!exact.some(e=>e.status==='passed'&&e.source_bindings.length&&e.source_bindings.every(s=>s.matches)&&e.artifact_bindings.every(b=>b.matches)),legacy:exact.some(e=>e.status==='passed')};
    row.classification=classifyEvidence(flags);categories[row.classification]++;row.classification_flags=flags;
    row.media_status=exact.some(e=>e.recorded_marker_only>0)?'historical_marker_only_needs_necessity_review':/未转录|未读取|媒体受限/.test(bytes(row.raw_path).toString('utf8'))?'disclosed_untranscribed_not_automatically_essential':'not_certified_by_inventory';
    row.semantic_pass_created=false;
    row.text_review_status=row.scoped_evidence.some(e=>e.validation?.reusable)?'reusable_scoped_text_review':'not_certified_by_scoped_text_review';
  }
  return {schema_version:1,kind:'raw_fidelity_inventory',generated_at:new Date().toISOString(),elapsed_ms:Date.now()-begun,raw_count:rows.length,categories,scanned_json:scanned,receipt_candidates:candidates,parse_failures:failures,rows,maintenance_baseline:baselineDelta(root),semantic_pass_created:false,limits:['Legacy evidence is not current RAW_STANDARD_V2 certification','Source markers and missing receipts are not proven semantic defects','Media necessity requires actual semantic adjudication','Scoped repair evidence does not certify a whole article','When maintenance_baseline is present, its delta owns repeat-work selection; archive classifications alone do not reopen accepted unchanged scopes']};
}
if(process.argv[1]&&path.resolve(process.argv[1])===own){
  try{const [action,...args]=process.argv.slice(2),opts={};for(let i=0;i<args.length;i+=2){if(!args[i]?.startsWith('--')||args[i+1]===undefined)throw Error('Expected --key value');opts[args[i].slice(2)]=args[i+1];}
    if(!['inventory','delta'].includes(action))throw Error('Action: inventory | delta');const root=fs.realpathSync(opts.root??path.resolve(path.dirname(own),'../../..'));const result=action==='delta'?baselineDelta(root):inventory(root);
    if(action==='delta'){if(!result)throw Error('No maintenance baseline is registered');const view=opts.format==='full'?result:{...result,changes:{...result.changes,unchanged_dispositions_reused:undefined},checkout_eol_equivalent:undefined,checkout_eol_equivalent_count:result.checkout_eol_equivalent.length};console.log(JSON.stringify(view,null,2));process.exitCode=result.summary.evidence_changes||result.summary.policy_changes?2:0;}
    else {
    if(opts.output){if(!/^docs\/audits\/[a-z0-9-]+\/[a-z0-9.-]+\.json$/.test(opts.output))throw Error('Output must be a new audit JSON');const out=safe(root,opts.output);if(fs.existsSync(out))throw Error('Preserve existing evidence; choose a new revision');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');}
    console.log(JSON.stringify({raw_count:result.raw_count,categories:result.categories,scanned_json:result.scanned_json,receipt_candidates:result.receipt_candidates,parse_failures:result.parse_failures.length,elapsed_ms:result.elapsed_ms,maintenance_baseline:result.maintenance_baseline?.summary??null,semantic_pass_created:false}));
    }
  }catch(e){console.error(e.message);process.exitCode=2;}
}
