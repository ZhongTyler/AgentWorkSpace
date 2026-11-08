import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startAtlas } from './asset-atlas.mjs';
import { hash, readAtlas, changeAtlas, checkAtlas } from './asset-atlas-store.mjs';
import { archiveMedia } from './archive-atlas-media.mjs';
const root = path.resolve(process.argv[2] || '.');
const argument = name => {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? undefined : process.argv[index + 1];
};
const evidence = path.resolve(argument('evidence'));
if (fs.existsSync(evidence)) throw Error('Choose a new evidence directory');
fs.mkdirSync(evidence, {
  recursive: true
});
fs.writeFileSync(path.join(evidence, 'README.md'), '# 资源图册验证\n\n结果由result.json记录，截图用于实际布局自审。\n\n## 目录\n\n无下级目录。\n');
const results = [];
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-atlas-test-'));
let browser, realService, fixtureService;
function pass(name) {
  results.push(name);
}
try {
  const template = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  for (const rel of ['assets/index.html', 'assets/atlas-changelog.md', 'assets/atlas-pages.json', 'assets/atlas-media-archive.json']) {
    fs.mkdirSync(path.dirname(path.join(fixture, rel)), {
      recursive: true
    });
    fs.copyFileSync(path.join(template, rel), path.join(fixture, rel));
  }
  fs.mkdirSync(path.join(fixture, 'maintenance'), {
    recursive: true
  });
  fs.writeFileSync(path.join(fixture, 'maintenance/project-config.json'), JSON.stringify({
    project: {
      id: 'fixture',
      name: '测试项目'
    },
    assets: {
      directory: 'assets'
    },
    engine: {
      directory: 'Game'
    }
  }));
  fs.writeFileSync(path.join(fixture, 'assets/catalog.json'), JSON.stringify({
    schema_version: 1,
    assets: []
  }));
  fs.writeFileSync(path.join(fixture, 'assets/atlas-media-archive.json'), JSON.stringify({schema_version:1, files:[]}));
  let view = readAtlas(fixture);
  const create = {
    operation: 'create',
    asset_id: 'test.actor',
    object_id: 'test',
    name: '测试角色',
    category: '角色',
    demand_stage: 'queued',
    priority: 'P1',
    requirement: '尺寸64，透明底',
    required_states: '待机、攻击',
    dynamic: '触发后播放，支持中断'
  };
  changeAtlas(fixture, view.revision, create);
  assert.equal(readAtlas(fixture).assets[0].atlas.requirement, create.requirement);
  pass('new requirement persists');
  assert.throws(() => changeAtlas(fixture, view.revision, {
    ...create,
    asset_id: 'test.second'
  }), /项目资料已更新/);
  pass('stale revision rejected without losing data');
  view = readAtlas(fixture);
  const real = readAtlas(root);
  const picture = real.assets.flatMap(a => a.versions).flatMap(v => v.files).find(f => f.path.endsWith('.png'));
  if (picture) {
    fs.copyFileSync(path.join(root, picture.path), path.join(fixture, 'assets/picture.png'));
  } else {
    // One-pixel decoder fixture keeps an empty template independently testable.
    fs.writeFileSync(path.join(fixture, 'assets/picture.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV1sAAAAASUVORK5CYII=', 'base64'));
  }
  changeAtlas(fixture, view.revision, {
    operation: 'version',
    asset_id: 'test.actor',
    version_id: 'v1',
    label: '候选1',
    files: ['assets/picture.png'],
    note: '首版'
  });
  view = readAtlas(fixture);
  let version = view.assets[0].versions[0];
  changeAtlas(fixture, view.revision, {
    operation: 'review',
    asset_id: 'test.actor',
    version_id: version.id,
    version_key: version.key,
    decision: 'adopted',
    scope: '地图用途64px',
    note: '采用',
    actor: '测试制作人'
  });
  view = readAtlas(fixture);
  assert.equal(view.assets[0].demand_stage, 'accepted');
  assert.equal(view.assets[0].stage, 'planned');
  assert.equal(view.assets[0].installation, 'not-installed');
  pass('visual adoption persists without forging delivery or installation');
  fs.copyFileSync(path.join(fixture, 'assets/picture.png'), path.join(fixture, 'assets/picture2.png'));
  changeAtlas(fixture, view.revision, {
    operation: 'version',
    asset_id: 'test.actor',
    version_id: 'v2',
    label: '候选2',
    files: ['assets/picture2.png']
  });
  view = readAtlas(fixture);
  assert.equal(view.assets[0].versions.find(v => v.id === 'v1').decision, 'adopted');
  assert.equal(view.assets[0].versions.find(v => v.id === 'v2').decision, 'pending');
  pass('new version retains old decision and starts pending');
  const saved = fs.readFileSync(path.join(fixture, 'assets/catalog.json'));
  assert.throws(() => changeAtlas(fixture, view.revision, {
    operation: 'version',
    asset_id: 'test.actor',
    version_id: 'v3',
    files: ['assets/../picture.png']
  }), /unsafe path/);
  assert.equal(hash(saved), hash(fs.readFileSync(path.join(fixture, 'assets/catalog.json'))));
  pass('unsafe paths cannot mutate catalog');
  version = view.assets[0].versions.find(v => v.id === 'v2');
  assert.throws(() => changeAtlas(fixture, view.revision, {
    operation: 'review-many',
    decision: 'adopted',
    scope: '测试',
    targets: [{
      asset_id: 'test.actor',
      version_id: 'v2',
      version_key: version.key
    }, {
      asset_id: 'missing',
      version_id: 'x',
      version_key: 'x'
    }]
  }), /版本已变更/);
  assert.equal(hash(saved), hash(fs.readFileSync(path.join(fixture, 'assets/catalog.json'))));
  pass('batch review rejects all if any target is invalid');
  fixtureService = await startAtlas(fixture);
  let response = await fetch(fixtureService.url + '/api/state');
  let state = await response.json();
  assert.equal(state.state.reviews.length, 1);
  pass('restart reads saved requirements and review');
  response = await fetch(fixtureService.url + '/api/change', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: '{}'
  });
  assert.equal(response.status, 400);
  pass('save requires local session token');
  response = await fetch(fixtureService.url + '/api/state', {
    headers: {
      Origin: 'https://untrusted.invalid'
    }
  });
  assert.equal(response.status, 400);
  pass('foreign origin rejected');
  response = await fetch(fixtureService.url + '/file?path=' + encodeURIComponent('../assets/catalog.json'));
  assert.equal(response.status, 400);
  pass('file traversal rejected');
  response = await fetch(fixtureService.url + '/file?path=assets/picture.png', {
    headers: {
      Range: 'bytes=0-7'
    }
  });
  assert.equal(response.status, 206);
  assert.equal((await response.arrayBuffer()).byteLength, 8);
  pass('media range request supported');
  await assert.rejects(() => startAtlas(fixture), /已运行/);
  pass('second writer cannot start');
  const require = createRequire(import.meta.url);
  const {
    chromium
  } = require(argument('playwright') || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser = await chromium.launch({
    headless: true,
    executablePath: argument('browser')
  });
  const page = await browser.newPage({
    viewport: {
      width: 1280,
      height: 900
    }
  });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  changeAtlas(fixture, readAtlas(fixture).revision, {...create, asset_id: 'test.demand'});
  fs.copyFileSync(path.join(fixture, 'assets/picture.png'), path.join(fixture, 'assets/orphan.png'));
  const catalogBeforeArchive = hash(fs.readFileSync(path.join(fixture, 'assets/catalog.json')));
  assert.equal(archiveMedia(fixture, true).additions, 1);
  assert.equal(archiveMedia(fixture, true).additions, 0);
  assert.equal(hash(fs.readFileSync(path.join(fixture, 'assets/catalog.json'))), catalogBeforeArchive);
  assert.equal(hash(fs.readFileSync(path.join(fixture, 'assets/orphan.png'))), hash(fs.readFileSync(path.join(fixture, 'assets/picture.png'))));
  pass('media archive is idempotent and preserves files and resource catalog');
  await page.goto(fixtureService.url);
  await page.locator('[data-tab="demands"]').click();
  await page.locator('[data-asset="test.demand"]').click();
  await page.locator('#demand-form [name="requirement"]').fill('浏览器保存后的需求');
  await page.locator('#demand-form button').click();
  await page.waitForFunction(() => document.querySelector('#demand-form [name="requirement"]')?.value === '浏览器保存后的需求');
  await page.reload();
  await page.locator('[data-tab="demands"]').click();
  await page.locator('[data-asset="test.demand"]').click();
  assert.equal(await page.locator('#demand-form [name="requirement"]').inputValue(), '浏览器保存后的需求');
  pass('browser form save survives reload');
  await page.locator('[data-tab="reviews"]').click();
  await page.locator('[data-asset="test.actor"]').click();
  assert.equal(await page.locator('#demand-form, #version-form').count(), 0);
  await page.locator('#review-form [name="decision"]').selectOption('revise');
  await page.locator('#review-form [name="note"]').fill('检查边缘');
  await page.locator('#review-form button').click();
  await page.waitForFunction(() => document.querySelector('#detail').textContent.includes('检查边缘'));
  assert.equal(readAtlas(fixture).state.reviews.length, 2);
  pass('browser review saves exact version');
  await page.locator('#compare').click();
  assert.equal(await page.locator('#comparison .media-box img').count(), 2);
  pass('actual version comparison displayed');
  changeAtlas(fixture, readAtlas(fixture).revision, {operation:'version',asset_id:'test.actor',version_id:'v3',label:'Agent登记版',files:['assets/picture2.png']});
  await page.reload();
  await page.locator('[data-tab="library"]').click();
  await page.locator('[data-asset="test.actor"]').click();
  assert.equal(await page.locator('#review-form, #demand-form, #version-form').count(), 0);
  assert.equal(readAtlas(fixture).assets[0].versions.length, 3);
  pass('Agent API registers a version and resource library remains read only');
  await page.locator('#close-detail').click();
  await page.locator('[data-tab="reviews"]').click();
  await page.locator('[data-select-review="test.actor"]').check();
  await page.getByText('批量审阅所选版本', {
    exact: true
  }).click();
  await page.locator('#bulk-form [name="scope"]').fill('地图用途');
  await page.locator('#bulk-form button').click();
  await page.waitForFunction(() => !document.querySelector('#create').open);
  assert.equal(readAtlas(fixture).state.reviews.length, 3);
  pass('browser batch review persists selected version');
  await page.locator('[data-tab="demands"]').click();
  await page.locator('[data-asset="test.demand"]').click();
  await page.locator('#demand-form [name="requirement"]').fill('保留未保存草稿');
  const latest = readAtlas(fixture);
  changeAtlas(fixture, latest.revision, {
    ...create,
    asset_id: 'test.other'
  });
  await page.locator('#demand-form button').click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('项目资料已更新'));
  assert.equal(await page.locator('#demand-form [name="requirement"]').inputValue(), '保留未保存草稿');
  await page.reload();
  await page.locator('[data-tab="demands"]').click();
  await page.locator('[data-asset="test.demand"]').click();
  assert.equal(await page.locator('#demand-form [name="requirement"]').inputValue(), '保留未保存草稿');
  pass('conflict retains draft across reload');
  changeAtlas(fixture, readAtlas(fixture).revision, {...create, asset_id: 'test.page', category: '页面'});
  assert.equal(readAtlas(fixture).assets.find(a => a.id === 'test.page').category, '页面');
  changeAtlas(fixture, readAtlas(fixture).revision, {operation:'version', asset_id:'test.demand', version_id:'output-v1', label:'需求产出', files:['assets/picture.png']});
  await page.reload();
  await page.locator('[data-tab="demands"]').click();
  assert.equal(await page.locator('[data-asset="test.demand"]').count(), 0);
  assert.equal(await page.locator('[data-asset="test.page"]').count(), 1);
  await page.locator('[data-tab="library"]').click();
  assert.equal(await page.locator('[data-asset="test.demand"]').count(), 1);
  assert.equal(await page.locator('#create-demand').count(), 0);
  pass('page requirements support Agent creation and generated output moves from demands to resources');
  await page.locator('[data-tab="history"]').click();
  assert.equal(await page.locator('#archive-files img').count(), 0);
  await page.locator('#media-archive summary').first().click();
  await page.locator('#archive-search').fill('orphan.png');
  assert.equal(await page.locator('#archive-files img').count(), 1);
  pass('archived media is searchable on demand');
  await page.locator('[data-tab="overview"]').click();
  const demandCount = await page.locator('[data-overview-view="demands"]').first().locator('b').textContent();
  changeAtlas(fixture, readAtlas(fixture).revision, {...create, asset_id:'test.external'});
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(count => document.querySelector('[data-overview-view="demands"] b')?.textContent === String(Number(count) + 1), demandCount);
  pass('overview refreshes after external catalog changes');
  const stageLinks = await page.locator('[data-filter-stage]').evaluateAll(buttons => buttons.map(b => ({stage:b.dataset.filterStage, view:b.dataset.overviewView, count:Number(b.dataset.count)})));
  for (const link of stageLinks) {
    await page.locator('[data-tab="overview"]').click();
    await page.locator(`[data-filter-stage="${link.stage}"][data-overview-view="${link.view}"]`).click();
    assert.equal(await page.locator('[data-asset]').count(), link.count);
  }
  pass('every overview progress link matches the destination count and clears stale filters');
  assert.equal(stageLinks.length, 8);
  assert.equal(stageLinks.find(link => link.stage === 'clarify').view, 'demands');
  assert.equal(stageLinks.find(link => link.stage === 'producer-review').view, 'reviews');
  pass('overview uses one context-specific destination per progress stage');
  changeAtlas(fixture, readAtlas(fixture).revision, {...create,asset_id:'test.sheet'});
  changeAtlas(fixture, readAtlas(fixture).revision, {operation:'version',asset_id:'test.sheet',version_id:'sheet-v1',label:'来源图板',files:['assets/picture.png']});
  changeAtlas(fixture, readAtlas(fixture).revision, {operation:'curate',patches:[
    {asset_id:'test.sheet',atlas:{name:'来源图板',category:'图标',demand_stage:'self-review',requirement:'用于测试来源关系的图板，具体组件在独立资源记录中审阅。',registration_role:'source'}},
    {asset_id:'test.actor',atlas:{name:'测试角色',category:'角色',demand_stage:'self-review',requirement:'用于验证资源来源与独立用途的角色棋子，按对应版本查看。',registration_role:'deliverable',parent_ids:['test.sheet']}}
  ]});
  await page.reload();
  await page.locator('[data-tab="library"]').click();
  assert.equal(await page.locator('[data-asset="test.sheet"]').count(),0);
  await page.locator('[data-asset="test.actor"]').click();
  await page.locator('[data-related-asset="test.sheet"]').click();
  assert.equal(await page.locator('#review-form').count(),0);
  assert.equal(await page.locator('[data-related-asset="test.actor"]').count(),1);
  await page.locator('[data-tab="history"]').click();
  await page.locator('#registration-history summary').click();
  await page.locator('#historical-cards [data-asset="test.sheet"]').waitFor();
  assert.equal(await page.locator('[data-asset="test.sheet"]').count(),1);
  pass('source sheets leave active lists and remain linked to children in history');
  try {
    realService = await startAtlas(root);
  } catch (error) {
    if (!error.existing_url) throw error;
    const existing = await fetch(error.existing_url + '/api/state').then(r => r.json());
    assert.equal(existing.project.id, real.project.id);
    realService = {
      url: error.existing_url,
      close: async () => {}
    };
  }
  const hashes = new Map(real.assets.flatMap(a => a.versions).flatMap(v => v.files).map(f => [f.path, f.sha256]));
  await page.goto(realService.url);
  await page.locator('[data-tab="library"]').click();
  const counts = [];
  for (const width of [960, 1280, 1920]) {
    await page.setViewportSize({
      width,
      height: 1000
    });
    await page.locator('.thumb img').evaluateAll(images => Promise.all(images.map(async image => {
      image.loading = 'eager';
      await image.decode();
    })));
    const clipped = await page.locator('.thumb img').evaluateAll(images => images.filter(image => {
      const a = image.getBoundingClientRect(),
        b = image.parentElement.getBoundingClientRect();
      return a.left < b.left - .5 || a.right > b.right + .5 || a.top < b.top - .5 || a.bottom > b.bottom + .5;
    }).map(image => image.src));
    assert.deepEqual(clipped, [], 'All thumbnails fully visible at ' + width);
    counts.push({
      width,
      images: await page.locator('.thumb img').count(),
      clipped: 0
    });
  }
  const resourceItems = real.assets.filter(a => !['source','historical'].includes(a.atlas?.registration_role) && (a.versions.some(v => v.files.length) || a.consumers.some(c => c.kind === 'procedural-runtime') || (a.source.kind === 'procedural' && a.stage === 'ready')));
  assert.equal(await page.locator('[data-asset]').count(), resourceItems.length);
  pass('all project resources represented and thumbnails fit at three widths');
  fs.writeFileSync(path.join(evidence, 'thumbnail-boundaries.json'), JSON.stringify(counts, null, 2));
  await page.locator('[data-filter="category"][value="UI"]').check();
  await page.screenshot({
    path: path.join(evidence, 'resource-library.png')
  });
  await page.locator('[data-clear-filter="category"]').click();
  const compositions = real.assets.filter(a => a.atlas?.composition);
  for (const asset of compositions) {
    await page.locator('[data-asset="' + asset.id + '"]').click();
    await page.locator('#media img').evaluate(image => image.decode());
    const fits = await page.locator('#media img').evaluate(image => {
      const a = image.getBoundingClientRect(),
        b = image.parentElement.getBoundingClientRect();
      return a.width <= b.width + .5 && a.height <= b.height + .5 && Math.abs(a.width / a.height - image.naturalWidth / image.naturalHeight) < .01;
    });
    assert(fits, asset.id + ' composition fits with original aspect');
    if (asset.id.endsWith('state-08')) await page.screenshot({
      path: path.join(evidence, 'state-eight-detail.png')
    });
    await page.locator('#close-detail').click();
  }
  pass('all ' + compositions.length + ' actual combinations fit and retain aspect');
  const action = real.assets.find(a => a.atlas?.frames);
  if (action) {
    await page.locator('[data-tab="library"]').click();
    await page.locator('[data-clear-filter="category"]').click();
    await page.locator('[data-asset="' + action.id + '"]').click();
    await page.locator('#media canvas').waitFor();
    await page.locator('#step-frame').click();
    assert.match(await page.locator('#frame-status').textContent(), /2 \/ /);
    await page.locator('#play-animation').click();
    await page.locator('#animation-speed').selectOption('2');
    await page.locator('#close-detail').click();
    pass('sprite frames, stepping, playback and speed work');
  }
  const audio = real.assets.find(a => a.category === '声音' && a.versions.some(v => v.files.some(f => /\.(wav|ogg|mp3)$/i.test(f.path))));
  if (audio) {
    await page.locator('[data-asset="' + audio.id + '"]').click();
    assert.equal(await page.locator('#media audio').count(), 1);
    await page.locator('#close-detail').click();
    pass('audio has dedicated playable preview');
  }
  await page.locator('[data-tab="history"]').click();
  await page.locator('#tool-changelog h1').waitFor();
  assert.equal((await page.locator('#tool-changelog h2').count()) >= 1, true);
  const markdownCheck = await page.evaluate(() => markdown('# 标题\n\n- **粗体**\n- `代码`\n\n<img src=x onerror=alert(1)>'));
  assert.match(markdownCheck, /<h1>标题<\/h1>/);
  assert.match(markdownCheck, /<strong>粗体<\/strong>/);
  assert.match(markdownCheck, /&lt;img/);
  pass('Markdown renders headings and lists while escaping HTML');
  await page.locator('[data-tab="library"]').click();
  await page.locator('[data-filter="category"][value="图标"]').check();
  await page.locator('[data-filter="category"][value="UI"]').check();
  const selectedTypes = await page.locator('.resource-group').evaluateAll(groups => groups.map(g => g.dataset.category));
  const expectedTypes = real.categories.filter(type => ['UI', '图标'].includes(type) && real.assets.some(a => a.category === type));
  assert.deepEqual(selectedTypes, expectedTypes);
  pass('multiple types form OR groups in stable category order');
  if (real.assets.length) {
    await page.locator('[data-filter="stage"][value="producer-review"]').check();
    await page.locator('[data-filter="stage"][value="self-review"]').check();
    const expected = resourceItems.filter(a => ['UI', '图标'].includes(a.category) && ['producer-review', 'self-review'].includes(a.demand_stage));
    assert.equal(await page.locator('[data-asset]').count(), expected.length);
    pass('different filter dimensions combine with AND');
    const first = expected.find(a => a.versions.length),
      second = expected.find(a => a.id !== first.id && a.versions.length);
    await page.locator('[data-asset="' + first.id + '"]').click();
    assert.equal(await page.locator('#detail').evaluate(d => d.matches(':modal')), false);
    if (second) {
      await page.locator('#main [data-asset="' + second.id + '"]').click();
      assert.match(await page.locator('#detail').innerText(), new RegExp(second.id.replaceAll('.', '\.')));
    }
    assert.equal(await page.locator('dialog[open]').count(), 1);
    pass('nonmodal drawer switches directly from another resource card');
    await page.locator('#detail [data-file] img').first().click();
    assert.equal(await page.locator('#create .media-box img').count(), 1);
    pass('version files display images and open an image drawer');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('dialog[open]').count(), 0);
    await page.locator('#main [data-asset="' + first.id + '"]').click();
    await page.locator('#main').click({
      position: {
        x: 3,
        y: 3
      }
    });
    assert.equal(await page.locator('dialog[open]').count(), 0);
    pass('Escape and blank area close drawers');
    await page.screenshot({
      path: path.join(evidence, 'grouped-multi-filter.png')
    });
  }
  assert.equal(await page.locator('[data-tab="compositions"]').count(), 0);
  await page.locator('[data-tab="library"]').click();
  assert.equal(await page.locator('.filter-row').count(), 3);
  assert.equal(await page.locator('.filter-rows details').count(), 0);
  await page.locator('[data-clear-filter="category"]').click();
  await page.locator('[data-clear-filter="stage"]').click();
  assert.equal(await page.locator('#create-demand').count(), 0);
  await page.locator('[data-tab="demands"]').click();
  assert.equal(await page.locator('.thumb').count(), 0);
  await page.locator('#create-demand').click();
  assert.equal(await page.locator('#create[open]').count(), 1);
  await page.keyboard.press('Escape');
  pass('resource library and requirement entry separate creation and resource display');
  for (const view of ['library', 'reviews']) {
    await page.locator('[data-tab="' + view + '"]').click();
    for (const type of ['UI', '图标']) {
      const group = page.locator('.resource-group[data-category="' + type + '"]');
      if (!(await group.count())) continue;
      const total = await group.locator('[data-asset]').count();
      await group.locator('[data-secondary-group]').check();
      assert.ok((await group.locator('.resource-subgroup').count()) > 1);
      assert.equal(await group.locator('[data-asset]').count(), total);
      await page.locator('#search').fill('system');
      await page.locator('#search').fill('');
      assert.equal(await group.locator('[data-secondary-group]').isChecked(), true);
      await group.locator('.group-heading').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: path.join(evidence, view + '-' + (type === 'UI' ? 'ui' : 'icons') + '-subgroups.png')
      });
      await group.locator('[data-secondary-group]').uncheck();
      assert.equal(await group.locator('.resource-subgroup').count(), 0);
    }
  }
  pass('per-category secondary grouping preserves items and toggles through filtering in both workbenches');
  for (const width of [440, 1280, 1920]) {
    await page.setViewportSize({
      width,
      height: 1000
    });
    await page.evaluate(() => window.scrollTo(0, 0));
    const invalid = await page.locator('.filter-choice').evaluateAll(labels => labels.filter(label => {
      const box = label.querySelector('input').getBoundingClientRect();
      return box.width > 20 || box.height > 20 || label.scrollWidth > label.clientWidth + 1;
    }).length);
    assert.equal(invalid, 0);
    await page.screenshot({
      path: path.join(evidence, 'flat-filters-' + width + '.png')
    });
  }
  await page.setViewportSize({
    width: 1920,
    height: 1080
  });
  pass('flat filter labels and checkbox sizes fit narrow and wide viewports');
  await page.locator('[data-tab="library"]').click();
  await page.locator('[data-clear-filter="category"]').click();
  await page.locator('[data-filter="category"][value="页面"]').check();
  const pages = JSON.parse(fs.readFileSync(path.join(root, 'assets/atlas-pages.json'), 'utf8'));
  assert.equal(await page.locator('[data-asset]').count(), real.assets.filter(a => a.category === '页面' && resourceItems.some(r => r.id === a.id)).length);
  if (pages.pages.length) {
    const state = pages.pages[0].states.find(s => s.related.length);
    await page.locator('[data-asset="' + state.asset_id + '"]').click();
    await page.locator('[data-related-asset]').first().click();
    assert.equal(await page.locator('.page-context').count(), 1);
    await page.screenshot({
      path: path.join(evidence, 'page-state-drawer.png')
    });
    await page.locator('#close-detail').click();
  }
  pass('page requirements group states and resolve related state links');
  assert.deepEqual(pageErrors, []);
  pass('no browser script errors');
  for (const [file, digest] of hashes) assert.equal(hash(fs.readFileSync(path.join(root, file))), digest);
  pass('all reviewed source and processed media preserved');
  assert.deepEqual(checkAtlas(root).errors, []);
  pass('atlas contract check passes');
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({
    result: 'pass',
    headless: true,
    checks: results,
    resources: real.assets.length,
    compositions: compositions.length,
    producer_adoption: 'pending'
  }, null, 2));
  console.log(JSON.stringify({
    result: 'pass',
    checks: results.length,
    resources: real.assets.length,
    compositions: compositions.length
  }));
} catch (error) {
  fs.writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({
    result: 'fail',
    checks: results,
    error: error.stack
  }, null, 2));
  throw error;
} finally {
  if (browser) await browser.close();
  if (realService) await realService.close();
  if (fixtureService) await fixtureService.close();
  const resolved = fs.realpathSync(fixture);
  if (path.dirname(resolved) === fs.realpathSync(os.tmpdir()) && path.basename(resolved).startsWith('asset-atlas-test-')) fs.rmSync(resolved, {
    recursive: true
  });
}
