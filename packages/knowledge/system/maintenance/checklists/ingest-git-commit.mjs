import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Reuse the workspace's message validator when installed; standalone packages
// retain the declared trailer format and explicitly report the unavailable check.
function findChecker(root){
  let checker=null;
  for(let at=root;;at=path.dirname(at)){
    const candidate=path.join(at,'WorkspaceOrchestration/scripts/execution-check.ps1');
    if(fs.existsSync(candidate)){checker=candidate;break;}
    if(at===path.dirname(at))break;
  }
  return checker;
}
function runCheck(checker,action,file,exec,shell){
  const quote=s=>"'"+s.replaceAll("'","''")+"'";
  return exec(shell,['-NoProfile','-Command',`& ${quote(checker)} -Arguments @(${quote(action)},${quote(action==='message'?'--file':'--input')},${quote(file)}); exit $LASTEXITCODE`]);
}
export function commitMessage(root,subject,exec,shell){
  const checker=findChecker(root);
  if(/[\r\n]/.test(subject))throw Error('Commit subject must be one line');
  const message=subject+'\n\nClosure-Level: W2\nClosure-Domain: knowledge\nClosure-Signals: durable_state_transition\nClosure-Corrected: no\n';
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-message-'));
  try{
    const file=path.join(temporary,'message.txt');fs.writeFileSync(file,message);
    if(checker)runCheck(checker,'message',file,exec,shell);
    exec('git',['-C',root,'commit','-F',file]);
    const actual=exec('git',['-C',root,'show','-s','--format=%B','HEAD']);
    if(actual.trim()!==message.trim())throw Error('Committed message differs from validated input');
    return {machine_message_check:checker?'passed':'unavailable_standalone',head:exec('git',['-C',root,'rev-parse','HEAD'])};
  }finally{
    if(path.dirname(temporary)!==os.tmpdir()||!path.basename(temporary).startsWith('ingest-message-'))throw Error('Unsafe temporary message directory');
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}

export function verifyWorkspaceClosure(root,chain,exec,shell){
  const checker=findChecker(root);
  if(!checker)return {status:'unavailable_standalone',scope:'Direct committed gitlink edges are still verified by the controller; workspace validator is not installed.'};
  const repositories={},edges=[];
  chain.forEach((item,i)=>{
    const git=(...args)=>exec('git',['-C',item.path,...args]);
    const result=git('rev-parse','HEAD'),base=git('rev-parse','HEAD^');
    repositories['repo'+i]={path:item.path,base,result,parent:i+1<chain.length?'repo'+(i+1):null,gitlink_path:item.gitlink_path??null,scope:item.scope};
    if(i+1<chain.length)edges.push({parent:'repo'+(i+1),child:'repo'+i,path:item.gitlink_path});
  });
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'ingest-closure-'));
  try{
    const file=path.join(temporary,'closure.json');fs.writeFileSync(file,JSON.stringify({repositories,edges}));
    const report=JSON.parse(runCheck(checker,'closure',file,exec,shell));
    if(report.result?.closed!==true)throw Error('Workspace closure verification failed: '+JSON.stringify(report));
    return {status:'passed',report};
  }finally{
    if(path.dirname(temporary)!==os.tmpdir()||!path.basename(temporary).startsWith('ingest-closure-'))throw Error('Unsafe temporary closure directory');
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
