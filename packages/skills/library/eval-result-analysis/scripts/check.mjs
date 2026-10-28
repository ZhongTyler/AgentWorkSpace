import assert from 'node:assert/strict';
import {analyze,summary,ranking} from './analyze-records.mjs';
const row=(c,f,r,p,choice='a',answer='a',system='main')=>({case:c,condition:f,repeat:r,system,dimension:'test',choice,answer,probabilities:p});
let checks=0;
const check=(name,fn)=>{fn();checks++;console.log('PASS '+name)};
check('Brier hand-calculated binary case and all-wrong endpoint',()=>{
 const s=summary([row('1','A',1,{a:.8,b:.2}),row('2','A',1,{a:0,b:1},'b')]);
 assert.equal(s.correct,1);assert.ok(Math.abs(s.brier-1.04)<1e-12);assert.equal(s.n,2);
});
check('Top2 boundary tie has lower and upper coverage',()=>{
 const r=row('1','A',1,{a:.4,b:.2,c:.2,d:.2},'a','c');assert.deepEqual(ranking(r,2),{min_rank:2,max_rank:4,topk_min:0,topk_max:1});
});
check('Missing repeat remains incomplete; singleton stability unknown',()=>{
 const s=analyze({conditions:['A','B'],planned_repeats:3,records:[row('1','A',1,{a:.8,b:.2}),row('1','B',1,{a:.3,b:.7},'b')]});
 assert.equal(s.per_case[0].classification,'incomplete');assert.equal(s.per_case[0].choice_pair_agreement,null);assert.equal(s.paired.main.n,1);assert.equal(s.paired.main.common_complete_triplets.A.n,0);
});
check('Question-balanced contrast differs from pooled with unequal observations',()=>{
 const records=[1,2,3].flatMap(r=>[row('full','A',r,{a:.8,b:.2}),row('full','B',r,{a:.2,b:.8},'b')]);records.push(row('one','A',1,{a:.2,b:.8},'b'),row('one','B',1,{a:.8,b:.2}));
 const s=analyze({conditions:['A','B'],planned_repeats:3,records});assert.equal(s.paired.main.question_equal_delta,0);assert.equal(s.paired.main.A.accuracy-s.paired.main.B.accuracy,.5);
});
check('Stable wrong is distinct from mixed correctness',()=>{
 const records=[1,2,3].flatMap(r=>[row('1','A',r,{a:.2,b:.8},'b'),row('1','B',r,r===1?{a:.8,b:.2}:{a:.2,b:.8},r===1?'a':'b')]);
 const s=analyze({conditions:['A','B'],planned_repeats:3,records});assert.equal(s.per_case.find(x=>x.condition==='A').classification,'stable_wrong');assert.equal(s.per_case.find(x=>x.condition==='B').classification,'mixed_correctness');assert.equal(s.independent_subjects,1);
});
check('Two systems agreeing wrongly do not become correct; absent group null',()=>{
 const records=['x','y'].map(sys=>row('1','A',1,{a:.2,b:.8},'b','a',sys));const s=analyze({conditions:['A','B'],planned_repeats:3,records});assert.equal(s.cross_system.A.same_choice,1);assert.equal(s.cross_system.A.same_choice_correct,0);assert.equal(s.cross_system.B.pairs,0);assert.equal(s.confidence.B.x.maximum_selected_probability,null);
});
check('Slash identities stay distinct',()=>{
 const records=[row('q/1','A',1,{a:.8,b:.2}),row('q','A',1,{a:.8,b:.2})];const s=analyze({conditions:['A','B'],planned_repeats:3,records});assert.equal(s.per_case.length,2);assert.equal(s.independent_subjects,2);
});
check('Duplicates, changed labels and invalid probabilities reject',()=>{
 const r=row('1','A',1,{a:.8,b:.2});assert.throws(()=>analyze({conditions:['A','B'],planned_repeats:3,records:[r,r]}),/Duplicate/);
 assert.throws(()=>analyze({conditions:['A','B'],planned_repeats:3,records:[r,row('1','B',1,{a:.8,b:.2},'a','b')]}),/label/);
 assert.throws(()=>analyze({conditions:['A','B'],planned_repeats:3,records:[row('1','A',1,{a:.8,b:.3})]}),/probabilities/);
});
check('Empty matrix, repeated condition and out-of-plan repeat reject',()=>{
 assert.throws(()=>analyze({conditions:['A','B'],planned_repeats:3,records:[]}),/Nonempty/);
 assert.throws(()=>analyze({conditions:['A','A'],planned_repeats:3,records:[row('1','A',1,{a:.8,b:.2})]}),/distinct/);
 assert.throws(()=>analyze({conditions:['A','B'],planned_repeats:3,records:[row('1','A',4,{a:.8,b:.2})]}),/identity/);
});
console.log(JSON.stringify({checks,failed:0,scope:'synthetic computational checks; not semantic or real-world accuracy authentication'}));
