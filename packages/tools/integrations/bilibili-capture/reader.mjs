import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url)),runtime=path.join(root,'vendor/reader');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function health(){
  const p=path.join(root,'reader-lock.json');if(!fs.existsSync(p))return {status:'not_prepared',network:false,credentials:false};
  const lock=JSON.parse(fs.readFileSync(p,'utf8')),changed=[];
  for(const [name,hash]of Object.entries(lock.runtime_files)){
    const f=path.resolve(runtime,name);if(!f.startsWith(runtime+path.sep)||!fs.existsSync(f)||sha(fs.readFileSync(f))!==hash)changed.push(name);
  }
  return {status:changed.length?'changed':'pass',files:Object.keys(lock.runtime_files).length,changed,network:false,credentials:false,scope:lock.scope};
}
export function makeGuard(fetcher,{bvid,maxRequests=8}={}){
  let stopped=null,count=0,selectedCid=null;const requests=[];
  const fail=code=>{stopped=stopped||code;const e=Error(stopped);e.name='ReaderStopped';throw e;};
  const fetch=async(url,init={})=>{
    if(stopped)fail(stopped);
    const u=new URL(url),headers=new Headers(init.headers||{});
    if(u.protocol!=='https:'||u.username||u.password||u.port)fail('request_url_denied');
    if(headers.has('Cookie')||headers.has('Authorization'))fail('anonymous_reader_cannot_send_credentials');
    const api=u.hostname==='api.bilibili.com'&&['/x/web-interface/nav','/x/web-interface/wbi/view','/x/player/wbi/v2'].includes(u.pathname);
    const subtitle=['aisubtitle.hdslb.com','subtitle.bilibili.com'].includes(u.hostname)&&u.pathname.endsWith('.json');
    if(!api&&!subtitle)fail('endpoint_outside_selected_read_scope');
    if(api&&u.pathname!=='/x/web-interface/nav'&&u.searchParams.get('bvid')!==bvid)fail('video_request_identity_changed');
    if(api&&u.pathname==='/x/player/wbi/v2'&&Number(u.searchParams.get('cid'))!==selectedCid)fail('part_request_identity_changed');
    if(count>=maxRequests)fail('request_budget_exhausted');
    count++;requests.push({host:u.hostname,path:u.pathname});
    let response;
    try{response=await fetcher(url,{...init,redirect:'manual'});}catch{fail('network_unavailable_no_retry');}
    if([401,403,412,429].includes(response.status))fail('access_or_rate_boundary_http_'+response.status);
    if(response.status>=300&&response.status<400)fail('redirect_not_followed');
    if(!response.ok)fail('upstream_http_'+response.status+'_no_retry');
    return response;
  };
  return {fetch,selectPart:cid=>{if(!Number.isSafeInteger(cid)||cid<=0)fail('invalid_part_identity');selectedCid=cid;},state:()=>({requests,count,stopped})};
}
export async function loadOriginalReader(){
  if(health().status!=='pass')throw Error('restore_pinned_reader_first');
  return import(pathToFileURL(path.join(runtime,'dist/bilibili/video-api.js')).href);
}
let reading=false;
export async function readVideo({bvid,page=1,transcript=false},{fetcher=globalThis.fetch}={}){
  if(!/^BV[A-Za-z0-9]{10}$/.test(bvid||'')||!Number.isInteger(page)||page<1||page>1000||typeof transcript!=='boolean')throw Error('invalid_video_request');
  if(reading)throw Error('reader_requires_isolated_serial_worker');reading=true;
  const guard=makeGuard(fetcher,{bvid}),originalFetch=globalThis.fetch;globalThis.fetch=guard.fetch;
  try{
    const api=await loadOriginalReader(),meta=await api.getVideoInfo(bvid);
    if(meta.bvid!==bvid)throw Error('returned_video_identity_mismatch');
    const part=meta.pages?.find(p=>p.page===page);
    if(!part)throw Error('requested_part_not_in_metadata');
    guard.selectPart(part.cid);
    const base={bvid,page,cid:part.cid,title:meta.title,author:meta.owner.name,part:part.part,duration:part.duration,
      url:'https://www.bilibili.com/video/'+bvid+'/?p='+page,source_kind:'platform_metadata_not_video_content'};
    if(!transcript)return {status:'metadata_read',metadata:base,access:guard.state(),frames_read:false,persisted:false};
    const subtitles=await api.getVideoSubtitle(bvid,part.cid),tracks=subtitles.subtitle.subtitles;
    const eligible=tracks.filter(t=>/^(zh|ai-zh)/.test(t.lan)),track=eligible.find(t=>!t.lan.startsWith('ai-'))||eligible[0];
    if(!track)return {status:'subtitle_unavailable',metadata:base,available_languages:tracks.map(t=>t.lan),access:guard.state(),description_fallback:false,frames_read:false,persisted:false};
    const body=(await api.getSubtitleContent(track.subtitle_url)).body;
    const ai=track.lan.startsWith('ai-');
    if(ai){
      const second=(await api.getSubtitleContent(track.subtitle_url)).body;
      const {assessAiSubtitleIntegrity}=await import(pathToFileURL(path.join(runtime,'dist/bilibili/subtitle-integrity.js')).href);
      if(!assessAiSubtitleIntegrity(body,second,track.lan,part.duration).usable)throw Error('platform_ai_subtitle_integrity_failed');
    }
    return {status:'subtitle_read_requires_visual_review',metadata:base,
      subtitle_kind:ai?'platform_ai':'platform_track_origin_not_independently_verified',language:track.lan,
      segments:body,body_sha256:sha(Buffer.from(JSON.stringify(body))),access:guard.state(),frames_read:false,persisted:false,
      limits:['Request BVID, Part and CID bound to returned metadata; semantic subtitle ownership still needs visual review.','Description, comments and summaries were not substituted for the transcript.','No credentials, login, browser cookie export, ASR or automatic knowledge writes.']};
  }catch(e){return {status:'stopped',reason:guard.state().stopped||(e.code==='COOKIE_EXPIRED'?'authentication_required':e.code==='ACCESS_DENIED'?'access_denied':e.originalError?.code===-352?'platform_risk_control':/^[a-z0-9_]+$/i.test(e.message)?e.message:e.name),
    ...(Number.isInteger(e.originalError?.code)?{upstream_code:e.originalError.code}:{}),access:guard.state(),credentials:false,frames_read:false,persisted:false};}
  finally{globalThis.fetch=originalFetch;reading=false;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [command,bvid,page]=process.argv.slice(2);
    if(command==='health'&&bvid===undefined){const h=health();console.log(JSON.stringify(h));if(h.status!=='pass')process.exitCode=2;}
    else if(['metadata','transcript'].includes(command)&&bvid&&process.argv.length<=5){const r=await readVideo({bvid,page:page===undefined?1:Number(page),transcript:command==='transcript'});console.log(JSON.stringify(r,null,2));if(r.status==='stopped')process.exitCode=2;}
    else throw Error('usage_health_or_metadata_or_transcript_bvid_optional_page');
  }catch(e){console.error(JSON.stringify({status:'rejected',reason:e.message}));process.exitCode=2;}
}
