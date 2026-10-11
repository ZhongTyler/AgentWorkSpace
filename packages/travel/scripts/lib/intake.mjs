import fs from 'node:fs';
import path from 'node:path';
import {inside,read,uid,hash,publicUrl} from './core.mjs';
import {importSource} from './research.mjs';

// Checks declarations and local bytes, never executes archived HTML or fetches its URLs.
export function captureAudit(capture, images) {
  if(!capture) return {status:'unknown',issues:['Original body/page coverage was not declared'],semanticAttestationOnly:true};
  const issues=[];
  if(!['manual','mcp','web'].includes(capture.method))throw Error('capture.method must be manual/mcp/web');
  if(!capture.by||!Number.isFinite(Date.parse(capture.at)))throw Error('capture needs by and valid at');
  if(!['complete','partial','unknown'].includes(capture.scope))throw Error('capture.scope must be complete/partial/unknown');
  const expected=capture.expectedImages;
  if(expected!=null&&(!Number.isInteger(expected)||expected<0))throw Error('expectedImages must be a non-negative integer or null');
  const positions=images.map(i=>i.position);
  if(positions.some(n=>n!=null&&(!Number.isInteger(n)||n<1)))throw Error('Image positions must be positive integers');
  if(new Set(positions.filter(n=>n!=null)).size!==positions.filter(n=>n!=null).length)throw Error('Duplicate original image position');
  if(capture.bodyExpanded!==true)issues.push('Full expanded body has not been attested');
  if(expected==null)issues.push('Original image/page count is unknown');
  else {
    if(images.length!==expected)issues.push(`Captured ${images.length} of ${expected} declared images/pages`);
    if(expected>0&&positions.some(n=>n==null))issues.push('Original image/page positions are missing');
    if(positions.some(n=>n>expected))throw Error('Image position exceeds declared original total');
    if(positions.some((n,i)=>n!=null&&n!==i+1))issues.push('Original image/page sequence has gaps or is out of order');
  }
  if(capture.scope==='complete'&&issues.length)throw Error('Cannot declare complete capture: '+issues.join('; '));
  return {status:capture.scope,issues,semanticAttestationOnly:true};
}

export function intake(project,file,options={}) {
  const full=path.resolve(file),input=read(full),root=path.dirname(full);
  uid(input.id);
  if(!input.capture)throw Error('Manual intake requires capture declaration (unknown is allowed)');
  if(typeof input.textFile!=='string'||!Array.isArray(input.images))throw Error('Intake needs textFile and ordered images');
  const text=fs.readFileSync(inside(root,input.textFile),'utf8');
  const source={id:input.id,title:input.title,url:publicUrl(input.url),text,images:input.images,
    author:input.author,publishedAt:input.publishedAt,topics:input.topics,capture:input.capture};
  if(input.archive)source.archive=input.archive;
  return importSource(project,source,root,options);
}

export function sourceAudit(project) {
  const rows=[],errors=[];
  for(const row of read(inside(project,'research/registry.json'))){
    if(!row.raw){rows.push({id:row.id,status:'not-extracted'});continue;}
    try {
      const raw=read(inside(project,row.raw));
      if(hash(raw)!==row.rawHash)throw Error('Raw manifest changed');
      for(const image of raw.images)if(hash(fs.readFileSync(inside(project,image.file)))!==image.hash)throw Error('Raw image changed: '+image.file);
      if(raw.archive&&hash(fs.readFileSync(inside(project,raw.archive.file)))!==raw.archive.hash)throw Error('Archive changed');
      const capture=captureAudit(raw.capture,raw.images);
      rows.push({id:row.id,...capture,images:raw.images.length,archive:raw.archive?.file||null});
    }catch(e){errors.push({id:row.id,error:e.message});}
  }
  return {valid:errors.length===0,errors,rows,counts:{complete:rows.filter(r=>r.status==='complete').length,
    partial:rows.filter(r=>r.status==='partial').length,unknown:rows.filter(r=>r.status==='unknown').length},
    limitation:'Completeness is attested by the named reader, not proven by image counts or an HTML archive.'};
}
