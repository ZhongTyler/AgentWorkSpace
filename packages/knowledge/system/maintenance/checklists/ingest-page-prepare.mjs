import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {safe} from './raw-quality.mjs';

// Page-mutating mechanical work belongs before review, never inside Seal.
export function preparePages(root,pages,{invoke=execFileSync,shell}={}){
  if(!pages.length)return {status:'unchanged',pages:[]};
  for(const p of pages){safe(root,p);if(!/^wiki\/[^/\\]+\.md$/.test(p))throw Error('Non-Wiki output requires the explicit structural contract: '+p);}
  shell??=process.platform==='win32'?path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'):'pwsh';
  invoke(shell,['-NoProfile','-File',safe(root,'system/maintenance/checklists/sync-wiki-source-ledgers.ps1'),'-Mode','Sync','-ProjectRoot',root,'-PathsCsv',pages.join('|')],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  return {status:'prepared',pages};
}
