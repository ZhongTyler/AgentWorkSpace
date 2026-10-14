import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const receptionHash = text => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

// Read-only integrity check, not a semantic completeness or user-approval check.
export function checkDecisionReception(root, index = 'docs/decisions/decision-reception.md') {
  const errors = [], warnings = [];
  try {
    const file = path.resolve(root, index);
    const text = fs.readFileSync(file, 'utf8');
    const blocks = [...text.matchAll(/^```decision-reception\r?\n([\s\S]*?)^```/gm)];
    if (blocks.length !== 1) throw Error('one decision-reception block required');
    const data = JSON.parse(blocks[0][1]);
    if (data.schema_version !== 1 || !['empty', 'received'].includes(data.state) || !Array.isArray(data.sources)) throw Error('invalid decision reception contract');
    const expected = new Set(), aliases = new Set();
    for (const source of data.sources) {
      if (!/^[A-Za-z0-9_-]+$/.test(source.key) || aliases.has(source.key)) throw Error('invalid/duplicate reception source');
      aliases.add(source.key);
      // External source references are intentional; this function never writes them.
      if (typeof source.path !== 'string' || !source.path || path.isAbsolute(source.path)) throw Error('relative reception source path required');
      const original = fs.readFileSync(path.resolve(root, source.path), 'utf8');
      if (!/^[a-f0-9]{64}$/.test(source.sha256) || receptionHash(original) !== source.sha256) errors.push('decision source changed; review before refreshing hash: ' + source.key);
      if (typeof source.id_pattern !== 'string' || !source.id_pattern.startsWith('^')) throw Error('anchored source id_pattern required');
      const ids = [...original.matchAll(new RegExp(source.id_pattern, 'gm'))].map(m => m[1]);
      if (!ids.length || ids.some(id => !id || !/^[A-Za-z0-9_.-]+$/.test(id)) || new Set(ids).size !== ids.length) throw Error('empty/invalid/duplicate source decision IDs: ' + source.key);
      for (const id of ids) expected.add(source.key + ':' + id);
    }
    const actual = new Set();
    const dispositions = new Set(['inherited', 'deferred', 'scoped-change', 'superseded', 'needs-review']);
    const linkExists = cell => {
      const links = [...cell.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)];
      return links.length > 0 && links.every(m => {
        const target = m[1].split('#')[0];
        return target && !/^[a-z][a-z0-9+.-]*:/i.test(target) && fs.statSync(path.resolve(path.dirname(file), target)).isFile();
      });
    };
    for (const line of text.split(/\r?\n/).filter(line => /^\|\s*[A-Za-z0-9_-]+:/.test(line))) {
      const cells = line.split('|').slice(1, -1).map(v => v.trim());
      if (cells.length !== 6) throw Error('reception row requires six cells');
      const [id, disposition, summary, owner, evidence, next] = cells;
      if (actual.has(id)) errors.push('duplicate reception: ' + id);
      actual.add(id);
      if (!expected.has(id)) errors.push('unknown reception ID: ' + id);
      if (!dispositions.has(disposition)) errors.push('invalid reception disposition: ' + id);
      if (!summary || !linkExists(owner)) errors.push('missing current owner: ' + id);
      if (['scoped-change', 'superseded'].includes(disposition) && !linkExists(evidence)) errors.push('replacement evidence required: ' + id);
      if (!next || (disposition === 'deferred' && next === '-')) errors.push('next/review condition required: ' + id);
      if (disposition === 'needs-review') warnings.push('resolve before dependent work: ' + id);
    }
    for (const id of expected) if (!actual.has(id)) errors.push('missing reception: ' + id);
    if (data.state === 'empty' && (data.sources.length || actual.size)) errors.push('empty reception cannot contain sources/rows');
    if (data.state === 'received' && !data.sources.length) errors.push('received requires sources');
    if (data.state === 'empty') warnings.push('decision reception empty; not an acceptance claim');
  } catch (error) { errors.push('decision reception: ' + error.message); }
  return { errors, warnings };
}
