// Read-only transport around the already pinned anonymous reader/WBI signer.
import {readVideo, health} from './reader.mjs';
import {pathToFileURL, fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
let busy=false;
export async function request(...args){
  if(busy)throw Error('isolated_platform_worker_required');busy=true;
  try{return await requestImpl(...args);}finally{busy=false;}
}
async function requestImpl(action,{bvid,page=1,keyword='',limit=5}={},fetcher=globalThis.fetch){
  if(health().status!=='pass')throw Error('reader_integrity_failed');
  if(!['subtitles','storyboard','audio','search'].includes(action))throw Error('action_denied');
  if(action!=='search'&&(!/^BV[A-Za-z0-9]{10}$/.test(bvid||'')||!Number.isInteger(page)||page<1||page>1000))throw Error('invalid_video_identity');
  if(action==='search'&&(typeof keyword!=='string'||!keyword.trim()||keyword.length>120||!Number.isInteger(limit)||limit<1||limit>10))throw Error('invalid_public_search');
  let meta=null;
  const trace=[]; let stopped=null;
  if(action!=='search'){
    const r=await readVideo({bvid,page},{fetcher});
    if(r.status!=='metadata_read')return r;
    meta=r.metadata;trace.push(...r.access.requests);
  }
  const fail=reason=>{stopped=reason;throw Error(reason);};
  const guarded=async(url,init={})=>{
    if(stopped)fail(stopped);
    const u=new URL(url),h=new Headers(init.headers||{});
    if(u.protocol!=='https:'||u.hostname!=='api.bilibili.com'||u.port||u.username||u.password||h.has('cookie')||h.has('authorization')||(init.method||'GET')!=='GET')fail('request_denied');
    const allowed=['/x/web-interface/nav',...({subtitles:['/x/player/wbi/v2'],storyboard:['/x/player/videoshot'],audio:['/x/player/wbi/playurl'],search:['/x/web-interface/wbi/search/type']}[action])];
    if(!allowed.includes(u.pathname)||trace.length>=8)fail('endpoint_or_budget_denied');
    if(meta&&u.pathname!=='/x/web-interface/nav'&&(u.searchParams.get('bvid')!==bvid||Number(u.searchParams.get('cid'))!==meta.cid))fail('identity_changed');
    trace.push({host:u.hostname,path:u.pathname});
    let r;try{r=await fetcher(u,{...init,redirect:'manual',signal:AbortSignal.timeout(20000)});}catch{fail('network_unavailable_no_retry');}
    if(!r.ok)fail('upstream_http_'+r.status+'_no_retry');
    const declared=Number(r.headers.get('content-length')||0);if(declared>2000000)fail('response_too_large');
    const reader=r.body.getReader();let n=0;const chunks=[];
    try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>2000000)fail('response_too_large');chunks.push(value);}}finally{await reader.cancel();}
    return new Response(Buffer.concat(chunks),{status:200,headers:{'content-type':'application/json'}});
  };
  const old=globalThis.fetch;globalThis.fetch=guarded;
  try{
    const {getWBI,generateWBISign}=await import(pathToFileURL(path.join(root,'vendor/reader/dist/bilibili/wbi.js')).href);
    const endpoints={subtitles:'/x/player/wbi/v2',storyboard:'/x/player/videoshot',audio:'/x/player/wbi/playurl',search:'/x/web-interface/wbi/search/type'};
    let params=action==='search'?{keyword,search_type:'video',page:1,order:'pubdate'}:{bvid,cid:meta.cid};
    if(action==='storyboard')params.index=1;
    if(action==='audio')Object.assign(params,{fnval:16,qn:16,fourk:0});
    if(action!=='storyboard'){
      params.wts=Math.floor(Date.now()/1000);
      const encoded=Object.fromEntries(Object.entries(params).map(([k,v])=>[k,encodeURIComponent(String(v).replace(/[!'()*]/g,''))]));
      params.w_rid=generateWBISign(encoded,(await getWBI()).mixKey);
    }
    const r=await guarded('https://api.bilibili.com'+endpoints[action]+'?'+new URLSearchParams(params),{headers:{Referer:'https://www.bilibili.com/','User-Agent':'Mozilla/5.0'}});
    const raw=await r.json();if(raw.code!==0)return {status:'stopped',reason:raw.code===-101?'authentication_required':'platform_code_'+raw.code,metadata:meta,access:trace};
    if(action==='search')return {status:'search_read',keyword,items:(raw.data?.result||[]).slice(0,limit).map(x=>({bvid:x.bvid,title:String(x.title||'').replace(/<[^>]*>/g,''),author:x.author,pubdate:x.pubdate,source_kind:'discovery_metadata_not_full_content'})),access:trace};
    return {status:'platform_read',metadata:meta,data:raw.data,access:trace};
  }catch(e){return {status:'stopped',reason:stopped||(/^[a-zA-Z0-9_]+$/.test(e.message)?e.message:e.name),metadata:meta,access:trace};}
  finally{globalThis.fetch=old;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const raw=await new Promise(resolve=>{let b='';process.stdin.setEncoding('utf8');process.stdin.on('data',v=>{b+=v;if(b.length>4096)process.exit(2);});process.stdin.on('end',()=>resolve(b));});const p=JSON.parse(raw);console.log(JSON.stringify(await request(p.action,p)));}
  catch{console.log(JSON.stringify({status:'stopped',reason:'invalid_platform_request'}));process.exitCode=2;}
}
