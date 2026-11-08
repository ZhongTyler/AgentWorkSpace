// Deterministic operational rollup only; business metrics require the backend's
// separately frozen minimal-snapshot contract. No question or answer is read.
import {canonical,hash} from './state.mjs';
import {feedbackMetricBoundary} from './metric-boundary.mjs';
export function summarizeSync(records,{windowStart,windowEnd}={}){
 const selected=records.filter(r=>typeof r.at==='string'&&Date.parse(r.at)>=Date.parse(windowStart)&&Date.parse(r.at)<Date.parse(windowEnd));
 const unique=[...new Map(selected.map(r=>[r.direction+'\0'+r.at,r])).values()];
 const measure=k=>{const known=unique.filter(r=>Number.isFinite(r[k])&&r[k]>=0);return {value:known.length?known.reduce((s,r)=>s+r[k],0):null,denominator:unique.length,known:known.length,unknown:unique.length-known.length};};
 const input=unique.map(r=>({direction:r.direction,at:r.at,exitCode:r.exitCode??null,requests:r.requests??null,retries:r.retries??null,uploadBytes:r.uploadBytes??null,downloadBytes:r.downloadBytes??null})).sort((a,b)=>(a.direction+a.at).localeCompare(b.direction+b.at));
 return {metric_schema:'knowledge-sync-operations-v1',window:{start:windowStart,end:windowEnd,timezone:'Asia/Shanghai'},inputSha256:hash(canonical(input)),
  attempts:unique.length,successful:unique.filter(r=>r.exitCode===0).length,failed:unique.filter(r=>Number.isInteger(r.exitCode)&&![0,10,20].includes(r.exitCode)).length,
  unknownTerminal:unique.filter(r=>!Number.isInteger(r.exitCode)).length,requests:measure('requests'),retries:measure('retries'),uploadBytes:measure('uploadBytes'),downloadBytes:measure('downloadBytes'),
  businessMetrics:'awaiting-backend-minimal-snapshot-contract',feedbackAnalytics:feedbackMetricBoundary(),cost:null,costStatus:'unknown',qualityVerified:false};
}
