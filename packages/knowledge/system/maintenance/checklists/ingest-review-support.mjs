import fs from 'node:fs';
import path from 'node:path';
import {safe, sha, styleCheck} from './raw-quality.mjs';
import {findReviewerLog, preflightReviewer} from './ingest-runtime-contract.mjs';

export function splitRaw(text) {
  const match = text.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!match) throw Error('Raw frontmatter is missing or unclosed');
  const fields = {};
  let key;
  for (const line of match[1].split(/\r?\n/)) {
    const field = line.match(/^([A-Za-z_][\w-]*):(?:\s|$)/);
    if (field) {
      key = field[1];
      if (Object.hasOwn(fields, key)) throw Error('Duplicate Raw metadata: ' + key);
      fields[key] = line;
    } else {
      if (!key && line.trim()) throw Error('Unsupported frontmatter syntax');
      if (key) fields[key] += '\n' + line;
    }
  }
  return {fields, body: text.replace(/^\uFEFF/, '').slice(match[0].length), bodyLine: match[0].split(/\r?\n/).length};
}

export function metadataPreflight(root, text) {
  const mechanical = styleCheck(text);
  if (mechanical.status !== 'passed') throw Error('Raw mechanical preflight failed: ' + mechanical.findings.map(x=>x.detail).join('; '));
  const {fields} = splitRaw(text);
  const block = fields.domains?.replace(/^domains:\s*/, '').trim();
  let domains;
  if (block?.startsWith('[') && block.endsWith(']')) domains = block.slice(1,-1).split(',');
  else if (block && block.split('\n').every(x=>/^\s*-\s+/.test(x))) domains = block.split('\n').map(x=>x.replace(/^\s*-\s+/,''));
  else throw Error('domains must be an explicit inline or block list');
  domains = domains.map(x=>x.trim().replace(/^(['"])(.*)\1$/, '$2'));
  const allowed = new Set(fs.readdirSync(safe(root, 'domains', false)).filter(x=>x.endsWith('.md') && x!=='README.md').map(x=>x.slice(0,-3)));
  if (!domains.length || domains.some(x=>!allowed.has(x))) throw Error('Unknown domain; use exact domains/*.md names: ' + domains.filter(x=>!allowed.has(x)).join(', '));
  return {status:'passed', domains};
}

export function metadataDelta(before, after) {
  const a=splitRaw(before), b=splitRaw(after);
  if (a.body !== b.body) throw Error('Metadata reuse requires byte-identical body, including source-location markers');
  const changed=[...new Set([...Object.keys(a.fields),...Object.keys(b.fields)])].filter(k=>a.fields[k]!==b.fields[k]);
  if (!changed.length || changed.some(k=>!['domains','tags'].includes(k))) throw Error('Only domains/tags metadata may reuse semantic evidence');
  return {changed_fields:changed, line_delta:b.bodyLine-a.bodyLine, body_sha256:sha(a.body)};
}

export function checkReviewerRuntime(root, run, agent, request, options={}) {
  if (!(run.execution_control?.runtime_contract_version >= 2)) return null;
  const log=options.log || findReviewerLog(agent, options.sessions);
  return preflightReviewer({root,run,agent,log,requests:[request]});
}
