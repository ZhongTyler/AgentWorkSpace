import fs from 'node:fs';
import path from 'node:path';
import {safe} from './raw-quality.mjs';
import {splitRaw} from './ingest-review-support.mjs';
import {scoreRows} from './ingest-score-check.mjs';

const register='system/registry/skipped-sources.md';
const scalar=value=>{
  const text=String(value??'').trim();
  if(text.startsWith('"')){try{return JSON.parse(text);}catch{/* YAML plain scalar fallback below */}}
  return text.replace(/^['"]|['"]$/g,'');
};
const cell=value=>String(value).replaceAll('|','\\|').replace(/\r?\n/g,' ').trim();

// The scoring decision and the source choice are supplied by the parent. This
// producer only renders their approved values and never decides what to skip.
export function syncSkippedSources(root,run,sources){
  const skipped=sources.filter(s=>s.disposition==='skipped');
  if(!skipped.length)return {status:'unchanged',added:0,path:register};
  const semantic=JSON.parse(fs.readFileSync(safe(root,run.package_data.path),'utf8')).sections.scoring.semantic;
  const totals=new Map(scoreRows(semantic).map(s=>[s.source,s.total]));
  const ratings=new Map(semantic.rows.map(s=>[s.source,s]));
  const current=fs.readFileSync(safe(root,register),'utf8');
  const additions=[];
  for(const item of skipped){
    const match=/^Clippings\/(\d{4})(\d{2})(\d{2})-(.+)\.md$/.exec(item.source);
    if(!match)throw Error('Skipped Clipping requires canonical name: '+item.source);
    const title=match[4],day=`${match[1]}-${match[2]}-${match[3]}`;
    const rating=ratings.get(item.source),total=totals.get(item.source);
    if(!rating||total===undefined)throw Error('Scoring row missing for skipped source: '+item.source);
    if(typeof item.skip_reason!=='string'||!item.skip_reason.trim()||typeof item.registration?.source!=='string'||!item.registration.source.trim())throw Error('Skipped source requires explicit source and reason: '+item.source);
    const text=fs.readFileSync(safe(root,item.source),'utf8'),meta=splitRaw(text).fields;
    const url=scalar((meta.source_url??meta.source)?.replace(/^[^:]+:\s*/,''));
    if(!/^https?:\/\//.test(url))throw Error('Skipped source URL is missing: '+item.source);
    const wiki=`[[${item.source.slice(0,-3)}]]`;
    const values=[day,`[${item.registration.source}](${url})`,title,rating.A1,rating.A2,rating.A3,rating.B1,rating.B2,total,`${item.skip_reason.trim()}。剪藏：${wiki}`];
    const row='| '+values.map(cell).join(' | ')+' |';
    const prior=current.split(/\r?\n/).filter(line=>line.includes(wiki));
    if(prior.length){
      if(prior.length!==1||prior[0]!==row)throw Error('Skipped source already recorded with different evidence; reconcile its historical score: '+item.source);
      continue;
    }
    additions.push(row);
  }
  if(!additions.length)return {status:'reused',added:0,path:register};
  const after=current.trimEnd()+'\n\n'+additions.join('\n')+'\n';
  const full=safe(root,register),pending=safe(root,register+'.pending',false);
  fs.writeFileSync(pending,after);fs.renameSync(pending,full);
  return {status:'recorded',added:additions.length,path:register};
}
