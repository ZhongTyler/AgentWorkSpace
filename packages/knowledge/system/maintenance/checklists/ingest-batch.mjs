import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {safe,sha} from './raw-quality.mjs';
import {assembleRaw} from './assemble-raw.mjs';
import {compileBundle} from './compile-core-bundle.mjs';
import {completeCoreReview,verifyCoreReceipt} from './core-review-control.mjs';

const read=(root,p)=>JSON.parse(fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,''));
const rel=(root,p)=>path.relative(root,p).split(path.sep).join('/');
function recordAudit(root,run,receipt) {
  const shell=process.platform==='win32'?path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
  return execFileSync(shell,['-NoProfile','-File',safe(root,'system/maintenance/checklists/ingest-control.ps1'),'-Action','record-content-audit','-RunPath',run,'-AuditReceiptPath',receipt],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024});
}

export function reviewRow(root,runPath,row,register=recordAudit) {
  const run=read(root,runPath),bundle=read(root,row.bundle),raw=bundle.ledger?.raw?.path;
  const expectedLedger=rel(root,path.join(path.dirname(safe(root,runPath)),'review-bundles',sha(fs.readFileSync(safe(root,row.bundle))).slice(0,16),'ledger.json'));
  const attempt=run.execution_control?.core_review_attempts?.find(x=>x.raw_path===raw&&x.ledger_path===expectedLedger&&x.status==='passed'&&x.agent_id===row.agent);
  let receipt,reused=false,compiled,completed;
  if(attempt) {
    if(sha(fs.readFileSync(safe(root,attempt.receipt_path)))!==attempt.receipt_sha256)throw Error('Receipt hash drift');
    verifyCoreReceipt(root,{receipt:attempt.receipt_path});
    receipt=attempt.receipt_path;reused=true;
  } else {
    compiled=compileBundle(root,{run:runPath,...row});
    if(compiled.status!=='passed')throw Error('Compile preflight failed: '+JSON.stringify(compiled));
    completed=completeCoreReview(root,{run:runPath,raw,agent:row.agent,log:row.log});
    if(completed.status!=='passed')throw Error('Review failed: '+JSON.stringify(completed));
    receipt=completed.receipt_path;
  }
  const current=read(root,runPath),receiptHash=sha(fs.readFileSync(safe(root,receipt)));
  const registered=current.content_audits?.some(x=>x.raw_path===raw&&x.path===receipt&&x.sha256===receiptHash);
  const registration=registered?'already_registered':register(root,runPath,receipt);
  return {status:reused?'reused':'passed',raw,receipt,compiled,completed,registration};
}

export function executeRows(rows,execute) {
  return rows.map((row,index)=>{
    const started_at=new Date().toISOString();
    try {const result=execute(row);return {index,started_at,ended_at:new Date().toISOString(),...result};}
    catch(error){return {index,started_at,ended_at:new Date().toISOString(),status:'failed',error:error.stack??String(error),stdout:error.stdout?.toString(),stderr:error.stderr?.toString()};}
  });
}

export function runBatch(root,{run:runPath,plan:planPath,outputMode='summary'}) {
  root=fs.realpathSync(root);
  const run=read(root,runPath),directory=path.dirname(safe(root,runPath)),planFile=safe(root,planPath),plan=read(root,planPath);
  if(!['running_scoring','scoring_approved'].includes(run.status))throw Error('Batch requires open Stage1');
  if(!planFile.startsWith(directory+path.sep))throw Error('Plan must be run-local');
  if(!['assemble','review'].includes(plan.phase)||!Array.isArray(plan.rows)||!plan.rows.length)throw Error('Expected assemble/review phase and nonempty rows');
  const keys=plan.phase==='assemble'?['source','header','body','output']:['bundle','agent'];
  for(const row of plan.rows) {
    if(!row||Object.keys(row).some(k=>!keys.includes(k))||keys.some(k=>typeof row[k]!=='string'||!row[k]))throw Error('Invalid batch row');
    if(plan.phase==='assemble') {
      if(!run.items?.includes(row.source)||!/^raw-sources\/[^/\\]+\.md$/.test(row.output))throw Error('Assembly source/output outside batch scope');
      for(const key of ['header','body'])if(!safe(root,row[key]).startsWith(directory+path.sep))throw Error('Writer inputs must be run-local');
    } else if(!safe(root,row.bundle).startsWith(directory+path.sep))throw Error('Bundle must be run-local');
  }
  const identities=plan.rows.map(row=>plan.phase==='assemble'?row.output:row.bundle);
  if(new Set(identities).size!==identities.length)throw Error('Duplicate batch outputs/bundles');
  const started_at=new Date().toISOString();
  const results=executeRows(plan.rows,row=>plan.phase==='assemble'?assembleRaw(root,{...row,reuse:true}):reviewRow(root,runPath,row));
  const report={phase:plan.phase,started_at,ended_at:new Date().toISOString(),results};
  const logs=path.join(directory,'batch-logs');safe(root,logs,false);fs.mkdirSync(logs,{recursive:true});
  const reportPath=path.join(logs,`${plan.phase}-${Date.now()}-${randomUUID()}.json`);
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  const failed=results.filter(x=>x.status==='failed');
  const summary={status:failed.length?'failed':'passed',phase:plan.phase,total:results.length,reused:results.filter(x=>x.status==='reused').length,failed:failed.map(x=>({index:x.index,item:identities[x.index],error:x.error.split('\n')[0]})),report:rel(root,reportPath),next_action:failed.length?'Repair listed rows and rerun this plan; unchanged results are verified and reused.':plan.phase==='assemble'?'Send complete sources and Raw files to the independent reviewer.':'Reuse registered passed ledgers for Stage2; stage gates remain required.'};
  return outputMode==='full'?{...summary,detail:report}:summary;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].slice(2)]=process.argv[i+1];const result=runBatch(args.root,args);console.log(JSON.stringify(result,null,2));if(result.status==='failed')process.exitCode=2;}
  catch(error){console.error(error.message);process.exitCode=2;}
}
