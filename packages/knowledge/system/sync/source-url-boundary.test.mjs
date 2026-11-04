import test from 'node:test';
import assert from 'node:assert/strict';
import {projectWeChatURL,projectPublicSource,assertPublicSourceText,assertPublicProviderBody} from './source-url-boundary.mjs';
const unsafe='https://mp.weixin.qq.com/s?__biz=ARTICLE%2BID&mid=123&idx=2&sn=article-signature&pass_ticket=SYNTHETIC_ACCESS&exportkey=SYNTHETIC_EXPORT&abtest_cookie=SYNTHETIC_COOKIE&sessionid=SYNTHETIC_SESSION#wechat_redirect';
const safe='https://mp.weixin.qq.com/s?__biz=ARTICLE%2BID&mid=123&idx=2&sn=article-signature#wechat_redirect';

test('remove exactly four query keys, retaining article identity, order, escapes and fragment',()=>{
 assert.equal(projectWeChatURL(unsafe).url,safe);
 assert.equal(projectWeChatURL(safe).url,safe);
 assert.equal(projectWeChatURL('https://mp.weixin.qq.com/s?PASS_TICKET=x&%65xportkey=y&amp;mid=1&sessionid=a&sessionid=b').url,'https://mp.weixin.qq.com/s?mid=1');
 assert.equal(projectWeChatURL('https://mp.weixin.qq.com/s?mid=%2B+&sn=ab%3D&amp;pass_ticket=x&amp;idx=2').url,'https://mp.weixin.qq.com/s?mid=%2B+&sn=ab%3D&amp;idx=2');
 for(const url of ['https://example.org/?pass_ticket=x','https://mp.weixin.qq.com.evil.test/?exportkey=x','https://mp.weixin.qq.com/s#pass_ticket=x','https://mp.weixin.qq.com/s?not_pass_ticket=x'])assert.equal(projectWeChatURL(url).url,url);
});

test('projection retains BOM, CRLF, author/date, exact body and every non-source field',()=>{
 const before=Buffer.from('\uFEFF---\r\ntitle: 示例\r\nsource: ryan\r\ndate: 2019-08-13\r\nsource_url: "'+unsafe+'"\r\n---\r\n# 原文\r\n\r\n正文完全不变。\r\n');
 const expected=Buffer.from(before.toString().replace(unsafe,safe));
 const out=projectPublicSource(before);assert.deepEqual(out.bytes,expected);assert.equal(out.changed,true);assert.notEqual(out.source_sha256,out.public_sha256);
 assert.equal(projectPublicSource(out.bytes).changed,false);assertPublicSourceText(out.bytes.toString());
});

test('legacy source URL alias and source_url list are supported; author names and other lists stay untouched',()=>{
 const before='---\nsource: "'+unsafe+'"\nsource_url:\n  - "'+unsafe+'"\n  - "'+safe+'"\n---\nBody\n';
 assert.equal(projectPublicSource(Buffer.from(before)).bytes.toString(),before.replaceAll(unsafe,safe));
 assert.throws(()=>projectPublicSource(Buffer.from('---\nnotes:\n  - "'+unsafe+'"\n---\nBody')),e=>e.code==='source_url_manual_review_required');
});

test('body URLs, unsupported metadata and malformed UTF8 are exceptions, never automatic prose edits',()=>{
 for(const text of ['# 正文\n'+unsafe,'---\nnote: '+unsafe+'\n---\nBody','---\nsource_url: ['+unsafe+']\n---\nBody']){
  assert.throws(()=>projectPublicSource(Buffer.from(text)),e=>e.code==='source_url_manual_review_required'&&!JSON.stringify(e).includes('SYNTHETIC_ACCESS'));
 }
 assert.throws(()=>projectPublicSource(Buffer.from([255,254,99])));
});

test('provider guard checks Raw, preview, history and nested JSON without mutating bytes',()=>{
 for(const value of [{messages:[{role:'user',content:unsafe}]},{messages:[{role:'user',content:JSON.stringify({sources:[{content:'---\nsource_url: '+unsafe+'\n---\nbody'}]})}]},{history:[{content:[{type:'text',text:unsafe}]}]}]){
  const old=JSON.stringify(value);assert.throws(()=>assertPublicProviderBody(value),e=>e.code==='source_url_parameters_forbidden'&&!e.message.includes('SYNTHETIC'));assert.equal(JSON.stringify(value),old);
 }
 assert.doesNotThrow(()=>assertPublicProviderBody({messages:[{content:safe+' pass_ticket exportkey sessionid abtest_cookie'}]}));
});
