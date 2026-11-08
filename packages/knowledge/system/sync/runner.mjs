import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readJson,atomicJson,withLock,requireValue,hash,recoverLock,SyncError} from './state.mjs';
import {fixedSshTransport,requester} from './transport.mjs';
import {publishContent,pullCompounding,coreStoreFactory,acceptedManifest,privateReceiveAllowed} from './clients.mjs';
import {makeAnalysisConsumer,analyticsStatus} from './analytics-snapshot.mjs';
import {summarizeSync} from './analysis.mjs';
import {privateUsage} from './resources.mjs';
import {syncQueryPackages} from './query-package-sync.mjs';
export const DIRECTIONS=['publish-content','pull-compounding'];
export const EXIT=Object.freeze({ok:0,disabled:10,busy:20,retryable:30,validation:40,conflict:41,windowLost:42,internal:50});
const codeOf=e=>e?.code instanceof String?String(e.code):typeof e?.code==='string'?e.code:'internal_error';
const knownCode=code=>/^[a-z][a-z0-9_]{0,63}$/.test(code)?code:'internal_error';
export function readiness(config,direction){
 const job=config?.jobs?.[direction];
 if(config?.schemaVersion!==1||!job)return {ready:false,reason:'configuration_missing'};
 if(job.enabled!==true)return {ready:false,reason:job.disabledReason??'safely_disabled'};
 if(config.transport?.approvedContractPath==null||!fs.existsSync(config.transport.approvedContractPath))return {ready:false,reason:'backend_contract_missing'};
 if(config.transport?.approvedContractSha256!==hash(fs.readFileSync(config.transport.approvedContractPath)))return {ready:false,reason:'backend_contract_unverified'};
 if(config.transport?.dedicatedIdentityConfirmed!==true||!config.transport?.deploymentReceiptPath||!fs.existsSync(config.transport.deploymentReceiptPath)||hash(fs.readFileSync(config.transport.deploymentReceiptPath))!==config.transport.deploymentReceiptSha256)return {ready:false,reason:'dedicated_endpoint_unconfirmed'};
 if(!path.isAbsolute(config.transport.identityFile??'')||!fs.existsSync(config.transport.identityFile))return {ready:false,reason:'dedicated_identity_unavailable'};
 try{fixedSshTransport(config.transport);}catch{return {ready:false,reason:'transport_not_configured'};}
 if(direction==='publish-content'&&!job.publicationPointer&&(!job.manifestPath||!job.acceptancePath))return {ready:false,reason:'accepted_snapshot_missing'};
 if(direction==='pull-compounding'&&!privateReceiveAllowed(job))return {ready:false,reason:'private_transfer_policy_unconfirmed'};
 try{if(direction==='publish-content')acceptedManifest(job);else{requireValue(Number.isSafeInteger(job.tombstoneRetentionMs)&&job.tombstoneRetentionMs>0&&Array.isArray(job.allowedNamespaces)&&job.allowedNamespaces.length>0,'retention_unconfigured');}}catch{return {ready:false,reason:'snapshot_or_policy_invalid'};}
 return {ready:true};
}
export async function runJob(config,direction,{transport,storeFactory,sleep,now=Date.now}={}){
 requireValue(DIRECTIONS.includes(direction),'unknown_direction');
 const started=now(),job=config?.jobs?.[direction],ready=readiness(config,direction);
 const output={schemaVersion:1,direction,at:new Date(started).toISOString(),enabled:job?.enabled===true,status:'disabled',reason:ready.reason??null,
  exitCode:EXIT.disabled,modelCalls:0,sourceRequests:0,manualResearchRuns:0};
 if(!config?.privateHome)return output;
 const healthFile=path.join(config.privateHome,'health',direction+'.json'),previous=readJson(healthFile,{});
 if(!ready.ready){atomicJson(healthFile,{...output,consecutiveFailures:0,lastSuccessAt:previous.lastSuccessAt??null});return output;}
 const metrics={requests:0,retries:0,uploadBytes:0,downloadBytes:0};
 try{
  const result=await withLock(config.privateHome,direction,async()=>{
   const usage=privateUsage(config.privateHome),limit=config.maxPrivateBytes??128*1024*1024;
   requireValue(Number.isSafeInteger(limit)&&limit>0&&usage.bytes<=limit,'private_capacity');
   const maxDurationMs=job.maxDurationMs??300000;requireValue(Number.isSafeInteger(maxDurationMs)&&maxDurationMs>=1000&&maxDurationMs<=900000,'invalid_job_deadline');
   const call=requester(transport??fixedSshTransport(config.transport),{deadline:started+maxDurationMs,maxAttempts:job.maxAttempts??3,sleep,now,metrics});
   const home=path.join(config.privateHome,direction);
   if(direction==='publish-content'){
    if(job.publicationMaintenanceBinding){
     const binding=readJson(job.publicationMaintenanceBinding);
     requireValue(binding?.publicationHome===job.publicationHome&&binding.pointerPath===job.publicationPointer,'publication_binding_mismatch');
     const {refreshPublication}=await import('./publication-maintenance.mjs');
     await refreshPublication(binding,{lockHeldHome:config.privateHome});
    }
    return publishContent(job,call,{home});
   }
   const analysis=makeAnalysisConsumer(job,{home,clock:now});
   const pulled=await pullCompounding(job,call,{home,storeFactory:storeFactory??await coreStoreFactory(config.toolsRoot),now:now(),clock:now,consumeAnalysisSnapshot:analysis.consume,onCoreApplied:analysis.invalidate,pruneAnalysis:analysis.prune});
   const queryPackages=await syncQueryPackages(job,call,{home,toolsRoot:config.toolsRoot,clock:now});
   const failures=[...pulled.failures,...queryPackages.failures];
   return {...pulled,status:failures.length?'partial':pulled.packagesImported||queryPackages.received||queryPackages.resultsAcknowledged?'imported':'unchanged',failures,queryPackages,feedbackAnalytics:(job.allowedNamespaces??[]).map(namespace=>({namespace,...analyticsStatus(job,home,namespace,{now:now()})}))};
  });
  const reasons=result.failures?.map(r=>r.code)??[];
  Object.assign(output,result,{status:result.status,exitCode:result.status==='partial'?(reasons.includes('window_lost')?EXIT.windowLost:reasons.includes('revision_conflict')?EXIT.conflict:EXIT.validation):EXIT.ok,reason:null});
 }catch(error){
  const code=knownCode(codeOf(error));Object.assign(output,{status:code==='lock_busy'?'busy':'failed',reason:code,
   exitCode:code==='lock_busy'?EXIT.busy:code==='window_lost'?EXIT.windowLost:code==='revision_conflict'?EXIT.conflict:error.retryable?EXIT.retryable:EXIT.validation});
 }
 const success=output.exitCode===0;const failures=success?0:output.exitCode===EXIT.busy?(previous.consecutiveFailures??0):(previous.consecutiveFailures??0)+1;
 const record={...output,...metrics,activityMs:Math.max(0,now()-started),consecutiveFailures:failures,
  lastSuccessAt:success?new Date(now()).toISOString():previous.lastSuccessAt??null,enabledAt:previous.enabledAt??new Date(started).toISOString(),
  recoveryObserved:success&&(previous.consecutiveFailures??0)>0};
 atomicJson(healthFile,record);
 if(direction==='pull-compounding'&&success){
  const records=DIRECTIONS.map(d=>readJson(path.join(config.privateHome,'health',d+'.json'))).filter(Boolean),day=new Date(now()+8*3600000).toISOString().slice(0,10);
  atomicJson(path.join(config.privateHome,'analysis','operations.json'),{...summarizeSync(records,{windowStart:day+'T00:00:00+08:00',windowEnd:new Date(Date.parse(day+'T00:00:00+08:00')+86400000).toISOString()}),businessMetrics:'separate-versioned-private-namespace-snapshot',feedbackAnalytics:record.feedbackAnalytics});
 }
 return record;
}
async function main(){
 const [operation,configPath,direction,token]=process.argv.slice(2);const config=readJson(configPath);
 if(operation==='run'){const result=await runJob(config,direction);console.log(JSON.stringify(result));process.exitCode=result.exitCode;}
 else if(operation==='readiness'){console.log(JSON.stringify(Object.fromEntries(DIRECTIONS.map(d=>[d,readiness(config,d)]))));}
 else if(operation==='recover-lock'){requireValue(DIRECTIONS.includes(direction),'unknown_direction');console.log(JSON.stringify(recoverLock(config.privateHome,direction,token)));}
 else throw new SyncError('unknown_operation');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(e=>{console.log(JSON.stringify({status:'failed',reason:knownCode(codeOf(e)),exitCode:EXIT.internal}));process.exitCode=EXIT.internal;});
