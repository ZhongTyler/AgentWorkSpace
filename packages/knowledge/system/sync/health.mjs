// Pure, safe metadata only. No network, model, retained payload or task mutation.
import {feedbackMetricBoundary} from './metric-boundary.mjs';
export function syncHealth(config,records={},native=null,{now=Date.now(),usage=null}={}){
 const jobs=[],alerts=[],recoveredScopes=[];
 const validationCodes=['revision_conflict','transfer_integrity','namespace_not_allowed','accepted_content_changed','manifest_not_accepted','staging_not_verified','transfer_not_qualified','unknown_transfer_schema','nonminimal_private_metadata','analysis_snapshot_contract_unconfirmed','analysis_snapshot_not_durable','unknown_attachment_schema','analysis_snapshot_invalid','analysis_snapshot_integrity','analysis_snapshot_expired','analysis_snapshot_stale','analysis_schema_unconfirmed','analysis_schema_drift','analysis_policy_unconfirmed','case_import_unconfirmed','unsafe_publication_pointer','publication_pointer_changed','publication_binding_mismatch'];
 for(const direction of ['publish-content','pull-compounding']){
  const job=config.jobs?.[direction]??{},r=records[direction]??{},task=native?.jobs?.find(v=>v.direction===direction);
  const enabled=job.enabled===true,age=typeof r.lastSuccessAt==='string'?now-Date.parse(r.lastSuccessAt):null;
  const reasons=[];let status=enabled?'unknown':'disabled';
  if(enabled){
   if(task?.installed!==true||task.enabled!==true||task.principalMatched!==true)reasons.push('scheduler-unconfirmed');
   if(r.exitCode===10)reasons.push('configuration-required');
   if(['private_capacity','private_file_capacity'].includes(r.reason))reasons.push('capacity');
   const failures=Array.isArray(r.failures)?r.failures.map(x=>x.code):[];
   if(r.reason==='window_lost'||failures.includes('window_lost'))reasons.push('window-lost');
   if(validationCodes.includes(r.reason)||r.reason==='publication_review_event_pending'||failures.some(c=>validationCodes.includes(c)))reasons.push('validation-conflict');
   if((r.consecutiveFailures??0)>=(job.failureAlertAfter??3))reasons.push('persistent-failure');
   const since=r.lastSuccessAt??r.enabledAt??job.enabledAt;
   if(typeof since==='string'&&now-Date.parse(since)>(job.maxLagMs??Math.max(3*(job.intervalMinutes??30)*60000,3600000)))reasons.push('lagging');
   if(typeof r.at!=='string'||!Number.isFinite(Date.parse(r.at))||Date.parse(r.at)>now+300000)reasons.push('receipt-unavailable');
   status=reasons.length?'warning':r.exitCode===0?'observed':'pending';
  }
  for(const reason of reasons)alerts.push('knowledge-sync:'+direction+':'+reason);
  if(enabled&&status==='observed'&&r.recoveryObserved===true)recoveredScopes.push(direction);
  jobs.push({direction,enabled,status,reasons,lastAttemptAt:r.at??null,lastSuccessAt:r.lastSuccessAt??null,successAgeMs:Number.isFinite(age)?age:null,
   consecutiveFailures:r.consecutiveFailures??null,exitCode:r.exitCode??null,registered:task?.installed??null,nativeEnabled:task?.enabled??null,indexVerified:r.indexVerified??null,activeSnapshot:r.activeSnapshot??null,
   requests:r.requests??null,retries:r.retries??null,uploadBytes:r.uploadBytes??null,downloadBytes:r.downloadBytes??null,
   packagesImported:r.packagesImported??null,objectsUploaded:r.objectsUploaded??null});
 }
 return {schemaVersion:1,readOnly:true,status:alerts.length?'warning':jobs.every(j=>!j.enabled)?'disabled':jobs.some(j=>j.status!=='observed')?'pending':'observed',
  jobs,alerts:alerts.sort(),recoveredScopes,localCapacity:usage,remoteBacklog:null,remoteUnknownCosts:null,remoteCapacity:null,feedbackAnalytics:feedbackMetricBoundary(),backupFreshness:'unconfigured',recoveryVerification:'unconfigured',modelCalls:0,sourceRequests:0};
}
