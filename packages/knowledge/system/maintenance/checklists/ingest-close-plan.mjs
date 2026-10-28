import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
export function committedParent(root){
  root=fs.realpathSync(root);
  // An independently cloned nested repo can still be tracked as a gitlink.
  // --show-superproject-working-tree alone misses that common local layout.
  for(let candidate=path.dirname(root);candidate!==path.dirname(candidate);candidate=path.dirname(candidate)){
    if(!fs.existsSync(path.join(candidate,'.git')))continue;
    const link=path.relative(candidate,root).split(path.sep).join('/');
    let entry;
    try{entry=execFileSync('git',['-c',`safe.directory=${candidate.replaceAll('\\','/')}`,'-C',candidate,'ls-tree','HEAD','--',link],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}
    catch(error){throw Error('Cannot verify potential parent '+candidate+': '+(error.stderr?.toString()||error.message));}
    const match=entry.match(/^160000 commit ([0-9a-f]{40,64})\t/);
    if(match)return {path:candidate,gitlink_path:link,committed_child:match[1]};
  }
  return null;
}
export function closePlan(root, runPath, phase = 'Inspect') {
  const full = path.resolve(root, runPath), relative = path.relative(root, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Run must stay inside repository.');
  const run = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const dirty = new Set([...git('diff','--name-only','-z').split('\0'), ...git('diff','--cached','--name-only','-z').split('\0'), ...git('ls-files','--others','--exclude-standard','-z').split('\0')].filter(Boolean));
  const directory = path.posix.dirname(relative.replaceAll('\\','/'));
  const exitPaths = [relative.replaceAll('\\','/'), directory+'/final-review.md', directory+'/final-review-content.json', 'system/maintenance/ingest-runs/index.json', 'system/registry/ingest-auto-review-state.json'];
  // The run manifest and advance outputs are the authoritative provenance for
  // ordinary evidence. Known run-local evidence folders are produced by the
  // standalone backtest/review paths, which can finish after Stage3 sealing.
  const evidenceFolders=new Set(['backtest-source-audits','core-review','diffs','evidence','raw-bodies','raw-headers','repairs','review-bundles','revisions','source-manifests','tasks','work']);
  const recorded=new Set(),visited=new Set();
  const visit=value=>{
    if(Array.isArray(value)){value.forEach(visit);return;}
    if(value&&typeof value==='object'){Object.values(value).forEach(visit);return;}
    if(typeof value!=='string'||!value.startsWith(directory+'/')||visited.has(value))return;
    const file=path.resolve(root,value),base=path.resolve(root,directory)+path.sep;
    if(!file.startsWith(base)||!fs.existsSync(file)||!fs.statSync(file).isFile()||fs.lstatSync(file).isSymbolicLink())return;
    visited.add(value);recorded.add(value);
    if(file.endsWith('.json'))visit(JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')));
  };
  visit(run);
  const unclassified=[];
  for(const p of dirty){
    if(!p.startsWith(directory+'/')||exitPaths.includes(p))continue;
    const suffix=p.slice(directory.length+1),folder=suffix.split('/')[0];
    if(recorded.has(p)||evidenceFolders.has(folder)||/^(?:backtest|content-backtest|maintenance|semantic|package|context|registration|stage3-prepared|page-review|raw-review|advance-error|aggregate)[^/]*\.(?:json|md)$/.test(suffix))exitPaths.push(p);
    else unclassified.push(p);
  }
  if(run.execution_control?.page_review_contract_version>=2)for(const rel of ['NOW.md','system/registry/KNOWLEDGE_STATUS.md']){
    if(fs.existsSync(path.join(root,rel))&&fs.readFileSync(path.join(root,rel),'utf8').includes(run.batch_id))exitPaths.push(rel);
  }
  const attachments=[];
  for (const name of ['lifecycle-timing.json','cost-final.json','cost-review.json']) {
    const p=directory+'/'+name;
    if(fs.existsSync(path.join(root,p))) exitPaths.push(p);
  }
  if (run.final_review?.content_manifest) {
    const resolveLocal=value=>{
      const full=path.resolve(root,value), rel=path.relative(root,full);
      if (rel.startsWith('..') || path.isAbsolute(rel)) throw Error('Review attachment escapes repository');
      const real=fs.realpathSync(full),realRoot=fs.realpathSync(root);
      if (!real.startsWith(realRoot+path.sep)) throw Error('Linked review attachment escapes repository');
      return full;
    };
    const digest=file=>crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const manifestFile=resolveLocal(run.final_review.content_manifest);
    if (digest(manifestFile)!==run.final_review.content_manifest_sha256) throw Error('Final content manifest drift');
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8').replace(/^\uFEFF/,''));
    if (digest(resolveLocal(run.final_review.path))!==run.final_review.sha256 || manifest.review_sha256!==run.final_review.sha256) throw Error('Final review report drift');
    for (const file of manifest.files??[]) {
      if (!file.path.startsWith(directory+'/diffs/')) continue;
      if (!file.exists || digest(resolveLocal(file.path))!==file.sha256) throw Error('Final review attachment missing or changed: '+file.path);
      attachments.push(file.path); exitPaths.push(file.path);
    }
    const review=fs.readFileSync(resolveLocal(run.final_review.path),'utf8');
    for (const match of review.matchAll(/\]\((diffs\/[^)]+)\)/g)) {
      const target=directory+'/'+decodeURIComponent(match[1]);
      if (!attachments.includes(target)) throw Error('Review diff is not bound by content manifest: '+target);
    }
  }
  const tracked=new Set(attachments.length ? git('ls-files','-z','--',...attachments).split('\0').filter(Boolean) : []);
  const pending=exitPaths.filter(x=>dirty.has(x) || (attachments.includes(x) && !tracked.has(x)));
  const head = git('rev-parse','HEAD');
  let parent = committedParent(root);
  const superproject = git('rev-parse','--show-superproject-working-tree');
  if (superproject) {
    const link = path.relative(superproject, root).replaceAll('\\','/');
    const entry = execFileSync('git',['-c',`safe.directory=${superproject.replaceAll('\\','/')}`,'-C',superproject,'ls-tree','HEAD','--',link],{encoding:'utf8'}).trim();
    const match = entry.match(/^160000 commit ([0-9a-f]{40,64})\t/);
    parent = {path:superproject,gitlink_path:link,committed_child:match?.[1]??null,matches_child_head:match?.[1]===head};
  }
  if(parent)parent.matches_child_head=parent.committed_child===head;
  return {status:run.status,phase,run_path:relative.replaceAll('\\','/'),raw_count:fs.readdirSync(path.join(root,'raw-sources'),{withFileTypes:true}).filter(x=>x.isFile()&&x.name.endsWith('.md')&&x.name!=='README.md'&&!x.name.endsWith('.template.md')).length,
    recorded_counts:run.counts,stage1_revision:run.commits.stage1,stage3_revision:run.commits.stage3,final_review:run.final_review,
    review_attachments:attachments,stage_paths:pending,unclassified_run_paths:unclassified,other_dirty_paths:[...dirty].filter(x=>!exitPaths.includes(x)),head,parent,
    git_closed:run.status==='completed' && !pending.length && (!parent || parent.matches_child_head),
    next_action:run.status==='completed'?'Run Costs before the exit commit (partial lifecycle); Inspect lists exit paths. Commit each direct parent gitlink and verify edges, then run read-only CostsSnapshot. Report its explicit cutoff, not cost-final as full-batch cost.':'Continue the current gate; Review renders and verifies, Finish requires the exact approved hash.'};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const args={}; for(let i=2;i<process.argv.length;i+=2) args[process.argv[i].slice(2)]=process.argv[i+1]; console.log(JSON.stringify(closePlan(args.root,args.run,args.phase),null,2)); }
  catch(e) {console.error(e.message);process.exitCode=2;}
}
