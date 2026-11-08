// Validate a supplied ratio; do not create votes, choose the denominator or
// infer delivery/exposure/answer ownership. Those are backend facts.
import {requireValue} from './state.mjs';
export function preserveRatio(metric){
 requireValue(metric&&Object.keys(metric).sort().join(',')==='denominator,numerator,value','invalid_metric_ratio');
 const {numerator:n,denominator:d,value}=metric;
 requireValue([n,d].every(v=>v===null||Number.isSafeInteger(v)&&v>=0),'invalid_metric_ratio');
 if(n===null||d===null){requireValue(value===null,'unknown_metric_coerced');return {...metric,status:'unknown'};}
 requireValue(n<=d,'invalid_metric_ratio');
 if(d===0){requireValue(value===null,'empty_metric_coerced');return {...metric,status:'no-feedback'};}
 requireValue(typeof value==='number'&&Number.isFinite(value)&&Math.abs(value-n/d)<=2*Number.EPSILON,'invalid_metric_ratio');
 return {...metric,status:'observed'};
}
export const feedbackMetricBoundary=()=>({status:'unknown',reason:'backend-v0.7-snapshot-contract-unconfirmed',specificationVersion:'0.7',
 metricVersion:null,answerTimeWindow:null,asOf:null,helpfulness:null,deliveredCoverage:null,exposureParticipation:null,
 satisfactionIsAccuracy:false,deliveryIsExposure:false,liveSnapshotConsumed:false});
