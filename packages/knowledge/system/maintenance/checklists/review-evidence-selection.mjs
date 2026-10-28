import fs from 'node:fs';
import {safe,sha} from './raw-quality.mjs';

// One-based, inclusive full-file lines. Version binding is mandatory; a
// selection locates evidence, it never supplies a semantic judgment.
export function selectEvidence(root,file,selection,expectedHash){
  const bytes=fs.readFileSync(safe(root,file));
  if(!expectedHash||sha(bytes)!==expectedHash)throw Error('Evidence selection input drift: '+file);
  const lines=bytes.toString('utf8').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');
  const {start_line:a,end_line:b}=selection??{};
  if(!Number.isInteger(a)||!Number.isInteger(b)||a<1||b<a||b>lines.length)throw Error('Invalid evidence selection lines: '+file);
  const quote=lines.slice(a-1,b).join('\n');
  if(!quote.trim())throw Error('Empty evidence selection: '+file);
  return {quote,ranges:[[a,b]]};
}

export function applySelection(root,object,side,file,expectedHash){
  if(!object[side+'_selection'])return;
  const evidence=selectEvidence(root,file,object[side+'_selection'],expectedHash);
  if(object[side+'_quote']&&object[side+'_quote']!==evidence.quote)throw Error('Quote conflicts with selected evidence: '+file);
  object[side+'_quote']=evidence.quote;
  object[side+'_ranges']=evidence.ranges;
}
