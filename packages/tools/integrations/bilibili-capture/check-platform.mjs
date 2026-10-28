import assert from 'node:assert/strict';
import {request} from './platform.mjs';
const done=[];
for(const status of [401,403,412,429]){
  let n=0;
  const r=await request('search',{keyword:'synthetic'},async()=>{n++;return new Response('',{status});});
  assert.equal(r.status,'stopped');assert.equal(n,1);done.push('http_'+status+'_one_attempt');
}
let n=0;await assert.rejects(()=>request('search',{keyword:'',limit:1},async()=>{n++;}));assert.equal(n,0);done.push('invalid_search_no_network');
await assert.rejects(()=>request('audio',{bvid:'invalid'}));done.push('invalid_identity_rejected');
console.log(JSON.stringify({status:'pass',checks:done,synthetic:true,real_network:false}));
