// Standalone, read-only catalog checks. Kept identical in the template and its first consumer.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {inspectReleases} from './check-releases.mjs';

const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function inside(root, rel) {
  if (typeof rel !== 'string' || !rel || /[\\:]/.test(rel) || path.isAbsolute(rel) || rel.split('/').some(p => !p || p === '.' || p === '..')) throw Error(`unsafe path: ${rel}`);
  const base = path.resolve(root), target = path.resolve(base, rel);
  if (!target.startsWith(base + path.sep)) throw Error(`outside project: ${rel}`);
  let current = base;
  if (fs.lstatSync(base).isSymbolicLink()) throw Error(`linked root: ${base}`);
  for (const part of rel.split('/')) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw Error(`linked path: ${rel}`);
  }
  return target;
}
export function checkAssets(root, config) {
  const errors = [], warnings = [], checked = new Set(), receipts = new Map();
  const attempt = fn => { try { fn(); } catch (e) { errors.push(e.message); } };
  const file = rel => { const p = inside(root, rel); if (!fs.statSync(p).isFile()) throw Error(`not a file: ${rel}`); return p; };
  const evidence = (items, label) => { if (!Array.isArray(items) || !items.length) throw Error(`missing evidence: ${label}`); items.forEach(file); };
  const hash = (rel, expected) => { if (!/^[a-f0-9]{64}$/.test(expected || '') || digest(file(rel)) !== expected) throw Error(`hash mismatch: ${rel}`); };
  let base, engine, catalog;
  try {
    base = config.assets?.directory;
    engine = config.engine?.directory;
    inside(root, base); inside(root, engine);
    const a = base.toLowerCase(), b = engine.toLowerCase();
    if (a === b || a.startsWith(b + '/') || b.startsWith(a + '/')) throw Error('assets/engine directories overlap');
    if (config.assets.contract_version !== 1) throw Error('unsupported assets contract');
    catalog = JSON.parse(fs.readFileSync(file(`${base}/catalog.json`), 'utf8'));
    if (catalog.schema_version !== 1 || !Array.isArray(catalog.assets)) throw Error('invalid catalog v1');
  } catch (e) { return {errors:[e.message], warnings}; }
  const ids = new Set();
  const byId = new Map(catalog.assets.map(a => [a.id, a]));
  for (const a of catalog.assets) attempt(() => {
    if (!/^[a-z0-9][a-z0-9._:-]*$/.test(a.id || '') || ids.has(a.id)) throw Error(`invalid/duplicate asset ID: ${a.id}`);
    ids.add(a.id);
    for (const key of ['object_id','purpose','spec','owner']) if (typeof a[key] !== 'string' || !a[key].trim()) throw Error(`missing ${key}: ${a.id}`);
    if (!['P0','P1','P2'].includes(a.priority)) throw Error(`invalid priority: ${a.id}`);
    if (!['planned','acquired','working','review','ready','retired'].includes(a.stage)) throw Error(`invalid stage: ${a.id}`);
    if (!a.spec.startsWith(base + '/specs/')) throw Error(`spec outside workbench: ${a.id}`);
    file(a.spec);
    if (!Array.isArray(a.references)) throw Error(`missing references: ${a.id}`);
    for (const id of a.references) if (id === a.id || !byId.has(id)) throw Error(`invalid reference ${id}: ${a.id}`);
    if (a.work_path !== null) {
      if (!a.work_path?.startsWith(base + '/work/')) throw Error(`work outside workbench: ${a.id}`);
      if (!fs.statSync(inside(root, a.work_path)).isDirectory()) throw Error(`missing work directory: ${a.id}`);
    }
    for (const key of ['concept','purpose','technical','rights']) {
      const gate = a.gates?.[key];
      if (!['pending','pass','fail'].includes(gate?.status)) throw Error(`invalid ${key} gate: ${a.id}`);
      if (gate.status !== 'pending') evidence(gate.evidence, `${a.id}/${key}`);
      else if (!Array.isArray(gate.evidence)) throw Error(`missing pending evidence list: ${a.id}`);
      else gate.evidence.forEach(file);
      if (a.stage === 'ready' && gate.status !== 'pass') throw Error(`ready without ${key} pass: ${a.id}`);
    }
    if (!['planned','vendor','generated','custom','procedural'].includes(a.source?.kind) || typeof a.source.version !== 'string' || !Array.isArray(a.source.files)) throw Error(`invalid source: ${a.id}`);
    if (a.stage !== 'planned' && a.source.kind === 'planned') throw Error('non-planned stage without a source: ' + a.id);
    if (['vendor','generated'].includes(a.source.kind) && !a.source.receipt) throw Error('missing source receipt: ' + a.id);
    if (['vendor','generated','custom'].includes(a.source.kind) && a.stage !== 'planned' && !a.source.files.length) throw Error(`acquired without source: ${a.id}`);
    for (const f of a.source.files) {
      if (!f.path.startsWith(base + '/sources/')) throw Error(`source outside workbench: ${a.id}`);
      hash(f.path, f.sha256);
    }
    if (a.source.receipt && !checked.has(a.source.receipt)) {
      if (!a.source.receipt.startsWith(base + '/sources/')) throw Error(`receipt outside sources: ${a.id}`);
      const r = JSON.parse(fs.readFileSync(file(a.source.receipt), 'utf8'));
      if (r.contract !== 'source-snapshot-v1' || !r.origin || !Object.keys(r.files || {}).length) throw Error(`invalid snapshot: ${a.id}`);
      for (const [rel, sha] of Object.entries(r.files)) { inside(path.dirname(file(a.source.receipt)), rel); hash(path.posix.join(path.posix.dirname(a.source.receipt), rel), sha); }
      checked.add(a.source.receipt);
    }
    if (a.source.receipt) {
      const r = JSON.parse(fs.readFileSync(file(a.source.receipt), 'utf8'));
      const dir = path.posix.dirname(a.source.receipt) + '/';
      for (const f of a.source.files) if (!f.path.startsWith(dir) || r.files[f.path.slice(dir.length)] !== f.sha256) throw Error('source not owned by snapshot: ' + a.id);
    }
    if (!Array.isArray(a.consumers)) throw Error(`missing consumers: ${a.id}`);
    for (const c of a.consumers) {
      if (!c.path?.startsWith(engine + '/') || !['runtime-reference','legacy-installed-unused','procedural-runtime'].includes(c.kind)) throw Error(`invalid consumer: ${a.id}`);
      file(c.path); evidence(c.evidence, `consumer ${a.id}`);
    }
  });
  for (const legacy of config.assets.legacy_receipts || []) attempt(() => {
    if (!legacy.reason || !legacy.review_when || !legacy.path?.startsWith(engine + '/assets/')) throw Error('invalid legacy exception');
    if (receipts.has(legacy.path)) throw Error('duplicate legacy receipt');
    const r = JSON.parse(fs.readFileSync(file(legacy.path), 'utf8'));
    if (r.contract !== 'gamepresentation-godot-v1' || !Array.isArray(r.assets)) throw Error(`unsupported legacy receipt: ${legacy.path}`);
    const parent = path.posix.dirname(legacy.path);
    for (const [rel, sha] of Object.entries(r.files)) { inside(path.dirname(file(legacy.path)), rel); hash(parent + '/' + rel, sha); }
    for (const asset of r.assets) {
      const match = catalog.assets.find(a => a.source.upstream_id === asset.asset_id && a.consumers.some(c => c.path === parent + '/' + asset.path));
      if (!match) throw Error(`unregistered legacy asset: ${asset.asset_id}`);
      if (r.files[asset.path] !== asset.delivered_sha256) throw Error(`receipt media hash inconsistency: ${asset.asset_id}`);
    }
    receipts.set(legacy.path, r);
    warnings.push(`legacy installed bundle: ${r.bundle}; ${legacy.review_when}`);
  });
  const newReleases=inspectReleases({root,config,catalog,file,hash,inside});
  errors.push(...newReleases.errors);warnings.push(...newReleases.warnings);
  for(const [p,r] of newReleases.receipts)receipts.set(p,r);
  attempt(() => {
    const known = new Set([...receipts].flatMap(([p, r]) => Object.keys(r.files).map(f => path.posix.dirname(p) + '/' + f)));
    const walk = rel => {
      const p = inside(root, rel);
      if (!fs.existsSync(p)) return;
      for (const e of fs.readdirSync(p, {withFileTypes:true})) {
        const child = rel + '/' + e.name; inside(root, child);
        if (e.isDirectory()) walk(child);
        else if (/\.(png|jpg|jpeg|webp|svg|wav|ogg|mp3|ttf|otf|glb|gltf)$/i.test(e.name) && !known.has(child)) throw Error(`unregistered runtime media: ${child}`);
        else if (e.name === 'receipt.json' && !receipts.has(child)) throw Error(`unregistered runtime receipt: ${child}`);
      }
    };
    walk(engine + '/assets');
  });
  const contract = config.assets.workflow_contract;
  if (!contract || !fs.existsSync(path.resolve(root, contract))) warnings.push('workflow contract unavailable: preserve sources, do not publish; configure a verified contract before asset delivery');
  return {errors, warnings, counts:{assets:catalog.assets.length, source_snapshots:checked.size, legacy_bundles:(config.assets.legacy_receipts??[]).length,workbench_bundles:newReleases.receipts.size}};
}
