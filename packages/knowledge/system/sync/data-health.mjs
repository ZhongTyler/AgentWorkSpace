// Local adapter receipts only. Cloud DB, service, backlog and billing remain
// backend facts; absence is unknown and never a zero-sized healthy database.
export function dataHealth(policy,backup,recovery,{now=Date.now(),usage=null,maxBytes=null}={}){
 const alerts=[];let backupStatus='unconfigured',recoveryStatus='unconfigured';
 if(usage?.status==='observed'&&Number.isSafeInteger(maxBytes)&&usage.bytes>maxBytes)alerts.push('knowledge-sync:data:capacity');
 if(policy?.confirmed===true){
  const valid=(row,field,maxAge)=>row?.schema===1&&Number.isFinite(Date.parse(row[field]))&&Date.parse(row[field])<=now&&now-Date.parse(row[field])<=maxAge;
  if(!Number.isSafeInteger(policy.backupMaxAgeMs)||policy.backupMaxAgeMs<=0||!Number.isSafeInteger(policy.recoveryMaxAgeMs)||policy.recoveryMaxAgeMs<=0){backupStatus=recoveryStatus='unknown';alerts.push('knowledge-sync:data:policy-unavailable');}
  else{
   backupStatus=backup?.encrypted===true&&backup.credentialsIncluded===false&&valid(backup,'createdAt',policy.backupMaxAgeMs)?'observed':backup?'expired-or-invalid':'unknown';
   recoveryStatus=recovery?.status==='restored-isolated'&&recovery.controlWatermarksVerified===true&&recovery.credentialsIncluded===false&&valid(recovery,'at',policy.recoveryMaxAgeMs)?'observed':recovery?'expired-or-invalid':'unknown';
   if(backupStatus!=='observed')alerts.push('knowledge-sync:data:backup-expired');
   if(recoveryStatus!=='observed')alerts.push('knowledge-sync:data:recovery-unconfirmed');
  }
 }
 return {status:alerts.length?'unknown':policy?.confirmed===true?'observed':'unconfigured',backupStatus,recoveryStatus,capacity:usage,remoteBacklog:null,remoteUnknownCosts:null,remoteCapacity:null,alerts};
}
