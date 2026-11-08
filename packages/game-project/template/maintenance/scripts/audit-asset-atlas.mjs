import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAtlas, filesUnder, hash, mediaTypes } from './asset-atlas-store.mjs';

export function auditAtlas(root) {
  const view = readAtlas(root);
  const raw = JSON.parse(fs.readFileSync(path.join(root, view.base, 'catalog.json')));
  const config = JSON.parse(fs.readFileSync(path.join(root, 'maintenance/project-config.json')));
  const errors = [];
  const warnings = [];
  const issues = new Map(view.assets.map(a => [a.id, []]));
  function issue(id, code, message) {
    const item = {asset_id: id, code, message};
    errors.push(item);
    if (issues.has(id)) issues.get(id).push(code);
  }
  const byId = new Map(view.assets.map(a => [a.id, a]));
  const roles = new Set(['deliverable', 'source', 'composition', 'procedural', 'demand', 'reference', 'historical']);
  const hashes = new Map();
  const missing = [];
  for (const a of view.assets) {
    const metadata = a.atlas || {};
    const current = a.versions.find(v => v.id === a.current_version);
    if (!metadata.name || metadata.name === a.id) issue(a.id, 'unclear-name', '缺少可读名称');
    if (!metadata.requirement || metadata.requirement.length < 16) issue(a.id, 'unclear-description', '缺少明确用途与范围说明');
    if (!roles.has(metadata.registration_role)) issue(a.id, 'registration-role', '未明确登记用途或来源层级');
    for (const parent of metadata.parent_ids || []) {
      if (!byId.has(parent) || parent === a.id) issue(a.id, 'parent-reference', '来源关系不存在或指向自身');
    }
    for (const evidence of metadata.status_basis || []) if (!fs.existsSync(path.join(root, evidence))) issue(a.id, 'status-evidence-missing', '采用依据文件不存在');
    const bound = current?.binding?.source;
    if (bound && !(metadata.parent_ids || []).length) issue(a.id, 'missing-source-relation', '加工版本未关联来源登记');
    if (bound && (metadata.parent_ids || []).length && !metadata.parent_ids.some(id => byId.get(id)?.source.files.some(p => a.source.files.some(f => f.sha256 === p.sha256)))) issue(a.id, 'source-binding-mismatch', '来源关系与加工输入不一致');
    if (metadata.registration_role === 'source' && !view.assets.some(child => child.atlas?.parent_ids?.includes(a.id))) issue(a.id, 'orphan-source', '来源图板没有对应组件');
    if (a.source.kind === 'procedural' && metadata.registration_role !== 'historical') {
      if (!metadata.dynamic || metadata.dynamic.length < 16 || !a.consumers.length) issue(a.id, 'unclear-procedural', '程序表现缺少触发、效果或实现入口');
    }
    for (const consumer of a.consumers) {
      if (!fs.existsSync(path.join(root, consumer.path))) issue(a.id, 'consumer-missing', '登记的消费者文件不存在');
    }
    if (a.demand_stage === 'accepted' && current?.decision !== 'adopted') {
      if (a.stage !== 'ready' || !Object.values(a.gates).every(g => g.status === 'pass') || !metadata.status_basis?.length) issue(a.id, 'unsupported-acceptance', '采用状态缺少版本审阅或原有四门与依据');
      if (a.versions.some(v => v.kind === 'release') && current?.kind !== 'release') issue(a.id, 'wrong-current-version', '已交付资源默认打开了来源或旧加工版本');
    }
    if (a.stage === 'retired' && a.demand_stage !== 'archived') issue(a.id, 'retired-state', '退役记录的制作状态矛盾');
    const extension = current?.files[0] && path.extname(current.files[0].path).toLowerCase();
    if (['.wav', '.ogg', '.mp3'].includes(extension) && a.category !== '声音') issue(a.id, 'media-category', '音频登记类型不符');
    if (['.otf', '.ttf'].includes(extension) && a.category !== '字体') issue(a.id, 'media-category', '字体登记类型不符');
    if (!['source', 'historical'].includes(metadata.registration_role)) {
      for (const f of current?.files || []) {
        if (!hashes.has(f.sha256)) hashes.set(f.sha256, new Set());
        hashes.get(f.sha256).add(a.id);
      }
    }
  }
  const done = new Set();
  function visit(id, pending = new Set()) {
    if (pending.has(id)) { issue(id, 'source-cycle', '来源关系形成循环'); return; }
    if (done.has(id)) return;
    const next = new Set(pending).add(id);
    for (const parent of byId.get(id)?.atlas?.parent_ids || []) if (byId.has(parent)) visit(parent, next);
    done.add(id);
  }
  for (const a of view.assets) visit(a.id);
  const shared = [...hashes].filter(([, ids]) => ids.size > 1).map(([sha256, ids]) => ({sha256, ids: [...ids]}));
  for (const group of shared) {
    const resources = group.ids.map(id => byId.get(id));
    const explicit = resources.every(a => a.atlas?.reuse_note && (a.atlas?.reuse_with || []).some(id => group.ids.includes(id) && id !== a.id));
    if (!explicit) for (const a of resources) issue(a.id, 'unexplained-duplicate', '同哈希跨用途复用缺少关系与说明');
  }
  const signatures = new Map();
  for (const a of view.assets) {
    if (['source', 'historical'].includes(a.atlas?.registration_role)) continue;
    const key = [a.object_id, a.category, a.atlas?.usage_key || a.purpose].join('|');
    if (signatures.has(key)) issue(a.id, 'duplicate-purpose', '同对象、同类型与同用途重复登记 ' + signatures.get(key));
    signatures.set(key, a.id);
  }
  const engine = config.engine.directory + '/assets';
  const knownHashes = new Set(view.assets.flatMap(a => a.versions.flatMap(v => v.files.map(f => f.sha256))));
  const engineMedia = filesUnder(root, engine).filter(p => mediaTypes.has(path.extname(p).toLowerCase()));
  for (const file of engineMedia) {
    if (!knownHashes.has(hash(fs.readFileSync(path.join(root, file))))) missing.push({kind:'engine-media', path:file});
  }
  for (const folder of [engine, view.base + '/releases']) {
    for (const file of filesUnder(root, folder).filter(p => /\/(receipt|release)\.json$/.test(p))) {
      const manifest = JSON.parse(fs.readFileSync(path.join(root, file)));
      for (const item of manifest.assets || []) if (!byId.has(item.asset_id)) missing.push({kind:'manifest-id', path:file, asset_id:item.asset_id});
    }
  }
  for (const target of raw.atlas?.audit_targets || []) {
    if (!view.assets.some(a => a.consumers.some(c => c.path === target.path))) missing.push({kind:'program-target', path:target.path});
  }
  const coverage = [];
  for (const rule of raw.atlas?.coverage_rules || []) {
    const content = JSON.parse(fs.readFileSync(path.join(root, rule.path)));
    const entries = rule.collection.split('.').reduce((value, key) => value?.[key], content);
    if (!Array.isArray(entries)) throw Error('覆盖核对集合不存在 ' + rule.collection);
    for (const entry of entries) {
      const id = rule.prefix + entry.id + (rule.suffix || '');
      const registered = byId.has(id);
      coverage.push({source:rule.path, collection:rule.collection, content_id:entry.id, asset_id:id, registered});
      if (!registered) missing.push({kind:'content-coverage', path:rule.path, asset_id:id});
    }
  }
  for (const item of missing) errors.push({code:'missing-registration', ...item, message:'实际消费者或交付记录缺少登记'});
  const archiveFile = path.join(root, view.base, 'atlas-media-archive.json');
  const archived = new Set(JSON.parse(fs.readFileSync(archiveFile)).files.map(f => f.path));
  const unassigned = view.unassigned.filter(p => !archived.has(p));
  if (unassigned.length) warnings.push({code:'unassigned-media', count:unassigned.length, message:'新增媒体需核对用途或归档'});
  return {
    result: errors.length ? 'fail' : 'pass', errors, warnings, engine_media:engineMedia.length,
    shared_current_media:shared, unassigned_media:unassigned, coverage,
    rows:view.assets.map(a => ({id:a.id, name:a.name, category:a.category, stage:a.demand_stage, role:a.atlas?.registration_role, current_version:a.current_version, parents:a.atlas?.parent_ids || [], purpose:a.atlas?.requirement || a.purpose, consumers:a.consumers.map(c=>c.path), issues:issues.get(a.id)}))
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = auditAtlas(path.resolve(process.argv[2] || '.'));
    const outputIndex = process.argv.indexOf('--output');
    if (outputIndex >= 0) fs.writeFileSync(process.argv[outputIndex + 1], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({result:report.result, rows:report.rows.length, errors:report.errors.length, warnings:report.warnings.length, engine_media:report.engine_media}));
    process.exitCode = report.errors.length ? 1 : 0;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
