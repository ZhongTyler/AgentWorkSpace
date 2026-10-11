import fs from 'node:fs';
import path from 'node:path';
import { inside, uid, read, write, hash, now, publicUrl, safeUrl, esc, loadTrip } from './core.mjs';
import {captureAudit} from './intake.mjs';

const registry = project => read(inside(project,'research/registry.json'));
export function register(project, candidates) {
  const rows=registry(project);
  for(const input of candidates) {
    const id=uid(input.id), url=publicUrl(input.url);
    const old=rows.find(x=>x.id===id);
    const clean={id,url,title:String(input.title||id),author:String(input.author||''),query:String(input.query||''),capturedAt:now(),topics:input.topics||[]};
    if(old) Object.assign(old,clean); else rows.push({...clean,screen:'candidate'});
  }
  write(inside(project,'research/registry.json'),rows);
  return {registered:candidates.length,total:rows.length};
}
export function screen(project, id, decision, reason) {
  if(!['candidate','excluded'].includes(decision)||!reason)throw Error('screen needs candidate/excluded and reason');
  const rows=registry(project), item=rows.find(x=>x.id===uid(id));
  if(!item)throw Error('Candidate not registered');
  Object.assign(item,{screen:decision,reason});
  write(inside(project,'research/registry.json'),rows);
}
export function importSource(project, source, inputRoot, {refresh=false}={}) {
  uid(source.id);
  const rows=registry(project), existing=rows.find(x=>x.id===source.id);
  if(existing?.raw && !refresh)throw Error('Source exists; use explicit --refresh to preserve a new immutable revision');
  if(!source.title||!safeUrl(publicUrl(source.url))||typeof source.text!=='string'||!Array.isArray(source.images))throw Error('Source needs id/title/url/text/images');
  if(!source.text.trim()&&!source.images.length)throw Error('Empty source');
  const payload=source.images.map(image=>{
    const full=inside(inputRoot,image.file);
    const bytes=fs.readFileSync(full);
    const mime=sniff(bytes);
    if(!mime)throw Error('Unsupported or invalid raster image '+image.file);
    return {bytes,mime,hash:hash(bytes),...(image.position!=null?{position:image.position}:{})};
  });
  if(new Set(payload.map(x=>x.hash)).size!==payload.length)throw Error('Duplicate images in manifest; review source before import');
  const coverage=captureAudit(source.capture,payload);
  let archive=null;
  if(source.archive){
    const full=inside(inputRoot,source.archive.file),ext=path.extname(full).toLowerCase();
    if(!['.html','.htm','.pdf'].includes(ext))throw Error('Archive must be HTML or PDF');
    const bytes=fs.readFileSync(full);
    if(!bytes.length)throw Error('Empty archive');
    if(ext==='.pdf'&&bytes.toString('ascii',0,5)!=='%PDF-')throw Error('Invalid PDF archive');
    archive={bytes,ext,hash:hash(bytes)};
  }
  const version=now().replace(/[:.]/g,'-')+'-'+hash(JSON.stringify(source)+payload.map(x=>x.hash).join()+(archive?.hash||'')).slice(0,8);
  const dir='research/raw/'+source.id+'/'+version;
  const raw={id:source.id,title:source.title,author:String(source.author||''),url:publicUrl(source.url),capturedAt:now(),
    text:source.text,publishedAt:source.publishedAt||null,images:payload.map((p,i)=>({file:dir+'/'+String(i+1).padStart(3,'0')+'.'+p.mime.split('/')[1],hash:p.hash,mime:p.mime,...(p.position!=null?{position:p.position}:{})})),
    ...(source.capture?{capture:source.capture}:{}),...(archive?{archive:{file:'private/source-archives/'+source.id+'/'+version+archive.ext,hash:archive.hash}}:{})};
  // The manifest is installed only after all images have been read and verified.
  for(let i=0;i<payload.length;i++)write(inside(project,raw.images[i].file),payload[i].bytes,{exclusive:true});
  if(archive)write(inside(project,raw.archive.file),archive.bytes,{exclusive:true});
  write(inside(project,dir+'/source.json'),raw,{exclusive:true});
  write(inside(project,dir+'/source.md'),'# '+raw.title+'\n\n'+raw.url+'\n\n'+raw.text+'\n\n'+raw.images.map((img,i)=>'![图'+(i+1)+']('+path.basename(img.file)+')').join('\n\n'),{exclusive:true});
  if(!existing)rows.push({id:raw.id,title:raw.title,url:raw.url,author:raw.author,screen:'candidate',topics:source.topics||[]});
  const row=rows.find(x=>x.id===raw.id);
  Object.assign(row,{raw:dir+'/source.json',rawHash:hash(raw),imageCount:raw.images.length,review:null});
  write(inside(project,'research/registry.json'),rows);
  return {id:raw.id,raw:row.raw,images:payload.length,capture:coverage};
}
export function sniff(bytes) {
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
  if(bytes.toString('ascii',0,3)==='GIF')return 'image/gif';
  return null;
}
export function digest(project, review) {
  uid(review.id);
  const rows=registry(project), row=rows.find(x=>x.id===review.id);
  if(!row?.raw)throw Error('No extracted raw source');
  const raw=read(inside(project,row.raw));
  if(review.rawHash!==hash(raw)||review.rawHash!==row.rawHash)throw Error('Digest must bind current rawHash');
  for(const i of raw.images)if(hash(fs.readFileSync(inside(project,i.file)))!==i.hash)throw Error('Raw image changed; restore original before digestion');
  if(raw.archive&&hash(fs.readFileSync(inside(project,raw.archive.file)))!==raw.archive.hash)throw Error('Archive changed; restore original before digestion');
  if(!review.reviewer||!review.reviewedAt||!['complete','partial','not-used'].includes(review.status))throw Error('Reviewer/time/status required');
  if(!Array.isArray(review.images)||!Array.isArray(review.outcomes))throw Error('Review images/outcomes required');
  if(review.status==='complete'&&raw.capture&&captureAudit(raw.capture,raw.images).status!=='complete')throw Error('Partial/unknown capture cannot count as complete digestion; use partial until original coverage is checked');
  const hashes=review.images.map(x=>x.hash);
  if(new Set(hashes).size!==hashes.length||hashes.some(h=>!raw.images.some(x=>x.hash===h)))throw Error('Review image manifest mismatch');
  if(review.status!=='partial'){
    if(review.bodyRead!==true || raw.images.some(i=>!review.images.some(r=>r.hash===i.hash&&r.read===true)))throw Error('Complete review requires body and every image declaration');
    if(!review.outcomes.length)throw Error('Declare adopted destinations or non-adoption reasons');
  }
  for(const outcome of review.outcomes){
    if(review.status==='not-used'&&outcome.file)throw Error('Not-used review cannot declare adoption');
    if(!outcome.topic||!outcome.reason)throw Error('Outcome needs topic and reason');
    if(outcome.file) {
      const target=inside(project,outcome.file);
      if(!outcome.file.startsWith('knowledge/')||!fs.existsSync(target))throw Error('Outcome must reference existing knowledge document');
      const text=fs.readFileSync(target,'utf8');
      if(!text.includes(raw.url))throw Error('Wiki must retain public source link');
      outcome.hash=hash(text);
    } else if(outcome.decision!=='not-used')throw Error('Adopted outcome needs Wiki file');
  }
  const location='research/reviews/'+review.id+'-'+now().replace(/[:.]/g,'-')+'.json';
  write(inside(project,location),review,{exclusive:true});
  row.review=location;
  write(inside(project,'research/registry.json'),rows);
  return {id:row.id,status:review.status,semanticAttestationOnly:true};
}
export function researchStatus(project) {
  const rows=registry(project), counts={candidates:rows.length,extracted:0,complete:0,partial:0,notUsed:0,excluded:0},captureCounts={complete:0,partial:0,unknown:0};
  const duplicateBodies=new Map(), similarTitles=new Map(), warnings=[];
  for(const row of rows){
    if(row.screen==='excluded')counts.excluded++;
    if(row.raw){
      counts.extracted++;
      const raw=read(inside(project,row.raw)), signature=raw.text.trim()?hash(raw.text.trim()):null;
      const capture=captureAudit(raw.capture,raw.images);captureCounts[capture.status]++;
      if(signature&&duplicateBodies.has(signature))warnings.push({kind:'same-body',ids:[row.id,duplicateBodies.get(signature)]});
      if(signature)duplicateBodies.set(signature,row.id);
    }
    const title=row.title.replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
    if(title&&similarTitles.has(title))warnings.push({kind:'same-normalized-title',ids:[row.id,similarTitles.get(title)]});
    if(title)similarTitles.set(title,row.id);
    if(row.review){
      const r=read(inside(project,row.review));
      if(r.rawHash!==row.rawHash)warnings.push({kind:'stale-review',id:row.id});
      else if(r.status==='complete')counts.complete++;
      else if(r.status==='partial')counts.partial++;
      else if(r.status==='not-used')counts.notUsed++;
    }
  }
  const coverage=(loadTrip(project).researchCoverage||[]).map(c=>{
    const selected=[...new Set(c.noteIds||[])].map(id=>rows.find(n=>n.id===id)).filter(Boolean);
    const complete=selected.filter(n=>n.review&&read(inside(project,n.review)).status==='complete'&&read(inside(project,n.review)).rawHash===n.rawHash).length;
    return {...c,registered:selected.length,complete,officialCount:new Set(c.officialUrls||[]).size,sufficiency:'requires-semantic-review'};
  });
  return {counts,captureCounts,warnings,coverage,rows};
}
export function rawGallery(project,id) {
  const row=registry(project).find(x=>x.id===uid(id));
  if(!row?.raw)throw Error('No raw source');
  const source=read(inside(project,row.raw));
  const html='<!doctype html><meta charset="utf-8"><title>'+esc(source.title)+'</title><style>body{max-width:1000px;margin:2rem auto;font:18px/1.7 system-ui}img{max-width:100%}pre{white-space:pre-wrap}</style><h1>'+esc(source.title)+'</h1><pre>'+esc(source.text)+'</pre>'+source.images.map((i,n)=>'<figure><figcaption>图'+(n+1)+' · '+i.hash+'</figcaption><img src="data:'+i.mime+';base64,'+fs.readFileSync(inside(project,i.file)).toString('base64')+'"></figure>').join('');
  const output=inside(project,'.runtime/raw-'+id+'.html'); write(output,html);
  return {file:output,images:source.images.length};
}
