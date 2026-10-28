import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {safe,sha} from './raw-quality.mjs';

const meaningful=s=>typeof s==='string'&&s.trim().length>0;
const wiki=p=>typeof p==='string'&&/^wiki\/[^/\\]+\.md$/.test(p);

// Approved splits reuse the existing split verifier. Proposal-only requests
// remain in the package but do not authorize any structural edits.
export function verifyStructureRequests(root,run,semantic,{shell,invoke=execFileSync}={}){
  const requests=semantic.structure_change_requests??[];
  if(!Array.isArray(requests))throw Error('Structure requests must be an array');
  const reports=[];
  const runDir=path.posix.dirname(run.package_data.path);
  for(const request of requests){
    if(!request||typeof request!=='object'||Array.isArray(request))throw Error('Structure request must be a typed object');
    if(['proposed','candidate','deferred'].includes(request.status))continue;
    if(request.status!=='approved'||request.kind!=='wiki_split')return {status:'needs_contract',kind:request.kind??'unknown',request,contract:'system/integrations/DOMAIN_PRINCIPLES.md',reason:'This structural write needs its own explicit authorization and review contract; Wiki page review cannot certify it.'};
    if(!meaningful(request.authorization)||!meaningful(request.plan_path)||!request.plan_path.startsWith(runDir+'/'))throw Error('Approved split needs explicit authorization and a run-local plan');
    const plan=JSON.parse(fs.readFileSync(safe(root,request.plan_path),'utf8'));
    if(plan.batch_id!==run.batch_id||!wiki(plan.source?.path)||!wiki(plan.target?.path)||plan.source.path===plan.target.path)throw Error('Split plan must identify two Wiki pages in this batch');
    const planned=run.package_data?.path?JSON.parse(fs.readFileSync(safe(root,run.package_data.path),'utf8')).sections.stage2.semantic.consumption:[];
    const destinations=new Set(planned.flatMap(row=>row.decisions.flatMap(decision=>(decision.destinations??[]).map(to=>to.path))));
    for(const page of [plan.source.path,plan.target.path])if(!destinations.has(page)||!semantic.rows.some(row=>row.artifact===page))throw Error('Approved split page lacks this batch planning, writing and review: '+page);
    if(!semantic.splits?.some(split=>split.before===plan.source.path&&split.after===plan.target.path))throw Error('Approved split needs an explicit Stage3 outcome row');
    const receipt=`${runDir}/split-verify-${sha(request.plan_path).slice(0,12)}.json`;
    const program=safe(root,'system/maintenance/checklists/verify-wiki-split.ps1');
    const env={...process.env};for(const name of Object.keys(env))if(name.toLowerCase()==='psmodulepath')delete env[name];
    try{invoke(shell??(process.platform==='win32'?'powershell':'pwsh'),['-NoProfile','-File',program,'-PlanPath',request.plan_path,'-OutputPath',receipt],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],env});}
    catch(error){throw Error('Approved split failed its existing verifier: '+(error.stderr?.toString()||error.message));}
    const result=JSON.parse(fs.readFileSync(safe(root,receipt),'utf8'));
    if(result.status!=='passed'||result.batch_id!==run.batch_id||result.plan!==request.plan_path||result.checks.some(check=>!check.passed))throw Error('Approved split receipt is incomplete or failed');
    reports.push({plan_path:request.plan_path,receipt,source:plan.source.path,target:plan.target.path});
  }
  return {status:'passed',reports};
}
