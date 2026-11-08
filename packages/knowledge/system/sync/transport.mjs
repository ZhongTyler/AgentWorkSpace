import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {hash,canonical,requireValue,SyncError} from './state.mjs';
export const OPERATIONS=Object.freeze(['status','content-plan','content-stage','content-activate','content-status','feedback-next','feedback-ack','query-package-next','query-package-ack','query-package-results']);
// These are local adapter ports, not guessed server routes. A backend-owned,
// hash-bound contract must supply the real fixed-command binding before enable.
export function fixedSshTransport(config,{execute=spawnSync}={}){
 requireValue(['ssh_fixed_command','ssh_fixed_action'].includes(config?.kind),'transport_not_configured');
 requireValue(typeof config.host==='string'&&/^[A-Za-z0-9.-]+$/.test(config.host)&&typeof config.user==='string'&&/^[A-Za-z0-9_-]+$/.test(config.user),'invalid_ssh_target');
 requireValue(Number.isInteger(config.port)&&config.port>0&&config.port<=65535&&typeof config.identityFile==='string','invalid_ssh_target');
 if(config.kind==='ssh_fixed_command'){
  requireValue(Array.isArray(config.command)&&config.command.length>=1&&config.command.every(v=>typeof v==='string'&&/^[A-Za-z0-9_./-]+$/.test(v)),'fixed_command_required');
  requireValue(typeof config.remoteConfig==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(config.remoteConfig),'fixed_config_required');
 }else requireValue(config.command===undefined&&config.remoteConfig===undefined,'fixed_action_only');
 requireValue(config.approvedContractPath&&hash(fs.readFileSync(config.approvedContractPath))===config.approvedContractSha256,'backend_contract_unverified');
 const hostPin=()=>{
  if(config.knownHostsFile===undefined){requireValue(config.knownHostsSha256===undefined,'host_pin_unconfirmed');return [];}
  const file=config.knownHostsFile;requireValue(typeof file==='string'&&path.isAbsolute(file)&&!/["\r\n]/.test(file)&&typeof config.knownHostsSha256==='string'&&/^[a-f0-9]{64}$/.test(config.knownHostsSha256),'host_pin_unconfirmed');
  try{const s=fs.lstatSync(file),actual=fs.realpathSync(file),expected=path.resolve(file);requireValue(s.isFile()&&!s.isSymbolicLink()&&s.size<=65536&&(process.platform==='win32'?actual.toLowerCase()===expected.toLowerCase():actual===expected)&&hash(fs.readFileSync(file))===config.knownHostsSha256,'host_pin_unconfirmed');}catch{throw new SyncError('host_pin_unconfirmed');}
  return ['-o','UserKnownHostsFile="'+file+'"','-o','GlobalKnownHostsFile=none','-o','VerifyHostKeyDNS=no','-o','UpdateHostKeys=no'];
 };
 hostPin();
 return {async request(operation,payload,{timeoutMs=30000}={}){
  requireValue(OPERATIONS.includes(operation),'unknown_operation');
  const input=canonical(payload)+'\n';
  const maxRequestBytes=config.maxRequestBytes??12*1024*1024;
  requireValue(Number.isSafeInteger(maxRequestBytes)&&maxRequestBytes>0&&maxRequestBytes<=64*1024*1024&&Buffer.byteLength(input)<=maxRequestBytes,'request_too_large');
  const remote=config.kind==='ssh_fixed_action'?operation:[...config.command,operation,'--config',config.remoteConfig].join(' ');
  const args=['-T','-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','StrictHostKeyChecking=yes',...hostPin(),'-o','ConnectTimeout=10','-o','LogLevel=ERROR','-i',config.identityFile,'-p',String(config.port),config.user+'@'+config.host,remote];
  const result=execute('ssh',args,{input,encoding:'utf8',windowsHide:true,timeout:timeoutMs,maxBuffer:12*1024*1024});
  if(result.error)throw new SyncError('transport_unavailable',true);
  if(result.status===255)throw new SyncError('ssh_blocked',true);
  let value;try{value=JSON.parse(result.stdout);}catch{throw new SyncError('invalid_transport_response');}
  if(result.status!==0)throw new SyncError(typeof value?.code==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(value.code)?value.code:'remote_rejected',value?.retryable===true);
  requireValue(value&&typeof value==='object'&&!Array.isArray(value),'invalid_transport_response');
  return value;
 }};
}
export function requester(transport,{deadline=Date.now()+300000,maxAttempts=3,backoffMs=[1000,3000],sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,metrics={}}={}){
 requireValue(Number.isInteger(maxAttempts)&&maxAttempts>=1&&maxAttempts<=5,'invalid_retry_limit');
 return async(operation,payload,{attempts=maxAttempts}={})=>{
  for(let attempt=0;attempt<attempts;attempt++){
   requireValue(now()<deadline,'job_deadline');metrics.requests=(metrics.requests??0)+1;
   metrics.uploadBytes=(metrics.uploadBytes??0)+Buffer.byteLength(canonical(payload));
   try{const result=await transport.request(operation,payload,{timeoutMs:Math.max(1,Math.min(30000,deadline-now()))});metrics.downloadBytes=(metrics.downloadBytes??0)+Buffer.byteLength(canonical(result));return result;}
   catch(e){if(!e.retryable||attempt+1===attempts)throw e;metrics.retries=(metrics.retries??0)+1;const delay=backoffMs[attempt]??3000;requireValue(now()+delay<deadline,'job_deadline');await sleep(delay);}
  }
 };
}
