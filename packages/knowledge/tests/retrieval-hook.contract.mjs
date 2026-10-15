/** Actual Git post-commit invocation on a synthetic library. */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {installPostCommitHook} from '../system/query/retrieval-maintenance.mjs';
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'knowledge-post-commit-')),root=path.join(tmp,'library'),tools=process.env.TOOLS_ROOT,python=process.env.PYTHON_EXECUTABLE??'python';fs.mkdirSync(root);assert.ok(tools);
const git=(...a)=>execFileSync('git',['-C',root,...a],{encoding:'utf8'}).trim();
const write=(p,s)=>{p=path.join(root,p);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,s);};
const previous=process.env.KNOWLEDGE_RETRIEVAL_CONFIG;
try{
 git('init','-q');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');write('wiki/a.md','# A\n\n## 机制\n空间限制行动。\n');
 write('system/query/retrieval-maintenance.mjs',fs.readFileSync(path.resolve(import.meta.dirname,'../system/query/retrieval-maintenance.mjs')));git('add','.');git('commit','-qm','baseline');
 const home=path.join(tmp,'v0');execFileSync(python,['-X','utf8','-B',path.join(tools,'integrations/retrieval/cli.py'),'build','--root',root,'--home',home]);
 const bp=path.join(tmp,'binding.json');fs.writeFileSync(bp,JSON.stringify({schema_version:1,python,tools_root:tools,runtime_config:path.join(home,'config.json'),maintenance:{enabled:true,versions_root:path.join(tmp,'versions')}}));process.env.KNOWLEDGE_RETRIEVAL_CONFIG=bp;
 let result=installPostCommitHook(root);assert.equal(result.status,'installed');assert.equal(installPostCommitHook(root).status,'unchanged');
 write('wiki/a.md','# A\n\n## 机制\n开阔空间支持侧移绕行。\n');git('add','wiki/a.md');const stdout=git('commit','-m','reviewed maintenance','-m','Knowledge-Review-Ref: synthetic-review-only\nKnowledge-Review-Paths: ["wiki/a.md"]');
 const eventFolder=path.join(tmp,'versions/events');const event=JSON.parse(fs.readFileSync(path.join(eventFolder,fs.readdirSync(eventFolder)[0])));assert.equal(event.results[0].status,'updated');const b=JSON.parse(fs.readFileSync(bp));assert.notEqual(b.runtime_config,path.join(home,'config.json'));assert.ok(fs.existsSync(path.join(tmp,'versions/events')));
 const before=fs.readFileSync(bp);write('wiki/a.md','# A\n\n## 机制\n未审核新内容。\n');git('add','wiki/a.md');const noReview=git('commit','-m','unreviewed change');assert.deepEqual(fs.readFileSync(bp),before);
 // Actual completed-run commit invokes the same approval-bound adapter automatically.
 const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
 const rp='system/maintenance/ingest-runs/fixture/run.json',report='system/maintenance/ingest-runs/fixture/report.md',manifest='system/maintenance/ingest-runs/fixture/content.json';
 write(report,'Synthetic exact review, not a real user approval.');
 write(manifest,JSON.stringify({batch_id:'fixture',review_path:report,review_sha256:sha(report),wiki_paths:['wiki/a.md'],files:[{path:'wiki/a.md',exists:true,sha256:sha('wiki/a.md')}]}));
 write(rp,JSON.stringify({status:'completed',batch_id:'fixture',final_review:{path:report,sha256:sha(report),approved_sha256:sha(report),content_manifest:manifest,content_manifest_sha256:sha(manifest)}}));git('add','.');git('commit','-m','synthetic approved finish exit');
 const completedHead=git('rev-parse','HEAD'),eventName=fs.readdirSync(eventFolder).find(p=>p.startsWith(completedHead));assert.ok(eventName);assert.equal(JSON.parse(fs.readFileSync(path.join(eventFolder,eventName))).results[0].status,'updated');
 // Never replace another host hook.
 fs.writeFileSync(result.hook,'#!/bin/sh\n# existing host hook\nexit 0\n');const bytes=fs.readFileSync(result.hook);assert.equal(installPostCommitHook(root).status,'blocked');assert.deepEqual(fs.readFileSync(result.hook),bytes);
 console.log(JSON.stringify({status:'pass',cases:5,actual_post_commit_invoked:true,scope:'approved completed-run and reviewed maintenance commit auto-refresh, ordinary unreviewed commit skipped, duplicate install unchanged, existing hook preserved'}));
}finally{if(previous===undefined)delete process.env.KNOWLEDGE_RETRIEVAL_CONFIG;else process.env.KNOWLEDGE_RETRIEVAL_CONFIG=previous;fs.rmSync(tmp,{recursive:true,force:true});}
