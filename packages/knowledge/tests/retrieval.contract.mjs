/** Synthetic end-to-end Knowledge -> Tools -> actual Wiki read; no model or private corpus. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';
import {discover,discoverLegacy,readSource} from '../system/query/query-evidence.mjs';
const tools=process.env.TOOLS_ROOT??path.resolve(import.meta.dirname,'../../Tools'),python=process.env.PYTHON_EXECUTABLE??'python';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-retrieval-'));const root=path.join(tmp,'library'),home=path.join(tmp,'index');fs.mkdirSync(path.join(root,'wiki'),{recursive:true});
const run=(cmd,args)=>{const r=spawnSync(cmd,args,{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr||r.stdout);return r.stdout;};
const previous=process.env.KNOWLEDGE_RETRIEVAL_CONFIG;
try {
 fs.writeFileSync(path.join(root,'wiki/资源.md'),'# 资源\n\n## 条件\n囤积并非总是错误。恐怖游戏的资源稀缺可以保留。\n');
 fs.writeFileSync(path.join(root,'wiki/战斗.md'),'# 战斗\n\n## 行动\n稳定10伤、无恢复时，20血需2击，35血需4击。\n');
 run('git',['-C',root,'init','-q']);run('git',['-C',root,'add','.']);run('git',['-C',root,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture']);
 run(python,['-X','utf8','-B',path.join(tools,'integrations/retrieval/cli.py'),'build','--root',root,'--home',home]);
 const binding=path.join(tmp,'binding.json');fs.writeFileSync(binding,JSON.stringify({schema_version:1,python,tools_root:tools,runtime_config:path.join(home,'config.json')}));process.env.KNOWLEDGE_RETRIEVAL_CONFIG=binding;
 const q={schema_version:1,need:{question:'玩家把道具一直留着为什么？',kind:'understanding'},terms:['囤积']};
 const before=fs.readFileSync(path.join(root,'wiki/资源.md'));let result=discover(q,root);assert.equal(result.retrieval.used_mode,'bm25');assert.ok(result.candidates.some(c=>c.ref==='knowledge:wiki:资源'));assert.ok(result.candidates.every(c=>c.content_read===false));assert.equal(result.writes,false);
 const receipt=readSource({request:q,ref:'knowledge:wiki:资源',selection:{mode:'full'}},root);assert.ok(receipt.content.includes('恐怖'));assert.equal(receipt.claim_support,'not_verified');assert.deepEqual(before,fs.readFileSync(path.join(root,'wiki/资源.md')));
 assert.equal(discover({...q,retrieval:{mode:'legacy'}},root).retrieval.used_mode,'legacy');assert.deepEqual(discover({...q,retrieval:{mode:'legacy'}},root).candidates,discoverLegacy(q,root).candidates);
 assert.equal(discover({...q,retrieval:{mode:'hybrid'}},root).retrieval.used_mode,'legacy');assert.equal(discover({...q,sources:{knowledge:false}},root).status,'disabled');assert.equal(discover({...q,sources:{wiki:false}},root).retrieval.reason,'source_disabled');
 fs.appendFileSync(path.join(root,'wiki/资源.md'),'\nChanged claim.');result=discover(q,root);assert.equal(result.retrieval.used_mode,'legacy');assert.equal(result.retrieval.reason,'backend_unavailable_or_stale');
 process.env.KNOWLEDGE_RETRIEVAL_CONFIG=path.join(tmp,'absent');assert.equal(discover(q,root).retrieval.used_mode,'legacy');assert.throws(()=>discover({...q,retrieval:{mode:'hybrid',runtime_config:'escape'}},root));
 console.log(JSON.stringify({status:'pass',cases:9,scope:'synthetic real build, BM25 default, original full read, no writes, explicit legacy, unavailable hybrid/stale/missing fallback, disabled sources and request-path rejection'}));
} finally {
 if(previous===undefined)delete process.env.KNOWLEDGE_RETRIEVAL_CONFIG;else process.env.KNOWLEDGE_RETRIEVAL_CONFIG=previous;
 fs.rmSync(tmp,{recursive:true,force:true});
}
