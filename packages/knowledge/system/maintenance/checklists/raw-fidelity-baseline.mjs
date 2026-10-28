// Reuse a bound maintenance disposition, not a new semantic or full-media PASS.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const BASELINE_POINTER='system/registry/raw-fidelity-maintenance-baseline.json';
export const fingerprint=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
function safe(root,p){
 if(typeof p!=='string'||!p||path.isAbsolute(p)||p.includes('\\')||p.split('/').some(s=>['.','..','.git',''].includes(s)))throw Error('Unsafe baseline path');
 const full=path.resolve(root,p);if(!full.startsWith(root+path.sep))throw Error('Baseline escapes root');
 if(fs.existsSync(full)&&!fs.realpathSync(full).startsWith(root+path.sep))throw Error('Linked baseline escapes root');return full;
}
const names=(root,folder)=>fs.readdirSync(safe(root,folder)).filter(n=>n.endsWith('.md')&&n!=='README.md'&&!n.endsWith('.template.md')).map(n=>folder+'/'+n).sort();
export function dispositionDelta(baseline,current){
 const changes={new_raw:[],changed_raw_or_sources:[],removed_raw:[],changed_wiki:[],removed_wiki:[],new_wiki:[],changed_evidence:[],changed_policy:[],known_limitations_carried:[],unchanged_dispositions_reused:[]};
 const now=new Set(current.raw_paths),old=new Set(Object.keys(baseline.raws));
 const equivalent=p=>baseline.lf_files?.[p]&&current.lf_hashes?.[p]===baseline.lf_files[p];
 const changed=p=>current.hashes[p]!==baseline.files[p]&&!equivalent(p);
 for(const p of current.raw_paths){
  if(!old.has(p)){changes.new_raw.push(p);continue;}
  const row=baseline.raws[p],affected=[p,...row.source_paths].filter(changed);
  if(affected.length)changes.changed_raw_or_sources.push({path:p,dependencies:affected,action:'Review affected meaning and necessary context; do not re-audit unrelated accepted articles'});
  else{changes.unchanged_dispositions_reused.push(p);if(row.disposition==='source_acquisition_limited')changes.known_limitations_carried.push({path:p,disposition:row.disposition});}
 }
 changes.removed_raw=[...old].filter(p=>!now.has(p));
 const wiki=new Set(current.wiki_paths),beforeWiki=new Set(baseline.wiki_paths);
 changes.new_wiki=[...wiki].filter(p=>!beforeWiki.has(p));changes.removed_wiki=[...beforeWiki].filter(p=>!wiki.has(p));changes.changed_wiki=[...beforeWiki].filter(p=>wiki.has(p)&&changed(p));
 changes.changed_evidence=baseline.evidence_paths.filter(changed);changes.changed_policy=baseline.policy_paths.filter(changed);
 // Changed evidence/policy is never silently ignored or converted into 1585 new
 // semantic tasks. Establish applicability/recover evidence before any reuse.
 const actionable=changes.new_raw.length+changes.changed_raw_or_sources.length;
 return {schema_version:1,kind:'maintenance_baseline_delta',changes,checkout_eol_equivalent:Object.keys(baseline.files).filter(p=>current.hashes[p]!==baseline.files[p]&&equivalent(p)),summary:{baseline_raw:old.size,current_raw:now.size,new_raw:changes.new_raw.length,changed_raw_or_sources:changes.changed_raw_or_sources.length,unchanged_dispositions_reused:changes.unchanged_dispositions_reused.length,carried_source_limits:changes.known_limitations_carried.length,wiki_deltas:changes.changed_wiki.length+changes.new_wiki.length+changes.removed_wiki.length,evidence_changes:changes.changed_evidence.length,policy_changes:changes.changed_policy.length,raw_review_candidates:actionable},semantic_pass_created:false,full_semantic_reviews_started:0,reuse_status:changes.changed_evidence.length||changes.changed_policy.length?'check_changed_evidence_or_policy_applicability':'bound_dispositions_reusable',limits:['Unchanged means previously disposed scope only, never whole-library native/full-media certification','Existing limitations are carried, not passed; new material or a concrete regression can reopen its affected scope','Wiki-only deltas require consumer review, not a new audit of every unchanged Raw']};
}
export function baselineDelta(root){
 root=fs.realpathSync(root);const pointerPath=safe(root,BASELINE_POINTER);if(!fs.existsSync(pointerPath))return null;
 const pointer=JSON.parse(fs.readFileSync(pointerPath,'utf8')),bytes=fs.readFileSync(safe(root,pointer.manifest_path));
 if(pointer.schema_version!==1||fingerprint(bytes)!==pointer.manifest_sha256)throw Error('Missing or changed maintenance baseline manifest');
 const baseline=JSON.parse(bytes);if(baseline.schema_version!==1||baseline.kind!=='raw_fidelity_maintenance_baseline'||!baseline.raws||!baseline.files)throw Error('Unsupported maintenance baseline');
 const raw_paths=names(root,'raw-sources'),wiki_paths=names(root,'wiki'),hashes={},lf_hashes={};
 for(const p of Object.keys(baseline.files)){const file=safe(root,p),b=fs.existsSync(file)?fs.readFileSync(file):null;hashes[p]=b?fingerprint(b):null;if(b&&baseline.lf_files?.[p])lf_hashes[p]=fingerprint(b.toString('utf8').replaceAll('\r\n','\n'));}
 return {...dispositionDelta(baseline,{raw_paths,wiki_paths,hashes,lf_hashes}),baseline_id:pointer.baseline_id,baseline_revision:baseline.repository_revision,baseline_manifest:pointer.manifest_path};
}
