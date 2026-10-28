import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {safe} from './raw-quality.mjs';
import {syncRegistration} from './ingest-stage3-registration.mjs';
import {bindSectionQuotes} from './wiki-consumption.mjs';
import {pipeline} from './ingest-pipeline.mjs';
import {consolidated,ownedPaths,writeJson,inputIdentity} from './ingest-execution-state.mjs';
import {syncNavigation} from './ingest-navigation.mjs';

export function stagePaths(root,runPath,semantic){
  const run=JSON.parse(fs.readFileSync(safe(root,runPath),'utf8').replace(/^\uFEFF/,''));
  if(consolidated(run))return [...new Set([...ownedPaths(root,runPath,semantic),...(run.execution_control.advance?.navigation_outputs??[]),'NOW.md','system/maintenance/CHANGELOG.md','system/registry/KNOWLEDGE_STATUS.md','system/registry/raw-list.md','system/registry/index.md','system/registry/ingest-auto-review-state.json'])].filter(p=>fs.existsSync(safe(root,p,false))).sort();
  const directory=path.dirname(safe(root,runPath));
  const rel=p=>path.relative(root,p).split(path.sep).join('/');
  const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(safe(root,path.join(p,e.name),false)):[rel(safe(root,path.join(p,e.name)))]);
  return [...new Set(['NOW.md','system/maintenance/CHANGELOG.md','system/registry/KNOWLEDGE_STATUS.md','system/registry/raw-list.md','system/registry/index.md','system/registry/ingest-auto-review-state.json',...semantic.rows.map(r=>r.artifact),...walk(directory)])].filter(p=>fs.existsSync(safe(root,p,false))).sort();
}
export function prepareStage3(root,args,{invoke=execFileSync}={}){
  root=fs.realpathSync(root);const read=p=>JSON.parse(fs.readFileSync(safe(root,p),'utf8').replace(/^\uFEFF/,''));
  const run=read(args.run);
  if(args.mode==='inspect')return {status:'prepared',semantic_path:args.semantic,stage_paths:stagePaths(root,args.run,read(args.semantic))};
  if(run.status!=='stage2_planned'||(!consolidated(run)&&run.execution_control?.page_review_contract_version!==3))throw Error('Automatic preparation requires an open consolidated or page-review-v3 run');
  if(consolidated(run)&&read(run.package_data.path).sections.stage3.status==='sealed')throw Error('Sealed Stage3 is read-only; resume checkpoint/review or explicitly reopen');
  const directory=path.dirname(safe(root,args.run));
  const semanticFile=safe(root,args.semantic);if(!semanticFile.startsWith(directory+path.sep))throw Error('Semantic must be run-local');
  const semantic=read(args.semantic),pages=[...new Set(semantic.rows.map(r=>r.artifact))];
  if((!consolidated(run)&&!pages.length)||pages.some(p=>!/^wiki\/[^/\\]+\.md$/.test(p)))throw Error('Automatic preparation covers Wiki delivery only; structural outputs require their explicit contract');
  if(consolidated(run)){
    const navigation=syncNavigation(root,pages);
    if(navigation.changed.length){
      const latest=read(args.run);latest.execution_control.advance??={};
      latest.execution_control.advance.navigation_outputs=[...new Set([...(latest.execution_control.advance.navigation_outputs??[]),...navigation.changed])].sort();
      writeJson(root,args.run,latest);
    }
  }
  const registrationFile=args.registration?safe(root,args.registration):path.join(directory,'registration.json');
  if(!registrationFile.startsWith(directory+path.sep))throw Error('Registration must be run-local');
  const cachePaths=[args.semantic,registrationFile,'system/registry/raw-list.md','system/registry/index.md','system/registry/KNOWLEDGE_STATUS.md','NOW.md','system/maintenance/CHANGELOG.md',...fs.readdirSync(path.join(root,'wiki')).filter(p=>p.endsWith('.md')).map(p=>'wiki/'+p),...semantic.consumption.map(r=>r.raw),...['ingest-stage3-registration.mjs','sync-wiki-source-ledgers.ps1','sync-capacity-risks.ps1'].map(p=>'system/maintenance/checklists/'+p)];
  const cached=consolidated(run)&&run.execution_control.advance?.prepare_cache===inputIdentity(root,cachePaths);
  const registration=cached?{status:'synchronized',reused:true}:syncRegistration(root,run,semantic,fs.existsSync(registrationFile)?read(registrationFile):undefined);
  if(registration.status!=='synchronized')return registration;
  const checks=path.join(root,'system/maintenance/checklists');
  // Paths are returned from the real producers, never guessed by the caller.
  if(!consolidated(run)&&pages.length)invoke(args.shell,['-NoProfile','-File',path.join(checks,'sync-wiki-source-ledgers.ps1'),'-Mode','Sync','-ProjectRoot',root,'-PathsCsv',pages.join('|')],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  if(!cached){
    if(consolidated(run)&&pages.length)invoke(args.shell,['-NoProfile','-File',path.join(checks,'sync-wiki-source-ledgers.ps1'),'-Mode','Sync','-ProjectRoot',root,'-PathsCsv',pages.join('|'),'-RegistryOnly'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
    invoke(args.shell,['-NoProfile','-File',path.join(checks,'sync-capacity-risks.ps1'),'-Mode','Sync'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  }
  const prepared=bindSectionQuotes(root,semantic);
  // No disposition or judgment is inferred. planned must be resolved by the
  // controller; downstream consumption preparation explains remaining claims.
  if(JSON.stringify(prepared.consumption)!==JSON.stringify(semantic.consumption))delete prepared.consumption_review;
  const output=path.join(directory,'stage3-prepared.json'),bytes=JSON.stringify(prepared,null,2)+'\n';
  if(!fs.existsSync(output)||fs.readFileSync(output,'utf8')!==bytes)fs.writeFileSync(output,bytes);
  const semanticPath=path.relative(root,output).split(path.sep).join('/');
  if(consolidated(run)){
    const latest=read(args.run);latest.execution_control.advance??={};
    latest.execution_control.advance.prepared_semantic=semanticPath;
    latest.execution_control.advance.prepare_cache=inputIdentity(root,cachePaths);
    writeJson(root,args.run,latest);
  }
  const reviews=pipeline(root,'refresh-page-reviews',{run:args.run,semantic:semanticPath});
  return {status:'prepared',semantic_path:semanticPath,registration,review_status:reviews.status,reused_reports:reviews.reused_reports,pending_reports:reviews.pending_reports,stage_paths:stagePaths(root,args.run,prepared),next_action:'Complete only pending page reviews, resolve planned dispositions and prepare/bind the aggregate once using reused report paths. Then Seal with this semantic path; Seal stages this exact scope after successful preparation.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const a={};for(let i=2;i<process.argv.length;i+=2)a[process.argv[i].slice(2)]=process.argv[i+1];
    const result=prepareStage3(a.root,a);console.log(JSON.stringify(result));if(result.status!=='prepared')process.exitCode=2;
  }catch(e){console.error(e.stderr?.toString()||e.message);process.exitCode=2;}
}
