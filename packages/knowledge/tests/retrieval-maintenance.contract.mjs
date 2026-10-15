/** Synthetic approved-close events only; no maintainer knowledge or approval edited. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
import {afterReviewedCommit} from '../system/query/retrieval-maintenance.mjs';
import {discover,readSource} from '../system/query/query-evidence.mjs';
const tools=process.env.TOOLS_ROOT,python=process.env.PYTHON_EXECUTABLE??'python';assert.ok(tools);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reviewed-retrieval-')),root=path.join(tmp,'library'),binding=path.join(tmp,'binding.json');fs.mkdirSync(root);
const run=(c,a)=>execFileSync(c,a,{encoding:'utf8',maxBuffer:4*1024*1024});
const git=(...a)=>run('git',['-C',root,...a]).trim();const put=(p,b)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,b);};
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const prev=process.env.KNOWLEDGE_RETRIEVAL_CONFIG;
function seal(status='completed',wrong=false){
 const report='reviews/report.md',manifest='reviews/content.json',rp='reviews/run.json';put(report,'Synthetic final report; this is not a real user approval.');
 const paths=fs.readdirSync(path.join(root,'wiki')).filter(p=>p.endsWith('.md')).map(p=>'wiki/'+p);
 put(manifest,JSON.stringify({batch_id:'fixture',review_path:report,review_sha256:hash(report),wiki_paths:paths,files:paths.map(p=>({path:p,exists:true,sha256:hash(p)}))}));
 put(rp,JSON.stringify({status,batch_id:'fixture',final_review:{path:report,sha256:hash(report),approved_sha256:wrong?'0'.repeat(64):hash(report),content_manifest:manifest,content_manifest_sha256:hash(manifest)}}));git('add','.');git('commit','-qm','synthetic reviewed result');return rp;
}
try{
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');put('wiki/a.md','# 道具\n\n## 条件\n资源稀缺可能鼓励囤积。\n');git('add','.');git('commit','-qm','synthetic baseline');
 run(python,['-X','utf8','-B',path.join(tools,'integrations/retrieval/cli.py'),'build','--root',root,'--home',path.join(tmp,'v0')]);
 fs.writeFileSync(binding,JSON.stringify({schema_version:1,python,tools_root:tools,runtime_config:path.join(tmp,'v0/config.json'),maintenance:{enabled:true,versions_root:path.join(tmp,'versions')}}));process.env.KNOWLEDGE_RETRIEVAL_CONFIG=binding;
 put('wiki/b.md','# 空间\n\n## 条件\n狭窄通道限制包围，开阔空间支持绕行。\n');let rp=seal('awaiting_final_review');let before=fs.readFileSync(binding);assert.equal(afterReviewedCommit(root,{run:rp}).status,'failed');assert.deepEqual(fs.readFileSync(binding),before);
 rp=seal('completed',true);assert.equal(afterReviewedCommit(root,{run:rp}).status,'failed');
 rp=seal();let result=afterReviewedCommit(root,{run:rp});assert.equal(result.status,'updated');assert.equal(result.activated,true);assert.equal(result.knowledge_content_writes,false);
 const q={schema_version:1,need:{kind:'understanding',question:'开阔空间与包围'},terms:['绕行']};let found=discover(q,root);assert.equal(found.retrieval.used_mode,'bm25');assert.ok(found.candidates.some(c=>c.ref==='knowledge:wiki:b'));assert.ok(readSource({request:q,ref:'knowledge:wiki:b',selection:{mode:'full'}},root).content.includes('绕行'));
 before=fs.readFileSync(binding);assert.equal(afterReviewedCommit(root,{run:rp}).status,'unchanged');assert.deepEqual(fs.readFileSync(binding),before);
 put('wiki/b.md','# 空间\n\n## 条件\n新增未经审核正文。');assert.equal(afterReviewedCommit(root,{run:rp}).status,'failed');assert.deepEqual(fs.readFileSync(binding),before);assert.equal(discover(q,root).retrieval.used_mode,'legacy');
 git('restore','--','wiki/b.md');put('wiki/a.md','# 道具\n\n## 条件\n修改已审核道具条件。\n');rp=seal();
 assert.equal(afterReviewedCommit(root,{reviewRef:'synthetic maintenance review',paths:['wiki/b.md']}).status,'failed');assert.deepEqual(fs.readFileSync(binding),before);
 // Optional hybrid unavailable: BM25 updates, old hybrid pointer is not silently retained.
 let b=JSON.parse(fs.readFileSync(binding));b.hybrid_runtime_config=b.runtime_config;b.maintenance.refresh_hybrid=true;b.maintenance.embedding_config=path.join(tmp,'missing-embedding.json');fs.writeFileSync(binding,JSON.stringify(b));
 result=afterReviewedCommit(root,{run:rp});assert.equal(result.status,'updated');assert.equal(result.hybrid.status,'unavailable');assert.equal(discover({...q,retrieval:{mode:'hybrid'}},root).retrieval.used_mode,'legacy');assert.equal(discover(q,root).retrieval.used_mode,'bm25');
 before=fs.readFileSync(binding);put('wiki/new.md','# New\n未审核草稿。');assert.equal(afterReviewedCommit(root,{run:rp}).status,'failed');assert.deepEqual(fs.readFileSync(binding),before);
 fs.unlinkSync(path.join(root,'wiki/new.md'));
 // Deletion through an explicit reviewed maintenance event.
 fs.unlinkSync(path.join(root,'wiki/b.md'));git('add','wiki/b.md');git('commit','-qm','synthetic reviewed deletion');result=afterReviewedCommit(root,{reviewRef:'synthetic reviewed deletion',paths:['wiki/b.md']});assert.equal(result.status,'updated');assert.equal(discover(q,root).retrieval.used_mode,'bm25');
 console.log(JSON.stringify({status:'pass',cases:10,scope:'synthetic actual Git commits, pending/wrong approval rejection, add/edit/delete, default discovery and full read, unchanged idempotence, dirty and scope rejection, unavailable hybrid fallback'}));
}finally{if(prev===undefined)delete process.env.KNOWLEDGE_RETRIEVAL_CONFIG;else process.env.KNOWLEDGE_RETRIEVAL_CONFIG=prev;fs.rmSync(tmp,{recursive:true,force:true});}
