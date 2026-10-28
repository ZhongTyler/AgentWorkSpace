import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe} from './raw-quality.mjs';
import {consumptionMetrics} from './wiki-consumption.mjs';

// Only update a view that explicitly belongs to this completed batch, not another owner's focus.
export function syncCurrentState(root,run){
  if(run.status!=='completed')throw Error('Current-state sync requires completed run');
  const data=JSON.parse(fs.readFileSync(safe(root,run.package_data.path),'utf8').replace(/^\uFEFF/,''));
  const m=consumptionMetrics(data.sections.stage3.semantic),changed=[];
  const summary=`批次 ${run.batch_id} 已批准并 completed（${run.counts.after} Raw）；${m.wiki_page_count} 个 Wiki 页面 / ${m.destination_count} 条落点，${m.multi_page_raw_count} 篇一对多。Git 闭合另按提交树核验。`;
  for(const rel of ['NOW.md','system/registry/KNOWLEDGE_STATUS.md']){
    const file=safe(root,rel);const before=fs.readFileSync(file,'utf8');
    let after=before;
    if(rel==='NOW.md'){
      after=after.replace(/(## 当前阶段\r?\n\r?\n)([^\r\n]+)/,(_,heading,line)=>heading+(line.includes(run.batch_id)?summary:line));
      // Only clear the stale batch-specific next action; retain unrelated plans.
      const short=run.batch_id.match(/-b(\d+)-/)?.[1];
      if(short)after=after.replace(/^- .*$/gm,line=>line.includes(`B${short} 最终审核与用户确认`)?line.replace(`先完成 B${short} 最终审核与用户确认；`,'本批已批准；'):line);
    }else after=after.replace(/^- 当前运行：.*$/gm,line=>line.includes(run.batch_id)?`- 当前运行：${summary}`:line);
    if(after!==before){fs.writeFileSync(file,after);changed.push(rel);}
  }
  return {status:'synchronized',changed,scope:'Current batch status only; original approval and reports unchanged; not a semantic or Git PASS'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];console.log(JSON.stringify(syncCurrentState(a.root,JSON.parse(fs.readFileSync(safe(a.root,a.run),'utf8').replace(/^\uFEFF/,'')))));}
  catch(e){console.error(e.message);process.exitCode=1;}
}
