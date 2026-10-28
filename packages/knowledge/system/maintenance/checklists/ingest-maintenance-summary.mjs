import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export function maintenanceSummary(receipt, checkId) {
  if(checkId) {
    const check=(receipt.checks??[]).find(x=>x.id===checkId);
    if(!check) throw Error('Unknown check: '+checkId);
    return check;
  }
  const severity={}; for(const f of receipt.health?.findings??[]) severity[f.severity]=(severity[f.severity]??0)+1;
  return {status:receipt.status,failed_checks:(receipt.checks??[]).filter(x=>!x.passed).map(x=>({id:x.id,details:x.details})),
    health:{status:receipt.health?.status,severity_counts:severity},
    evidence:{files:receipt.evidence_cost?.evidence_file_count,bytes:receipt.evidence_cost?.evidence_bytes},
    next_action:'Expand only a failed check with --check <id>; unchanged successful checks need no manual reread.'};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const args={}; for(let i=2;i<process.argv.length;i+=2) args[process.argv[i].slice(2)]=process.argv[i+1];
    console.log(JSON.stringify(maintenanceSummary(JSON.parse(fs.readFileSync(args.receipt,'utf8').replace(/^\uFEFF/,'')),args.check),null,2));
  } catch(e) {console.error(e.message);process.exitCode=2;}
}
