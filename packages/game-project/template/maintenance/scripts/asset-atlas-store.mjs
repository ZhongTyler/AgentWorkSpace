import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inside } from './check-assets.mjs';
export const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const mediaTypes = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ogg', '.wav', '.mp3', '.mp4', '.webm', '.ttf', '.otf']);
export const demandStages = ['clarify', 'queued', 'working', 'self-review', 'producer-review', 'revise', 'accepted', 'archived'];
export const categories = ['角色', '敌人', '物件', '场景', 'UI', '页面', '图标', '动作', '特效', 'UI动效', '声音', '字体', '参考'];
export function filesUnder(root, relative) {
  const start = inside(root, relative);
  if (!fs.existsSync(start)) return [];
  const result = [];
  function visit(folder) {
    for (const item of fs.readdirSync(folder, {
      withFileTypes: true
    })) {
      if (item.isSymbolicLink()) continue;
      const file = path.join(folder, item.name);
      if (item.isDirectory()) visit(file);else result.push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  visit(start);
  return result;
}
export function categoryFor(asset) {
  if (asset.atlas?.category) return asset.atlas.category;
  if (asset.id.startsWith('audio.') || /sound|jingle/.test(asset.id)) return '声音';
  if (/font|noto:/.test(asset.id)) return '字体';
  if (/\.action$/.test(asset.id)) return '动作';
  if (asset.id.startsWith('hero.')) return '角色';
  if (asset.id.startsWith('enemy.')) return '敌人';
  if (/obstacle|board.grid/.test(asset.id)) return '物件';
  if (/scene\./.test(asset.id)) return '场景';
  if (/^fx\./.test(asset.id)) return '特效';
  if (/reference/.test(asset.id)) return '参考';
  return 'UI';
}
export function versionKey(version) {
  return hash(JSON.stringify({
    id: version.id,
    files: version.files,
    binding: version.binding || null
  }));
}
export function readAtlas(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'maintenance/project-config.json'), 'utf8'));
  const base = config.assets.directory;
  const catalogPath = inside(root, base + '/catalog.json');
  const bytes = fs.readFileSync(catalogPath);
  const catalog = JSON.parse(bytes);
  const state = catalog.atlas || {
    schema_version: 1,
    reviews: [],
    events: [],
    scenes: []
  };
  const installed = new Map();
  const releaseVersions = new Map();
  const warnings = [];
  const checkedFiles = new Map();
  function validFile(file) {
    if (!file?.path || !file.sha256) return false;
    const key = file.path + ':' + file.sha256;
    if (checkedFiles.has(key)) return checkedFiles.get(key);
    try {
      const target = inside(root, file.path);
      const valid = fs.existsSync(target) && hash(fs.readFileSync(target)) === file.sha256;
      checkedFiles.set(key, valid);
      return valid;
    } catch {
      checkedFiles.set(key, false);
      return false;
    }
  }
  const engineAssets = config.engine.directory + '/assets';
  for (const receipt of filesUnder(root, engineAssets).filter(p => /\/receipt\.json$/.test(p) && !p.includes('/licenses/'))) {
    const data = JSON.parse(fs.readFileSync(inside(root, receipt), 'utf8'));
    for (const item of data.assets || []) {
      const file = path.posix.join(path.posix.dirname(receipt), item.path);
      const row = {
        receipt,
        path: file,
        release: item.release || null,
        sha256: item.delivered_sha256,
        verified: validFile({
          path: file,
          sha256: item.delivered_sha256
        })
      };
      if (!installed.has(item.asset_id)) installed.set(item.asset_id, []);
      installed.get(item.asset_id).push(row);
    }
  }
  for (const release of filesUnder(root, base + '/releases').filter(p => p.endsWith('/release.json'))) {
    const data = JSON.parse(fs.readFileSync(inside(root, release), 'utf8'));
    for (const item of data.assets || []) {
      const version = {
        id: 'release:' + data.bundle + ':' + data.revision,
        label: '交付 ' + data.bundle + '/' + data.revision,
        kind: 'release',
        evidence: [release],
        files: [{
          path: path.posix.join(path.posix.dirname(release), item.path),
          sha256: item.delivered_sha256
        }]
      };
      if (!releaseVersions.has(item.asset_id)) releaseVersions.set(item.asset_id, []);
      releaseVersions.get(item.asset_id).push(version);
    }
  }
  const pages = JSON.parse(fs.readFileSync(path.join(root, base, 'atlas-pages.json'), 'utf8')).pages;
  const assets = catalog.assets.map(asset => {
    const versions = [...(asset.atlas?.versions || [])];
    if (asset.source.files.length) versions.push({
      id: 'source:' + asset.source.version,
      label: '来源 ' + asset.source.version,
      kind: 'source',
      files: asset.source.files,
      evidence: asset.source.receipt ? [asset.source.receipt] : []
    });
    versions.push(...(releaseVersions.get(asset.id) || []));
    const seen = new Set();
    const unique = versions.filter(v => !seen.has(v.id) && seen.add(v.id)).map(v => {
      const key = versionKey(v);
      const reviews = state.reviews.filter(r => r.asset_id === asset.id && r.version_key === key);
      return {
        ...v,
        key,
        verified: v.files.every(validFile),
        reviews,
        decision: reviews.at(-1)?.decision || 'pending'
      };
    });
    const actual = installed.get(asset.id) || [];
    const current = unique.find(v => v.id === asset.atlas?.current_version) || unique.find(v => v.kind === 'candidate') || unique[0];
    const visual = current?.decision;
    const stage = asset.atlas?.demand_stage || {
      planned: 'queued',
      acquired: 'self-review',
      working: 'working',
      review: 'producer-review',
      ready: 'accepted',
      retired: 'archived'
    }[asset.stage];
    const evidence = [...new Set([asset.spec, ...Object.values(asset.gates).flatMap(g => g.evidence || []), ...(asset.consumers || []).flatMap(c => c.evidence || [])])];
    return {
      ...asset,
      name: asset.atlas?.name || asset.id,
      category: pages.some(p => p.states.some(s => s.asset_id === asset.id)) ? '页面' : categoryFor(asset),
      versions: unique,
      current_version: current?.id || null,
      demand_stage: ['revise', 'rejected'].includes(visual) ? 'revise' : visual === 'adopted' ? 'accepted' : stage,
      installation: actual.length ? actual.every(x => x.verified) ? 'installed' : 'drift' : asset.consumers.some(c => c.kind === 'procedural-runtime') ? 'procedural-reference' : 'not-installed',
      installed: actual,
      evidence
    };
  });
  const known = new Set(assets.flatMap(a => a.versions.flatMap(v => v.files.map(f => f.path))));
  const media = filesUnder(root, base).filter(p => mediaTypes.has(path.extname(p).toLowerCase()));
  const unassigned = media.filter(p => !known.has(p));
  for (const a of assets) for (const v of a.versions) if (!v.verified) warnings.push(a.id + ' / ' + v.id + ' 文件缺失或内容已变');
  return {
    revision: hash(bytes),
    project: config.project,
    assets,
    state,
    categories,
    demandStages,
    unassigned,
    warnings,
    media_count: media.length,
    base,
    engine: config.engine.directory
  };
}
export function checkAtlas(root) {
  const errors = [];
  try {
    const view = readAtlas(root);
    errors.push(...view.warnings);
    const archive = JSON.parse(fs.readFileSync(inside(root, view.base + '/atlas-media-archive.json'), 'utf8'));
    if (archive.schema_version !== 1 || !Array.isArray(archive.files)) throw Error('媒体归档格式无效');
    const archivedPaths = new Set();
    for (const file of archive.files) {
      if (typeof file.path !== 'string' || !file.path.startsWith(view.base + '/') || archivedPaths.has(file.path) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isFinite(Date.parse(file.archived_at))) throw Error('媒体归档身份或哈希无效');
      archivedPaths.add(file.path);
      const actual = inside(root, file.path);
      if (!fs.existsSync(actual) || hash(fs.readFileSync(actual)) !== file.sha256) errors.push('归档媒体缺失或内容变化 ' + file.path);
    }
    const ids = new Set(view.assets.map(a => a.id));
    const pages = JSON.parse(fs.readFileSync(inside(root, view.base + '/atlas-pages.json'), 'utf8'));
    if (pages.schema_version !== 1 || !Array.isArray(pages.pages)) throw Error('页面需求格式无效');
    const pageIds = new Set();
    const assigned = new Set();
    for (const page of pages.pages) {
      if (!page.id || pageIds.has(page.id) || !page.system || !page.name || !Array.isArray(page.states) || !Array.isArray(page.components) || !Array.isArray(page.resources) || !Array.isArray(page.requirements)) throw Error('页面需求身份或内容无效');
      pageIds.add(page.id);
      const states = new Set(page.states.map(s => s.id));
      const components = new Set(page.components.map(c => c.id));
      if (states.size !== page.states.length || components.size !== page.components.length) throw Error('页面状态或组件ID重复');
      for (const state of page.states) {
        if (!ids.has(state.asset_id) || !Array.isArray(state.conditions) || !Array.isArray(state.resources) || !Array.isArray(state.related) || !Array.isArray(state.component_ids)) throw Error('页面状态资源/条件无效');
        if (state.related.some(id => !states.has(id)) || state.component_ids.some(id => !components.has(id)) || state.resources.some(id => !ids.has(id))) throw Error('页面状态关联不存在');
        assigned.add(state.asset_id);
      }
      for (const component of page.components) {
        if (!ids.has(component.asset_id) || !Array.isArray(component.applies_to) || component.applies_to.some(id => !states.has(id))) throw Error('页面控件关联不存在');
        for (const state of page.states) if (state.component_ids.includes(component.id) !== component.applies_to.includes(state.id)) throw Error('页面状态与控件关联不一致');
        assigned.add(component.asset_id);
      }
      if (page.resources.some(id => !ids.has(id))) throw Error('页面需求引用了不存在的资源');
    }
    for (const asset of view.assets) if (asset.atlas?.composition && !assigned.has(asset.id)) errors.push('组合资源尚未归属页面需求 ' + asset.id);
    for (const asset of view.assets) {
      const versions = asset.versions.map(v => v.id);
      if (new Set((asset.atlas?.versions || []).map(v => v.id)).size !== (asset.atlas?.versions || []).length) errors.push('重复图册版本 ' + asset.id);
      if (asset.atlas?.current_version && !versions.includes(asset.atlas.current_version)) errors.push('当前版本不存在 ' + asset.id);
      if (asset.atlas?.category && !categories.includes(asset.atlas.category)) errors.push('类型无效 ' + asset.id);
      if (asset.atlas?.demand_stage && !demandStages.includes(asset.atlas.demand_stage)) errors.push('制作进度无效 ' + asset.id);
      if (asset.installation === 'drift') errors.push('安装内容漂移 ' + asset.id);
    }
    for (const id of view.state.scenes || []) if (!ids.has(id)) errors.push('状态组合资源不存在 ' + id);
    for (const review of view.state.reviews) {
      const asset = view.assets.find(a => a.id === review.asset_id);
      if (!asset?.versions.some(v => v.key === review.version_key)) errors.push('审阅版本已无法核对 ' + review.asset_id);
    }
    for (const file of [view.base + '/index.html', view.base + '/atlas-changelog.md', 'maintenance/previews/open-asset-atlas.cmd']) if (!fs.existsSync(inside(root, file))) errors.push('缺少图册入口 ' + file);
    return {
      errors,
      assets: view.assets.length,
      versions: view.assets.reduce((n, a) => n + a.versions.length, 0),
      unassigned: view.unassigned.length
    };
  } catch (error) {
    return {
      errors: [error.message]
    };
  }
}
function bounded(value, maximum = 12000) {
  if (typeof value !== 'string' || value.length > maximum) throw Error('文字格式或长度不合法');
  return value.trim();
}
export function changeAtlas(root, expected, action) {
  const config = JSON.parse(fs.readFileSync(path.join(root, 'maintenance/project-config.json'), 'utf8'));
  const file = inside(root, config.assets.directory + '/catalog.json');
  const bytes = fs.readFileSync(file);
  if (hash(bytes) !== expected) {
    const error = Error('项目资料已更新，请刷新后重试。当前填写内容仍保留在页面。');
    error.status = 409;
    throw error;
  }
  const catalog = JSON.parse(bytes);
  catalog.atlas ||= {
    schema_version: 1,
    reviews: [],
    events: [],
    scenes: []
  };
  const state = catalog.atlas;
  const asset = catalog.assets.find(a => a.id === action.asset_id);
  const event = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    operation: action.operation,
    asset_id: action.asset_id,
    actor: bounded(action.actor || '制作人', 100)
  };
  if (action.operation === 'curate') {
    if (!Array.isArray(action.patches) || !Array.isArray(action.additions || [])) throw Error('登记梳理计划无效');
    const known = new Set(catalog.assets.map(a => a.id));
    for (const added of action.additions || []) {
      if (!added.id || known.has(added.id) || added.source?.kind !== 'procedural' || added.source.files?.length || added.stage !== 'working') throw Error('新增登记只允许有实现依据的程序表现');
      if (!added.consumers?.length || added.consumers.some(c => !fs.existsSync(inside(root, c.path)))) throw Error('新增程序登记缺少有效实现');
      known.add(added.id);
      catalog.assets.push(added);
    }
    const allowed = new Set(['name','category','demand_stage','requirement','required_states','dynamic','registration_role','parent_ids','reuse_with','reuse_note','status_basis','audit_note','current_version','subcategory','usage_key']);
    for (const patch of action.patches) {
      const target = catalog.assets.find(a => a.id === patch.asset_id);
      if (!target || !patch.atlas || Object.keys(patch.atlas).some(k => !allowed.has(k))) throw Error('登记梳理字段越界');
      if (!categories.includes(patch.atlas.category) || !demandStages.includes(patch.atlas.demand_stage)) throw Error('登记梳理类型或状态无效');
      if (patch.atlas.demand_stage === 'accepted' && target.stage !== 'ready') throw Error('梳理不能新增采用结论');
      for (const key of ['parent_ids','reuse_with']) if ((patch.atlas[key] || []).some(id => !known.has(id) || id === target.id)) throw Error('梳理关系无效');
      for (const key of ['status_basis']) if ((patch.atlas[key] || []).some(p => !fs.existsSync(inside(root, p)))) throw Error('梳理依据不存在');
      if (!bounded(patch.atlas.name,200) || !bounded(patch.atlas.requirement)) throw Error('梳理名称或说明为空');
      target.atlas = {...target.atlas, ...patch.atlas};
      for (const consumer of patch.consumers_add || []) {
        if (!fs.existsSync(inside(root, consumer.path))) throw Error('新增实现入口不存在');
        if (!target.consumers.some(c => c.path === consumer.path)) target.consumers.push(consumer);
      }
    }
    if (action.audit_targets) state.audit_targets = action.audit_targets;
    if (action.coverage_rules) state.coverage_rules = action.coverage_rules;
    event.note = bounded(action.note || '登记元数据梳理');
  } else if (action.operation === 'review' || action.operation === 'review-many') {
    if (!['pending', 'adopted', 'revise', 'rejected'].includes(action.decision)) throw Error('审阅决定不合法');
    if (!bounded(action.scope || '', 1000)) throw Error('请填写采用用途或审阅范围');
    const targets = action.operation === 'review' ? [action] : action.targets;
    if (!Array.isArray(targets) || !targets.length || targets.length > 300) throw Error('请选择1至300个版本');
    const view = readAtlas(root);
    const pending = targets.map(target => {
      const resource = view.assets.find(a => a.id === target.asset_id);
      const version = resource?.versions.find(v => v.id === target.version_id && v.key === target.version_key);
      if (!version || !version.verified) throw Error('版本已变更或文件未通过核对，请重新审阅');
      return {
        ...event,
        id: crypto.randomUUID(),
        asset_id: resource.id,
        version_id: version.id,
        version_key: version.key,
        decision: action.decision,
        scope: bounded(action.scope, 1000),
        note: bounded(action.note || '')
      };
    });
    state.reviews.push(...pending);
    state.events.push(...pending);
  } else if (action.operation === 'demand' || action.operation === 'create') {
    let target = asset;
    if (action.operation === 'create') {
      if (asset || !/^[a-z0-9][a-z0-9._:-]*$/.test(action.asset_id || '')) throw Error('ID无效或已存在');
      target = {
        id: action.asset_id,
        object_id: bounded(action.object_id || action.asset_id, 200),
        purpose: bounded(action.purpose || '待细化用途', 500),
        spec: config.assets.directory + '/specs/asset-spec-template.md',
        owner: config.project.id,
        priority: 'P1',
        stage: 'planned',
        source: {
          kind: 'planned',
          version: 'unproduced',
          files: []
        },
        references: [],
        work_path: null,
        desired_release: null,
        consumers: [],
        gates: Object.fromEntries(['concept', 'purpose', 'technical', 'rights'].map(k => [k, {
          status: 'pending',
          evidence: []
        }]))
      };
      catalog.assets.push(target);
    }
    if (!target) throw Error('资源不存在');
    if (!categories.includes(action.category) || !demandStages.includes(action.demand_stage)) throw Error('类型或制作进度无效');
    if (!['P0', 'P1', 'P2'].includes(action.priority)) throw Error('优先级无效');
    if (action.demand_stage === 'accepted') {
      const current = readAtlas(root).assets.find(a => a.id === target.id);
      const version = current?.versions.find(v => v.id === current.current_version);
      if (!(target.stage === 'ready' && !target.atlas?.current_version) && version?.decision !== 'adopted') throw Error('采用状态需要当前版本的审阅记录');
    }
    target.priority = action.priority;
    target.atlas = {
      ...target.atlas,
      registration_role: target.atlas?.registration_role || 'demand',
      name: bounded(action.name, 200),
      category: action.category,
      demand_stage: action.demand_stage,
      requirement: bounded(action.requirement || ''),
      dynamic: bounded(action.dynamic || ''),
      required_states: bounded(action.required_states || '', 2000)
    };
    if (!target.atlas.name) throw Error('请填写资源名称');
    if (action.demand_stage === 'archived') {
      const view = readAtlas(root).assets.find(a => a.id === target.id);
      if (view?.installed.length || target.consumers.length) throw Error('资源仍有工程引用，请先按维护流程解除引用后归档');
      target.stage = 'retired';
    }
  } else if (action.operation === 'version') {
    if (!asset) throw Error('资源不存在');
    const id = bounded(action.version_id, 100);
    if (!/^[a-z0-9][a-z0-9._:-]*$/i.test(id)) throw Error('版本ID不合法');
    if ((asset.atlas?.versions || []).some(v => v.id === id) || id.startsWith('source:') || id.startsWith('release:')) throw Error('版本ID已存在或保留');
    if (!Array.isArray(action.files) || !action.files.length || action.files.length > 64) throw Error('请选择1至64个项目资源文件');
    const files = action.files.map(rel => {
      const p = inside(root, rel);
      if (!rel.startsWith(config.assets.directory + '/') || !mediaTypes.has(path.extname(rel).toLowerCase()) || !fs.statSync(p).isFile()) throw Error('版本文件必须是资源工作台中的媒体');
      return {
        path: rel,
        sha256: hash(fs.readFileSync(p))
      };
    });
    asset.atlas ||= {};
    asset.atlas.versions ||= [];
    asset.atlas.versions.push({
      id,
      label: bounded(action.label || id, 200),
      kind: 'candidate',
      files,
      evidence: [],
      note: bounded(action.note || '')
    });
    asset.atlas.current_version = id;
    asset.atlas.demand_stage = 'self-review';
    if (!asset.atlas.registration_role || asset.atlas.registration_role === 'demand') asset.atlas.registration_role = 'deliverable';
  } else throw Error('操作不支持');
  if (!['review', 'review-many'].includes(action.operation)) state.events.push(event);
  const next = JSON.stringify(catalog, null, 2) + '\n';
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, next, {
      flag: 'wx'
    });
    if (hash(fs.readFileSync(file)) !== expected) {
      const error = Error('保存期间资料发生变化，请刷新重试');
      error.status = 409;
      throw error;
    }
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  return {
    revision: hash(Buffer.from(next)),
    event
  };
}
