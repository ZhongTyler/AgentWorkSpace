const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const {createResourceRenderer} = require('./render.cjs');

function argument(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function assert(value, label) {
  if (!value) throw new Error(label);
}

function sha(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

async function main() {
  const root = path.resolve(argument('root'));
  const output = path.resolve(argument('output'));
  const manifest = JSON.parse(fs.readFileSync(path.resolve(root, argument('manifest')), 'utf8'));
  const receipt = JSON.parse(fs.readFileSync(path.join(output, 'build-receipt.json'), 'utf8'));
  for (const file of [...receipt.files, ...receipt.scenes]) {
    assert(sha(fs.readFileSync(path.join(output, file.path))) === file.sha256, 'Output changed ' + file.path);
  }
  assert(sha(fs.readFileSync(path.join(__dirname, 'render.cjs'))) === receipt.renderer_sha256, 'Renderer changed after build');
  const {chromium} = require(argument('playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')));
  const browser = await chromium.launch({headless: true, executablePath: argument('browser')});
  try {
    const detached = fs.mkdtempSync(path.join(os.tmpdir(), 'resource-review-'));
    fs.copyFileSync(path.join(output, 'index.html'), path.join(detached, 'index.html'));
    const page = await browser.newPage({viewport: {width: 1440, height: 1100}, acceptDownloads: true});
    const errors = [];
    page.on('pageerror', error => errors.push(String(error)));
    await page.goto(pathToFileURL(path.join(detached, 'index.html')).href);
    await page.evaluate(() => window.reviewReady);
    await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
    assert(await page.locator('.asset').count() === manifest.assets.length, 'All assets displayed');
    const negativePath = argument('reject-crops');
    let rejectedCrops = 0;
    if (negativePath) {
      const cases = JSON.parse(fs.readFileSync(path.resolve(root, negativePath), 'utf8'));
      const images = {};
      for (const entry of cases) {
        const source = manifest.sources.find(source => source.id === entry.source);
        images[source.id] = 'data:image/png;base64,' + fs.readFileSync(path.resolve(root, source.path)).toString('base64');
      }
      const failures = await page.evaluate(async ({factory, images, cases}) => {
        const renderer = new Function('return (' + factory + ')()')();
        await renderer.loadSources(images);
        return cases.map(entry => {
          try {renderer.prepare([{...entry, require_edge_clear: true, sizes: []}]); return false;}
          catch (error) {return error.message.startsWith('Visible crop edge');}
        });
      }, {factory: createResourceRenderer.toString(), images, cases});
      assert(failures.every(Boolean), 'Known broken crops must fail');
      rejectedCrops = failures.length;
    }
    const sceneChecks = [];
    for (const scene of manifest.scenes) {
      const uri = await page.evaluate(id => window.reviewRenderer.renderScene(window.reviewData.scenes.find(scene => scene.id === id)).toDataURL('image/png'), scene.id);
      const expected = receipt.scenes.find(entry => entry.id === scene.id && entry.scale === 1);
      const actualHash = sha(Buffer.from(uri.split(',')[1], 'base64'));
      if (actualHash !== expected.sha256) {
        const expectedUri = 'data:image/png;base64,' + fs.readFileSync(path.join(output, expected.path)).toString('base64');
        const difference = await page.evaluate(async ({actual, expected}) => {
          async function pixels(uri) {
            const image = new Image(); image.src = uri; await image.decode();
            const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
            const context = canvas.getContext('2d'); context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height).data;
          }
          const a = await pixels(actual), b = await pixels(expected);
          let changed = 0, maximum = 0, sum = 0, largerThanTwo = 0;
          for (let i = 0; i < a.length; i++) {const d = Math.abs(a[i] - b[i]); if (d) changed++; if (d > 2) largerThanTwo++; maximum = Math.max(maximum, d); sum += d;}
          return {channels: a.length, changed, maximum, mean: sum / a.length, largerThanTwo};
        }, {actual: uri, expected: expectedUri});
        fs.writeFileSync(path.join(output, 'scene-raster-difference.json'), JSON.stringify({scene: scene.id, ...difference}, null, 2));
        fs.writeFileSync(path.join(output, 'gallery-' + scene.id + '-comparison.png'), Buffer.from(uri.split(',')[1], 'base64'));
      }
      assert(actualHash === expected.sha256, 'Gallery composition differs from PNG ' + scene.id);
      sceneChecks.push({id: scene.id, sha256: actualHash});
    }
    assert(new Set(sceneChecks.map(scene => scene.sha256)).size === sceneChecks.length, 'Scenes must have distinct visible output');
    // Size contact sheets use actual exported PNGs, without changing those PNGs.
    await page.addStyleTag({content: '[data-review]{display:none!important} #assets article[data-group="component"],#assets article[data-group="actor"],#assets article[data-group="environment"]{display:none!important}'});
    for (const size of [24, 32, 48, 64, 112, 128]) {
      await page.locator('[data-size="' + size + '"]').click();
      await page.waitForFunction(() => Array.from(document.querySelectorAll('#assets .asset img')).every(image => image.complete && image.naturalWidth > 0));
      const widths = await page.locator('#assets article[data-group="system"] img').evaluateAll(images => images.map(image => image.getBoundingClientRect().width));
      assert(widths.every(width => width === size), 'Actual display size ' + size);
      for (const background of ['light', 'dark']) {
        await page.locator('button[data-bg="' + background + '"]').click();
        await page.locator('#assets').screenshot({path: path.join(output, 'size-' + size + '-' + background + '.png')});
      }
    }
    await page.locator('[data-tab="scenes"]').click();
    const battle = manifest.scenes.filter(scene => scene.group === 'battle');
    for (const scene of battle) {
      await page.locator('[data-scene-id="' + scene.id + '"]').click();
      assert(await page.locator('#scenes canvas[data-scene="' + scene.id + '"]').count() === 1, 'Scene switch ' + scene.id);
    }
    await page.locator('[data-tab="assets"]').click();
    await page.addStyleTag({content: '[data-review]{display:block!important}'});
    const first = manifest.assets[0].id;
    await page.locator('[data-review="' + first + '"] select').selectOption('revise');
    await page.locator('[data-review="' + first + '"] textarea').fill('回归检查备注', {force: true});
    await page.locator('#export-reviews').click();
    assert(await page.locator('#review-export').isVisible(), 'Review export visible');
    const exported = JSON.parse(await page.locator('#review-export-text').inputValue());
    assert(exported.entries.some(entry => entry.id === first && entry.status === 'revise' && entry.note === '回归检查备注'), 'Review comment export');
    assert(exported.manifest_sha256 === receipt.manifest_sha256, 'Review version binding');
    assert(errors.length === 0, 'Page errors ' + errors.join(','));
    const report = {result: 'pass', headless: true, detached_html: true, assets: manifest.assets.length, files_hash_checked: receipt.files.length, scene_checks: sceneChecks, known_broken_crops_rejected: rejectedCrops, sizes: [24, 32, 48, 64, 112, 128], backgrounds: ['light', 'dark'], scene_navigation: battle.length, review_export: true, page_errors: errors};
    fs.writeFileSync(path.join(output, 'check-result.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({result: 'pass', assets: report.assets, scenes: sceneChecks.length, rejected_crops: rejectedCrops, sizes: report.sizes}));
  } finally {
    await browser.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
