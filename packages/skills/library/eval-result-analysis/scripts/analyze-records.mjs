import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
export const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
const group=(a,f)=>Object.groupBy(a,f);
const count=a=>Object.fromEntries(Object.entries(group(a,x=>x)).map(([k,v])=>[k,v.length]));
const tv=(a,b)=>Object.keys(a).reduce((s,k)=>s+Math.abs(a[k]-b[k]),0)/2;
const pairs=a=>a.flatMap((x,i)=>a.slice(i+1).map(y=>[x,y]));
export function ranking(r,k){
 const p=r.probabilities[r.answer],v=Object.values(r.probabilities),higher=v.filter(x=>x>p+1e-10).length,equal=v.filter(x=>Math.abs(x-p)<=1e-10).length;
 return {min_rank:higher+1,max_rank:higher+equal,topk_min:Number(higher+equal<=k),topk_max:Number(higher<k)};
}
export function summary(rows){
 const n=rows.length;
 return {n,subjects:new Set(rows.map(x=>x.case)).size,correct:rows.filter(r=>r.choice===r.answer).length,accuracy:mean(rows.map(r=>Number(r.choice===r.answer))),
  brier:mean(rows.map(r=>Object.entries(r.probabilities).reduce((s,[k,p])=>s+(p-Number(k===r.answer))**2,0))),
  mean_true_probability:mean(rows.map(r=>r.probabilities[r.answer])),mean_selected_probability:mean(rows.map(r=>r.probabilities[r.choice])),
  top2_min:rows.reduce((s,r)=>s+ranking(r,2).topk_min,0),top2_max:rows.reduce((s,r)=>s+ranking(r,2).topk_max,0),
  top3_min:rows.reduce((s,r)=>s+ranking(r,3).topk_min,0),top3_max:rows.reduce((s,r)=>s+ranking(r,3).topk_max,0)};
}
export function analyze(input){
 const {records,conditions}=input;
 if(!Array.isArray(records)||!records.length||!Array.isArray(conditions)||conditions.length!==2||new Set(conditions).size!==2)throw Error('Nonempty records and two distinct conditions required');
 if(!Number.isInteger(input.planned_repeats)||input.planned_repeats<1)throw Error('planned_repeats must be a positive integer');
 const [A,B]=conditions,systems=[...new Set(records.map(r=>r.system))];
 if(conditions.length!==2)throw Error('Exactly two conditions required');
 const seen=new Set(),labels=new Map();
 for(const r of records){const id=JSON.stringify([r.case,r.condition,r.repeat,r.system]);if(seen.has(id))throw Error('Duplicate '+id);seen.add(id);
  if(typeof r.case!=='string'||!r.case||typeof r.system!=='string'||!r.system||!Number.isInteger(r.repeat)||r.repeat<1||r.repeat>input.planned_repeats)throw Error('Invalid identity '+id);
  if(!conditions.includes(r.condition)||!r.probabilities||!Object.hasOwn(r.probabilities,r.answer)||!Object.hasOwn(r.probabilities,r.choice))throw Error('Invalid record '+id);
  const p=Object.values(r.probabilities);if(p.some(p=>!Number.isFinite(p)||p<0||p>1)||Math.abs(p.reduce((a,b)=>a+b,0)-1)>1e-7)throw Error('Invalid probabilities '+id);
  const label=JSON.stringify([r.answer,Object.keys(r.probabilities).sort()]);if(labels.has(r.case)&&labels.get(r.case)!==label)throw Error('Inconsistent label/options '+r.case);labels.set(r.case,label);
 }
 const out={schema_version:1,posthoc:true,independent_subjects:new Set(records.map(r=>r.case)).size,records:records.length,conditions,overall:{},dimensions:{},per_case:[],paired:{},cross_system:{},confidence:{},cost:input.cost??null};
 for(const f of conditions){out.overall[f]={};out.dimensions[f]={};out.confidence[f]={};for(const s of systems){const rows=records.filter(r=>r.condition===f&&r.system===s);out.overall[f][s]=summary(rows);
  out.dimensions[f][s]=Object.fromEntries(Object.entries(group(rows,r=>r.dimension)).map(([k,v])=>[k,summary(v)]));
  const margin=r=>{const p=Object.values(r.probabilities).sort((a,b)=>b-a);return p[0]-p[1]};
  out.confidence[f][s]={declared_trend:count(rows.map(r=>r.confidence?.trend??'unknown')),declared_manifestation:count(rows.map(r=>r.confidence?.manifestation??'unknown')),declared_timing:count(rows.map(r=>r.confidence?.timing??'unknown')),
   selected_ge_50:summary(rows.filter(r=>r.probabilities[r.choice]>=0.5-1e-10)),margin_le_05:summary(rows.filter(r=>margin(r)<=0.05+1e-10)),margin_gt_05:summary(rows.filter(r=>margin(r)>0.05+1e-10)),
   correct:summary(rows.filter(r=>r.choice===r.answer)),wrong:summary(rows.filter(r=>r.choice!==r.answer)),
   maximum_selected_probability:rows.length?Math.max(...rows.map(r=>r.probabilities[r.choice])):null,mean_margin:mean(rows.map(margin))};
 }}
 for(const [key,rows] of Object.entries(group(records,r=>JSON.stringify([r.case,r.condition,r.system])))){
  const [c,f,s]=JSON.parse(key),ps=pairs(rows),dist=count(rows.map(r=>r.choice)),right=rows.filter(r=>r.choice===r.answer).length;
  const complete=rows.length===input.planned_repeats;
  const chosen=Object.keys(dist).sort((a,b)=>dist[b]-dist[a]),max=dist[chosen[0]],tie=chosen.filter(x=>dist[x]===max);
  out.per_case.push({case:c,condition:f,system:s,dimension:rows[0].dimension,...summary(rows),complete_triplet:complete,
   repeats:rows.map(r=>({repeat:r.repeat,alias:r.alias,choice:r.choice,p_true:r.probabilities[r.answer],p_selected:r.probabilities[r.choice]})).sort((a,b)=>a.repeat-b.repeat),
   choice_distribution:dist,unanimous:complete?Object.keys(dist).length===1:null,
   classification:!complete?'incomplete':right===rows.length?'stable_correct':right===0&&Object.keys(dist).length===1?'stable_wrong':right===0?'variable_wrong':'mixed_correctness',
   choice_pair_agreement:mean(ps.map(([a,b])=>Number(a.choice===b.choice))),probability_pair_tv:mean(ps.map(([a,b])=>tv(a.probabilities,b.probabilities))),
   majority_choice:tie.length===1?tie[0]:null,majority_correct:tie.length===1?tie[0]===rows[0].answer:null,
   any_correct:right>0,all_correct:complete?right===rows.length:null});
 }
 for(const s of systems){
  const buckets=group(records.filter(r=>r.system===s),r=>JSON.stringify([r.case,r.repeat]));
  const matched=Object.values(buckets).filter(g=>g.some(x=>x.condition===A)&&g.some(x=>x.condition===B));
  const a=matched.map(g=>g.find(r=>r.condition===A)),b=matched.map(g=>g.find(r=>r.condition===B));
  const pc=Object.entries(group(matched,g=>g[0].case)).map(([c,gs])=>{const d=gs.map(g=>{const a=g.find(r=>r.condition===A),b=g.find(r=>r.condition===B);return Number(a.choice===a.answer)-Number(b.choice===b.answer)});return {case:c,n:gs.length,accuracy_delta_A_minus_B:mean(d),repeat_deltas:d,sign_reversal:d.some(x=>x>0)&&d.some(x=>x<0)}});
  out.paired[s]={n:matched.length,A:summary(a),B:summary(b),per_case:pc,question_equal_delta:mean(pc.map(x=>x.accuracy_delta_A_minus_B)),
   leave_one_case_out:pc.map(x=>({removed:x.case,delta:mean(pc.filter(y=>y.case!==x.case).map(y=>y.accuracy_delta_A_minus_B))})),
   common_complete_triplets:conditions.reduce((o,f)=>{const complete=pc.filter(x=>x.n===input.planned_repeats).map(x=>x.case);const rows=records.filter(r=>r.system===s&&r.condition===f&&complete.includes(r.case));const pcs=out.per_case.filter(x=>x.condition===f&&x.system===s&&complete.includes(x.case));o[f]={...summary(rows),unanimous_questions:pcs.filter(x=>x.unanimous).length,question_mean_tv:mean(pcs.map(x=>x.probability_pair_tv)),mean_choice_pair_agreement:mean(pcs.map(x=>x.choice_pair_agreement))};return o},{}),
   outcome_pairs:{both_correct:a.filter((x,i)=>x.choice===x.answer&&b[i].choice===b[i].answer).length,A_only:a.filter((x,i)=>x.choice===x.answer&&b[i].choice!==b[i].answer).length,B_only:a.filter((x,i)=>x.choice!==x.answer&&b[i].choice===b[i].answer).length,both_wrong:a.filter((x,i)=>x.choice!==x.answer&&b[i].choice!==b[i].answer).length}};
 }
 if(systems.length===2)for(const f of conditions){const bs=Object.values(group(records.filter(r=>r.condition===f),r=>JSON.stringify([r.case,r.repeat]))).filter(g=>g.length===2);const same=bs.filter(g=>g[0].choice===g[1].choice),different=bs.filter(g=>g[0].choice!==g[1].choice);
 out.cross_system[f]={pairs:bs.length,same_choice:same.length,same_choice_correct:same.filter(g=>g[0].choice===g[0].answer).length,different_choice:different.length,
  correctness_when_different:Object.fromEntries(systems.map(s=>[s,summary(different.map(g=>g.find(r=>r.system===s)))])),
  either_correct:bs.filter(g=>g.some(r=>r.choice===r.answer)).length,both_correct:bs.filter(g=>g.every(r=>r.choice===r.answer)).length,
  note:'Either-correct is an oracle upper bound, not a deployable selection policy; same chart and model family are correlated.'};}
 return out;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node analyze-records.mjs input.json output.json');const data=analyze(JSON.parse(fs.readFileSync(input,'utf8')));fs.writeFileSync(output,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify({records:data.records,subjects:data.independent_subjects,output}));}
