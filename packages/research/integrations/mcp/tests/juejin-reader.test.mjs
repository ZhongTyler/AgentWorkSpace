import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const runtime = process.env.RESEARCH_MCP_RUNTIME;
if (!runtime) throw new Error('Set RESEARCH_MCP_RUNTIME to the installed runtime');
const { articleUrl, extractArticle } = await import(pathToFileURL(path.join(runtime,
  'node_modules/agent-search-mcp/dist/tools/research-juejin-reader.mjs')));

test('retain ordered prose, fenced code, references and image URLs, exclude scripts and navigation', () => {
  const md = extractArticle('<title>Sample - 掘金</title><nav>unrelated</nav><div id="article-root"><style>.hidden{}</style><h2>Mechanism</h2><p>before</p><pre><code class="language-js">const n = 1;\nconsole.log(n);</code></pre><p><a href="/post/456">original</a><img data-src="//example.org/image.png" alt="diagram"></p><p>after</p><script>danger()</script></div>', 'https://juejin.cn/post/123');
  assert.match(md, /## Mechanism/);
  assert.match(md, /```js\nconst n = 1;\nconsole.log\(n\);\n```/);
  assert.match(md, /\[original\]\(https:\/\/juejin.cn\/post\/456\)/);
  assert.match(md, /!\[diagram\]\(https:\/\/example.org\/image.png\)/);
  assert.ok(md.indexOf('before') < md.indexOf('const n') && md.indexOf('after') > md.indexOf('const n'));
  assert.doesNotMatch(md, /danger|unrelated|hidden/);
});
test('challenge pages, empty or ambiguous bodies fail instead of reporting a title-only success', () => {
  for (const html of ['<title>请稍候</title>', '<title>X</title><div id="article-root"><style>x</style></div>', '<div id="article-root">a</div><div id="article-root">b</div>']) {
    assert.throws(() => extractArticle(html, 'https://juejin.cn/post/123'));
  }
});
test('only expected public hosts and article paths are accepted', () => {
  assert.equal(articleUrl('https://aicoding.juejin.cn/post/123?x=1'), 'https://juejin.cn/post/123');
  for (const url of ['http://juejin.cn/post/123','https://evil.test/post/123','https://juejin.cn.evil.test/post/123','https://juejin.cn:8443/post/123','https://juejin.cn/recommended','https://user:pass@juejin.cn/post/123']) assert.throws(() => articleUrl(url));
});
