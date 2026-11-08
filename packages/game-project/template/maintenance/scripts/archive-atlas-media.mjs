import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readAtlas, hash } from './asset-atlas-store.mjs';

export function archiveMedia(root, write = false) {
  const view = readAtlas(root);
  const file = path.join(root, view.base, 'atlas-media-archive.json');
  const previous = fs.existsSync(file) ? fs.readFileSync(file) : null;
  const archive = previous ? JSON.parse(previous) : {schema_version: 1, files: []};
  if (archive.schema_version !== 1 || !Array.isArray(archive.files)) throw Error('媒体归档格式无效');
  const existing = new Set(archive.files.map(f => f.path));
  const at = new Date().toISOString();
  const additions = view.unassigned.filter(p => !existing.has(p)).map(p => ({
    path: p,
    sha256: hash(fs.readFileSync(path.join(root, p))),
    archived_at: at
  }));
  if (write && additions.length) {
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    try {
      fs.writeFileSync(temporary, JSON.stringify({...archive, files: [...archive.files, ...additions]}, null, 2) + '\n', {flag: 'wx'});
      const current = fs.existsSync(file) ? fs.readFileSync(file) : null;
      if (hash(current || '') !== hash(previous || '') || hash(fs.readFileSync(path.join(root, view.base, 'catalog.json'))) !== view.revision) throw Error('归档期间资料变化，请重新读取后重试');
      fs.renameSync(temporary, file);
    } finally {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
  }
  return {archived: archive.files.length + (write ? additions.length : 0), additions: additions.length, written: write};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    console.log(JSON.stringify(archiveMedia(path.resolve(process.argv[2] || '.'), process.argv.includes('--archive'))));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
