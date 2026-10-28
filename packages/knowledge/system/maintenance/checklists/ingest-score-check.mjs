import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {safe,sha} from './raw-quality.mjs';

const need=(ok,message)=>{if(!ok)throw Error('Scoring: '+message);};
const read=(root,p)=>JSON.parse(fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,''));
function value(v,max) {
  const m=String(v).match(/^(\d+(?:\.\d+)?)(?:\/(\d+))?$/);
  need(m && (!m[2] || +m[2]===max) && +m[1]<=max,'invalid score '+v);
  return +m[1];
}
export function scoreRows(semantic) {
  need(Array.isArray(semantic.rows)&&semantic.rows.length,'rows required');
  const seen=new Set();
  return semantic.rows.map(r=>{
    need(typeof r.source==='string'&&!seen.has(r.source),'missing/duplicate source');seen.add(r.source);
    const a1=value(r.A1,5),a2=value(r.A2,5),a3=value(r.A3,1),b1=value(r.B1,5),b2=value(r.B2,5);
    need([.85,.95,1].includes(a3),'A3 must be 0.85, 0.95 or 1.00');
    const round=x=>Math.round((x+Number.EPSILON)*10)/10;
    const intrinsic=round((a1+a2)*a3),total=round((a1+a2)*a3+b1+b2);
    need(value(r.total,20)===total,'total mismatch: '+r.source);
    return {source:r.source,intrinsic_total:intrinsic,total};
  });
}
export function checkRegistry(root,run) {
  const data=read(root,run.package_data.path),scores=scoreRows(data.sections.scoring.semantic);
  const lines=fs.readFileSync(safe(root,'system/registry/raw-list.md'),'utf8').split(/\r?\n/);
  const result=[];
  for(const raw of (run.artifacts??[]).filter(x=>x.kind==='raw'&&x.disposition==='ingested')) {
    const audit=(run.content_audits??[]).find(x=>x.raw_path===raw.path);
    need(audit && sha(fs.readFileSync(safe(root,audit.path)))===audit.sha256,'bound Raw audit required');
    const receipt=read(root,audit.path);
    need(receipt.status==='passed' && receipt.raw_path===raw.path,'passed Raw audit required');
    const matches=scores.filter(x=>receipt.sources?.some(s=>s.source_path===x.source));
    need(matches.length===1,'Raw source mapping required: '+raw.path);
    const rows=lines.map(x=>x.split('|').map(s=>s.trim())).filter(x=>x[1]===path.posix.basename(raw.path));
    need(rows.length===1 && value(rows[0][7],10)===matches[0].intrinsic_total,'registry intrinsic mismatch: '+raw.path);
    result.push({raw:raw.path,intrinsic_total:matches[0].intrinsic_total});
  }
  return {status:'passed',scope:'arithmetic and registration only; not semantic scoring approval',rows:result};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try{const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];
    console.log(JSON.stringify(a.run?checkRegistry(a.root,read(a.root,a.run)):{status:'passed',rows:scoreRows(read(a.root,a.semantic))}));
  }catch(e){console.error(e.message);process.exitCode=2;}
}
