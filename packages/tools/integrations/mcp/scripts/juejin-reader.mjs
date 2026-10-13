// Local repair for agent-search-mcp 3.2.1. Read public SSR HTML; never evaluate page scripts.
import { load } from 'cheerio';
import TurndownService from 'turndown';

export function articleUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !['juejin.cn', 'www.juejin.cn', 'aicoding.juejin.cn'].includes(url.hostname)
      || url.username || url.password || (url.port && url.port !== '443') || !/^\/post\/\d+\/?$/.test(url.pathname)) {
    throw new Error('Expected an HTTPS Juejin /post/<id> URL');
  }
  return `https://juejin.cn${url.pathname.replace(/\/$/, '')}`;
}

export function extractArticle(html, source) {
  const $ = load(html);
  const root = $('#article-root');
  if (root.length !== 1) throw new Error('Article body unavailable (missing or ambiguous article-root)');
  root.find('style,script,noscript,button').remove();
  // Resolve references without fetching embedded media or linked pages.
  root.find('a').each((_, el) => {
    const href = $(el).attr('href');
    try {
      const u = new URL(href, source);
      if (['http:', 'https:'].includes(u.protocol)) $(el).attr('href', u.href);
      else $(el).removeAttr('href');
    } catch { $(el).removeAttr('href'); }
  });
  root.find('img').each((_, el) => {
    const raw = $(el).attr('data-src') || $(el).attr('src');
    try {
      const u = new URL(raw, source);
      if (['http:', 'https:'].includes(u.protocol)) $(el).attr('src', u.href);
      else $(el).remove();
    } catch { $(el).remove(); }
  });
  if (!root.text().trim() && !root.find('img').length) throw new Error('Article body is empty');
  const title = $('h1.article-title').text().trim() || $('title').text().replace(/\s*-\s*掘金$/, '').trim();
  if (!title) throw new Error('Article title unavailable');
  const md = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' }).turndown(root.html()).trim();
  if (!md) throw new Error('Article conversion produced an empty body');
  return `# ${title}\n\nSource: ${source}\nFormat: public SSR HTML converted to Markdown; embedded media are references only.\n\n${md}`;
}

export async function fetchJuejinArticle(url) {
  const source = articleUrl(url);
  const response = await fetch(source, { signal: AbortSignal.timeout(15000), redirect: 'error',
    headers: { Accept: 'text/html', 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!response.headers.get('content-type')?.includes('text/html')) throw new Error('Expected an HTML article');
  const html = await response.text();
  if (html.length > 8 * 1024 * 1024) throw new Error('Article exceeds bounded HTML size');
  return extractArticle(html, source);
}
