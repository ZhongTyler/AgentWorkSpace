import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe,sha} from './raw-quality.mjs';
import {scoreRows} from './ingest-score-check.mjs';
import {consumptionMetrics} from './wiki-consumption.mjs';

// The controller supplies prose/category only when a row is missing. Arithmetic,
// row rendering, counters and current-batch notices have one deterministic owner.
export function syncRegistration(root,run,semantic,registration={rows:[]}) {
  if(run.status!=='stage2_planned')throw Error('Registration requires open Stage3');
  const read=p=>fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,'');
  const data=JSON.parse(read(run.package_data.path)),scores=scoreRows(data.sections.scoring.semantic);
  const rawPath='system/registry/raw-list.md';let rawList=read(rawPath);
  const errors=[],updates=new Map(),batch=(run.artifacts??[]).filter(a=>a.kind==='raw'&&a.disposition==='ingested');
  const cells=(line)=>line.split('|').map(s=>s.trim());
  for(const raw of batch){
    const audit=run.content_audits.find(a=>a.raw_path===raw.path);
    if(!audit||sha(fs.readFileSync(safe(root,audit.path)))!==audit.sha256)throw Error('Bound audit required: '+raw.path);
    const receipt=JSON.parse(read(audit.path));
    if(receipt.status!=='passed'||receipt.raw_path!==raw.path||receipt.raw_sha256!==sha(fs.readFileSync(safe(root,raw.path))))throw Error('Raw audit drift: '+raw.path);
    const match=scores.filter(s=>receipt.sources?.some(x=>x.source_path===s.source));
    if(match.length!==1)throw Error('Unambiguous approved score required: '+raw.path);
    const name=path.posix.basename(raw.path),lines=rawList.split(/\r?\n/),existing=lines.filter(l=>cells(l)[1]===name);
    if(existing.length>1)throw Error('Duplicate registry row: '+name);
    if(existing.length){const cols=cells(existing[0]);if(cols.length!==9)throw Error('Unsupported registry columns: '+name);cols[7]=match[0].intrinsic_total.toFixed(1)+'/10';rawList=rawList.replace(existing[0],'| '+cols.slice(1,-1).join(' | ')+' |');continue;}
    const supplied=registration.rows.filter(r=>r.raw===raw.path);
    if(supplied.length!==1){errors.push({raw:raw.path,fields:['category','source','keywords','summary','unconsumed']});continue;}
    const r=supplied[0];
    if(!['设计理论与方法论','游戏分析与拆解'].includes(r.category)||['source','keywords','summary','unconsumed'].some(k=>typeof r[k]!=='string'||!r[k].trim()||/[|\r\n]/.test(r[k])))throw Error('Invalid controller registration fields: '+raw.path);
    const escaped=r.category.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    const section=new RegExp('(^### '+escaped+'\\r?\\n[\\s\\S]*?)(?=^### |$(?![\\s\\S]))','m');
    if(!section.test(rawList))throw Error('Registry category missing: '+r.category);
    const row='| '+[name,r.source,r.keywords,r.summary,'0 ⚪ 孤立',r.unconsumed,match[0].intrinsic_total.toFixed(1)+'/10'].join(' | ')+' |';
    rawList=rawList.replace(section,block=>block.trimEnd()+'\n'+row+'\n\n');
  }
  if(errors.length)return {status:'needs_registration',missing:errors,next_action:'Supply only these semantic fields in run-local registration.json; Prepare renders scores/counts. No files changed.'};
  rawList=rawList.replace(/(^### [^\r\n]+\r?\n)([\s\S]*?)(?=^### |$(?![\s\S]))/gm,(_,h,b)=>h+b.replace(/（共\s*\d+\s*篇）/,`（共 ${b.split(/\r?\n/).filter(l=>/^\|\s*[^|]+\.md\s*\|/.test(l)).length} 篇）`));
  updates.set(rawPath,rawList);
  const count=fs.readdirSync(safe(root,'raw-sources',false),{withFileTypes:true}).filter(f=>f.isFile()&&f.name.endsWith('.md')&&f.name!=='README.md'&&!f.name.endsWith('.template.md')).length;
  for(const p of ['NOW.md','system/registry/KNOWLEDGE_STATUS.md']){
    const before=read(p);if(!/^\s*-\s*raw：\d+/m.test(before))throw Error('Raw count slot missing: '+p);
    updates.set(p,before.replace(/^(\s*-\s*raw：)\d+/m,(_,prefix)=>prefix+count));
  }
  const m=consumptionMetrics(semantic),notice=`批次 ${run.batch_id}：Raw ${run.counts.before}→${count}；${m.wiki_page_count} 个 Wiki 页面，${m.destination_count} 个落点，${m.multi_page_raw_count} 篇一对多。等待正式审核与批准。`;
  const marker=`<!-- ingest-registration:${run.batch_id} -->`;
  for(const p of ['system/registry/index.md','system/maintenance/CHANGELOG.md']){
    const before=read(p);
    // One generated block per batch; never edit earlier historical entries.
    const start=before.indexOf(marker),end=start<0?-1:before.indexOf('<!-- /ingest-registration -->',start);
    const block=marker+'\n'+notice+'\n<!-- /ingest-registration -->';
    if(start>=0&&end<0)throw Error('Incomplete registration block: '+p);
    updates.set(p,start<0?before.replace(/^(.*\r?\n)/,`$1\n${block}\n`):before.slice(0,start)+block+before.slice(end+'<!-- /ingest-registration -->'.length));
  }
  const changed=[];
  for(const [p,after] of updates)if(read(p)!==after){fs.writeFileSync(safe(root,p),after);changed.push(p);}
  return {status:'synchronized',changed,raw_count:count,metrics:m};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];const read=p=>JSON.parse(fs.readFileSync(safe(a.root,p),'utf8').replace(/^\uFEFF/,''));
    const r=syncRegistration(a.root,read(a.run),read(a.semantic),a.registration?read(a.registration):undefined);console.log(JSON.stringify(r));if(r.status!=='synchronized')process.exitCode=2;
  }catch(e){console.error(e.message);process.exitCode=2;}
}
