import assert from 'node:assert/strict';
import {health,makeGuard,readVideo} from './reader.mjs';
const bvid='BV1mSyoBHE2G',checks=[];
const test=async(name,fn)=>{await fn();checks.push(name);};
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
const nav={data:{wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/abcdefghijklmnopqrstuvwxyz123456.png',sub_url:'https://i0.hdslb.com/bfs/wbi/123456abcdefghijklmnopqrstuvwxyz.png'}}};
const meta={code:0,data:{bvid,title:'合成字幕合同演练',cid:123,aid:456,owner:{name:'synthetic'},pages:[{cid:123,page:1,part:'合成第一P',duration:10}]}};
await test('runtime_hash_health_without_network',()=>assert.equal(health().status,'pass'));
await test('403_412_429_stop_and_no_more_requests',async()=>{
  for(const status of [403,412,429]){let n=0;const guard=makeGuard(async()=>{n++;return new Response('',{status});},{bvid});
    await assert.rejects(()=>guard.fetch('https://api.bilibili.com/x/web-interface/nav'));await assert.rejects(()=>guard.fetch('https://api.bilibili.com/x/web-interface/nav'));assert.equal(n,1);
  }
});
await test('cookies_and_off_scope_requests_are_not_sent',async()=>{
  for(const [url,headers]of [['https://api.bilibili.com/x/web-interface/nav',{Cookie:'synthetic'}],['https://api.bilibili.com/x/player/v2',{}],['https://example.com/secret.json',{}]]){
    let n=0;const g=makeGuard(async()=>{n++;return json({});},{bvid});await assert.rejects(()=>g.fetch(url,{headers}));assert.equal(n,0);
  }
});
await test('original_metadata_412_has_one_attempt_no_fallback',async()=>{
  let n=0;const result=await readVideo({bvid},{fetcher:async url=>{if(new URL(url).pathname.endsWith('/nav'))return json(nav);n++;return new Response('',{status:412});}});
  assert.equal(result.status,'stopped');assert.equal(n,1);assert(result.access.requests.every(r=>!r.path.endsWith('/view')||r.path.includes('/wbi/')));
});
await test('empty_subtitles_stay_unavailable_not_description',async()=>{
  const result=await readVideo({bvid,transcript:true},{fetcher:async url=>{
    const p=new URL(url).pathname;if(p.endsWith('/nav'))return json(nav);if(p.endsWith('/view'))return json(meta);return json({code:0,data:{subtitle:{subtitles:[]}}});
  }});assert.equal(result.status,'subtitle_unavailable');assert.equal(result.description_fallback,false);assert.equal(result.access.count,2);
});
await test('subtitle_request_412_no_legacy_or_fingerprint',async()=>{
  const r=await readVideo({bvid,transcript:true},{fetcher:async url=>new URL(url).pathname.endsWith('/view')?json(meta):new Response('',{status:412})});
  assert.equal(r.status,'stopped');assert.equal(r.access.count,2);assert(!r.access.requests.some(x=>x.path.includes('/finger/')||x.path==='/x/player/v2'));
});
await test('bvid_identity_mismatch_rejected',async()=>{
  const r=await readVideo({bvid},{fetcher:async()=>json({...meta,data:{...meta.data,bvid:'BV0000000000'}})});assert.equal(r.reason,'returned_video_identity_mismatch');
});
await test('actual_original_reader_preserves_caption_type_and_frames_unknown',async()=>{
  const r=await readVideo({bvid,transcript:true},{fetcher:async url=>{
    const u=new URL(url);if(u.pathname.endsWith('/view'))return json(meta);
    if(u.pathname==='/x/player/wbi/v2')return json({code:0,data:{subtitle:{subtitles:[{id:1,lan:'ai-zh',lan_doc:'中文自动字幕',subtitle_url:'https://aisubtitle.hdslb.com/synthetic.json'}]}}});
    return json({body:[{from:0,to:8,content:'合成字幕，不是实际视频。'}]});
  }});
  assert.equal(r.status,'subtitle_read_requires_visual_review');assert.equal(r.subtitle_kind,'platform_ai');assert.equal(r.frames_read,false);assert.equal(r.access.count,4);assert.equal(r.segments.length,1);
});
await test('login_required_is_distinct_from_missing_subtitles',async()=>{
  const r=await readVideo({bvid,transcript:true},{fetcher:async url=>new URL(url).pathname.endsWith('/view')?json(meta):json({code:-101,message:'mock login required'})});
  assert.equal(r.status,'stopped');assert.equal(r.reason,'authentication_required');assert.equal(r.upstream_code,-101);assert.equal(r.access.count,2);
});
await test('wrong_part_cid_stops_before_network',async()=>{
  let n=0;const guard=makeGuard(async()=>{n++;return json({});},{bvid});guard.selectPart(123);
  await assert.rejects(()=>guard.fetch('https://api.bilibili.com/x/player/wbi/v2?bvid='+bvid+'&cid=124'));assert.equal(n,0);
});
console.log(JSON.stringify({status:'PASS_WITH_LIMITS',checks,network:false,synthetic:true,real_video_content_verified:false},null,2));
