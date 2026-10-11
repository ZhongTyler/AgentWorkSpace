import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT, inside, write, read, hash, now, uid, publicUrl } from './core.mjs';
import { register, importSource, sniff } from './research.mjs';
import {assertResearchEnabled} from './operations.mjs';

export const runtimeDefault=path.join(ROOT,'.runtime/xhs');
const allowedTools=new Set(['check_login_status','get_login_qrcode','search_feeds','get_feed_detail']);
export async function boundedBytes(response,limit){
  if(Number(response.headers.get('content-length'))>limit)throw Error('Response exceeds size limit');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Response exceeds size limit');chunks.push(Buffer.from(value));}}
  finally{await reader.cancel();}
  return Buffer.concat(chunks);
}
function localEndpoint(endpoint){
  const u=new URL(endpoint);
  if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password)throw Error('MCP endpoint must be local HTTP loopback');
  return u.href;
}
export class MCP {
  constructor(endpoint,token='',fetcher=fetch){this.endpoint=localEndpoint(endpoint);this.token=token;this.fetcher=fetcher;this.counter=0;this.session=null;this.version='2025-06-18';}
  async request(method,params,notification=false){
    const id=notification?undefined:++this.counter;
    const headers={'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':this.version};
    if(this.token)headers.Authorization='Bearer '+this.token;
    if(this.session)headers['Mcp-Session-Id']=this.session;
    const response=await this.fetcher(this.endpoint,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(90000),body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params})});
    if(!response.ok)throw Error('MCP '+method+' HTTP '+response.status);
    const session=response.headers.get('mcp-session-id');if(session)this.session=session;
    if(notification||response.status===202)return null;
    let message;
    if((response.headers.get('content-type')||'').includes('text/event-stream')){
      const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
      try{while(true){
        const {value,done}=await reader.read();if(done)break;
        buffer+=decoder.decode(value,{stream:true});
        if(buffer.length>16*1024*1024)throw Error('MCP response too large');
        let index;
        while((index=buffer.search(/\r?\n\r?\n/))>=0){
          const event=buffer.slice(0,index);buffer=buffer.slice(index).replace(/^\r?\n\r?\n/,'');
          const data=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
          if(!data)continue;
          const parsed=JSON.parse(data);
          if(parsed.id===id){message=parsed;break;}
        }
        if(message)break;
      }}finally{await reader.cancel();}
    }else message=await response.json();
    if(!message||message.id!==id||message.error)throw Error('MCP protocol error or unmatched response');
    return message.result;
  }
  async initialize(){
    const info=await this.request('initialize',{protocolVersion:this.version,capabilities:{},clientInfo:{name:'portable-travel-workflow',version:'0.2.0'}});
    if(info.protocolVersion)this.version=info.protocolVersion;
    await this.request('notifications/initialized',{},true);
    return info;
  }
  async tools(){return (await this.request('tools/list',{})).tools||[];}
  async call(name,args={}){
    if(!allowedTools.has(name))throw Error('Travel MCP denies non-allowlisted tools');
    const result=await this.request('tools/call',{name,arguments:args});
    if(result.isError)throw Error('MCP tool failed: '+name+' (inspect private service log; response not echoed)');
    return result;
  }
}
export function unwrap(result){
  if(result.structuredContent)return result.structuredContent;
  const text=(result.content||[]).filter(c=>c.type==='text').map(c=>c.text).join('\n');
  try{return JSON.parse(text);}catch{return {text};}
}
export async function connect(runtime=runtimeDefault,endpoint){
  assertResearchEnabled(null,runtime);
  const file=path.join(runtime,'connection.json');
  const config=fs.existsSync(file)?read(file):{};
  const client=new MCP(endpoint||config.endpoint||'http://127.0.0.1:18060/mcp',config.token||process.env.TRAVEL_MCP_TOKEN||'');
  await client.initialize();
  return client;
}
export async function login(runtime=runtimeDefault,endpoint){
  const client=await connect(runtime,endpoint),result=await client.call('get_login_qrcode');
  let image=result.content?.find(c=>c.type==='image');
  if(!image){
    const data=unwrap(result),text=data.img||data.image||data.data?.img;
    const m=String(text||'').match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/s);
    if(m)image={mimeType:m[1],data:m[2]};
  }
  if(!image)throw Error('QR image not returned; check login status or upstream schema');
  const bytes=Buffer.from(image.data,'base64');if(!sniff(bytes))throw Error('Invalid QR raster data');
  const file=path.join(runtime,'login.'+sniff(bytes).split('/')[1]);write(file,bytes);
  return {file,next:'Open this local image and scan with your own Xiaohongshu app, then run mcp-status. QR is private temporary data; do not commit or publish it.'};
}
export async function status(runtime=runtimeDefault,endpoint){
  const client=await connect(runtime,endpoint),tools=await client.tools(),result=unwrap(await client.call('check_login_status'));
  // Do not return arbitrary provider objects or account identifiers.
  const s=JSON.stringify(result);
  const loggedIn=result.is_logged_in===true||result.data?.is_logged_in===true||(/已登录|登录成功/.test(s)&&!/未登录/.test(s));
  return {connected:true,loggedIn,availableReadTools:tools.filter(t=>allowedTools.has(t.name)).map(t=>t.name)};
}
export function cards(result){
  const d=unwrap(result);const arr=d.feeds||d.data?.feeds||d.items||d.data?.items;
  if(!Array.isArray(arr))throw Error('Search response not recognized; no candidates recorded');
  return arr.filter(x=>x.id&&x.noteCard).map(x=>({id:x.id,token:x.xsecToken||x.xsec_token,title:x.noteCard.displayTitle||x.noteCard.title||x.id,author:x.noteCard.user?.nickname||'',url:'https://www.xiaohongshu.com/explore/'+x.id}));
}
export async function search(project,keyword,{runtime=runtimeDefault,endpoint}={}){
  assertResearchEnabled(project,runtime);
  const client=await connect(runtime,endpoint),items=cards(await client.call('search_feeds',{keyword}));
  const safe=items.map(({token,...c})=>({...c,query:keyword}));
  return {...register(project,safe),items:safe};
}
function note(result,id){
  const d=unwrap(result),n=d.data?.note||d.note||d.data?.data?.note;
  if(!n||String(n.noteId||n.note_id||n.id)!==id)throw Error('Detail note ID mismatch or unknown schema');
  return n;
}
function imageItems(n){
  if(!Array.isArray(n.imageList))throw Error('Missing image manifest; do not assume zero images');
  return n.imageList.map(i=>({url:i.urlDefault||i.urlPre||i.infoList?.find(x=>x.imageScene==='WB_DFT')?.url||i.infoList?.[0]?.url,width:i.width,height:i.height}));
}
function imageSignature(images){return hash(images.map(i=>[new URL(i.url).pathname.split('/').at(-1),i.width,i.height]));}
async function cdnImage(url){
  let u=new URL(url);
  if(!/(^|\.)xhscdn\.com$/.test(u.hostname)||!['http:','https:'].includes(u.protocol))throw Error('Only Xiaohongshu image CDN is allowed');
  u.protocol='https:';u.search='';u.hash='';
  const response=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('Image CDN HTTP '+response.status);
  const bytes=await boundedBytes(response,25*1024*1024);
  if(bytes.length>25*1024*1024||!sniff(bytes))throw Error('Invalid/oversize image');
  return bytes;
}
export async function extract(project,keyword,ids,{runtime=runtimeDefault,endpoint,refresh=false}={}){
  assertResearchEnabled(project,runtime);
  if(ids.length>10)throw Error('Use small serial batches (maximum 10)');
  const client=await connect(runtime,endpoint),items=cards(await client.call('search_feeds',{keyword})),results=[];
  for(const id of ids){
    try{
      uid(id);
      const existing=read(inside(project,'research/registry.json')).find(n=>n.id===id);
      if(existing?.raw&&!refresh){results.push({id,ok:true,skipped:true,reason:'already-extracted; use --refresh for a new revision'});continue;}
      const c=items.find(x=>x.id===id);if(!c?.token)throw Error('Exact note absent from current search; refine query or import user-supplied material');
      const args={feed_id:id,xsec_token:c.token,load_all_comments:false};
      const first=note(await client.call('get_feed_detail',args),id);
      const second=note(await client.call('get_feed_detail',args),id);
      const a=imageItems(first),b=imageItems(second);
      if(imageSignature(a)!==imageSignature(b))throw Error('Image manifest unstable; retry later');
      if(!b.length&&!(second.desc||'').trim())throw Error('Empty note');
      const dir=inside(project,'.runtime/xhs-downloads/'+id);
      fs.mkdirSync(dir,{recursive:true});
      const cacheFile=path.join(dir,'download-manifest.json');
      const cache=fs.existsSync(cacheFile)?read(cacheFile):{signature:null,images:[]};
      if(cache.signature!==imageSignature(b)){cache.signature=imageSignature(b);cache.images=[];}
      const images=[];
      for(let i=0;i<b.length;i++){
        const saved=cache.images[i],local=saved?inside(dir,saved.file):null;
        if(saved&&fs.existsSync(local)&&hash(fs.readFileSync(local))===saved.hash){images.push({file:saved.file});continue;}
        const bytes=await cdnImage(b[i].url),file=String(i+1)+'.'+sniff(bytes).split('/')[1];
        write(path.join(dir,file),bytes);images.push({file});cache.images[i]={file,hash:hash(bytes)};
        write(cacheFile,cache);
      }
      results.push({ok:true,...importSource(project,{id,title:second.title||c.title,author:c.author,url:c.url,text:second.desc||'',images},dir,{refresh})});
    }catch(e){results.push({id,ok:false,error:e.message});}
  }
  return {results,failed:results.filter(r=>!r.ok).length};
}
export async function install(runtime=runtimeDefault,tag='latest'){
  assertResearchEnabled(null,runtime);
  if(!/^(latest|[a-zA-Z0-9._-]+)$/.test(tag))throw Error('Invalid version tag');
  const platform={win32:'windows',darwin:'darwin',linux:'linux'}[process.platform],arch={x64:'amd64',arm64:'arm64'}[process.arch];
  if(!platform||!arch)throw Error('Unsupported platform');
  const api='https://api.github.com/repos/xpzouying/xiaohongshu-mcp/releases/'+(tag==='latest'?'latest':'tags/'+tag);
  const response=await fetch(api,{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error('GitHub release HTTP '+response.status);
  const release=await response.json();
  const matches=release.assets.filter(a=>a.name.includes('xiaohongshu-mcp-'+platform+'-'+arch)&&!a.name.includes('login')&&!/sha|checksum|sig/i.test(a.name));
  if(matches.length!==1)throw Error('No unambiguous supported release asset; use upstream release page');
  const asset=matches[0],version=uid(release.tag_name.toLowerCase().replace(/\./g,'-')),dir=path.join(runtime,'versions',version);
  if(fs.existsSync(dir))throw Error('Version directory exists; inspect installed.json instead of overwriting');
  const url=new URL(asset.browser_download_url);
  if(url.hostname!=='github.com'||!url.pathname.startsWith('/xpzouying/xiaohongshu-mcp/releases/download/'))throw Error('Unexpected release URL');
  const download=await fetch(url,{signal:AbortSignal.timeout(120000)});
  if(!download.ok)throw Error('Download HTTP '+download.status);
  const bytes=await boundedBytes(download,350*1024*1024);
  if(bytes.length>350*1024*1024)throw Error('Release asset too large');
  const digest=hash(bytes),expected=asset.digest?.replace(/^sha256:/,'');
  if(expected&&digest!==expected)throw Error('Release checksum mismatch');
  fs.mkdirSync(dir,{recursive:true});
  const archive=path.join(dir,path.basename(asset.name));write(archive,bytes,{exclusive:true});
  let exe=archive;
  if(/\.(tar\.gz|tgz|zip)$/.test(asset.name)){
    const list=spawnSync('tar',['-tf',archive],{encoding:'utf8',windowsHide:true});
    if(list.status!==0)throw Error('tar required to extract release archive');
    for(const name of list.stdout.trim().split(/\r?\n/))if(path.isAbsolute(name)||name.split(/[\\/]/).includes('..')||/^[A-Za-z]:/.test(name))throw Error('Unsafe archive entry');
    const found=list.stdout.trim().split(/\r?\n/).filter(n=>path.basename(n)==='xiaohongshu-mcp-'+platform+'-'+arch+(platform==='windows'?'.exe':''));
    if(found.length!==1)throw Error('Could not identify service executable');
    // Extract one member to stdout, never let archive paths or links write filesystem targets.
    const result=spawnSync('tar',['-xOf',archive,found[0]],{windowsHide:true,maxBuffer:350*1024*1024});
    if(result.status!==0||!result.stdout.length)throw Error('Archive extraction failed');
    exe=path.join(dir,path.basename(found[0]));write(exe,result.stdout,{exclusive:true});
  }
  if(process.platform!=='win32')fs.chmodSync(exe,0o700);
  const record={version:release.tag_name,platform,arch,executable:exe,source:url.href,sha256:digest,publisherChecksumVerified:!!expected,installedAt:now()};
  write(path.join(runtime,'installed.json'),record);
  return record;
}
export async function start(runtime=runtimeDefault,{port=18060,executable}={}){
  assertResearchEnabled(null,runtime);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid port');
  const exe=executable||read(path.join(runtime,'installed.json')).executable;
  if(!path.isAbsolute(exe)||!fs.existsSync(exe))throw Error('Service executable missing');
  fs.mkdirSync(runtime,{recursive:true});
  const token=crypto.randomBytes(32).toString('hex'),endpoint='http://127.0.0.1:'+port+'/mcp';
  const {createServer}=await import('node:net');
  await new Promise((resolve,reject)=>{const s=createServer();s.once('error',()=>reject(Error('Port already occupied; inspect existing connection, do not kill it')));s.listen(port,'127.0.0.1',()=>s.close(resolve));});
  const log=fs.openSync(path.join(runtime,'service.log'),'a',0o600);
  const child=spawn(exe,['-headless=true','-port=127.0.0.1:'+port],{cwd:runtime,detached:true,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,AUTH_TOKEN:token,COOKIES_PATH:path.join(runtime,'cookies.json')}});
  let spawnError;child.on('error',e=>{spawnError=e;});child.unref();fs.closeSync(log);
  write(path.join(runtime,'connection.json'),{endpoint,token,pid:child.pid,executable:exe,startedAt:now()});
  for(let n=0;n<20;n++){
    if(spawnError)throw Error('Service process failed to start');
    try{const r=await fetch('http://127.0.0.1:'+port+'/health',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});if(r.ok)return {endpoint,pid:child.pid,health:true,next:'mcp-login'};}catch{}
    await new Promise(r=>setTimeout(r,500));
  }
  return {endpoint,pid:child.pid,health:false,next:'Inspect private service.log; browser bootstrap may still be downloading. Do not start duplicate service.'};
}
