import fs from 'node:fs';
import path from 'node:path';
import {safe} from './raw-quality.mjs';

const registry='system/registry/KNOWLEDGE_STATUS.md';
const rowPattern=/^\|\s*`([^`]+)`\s*\|\s*(\d+)\s*\|([^|]*)\|([^|]*)\|\s*$/gm;
export function capacityRows(root,pages){
  const text=fs.readFileSync(safe(root,registry),'utf8');
  const selected=new Set(pages.map(page=>path.posix.basename(page,'.md'))),result=[];
  for(const match of text.matchAll(rowPattern))if(selected.has(match[1])){
    const closure=match[4].trim(),parts=closure.split('；复核时点：');
    result.push({page:'wiki/'+match[1]+'.md',lines:Number(match[2]),basis:match[3].trim(),closure,
      previous_defer:parts.length===2&&parts.every(x=>x.trim())?{reason:parts[0],review_when:parts[1]}:null});
  }
  if(new Set(result.map(r=>r.page)).size!==result.length)throw Error('Duplicate capacity-risk row for a current Wiki page');
  return result.sort((a,b)=>a.page.localeCompare(b.page));
}
export function recordCapacityDecision(root,risks,decisions,semantic){
  if(!Array.isArray(decisions)||decisions.length!==risks.length||new Set(decisions.map(d=>d.page)).size!==risks.length)throw Error('Capacity decision must cover every affected risk once');
  const updates=[];
  for(const risk of risks){
    const choice=decisions.find(d=>d.page===risk.page);
    if(choice?.action==='reuse'){
      // The parent has already reviewed changed prose. Reuse is an explicit
      // semantic decision, not inferred from elapsed time, line count or PASS.
      if(!risk.previous_defer||choice.conditions_unchanged!==true||choice.rules_and_trigger_checked!==true||!choice.context_check?.trim())throw Error('Capacity reuse needs a prior defer and explicit unchanged conditions, current rules/trigger and context check');
      updates.push({risk,closure:risk.closure});continue;
    }
    if(!choice||!['defer','split'].includes(choice.action)||typeof choice.reason!=='string'||!choice.reason.trim())throw Error('Capacity decision needs an action and concrete reason: '+risk.page);
    if(choice.action==='defer'&&(!choice.review_when||typeof choice.review_when!=='string'))throw Error('Deferred split needs review_when: '+risk.page);
    if(choice.action==='split'&&!semantic.structure_change_requests?.some(r=>r.kind==='wiki_split'&&r.status==='approved'&&r.authorization&&r.plan_path))throw Error('Split decision needs an approved split plan and authorization');
    const closure=choice.action==='defer'?`${choice.reason.trim()}；复核时点：${choice.review_when.trim()}`:`${choice.reason.trim()}；按已批准拆分计划执行并核验。`;
    if(/[|\r\n]/.test(closure))throw Error('Capacity reason cannot contain a table separator or newline');
    updates.push({risk,closure});
  }
  const full=safe(root,registry),before=fs.readFileSync(full,'utf8');let after=before;
  for(const {risk,closure} of updates){
    const lines=after.split(/\r?\n/),indices=lines.map((line,i)=>({line,i})).filter(x=>{const m=x.line.match(/^\|\s*`([^`]+)`\s*\|/);return m?.[1]===path.posix.basename(risk.page,'.md');});
    if(indices.length!==1)throw Error('Capacity row changed before decision: '+risk.page);
    const old=indices[0].line;
    if(!old.includes(`| ${risk.lines} |`))throw Error('Capacity count changed before decision: '+risk.page);
    lines[indices[0].i]=`| \`${path.posix.basename(risk.page,'.md')}\` | ${risk.lines} | ${risk.basis} | ${closure} |`;
    after=lines.join(before.includes('\r\n')?'\r\n':'\n');
  }
  if(after!==before){const tmp=safe(root,registry+'.pending',false);fs.writeFileSync(tmp,after);fs.renameSync(tmp,full);}
  return {status:'recorded',changed:after!==before,rows:updates.length};
}
