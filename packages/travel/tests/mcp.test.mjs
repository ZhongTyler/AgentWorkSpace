import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MCP,cards,unwrap,boundedBytes,search,extract,install} from '../scripts/lib/mcp.mjs';
import {init,inside,write,read,hash} from '../scripts/lib/core.mjs';

test('MCP only allows loopback and the four read/login tools',async()=>{
 assert.throws(()=>new MCP('https://remote.example/mcp'),/loopback/);
 const c=new MCP('http://127.0.0.1:18060/mcp');
 await assert.rejects(c.call('publish_content'),/denies/);
});
test('MCP negotiates session and reads bounded SSE JSON-RPC result',async t=>{
 const calls=[],server=http.createServer(async(req,res)=>{
  let body='';for await(const p of req)body+=p;const m=JSON.parse(body);calls.push({m,headers:req.headers});
  if(m.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  res.setHeader('Mcp-Session-Id','session-test');
  if(m.method==='initialize'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{protocolVersion:'2025-06-18',capabilities:{}}}));return;}
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('event: message\r\ndata: '+JSON.stringify({jsonrpc:'2.0',method:'notifications/message',params:{}})+'\r\n\r\n');
  res.end('event: message\r\ndata: '+JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'{"is_logged_in":true}'}]}})+'\r\n\r\n');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const client=new MCP('http://127.0.0.1:'+server.address().port+'/mcp','TEST_LOCAL_TOKEN');
 await client.initialize();const r=unwrap(await client.call('check_login_status'));
 assert.equal(r.is_logged_in,true);assert.equal(calls[2].headers['mcp-session-id'],'session-test');assert.equal(calls[2].headers.authorization,'Bearer TEST_LOCAL_TOKEN');
});
test('MCP mismatched response fails closed, no success state invented',async()=>{
 const c=new MCP('http://127.0.0.1:1234/mcp','',async()=>new Response(JSON.stringify({id:999,result:{}}),{headers:{'content-type':'application/json'}}));
 await assert.rejects(c.call('check_login_status'),/unmatched/);
});
test('search response preserves exact identity and rejects unknown provider shape',()=>{
 const r={content:[{type:'text',text:JSON.stringify({feeds:[{id:'abcdef',xsecToken:'EPHEMERAL',noteCard:{displayTitle:'Title',user:{nickname:'Author'}}}]})}]};
 assert.equal(cards(r)[0].id,'abcdef');assert.equal(cards(r)[0].url,'https://www.xiaohongshu.com/explore/abcdef');assert.throws(()=>cards({content:[]}),/not recognized/);
});
test('binary download enforces declared and streamed size limits',async()=>{
 await assert.rejects(boundedBytes(new Response('abc',{headers:{'content-length':'999'}}),3),/size limit/);
 await assert.rejects(boundedBytes(new Response('abcd'),3),/size limit/);
 assert.equal((await boundedBytes(new Response('abc'),3)).toString(),'abc');
});
test('mock full search/extract keeps access token out of registered raw evidence',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-mcp-test-')),project=path.join(root,'trip'),runtime=path.join(root,'runtime');
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));init(project,'mock','2027-01-01','2027-01-01');
 const id='699df838000000002801d2de',secret='TEMPORARY_NOTE_TOKEN';let details=0;
 const server=http.createServer(async(req,res)=>{
  let body='';for await(const p of req)body+=p;const m=JSON.parse(body);res.setHeader('content-type','application/json');
  if(m.method==='notifications/initialized'){res.writeHead(202);res.end();return;}
  let result={protocolVersion:'2025-06-18'};
  if(m.method==='tools/call'){
   if(m.params.name==='search_feeds')result={content:[{type:'text',text:JSON.stringify({feeds:[{id,xsecToken:secret,noteCard:{displayTitle:'Mock',user:{nickname:'Synthetic'}}}]})}]};
   else {assert.equal(m.params.arguments.xsec_token,secret);details++;result={structuredContent:{data:{note:{noteId:id,title:'Mock',desc:'Text-only synthetic fixture',imageList:[]}}}};}
  }
  res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const endpoint='http://127.0.0.1:'+server.address().port+'/mcp';
 write(path.join(runtime,'connection.json'),{endpoint});
 await search(project,'mock',{runtime});const result=await extract(project,'mock',[id],{runtime});assert.equal(result.failed,0);assert.equal(details,2);
 const registry=read(inside(project,'research/registry.json')),raw=read(inside(project,registry[0].raw));
 assert.ok(!JSON.stringify([registry,raw]).includes(secret));assert.equal(raw.images.length,0);
 const again=await extract(project,'mock',[id],{runtime});assert.equal(again.results[0].skipped,true);assert.equal(details,2);
});
test('installer verifies release digest and records version without running a binary',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'travel-install-test-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const real=globalThis.fetch;t.after(()=>{globalThis.fetch=real;});
 const platform={win32:'windows',darwin:'darwin',linux:'linux'}[process.platform],arch={x64:'amd64',arm64:'arm64'}[process.arch];
 if(!platform||!arch){t.skip('Unsupported platform');return;}
 const bytes=Buffer.from('synthetic binary fixture; never executable'),name='xiaohongshu-mcp-'+platform+'-'+arch+(platform==='windows'?'.exe':'');
 const asset={name,browser_download_url:'https://github.com/xpzouying/xiaohongshu-mcp/releases/download/v0.0.0/'+name,digest:'sha256:'+hash(bytes)};
 globalThis.fetch=async url=>new Response(String(url).includes('api.github.com')?JSON.stringify({tag_name:'v0.0.0',assets:[asset]}):bytes);
 const record=await install(root,'v0.0.0');assert.equal(record.publisherChecksumVerified,true);assert.equal(hash(fs.readFileSync(record.executable)),hash(bytes));
 assert.ok(!fs.existsSync(path.join(root,'connection.json')));
 asset.digest='sha256:wrong';await assert.rejects(install(path.join(root,'bad'),'v0.0.0'),/checksum/);
 assert.ok(!fs.existsSync(path.join(root,'bad')));
});
