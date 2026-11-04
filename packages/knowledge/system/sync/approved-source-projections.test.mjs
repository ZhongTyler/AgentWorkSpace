import test from 'node:test';import assert from 'node:assert/strict';
import {hash} from './state.mjs';import {applyApprovedSourceProjection,manualProjectionRecords} from './approved-source-projections.mjs';
const url='https://mp.weixin.qq.com/s?mid=1&pass_ticket=SYNTHETIC',safe='https://mp.weixin.qq.com/s?mid=1';
const original=Buffer.from('---\nsource: Author\nsource_url:\n  - "'+url+'",\n---\nExact body\n'),expected=Buffer.from(original.toString().replace(url,safe));
const record={path:'raw-sources/example.md',source_sha256:hash(original),public_sha256:hash(expected),authorization_ref:'synthetic explicit manual approval'};
test('exact approved manual URL projection preserves comma, metadata and body; repeated use is identical',()=>{for(let i=0;i<2;i++){const result=applyApprovedSourceProjection(original,record);assert.deepEqual(result.bytes,expected);assert.equal(result.body_sha256,hash('Exact body\n'));}});
test('changed source, forged public bytes, missing authorization and duplicates are rejected',()=>{
 assert.throws(()=>applyApprovedSourceProjection(Buffer.concat([original,Buffer.from('new')]),record),{code:'manual_source_version_changed'});
 assert.throws(()=>applyApprovedSourceProjection(original,{...record,public_sha256:hash(Buffer.from('wrong'))}),{code:'manual_public_version_mismatch'});
 assert.throws(()=>manualProjectionRecords([{...record,authorization_ref:''}]),{code:'invalid_manual_source_projection'});
 assert.throws(()=>manualProjectionRecords([record,record]),{code:'invalid_manual_source_projection'});
});
