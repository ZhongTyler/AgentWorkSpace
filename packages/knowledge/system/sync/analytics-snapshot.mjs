import fs from 'node:fs';
import path from 'node:path';
import {canonical,hash,namespaceKey,readJson,atomicJson,requireValue} from './state.mjs';
import {compileReviewedSchema} from './schema-check.mjs';
import {preserveRatio,feedbackMetricBoundary} from './metric-boundary.mjs';
import {assertMinimalMetadata} from './private-metadata.mjs';
function schemaValidator(config){
 requireValue(typeof config.analyticsSchemaPath==='string'&&path.isAbsolute(config.analyticsSchemaPath)&&/^[a-f0-9]{64}$/.test(config.analyticsSchemaSha256??''),'analysis_schema_unconfirmed');
 const stat=fs.lstatSync(config.analyticsSchemaPath);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=262144,'analysis_schema_unconfirmed');
 const bytes=fs.readFileSync(config.analyticsSchemaPath);requireValue(hash(bytes)===config.analyticsSchemaSha256,'analysis_schema_drift');
 const schema=JSON.parse(bytes.toString('utf8'));requireValue(schema.$id==='knowledge-analysis-snapshot-v1','analysis_schema_unconfirmed');return compileReviewedSchema(schema);
}
function checkRatios(value){if(!value||typeof value!=='object')return;if(!Array.isArray(value)&&Object.keys(value).sort().join(',')==='denominator,numerator,value')preserveRatio(value);for(const child of Object.values(value))checkRatios(child);}
function checkFeedback(f){
 requireValue(f.metric_version==='answer-feedback-v1'&&f.window_basis==='answer_finished_at','analysis_snapshot_invalid');
 for(const row of [f,...f.by_result,...f.groups]){
  requireValue(row.helpful_count+row.unhelpful_count===row.effective_votes&&row.effective_votes+row.unrated_count===row.eligible_answers,'analysis_snapshot_invalid');
  requireValue(row.helpful.numerator===row.helpful_count&&row.helpful.denominator===row.effective_votes&&row.response_rate.numerator===row.effective_votes&&row.response_rate.denominator===row.eligible_answers,'analysis_snapshot_invalid');
 }
 requireValue(new Set(f.by_result.map(r=>r.result_kind)).size===2&&f.by_result.length===2,'analysis_snapshot_invalid');
 for(const key of ['eligible_answers','effective_votes','helpful_count','unhelpful_count','unrated_count'])requireValue(f.by_result.reduce((n,r)=>n+r[key],0)===f[key]&&f.groups.reduce((n,r)=>n+r[key],0)===f[key],'analysis_snapshot_invalid');
 const keys=f.groups.map(g=>canonical([g.model,g.snapshot_id,g.entry,g.billing_mode,g.result_kind]));requireValue(new Set(keys).size===keys.length,'analysis_snapshot_invalid');
}
export function validateAnalysisSnapshot(snapshot,config,context){
 schemaValidator(config)(snapshot);assertMinimalMetadata(snapshot);
 const {snapshot_sha256,...body}=snapshot;
 requireValue(hash(canonical(body))===snapshot_sha256&&canonical(snapshot.namespace)===canonical(context.namespace)&&snapshot.core_payload_sha256===context.corePayloadSha256&&snapshot.reject_before===context.rejectBefore,'analysis_snapshot_integrity');
 requireValue(snapshot.as_of<=context.now&&Date.parse(snapshot.expires_at)>context.now&&Date.parse(snapshot.expires_at)<=snapshot.as_of+snapshot.policy.retention_ms&&snapshot.policy.version.trim().length>0,'analysis_snapshot_expired');
 if(snapshot.state==='available'){
  requireValue(config.analyticsSnapshotImportConfirmed===true&&Number.isSafeInteger(config.maxAnalyticsRetentionMs)&&config.maxAnalyticsRetentionMs>=snapshot.policy.retention_ms,'analysis_policy_unconfirmed');
  let end=-1;for(const metric of snapshot.data.windows){const w=metric.window;requireValue(w.from<w.to&&w.from>=end&&w.to<=snapshot.as_of+1&&metric.feedback.as_of>=snapshot.as_of&&metric.feedback.as_of<=context.now,'analysis_snapshot_invalid');end=w.to;checkRatios(metric);checkFeedback(metric.feedback);
   for(const billing of [metric.billing.public_pool,metric.billing.byok_ds])for(const token of Object.values(billing.reported_tokens))requireValue(token.known+token.missing===billing.call_attempts&&(token.known===0?token.total===null:Number.isSafeInteger(token.total)),'analysis_snapshot_invalid');
  }
 }
 return snapshot;
}
const files=(home,ns)=>{const id=namespaceKey(ns);return {cache:path.join(home,'analytics',id+'.json'),watermark:path.join(home,'analytics-watermarks',id+'.json')};};
function boundedState(file,max=9*1024*1024){if(!fs.existsSync(file))return null;const stat=fs.lstatSync(file);requireValue(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=max,'analysis_snapshot_invalid');return readJson(file);}
export function makeAnalysisConsumer(config,{home,clock=Date.now}={}){
 const invalidate=async context=>{
  const f=files(home,context.namespace),prior=boundedState(f.watermark,65536);
  requireValue(!prior||context.sourceCursor>=prior.sourceCursor,'analysis_snapshot_stale');
  if(prior?.sourceCursor===context.sourceCursor){requireValue(prior.corePayloadSha256===context.corePayloadSha256,'analysis_snapshot_integrity');return;}
  atomicJson(f.watermark,{namespace:context.namespace,sourceCursor:context.sourceCursor,corePayloadSha256:context.corePayloadSha256,rejectBefore:context.rejectBefore,at:new Date(context.now).toISOString()});
 };
 const consume=async(snapshot,context)=>{
  validateAnalysisSnapshot(snapshot,config,context);await invalidate(context);
  const f=files(home,context.namespace),prior=boundedState(f.cache);
  requireValue(!prior||context.sourceCursor>=prior.sourceCursor&&snapshot.control_cursor>=prior.controlCursor&&snapshot.reject_before>=prior.rejectBefore&&snapshot.as_of>=prior.asOf,'analysis_snapshot_stale');
  if(prior?.sourceCursor===context.sourceCursor){requireValue(prior.snapshotSha256===snapshot.snapshot_sha256,'analysis_snapshot_integrity');if(prior.snapshot){requireValue(canonical(prior.snapshot)===canonical(snapshot),'analysis_snapshot_integrity');return {durable:true,unchanged:true};}}
  atomicJson(f.cache,{schemaVersion:1,namespace:context.namespace,sourceCursor:context.sourceCursor,controlCursor:snapshot.control_cursor,rejectBefore:snapshot.reject_before,asOf:snapshot.as_of,snapshotSha256:snapshot.snapshot_sha256,corePayloadSha256:context.corePayloadSha256,snapshot});
  return {durable:true,state:snapshot.state};
 };
 const prune=async namespace=>{const f=files(home,namespace),r=boundedState(f.cache);if(r?.snapshot&&Date.parse(r.snapshot.expires_at)<=clock())atomicJson(f.cache,{...r,snapshot:null,expired:true});};
 return {invalidate,consume,prune};
}
export function analyticsStatus(config,home,namespace,{now=Date.now()}={}){
 const base=feedbackMetricBoundary();try{
  const f=files(home,namespace),r=boundedState(f.cache),mark=boundedState(f.watermark,65536);if(!r)return base;
  if(r.expired||!r.snapshot||Date.parse(r.snapshot.expires_at)<=now)return {...base,reason:'analysis-snapshot-expired'};
  if(!mark||mark.sourceCursor!==r.sourceCursor||mark.corePayloadSha256!==r.corePayloadSha256)return {...base,reason:'analysis-snapshot-control-pending'};
  validateAnalysisSnapshot(r.snapshot,config,{namespace,sourceCursor:r.sourceCursor,corePayloadSha256:r.corePayloadSha256,rejectBefore:r.rejectBefore,now});
  return {...base,status:r.snapshot.state==='withdrawn'?'withdrawn':'observed',reason:null,metricVersion:r.snapshot.data?.metric_version??null,asOf:r.asOf,answerTimeWindow:r.snapshot.data?.windows.map(w=>w.window)??null,windowsCount:r.snapshot.data?.windows.length??null,snapshotSha256:r.snapshotSha256,controlCursor:r.controlCursor,rejectBefore:r.rejectBefore,expiresAt:r.snapshot.expires_at,liveSnapshotConsumed:true};
 }catch(e){return {...base,reason:/^[a-z_]+$/.test(e.code??'')?e.code:'analysis-snapshot-unavailable'};}
}
