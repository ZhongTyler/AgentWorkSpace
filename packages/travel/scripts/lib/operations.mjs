import fs from 'node:fs';
import path from 'node:path';
import {inside, read, write, hash, dayHash, now} from './core.mjs';

const minute = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '') ? Number(s.slice(0,2))*60+Number(s.slice(3)) : NaN;
// Optional structured constraints: ordinary projects without them stay compatible.
export function scheduleReport(trip) {
  const errors=[], warnings=[], windows=[];
  for (const d of trip.days) {
    const byId=new Map(d.timeline.filter(t=>t.id).map(t=>[t.id,t]));
    if(byId.size!==d.timeline.filter(t=>t.id).length)errors.push(d.date+': duplicate timeline ID');
    for(const c of d.constraints || []) {
      const selected=(c.timelineIds || []).map(id=>byId.get(id));
      if(!selected.length || selected.some(t=>!t)) {errors.push(d.date+': constraint '+c.id+' needs existing timelineIds');continue;}
      // A protected experience can never count transfers, food or luggage as shopping time.
      const spans=selected.filter(t=>t.kind===c.kind && (!t.branch || t.branch==='default')).map(t=>[minute(t.start),minute(t.end)]).sort((a,b)=>a[0]-b[0]);
      let total=0, end=-1;
      for(const [a,b] of spans){if(!Number.isFinite(a+b)||b<a){errors.push(d.date+': invalid protected span');continue;}total+=Math.max(0,b-Math.max(a,end));end=Math.max(end,b);}
      windows.push({date:d.date,id:c.id,kind:c.kind,minutes:total,minMinutes:c.minMinutes,maxMinutes:c.maxMinutes});
      if(!c.kind||!Number.isFinite(c.minMinutes)||c.minMinutes<0 || (c.maxMinutes!=null && (!Number.isFinite(c.maxMinutes)||c.maxMinutes<c.minMinutes)))errors.push(d.date+': invalid protected duration '+c.id);
      else if(total<c.minMinutes)errors.push(d.date+': protected '+c.id+' only '+total+' min; requires '+c.minMinutes);
      else if(c.maxMinutes!=null && total>c.maxMinutes)errors.push(d.date+': protected '+c.id+' exceeds maximum '+c.maxMinutes);
    }
    for(const t of d.timeline) {
      if(t.branch && t.branch!=='default')continue;
      const allocated=minute(t.end)-minute(t.start);
      if((t.routeId||t.deadlines?.length||t.minExperienceMinutes!=null)&&(!Number.isFinite(allocated)||allocated<0))errors.push(d.date+': invalid constrained timeline span '+(t.id||t.title));
      const route=trip.routes.find(r=>r.id===t.routeId);
      const eta=route?.observedDuration;
      if(eta){
        if(!Number.isFinite(eta.minutes)||eta.minutes<0||!eta.source||!eta.checkedAt)errors.push(d.date+': invalid observed map duration '+route.id);
        else if(allocated<eta.minutes+(t.bufferMinutes||0))errors.push(d.date+': '+route.id+' observed '+eta.minutes+' min exceeds allocated '+allocated+' min');
      }
      for(const limit of t.deadlines || []) {
        if(!['closes','lastAdmission','kitchenLastOrder','discountStarts','safetyCutoff'].includes(limit.kind)||!Number.isFinite(minute(limit.time))||!limit.source||!limit.checkedAt){errors.push(d.date+': invalid operational deadline');continue;}
        const at=minute(limit.time), start=minute(t.start), end=minute(t.end);
        if((['closes','safetyCutoff'].includes(limit.kind)&&end>at)||(['lastAdmission','kitchenLastOrder'].includes(limit.kind)&&start>at)||(limit.kind==='discountStarts'&&start<at))errors.push(d.date+': '+t.title+' conflicts with '+limit.kind+' '+limit.time);
      }
      if(t.minExperienceMinutes!=null && (!Number.isFinite(t.minExperienceMinutes)||t.minExperienceMinutes<0||allocated<t.minExperienceMinutes))errors.push(d.date+': insufficient experience duration '+t.title);
      if(t.compressionPriority!=null && !Number.isInteger(t.compressionPriority))errors.push(d.date+': compressionPriority must be integer');
    }
    const order=d.timeline.filter(t=>Number.isInteger(t.compressionPriority)).sort((a,b)=>a.compressionPriority-b.compressionPriority).map(t=>t.id||t.title);
    if(order.length)warnings.push(d.date+': delay compression order '+order.join(' -> ')+'; safety cutoffs override protected experiences');
  }
  return {valid:!errors.length,errors,warnings,windows};
}

export function channelPolicy(project) {
  const file=inside(project,'research/channels.json');
  return fs.existsSync(file)?read(file):{xiaohongshu:{state:'enabled'}};
}
export function assertResearchEnabled(project, runtime) {
  for(const file of [project && inside(project,'research/channels.json'),runtime && path.join(runtime,'channel-policy.json')].filter(Boolean)) {
    if(!fs.existsSync(file))continue;
    const p=read(file);
    if(!['enabled','paused'].includes(p.xiaohongshu?.state))throw Error('Invalid research channel policy');
    if(p.xiaohongshu.state==='paused')throw Error('Xiaohongshu paused by user: no connect, start, login, retry, search or extract; reuse local evidence and official sources');
  }
}
export function setChannel(project,{state,reason,by,runtime,explicitUserResume=false}) {
  if(!['enabled','paused'].includes(state)||!reason||!by)throw Error('state/reason/by required');
  const runtimePaused=runtime && fs.existsSync(path.join(path.resolve(runtime),'channel-policy.json')) && read(path.join(path.resolve(runtime),'channel-policy.json')).xiaohongshu?.state==='paused';
  if((channelPolicy(project).xiaohongshu?.state==='paused'||runtimePaused) && state==='enabled' && !explicitUserResume)throw Error('Explicit user resume required');
  const policy={xiaohongshu:{state,reason,by,at:now()}};
  write(inside(project,'research/channels.json'),policy);
  // Bind the runtime used by old unscoped mcp-start/login/install commands too.
  if(runtime)write(path.join(path.resolve(runtime),'channel-policy.json'),policy);
  return policy;
}

export function changeReport(before,after,{date,actual,by,at}={}) {
  if(!date||!by||!at||!Array.isArray(actual)||actual.some(x=>!x.title||!x.time))throw Error('Change review needs date, by, at and actual observations');
  const pastChanges=before.days.filter(d=>d.date<date && dayHash(d)!==dayHash(after.days.find(x=>x.date===d.date)||{})).map(d=>d.date);
  const changed=after.days.filter(d=>dayHash(d)!==dayHash(before.days.find(x=>x.date===d.date)||{})).map(d=>d.date);
  const adjacent=after.days.filter(d=>d.date>=date && changed.some(c=>Math.abs(Date.parse(c)-Date.parse(d.date))<=864e5)).map(d=>d.date);
  return {valid:!pastChanges.length,date,by,at,actual,pastChanges,changed,reviewDates:adjacent,
    consumers:['timeline','meals','routes-and-captures','orders-todos','journal-experiences','budget','site'],
    beforeHash:hash(before),afterHash:hash(after),note:'Review aid, not automatic adoption. Actual observations do not replace planned history; do not rewrite past dates without an explicit correction.'};
}

// Adapter-neutral regression: no model installation, paid request or model preference.
export function assistantCoverage(expected,result) {
  const errors=[], omitted=result.omitted || [], units=result.units || [];
  const required=expected.units || [];
  if(new Set(units.map(u=>u.id)).size!==units.length)errors.push('duplicate unit');
  if(new Set(omitted.map(u=>u.id)).size!==omitted.length)errors.push('duplicate omission');
  for(const u of required){
    const got=units.find(x=>x.id===u.id), omission=omitted.find(x=>x.id===u.id);
    if(!got && !omission)errors.push('missing unit '+u.id);
    if(got && omission)errors.push('unit both included and omitted '+u.id);
    if(got && (got.date!==u.date||got.contentHash!==u.contentHash||JSON.stringify([...(got.sourceIds||[])].sort())!==JSON.stringify([...(u.sourceIds||[])].sort())))errors.push('truncated/stale content or references '+u.id);
    if(omission && (!omission.reason || result.budgetLimited!==true))errors.push('unexplained omission '+u.id);
  }
  for(const u of [...units,...omitted])if(!required.some(x=>x.id===u.id))errors.push('unknown unit '+u.id);
  if(result.complete===true&&omitted.length)errors.push('false complete coverage claim');
  return {valid:!errors.length,errors,included:units.length,omitted:omitted.length,dates:[...new Set(required.map(x=>x.date))]};
}
