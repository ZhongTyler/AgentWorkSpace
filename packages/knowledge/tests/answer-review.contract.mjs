/** Isolated answer-bound evidence checks; no semantic correctness claims. */
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {readSource,reviewAnswer,assembleResult} from '../system/query/query-evidence.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'answer-review-'));fs.mkdirSync(path.join(root,'wiki'));
const file=path.join(root,'wiki/example.md'),text='# 示例\n## 范围\n仅适用于测试版本。\n## 反例\n正式版本可能相反。\n## 来源\n这是工程重组，并非项目实测。\n';fs.writeFileSync(file,text);
const request={need:{question:'这个结论可以用于正式版吗？',kind:'understanding'}};
let count=0;const check=(name,fn)=>{try{fn();count++;}catch(e){throw new Error(name,{cause:e});}};
const receipt=readSource({request,ref:'knowledge:wiki:example'},root);
const answer='这只是测试版观察；正式版可能不同。材料是工程整理，未做本项目实测。';
const checks=[['condition','仅适用于测试版本。','这只是测试版观察'],['counterexample','正式版本可能相反。','正式版可能不同'],['provenance','这是工程重组，并非项目实测。','材料是工程整理，未做本项目实测']].map(([kind,quote,answer_quote])=>({kind,applicability:'applicable',reason:'会改变本题结论',items:[{id:kind,requirement:quote,evidence:[{ref:receipt.ref,quote}],status:'covered',answer_quote,rationale:'等价改写保留了限定'}]}));
const input={request,receipts:[receipt],answer,answer_checks:checks};const clone=x=>structuredClone(x);
try{
 check('paraphrases pass without source-word equality',()=>{const r=reviewAnswer(input,root);assert.equal(r.status,'answer_review_ready');assert.equal(r.claim_support,'not_verified');assert.equal(r.semantic_review,'caller_assessed_not_independently_verified');});
 check('missing qualifier blocks',()=>{const i=clone(input);i.answer_checks[0].items[0].status='missing';assert.equal(reviewAnswer(i,root).status,'answer_revision_required');});
 check('uncertainty blocks ready',()=>{const i=clone(input);i.answer_checks[1].items[0].status='uncertain';assert.equal(reviewAnswer(i,root).status,'answer_revision_required');});
 check('changed answer cannot borrow old ready',()=>{const i={...input,answer:'正式版可以直接采用。',answer_review:reviewAnswer(input,root)};assert.equal(reviewAnswer(i,root).status,'answer_revision_required');});
 check('irrelevant category must explain non-applicability',()=>{const i=clone(input);i.answer_checks[1]={kind:'counterexample',applicability:'not_applicable',reason:'本次只核对独立版本事实，不主张效果',items:[]};assert.equal(reviewAnswer(i,root).status,'answer_review_ready');});
 check('missing review category rejected',()=>assert.throws(()=>reviewAnswer({...input,answer_checks:checks.slice(1)},root)));
 check('duplicate requirement IDs rejected',()=>{const i=clone(input);i.answer_checks[1].items[0].id='condition';assert.throws(()=>reviewAnswer(i,root));});
 check('unread evidence cannot support review',()=>{const i=clone(input);i.answer_checks[0].items[0].evidence[0].ref='knowledge:wiki:missing';assert.equal(reviewAnswer(i,root).status,'invalid_evidence');});
 check('wrong quote cannot support review',()=>{const i=clone(input);i.answer_checks[0].items[0].evidence[0].quote='伪造原句';assert.equal(reviewAnswer(i,root).status,'invalid_evidence');});
 check('scope drift invalidates review',()=>assert.equal(reviewAnswer({...input,request:{need:{...request.need,object:'another'}}},root).status,'invalid_evidence'));
 check('permission cannot be bypassed',()=>assert.equal(reviewAnswer({...input,request:{...request,sources:{wiki:false}}},root).status,'invalid_evidence'));
 check('budget is still enforced',()=>assert.equal(reviewAnswer({...input,request:{...request,budget:{max_sources:0}}},root).status,'invalid_evidence'));
 check('source drift invalidates review',()=>{fs.appendFileSync(file,'真实内容变化。');assert.equal(reviewAnswer(input,root).status,'invalid_evidence');fs.writeFileSync(file,text);});
 const assembled={...input,claims:[],gaps:[],stop_reason:'needs_answered'};
 check('assembly consumes current reviewed answer',()=>{const r=assembleResult(assembled,root);assert.equal(r.status,'assembled');assert.equal(r.answer,answer);assert.equal(r.answer_review.status,'answer_review_ready');});
 check('assembly refuses missing qualifiers',()=>{const i=clone(assembled);i.answer_checks[2].items[0].status='missing';assert.equal(assembleResult(i,root).status,'answer_revision_required');});
 check('legacy evidence assembly stays compatible',()=>{const {answer,answer_checks,...old}=assembled;assert.equal(assembleResult(old,root).status,'assembled');assert(!assembleResult(old,root).answer_review);});
 check('CLI real review failure exits2',()=>{const i=clone(input);i.answer_checks[0].items[0].status='missing';const child=spawnSync(process.execPath,[path.resolve(import.meta.dirname,'../system/query/query-evidence.mjs'),'review','-','--root',root],{input:JSON.stringify(i),encoding:'utf8'});assert.equal(child.status,2);assert.equal(JSON.parse(child.stdout).status,'answer_revision_required');});
 check('read-only source bytes retained',()=>assert.equal(fs.readFileSync(file,'utf8'),text));
 console.log(JSON.stringify({status:'pass',checks:count,semantic_quality_verified:false,writes_to_real_library:false}));
}finally{fs.rmSync(root,{recursive:true,force:true});}
