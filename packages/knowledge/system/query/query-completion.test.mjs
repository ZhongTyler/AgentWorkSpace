import test from 'node:test';import assert from 'node:assert/strict';
import {compileCompletion,queryStopReasons} from './query-completion.mjs';
import {assembleResult} from './query-evidence.mjs';
const gap={text:'An unresolved comparison premise.',critical:true};
test('shared completion enum is immutable',()=>{assert(Object.isFrozen(queryStopReasons));assert(queryStopReasons.includes('critical_gaps_remaining'));});
test('early logical conflict is neutral; terminal and Legacy behavior stay compatible',()=>{
 const input={blocks:[{text:'Original 中😀'}],gaps:[gap],stop_reason:'needs_answered'},before=structuredClone(input);
 const early=compileCompletion(input,{normalizeCritical:true});assert.equal(early.args.stop_reason,'critical_gaps_remaining');assert.equal(early.audit.proposed_stop_reason,'needs_answered');assert.equal(early.audit.single_final_generation_limit,false);assert.deepEqual(input,before);
 assert.equal(compileCompletion(input).args,input);assert.equal(compileCompletion(input,{finalGenerationSpent:true}).args.stop_reason,'budget_exhausted');
 assert.equal(compileCompletion({gaps:[]},{finalGenerationSpent:true}).args.stop_reason,'needs_answered');
 assert.equal(compileCompletion({gaps:[]},{finalGenerationSpent:true,hasSources:false}).args.stop_reason,'budget_exhausted');
});
test('finite-domain properties: no prose/gap mutation, idempotence, honest cause preservation',()=>{
 let cases=0;
 for(const reason of [...queryStopReasons,undefined])for(const gaps of [[],[{text:'Noncritical',critical:false}],[gap],[{text:'Implicit critical'}]])for(const finalGenerationSpent of [false,true])for(const normalizeCritical of [false,true])for(const hasSources of [false,true])for(const readConstraintsMet of [false,true]){
  const input={blocks:[{text:'Case '+cases+' 中😀',evidence:[]}],gaps:structuredClone(gaps),stop_reason:reason,other:{kept:cases}},before=structuredClone(input),options={finalGenerationSpent,normalizeCritical,hasSources,readConstraintsMet};
  const {args}=compileCompletion(input,options);assert.deepEqual(input,before);assert.equal(args.blocks,input.blocks);assert.equal(args.gaps,input.gaps);assert.equal(args.other,input.other);
  const {stop_reason:_,...rest}=args,{stop_reason:__,...original}=input;assert.deepEqual(rest,original);assert.deepEqual(compileCompletion(args,options).args,args);
  if(reason&&reason!=='needs_answered')assert.equal(args.stop_reason,reason);
  if(!finalGenerationSpent&&(!normalizeCritical||reason!=='needs_answered'||!gaps.some(g=>g.critical!==false)))assert.equal(args,input);
  if(args.stop_reason==='critical_gaps_remaining'&&reason!=='critical_gaps_remaining'){assert(gaps.some(g=>g.critical!==false));assert(!finalGenerationSpent);}
  cases++;
 }
 assert.equal(cases,448);
});
test('malformed gaps and unknown stops remain original validator input',()=>{
 for(const gaps of [null,{},[null],[{}],[{text:'x',critical:'false'}],[{text:' ',critical:true}]])for(const finalGenerationSpent of [false,true]){const input={gaps,stop_reason:'needs_answered'};assert.deepEqual(compileCompletion(input,{normalizeCritical:true,finalGenerationSpent}),{args:input,audit:null});}
 const input={gaps:[gap],stop_reason:'UNKNOWN'};assert.deepEqual(compileCompletion(input,{finalGenerationSpent:true,normalizeCritical:true}),{args:input,audit:null});
});
test('Core keeps the answered exclusion and requires a real critical gap for neutral stop',()=>{
 const input={request:{schema_version:1,need:{kind:'fact',question:'Synthetic only'},terms:['synthetic']},receipts:[],claims:[],gaps:[gap],stop_reason:'needs_answered'};
 assert.throws(()=>assembleResult(input),e=>e.code==='critical_gaps_cannot_be_answered');
 assert.equal(assembleResult({...input,stop_reason:'critical_gaps_remaining'}).status,'assembled');
 assert.throws(()=>assembleResult({...input,gaps:[{text:'Not critical',critical:false}],stop_reason:'critical_gaps_remaining'}),e=>e.code==='critical_gap_stop_requires_critical_gap');
 assert.throws(()=>assembleResult({...input,gaps:[],stop_reason:'critical_gaps_remaining'}),e=>e.code==='incomplete_stop_requires_gaps');
});
