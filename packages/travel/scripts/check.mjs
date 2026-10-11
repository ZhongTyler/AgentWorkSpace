import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageCheck } from './lib/package.mjs';

export function withoutCode(text) {
  return text.replace(/(^|\n)[ \t]*(\x60{3,}|~{3,})[^\n]*\n[\s\S]*?\n[ \t]*\2[ \t]*(?=\n|$)/g, '\n')
    .replace(/(\x60+)[^\n]*?\1/g, '');
}

export function headingAnchors(text) {
  const counts = new Map();
  return new Set(withoutCode(text).split(/\r?\n/).flatMap(line => {
    const match = line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (!match) return [];
    const slug = match[1].toLowerCase().replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '').replace(/\s/g, '-');
    const n = counts.get(slug) || 0;
    counts.set(slug, n + 1);
    return [n ? slug + '-' + n : slug];
  }));
}

export function checkMarkdown(file, text, io = fs) {
  const errors = [];
  let localLinks = 0;
  // This collection uses inline links; code samples and external URLs are not tested.
  for (const match of withoutCode(text).matchAll(/!?\[[^\]\n]*\]\((<[^>\n]+>|[^)\n]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//') || raw.includes('{{')) continue;
    localLinks++;
    let target;
    try { target = decodeURIComponent(raw); }
    catch { errors.push('invalid URL encoding: ' + raw); continue; }
    const index = target.indexOf('#');
    const fragment = index < 0 ? '' : target.slice(index + 1);
    const relative = (index < 0 ? target : target.slice(0, index)).split('?')[0];
    const destination = relative ? path.resolve(path.dirname(file), relative) : file;
    if (!io.existsSync(destination)) {
      errors.push('missing target: ' + raw);
    } else if (fragment && destination.endsWith('.md')) {
      const source = destination === file ? text : io.readFileSync(destination, 'utf8');
      if (!headingAnchors(source).has(fragment)) errors.push('missing heading: ' + raw);
    }
  }
  return { localLinks, errors };
}

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? markdownFiles(full) : entry.name.endsWith('.md') ? [full] : [];
  });
}

export function run() {
  const result=packageCheck();
  console.log(JSON.stringify(result,null,2));
  return result.valid?0:1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run();
}
