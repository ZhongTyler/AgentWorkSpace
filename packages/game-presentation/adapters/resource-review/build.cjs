const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {createResourceRenderer} = require('./render.cjs');

function argument(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function sha(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const root = fs.realpathSync(argument('root'));
  const manifestPath = fs.realpathSync(path.resolve(root, argument('manifest')));
  const output = path.resolve(argument('output'));
  if (!manifestPath.startsWith(root + path.sep)) throw new Error('Manifest escaped project');
  if (fs.existsSync(output)) throw new Error('Choose a new output directory');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const field of ['sources', 'assets', 'scenes']) {
    if (!Array.isArray(manifest[field])) throw new Error('Manifest array required ' + field);
    for (const item of manifest[field]) {
      if (typeof item.id !== 'string' || !item.id || item.id.trim() !== item.id || item.id.length > 128 ||
          /[\\/:\x00-\x1f<>"|?*]/.test(item.id) || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(item.id)) {
        throw new Error('Unsafe resource ID');
      }
    }
    if (new Set(manifest[field].map(item => item.id)).size !== manifest[field].length) throw new Error('Duplicate ID ' + field);
  }
  if (new Set(manifest.assets.map(asset => asset.id)).size !== manifest.assets.length) throw new Error('Duplicate asset ID');
  if (new Set(manifest.scenes.map(scene => scene.id)).size !== manifest.scenes.length) throw new Error('Duplicate scene ID');
  for (const asset of manifest.assets) {
    if (asset.sizes && (!Array.isArray(asset.sizes) || asset.sizes.some(size => !Number.isSafeInteger(size) || size < 1))) {
      throw new Error('Invalid output pixel size ' + asset.id);
    }
    if (!asset.require_edge_clear && asset.edge_policy !== 'full_bleed') throw new Error('Crop edge policy missing ' + asset.id);
    if (asset.square && (!asset.sizes || !asset.sizes.length) && asset.group !== 'actor') throw new Error('Display sizes missing ' + asset.id);
  }
  if (!manifest.groups || typeof manifest.groups !== 'object' || Array.isArray(manifest.groups)) throw new Error('Manifest groups required');
  const playwrightPath = argument('playwright', path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const {chromium} = require(playwrightPath);
  if (fs.existsSync(path.join(output, 'build-receipt.json'))) throw new Error('Preserve existing build receipt; choose a new output directory');
  const images = {};
  for (const source of manifest.sources) {
    const sourcePath = fs.realpathSync(path.resolve(root, source.path));
    if (!sourcePath.startsWith(root + path.sep)) throw new Error('Source escaped project ' + source.id);
    const bytes = fs.readFileSync(sourcePath);
    if (sha(bytes) !== source.sha256) throw new Error('Source changed ' + source.id);
    images[source.id] = 'data:image/png;base64,' + bytes.toString('base64');
  }
  fs.mkdirSync(path.dirname(output), {recursive: true});
  fs.mkdirSync(output);
  const browser = await chromium.launch({headless: true, executablePath: argument('browser')});
  try {
    const page = await browser.newPage();
    const prepared = await page.evaluate(async ({factory, images, assets}) => {
      const renderer = new Function('return (' + factory + ')()')();
      await renderer.loadSources(images);
      const prepared = renderer.prepare(assets);
      await renderer.loadPrepared(prepared);
      window.reviewRenderer = renderer;
      return prepared;
    }, {factory: createResourceRenderer.toString(), images, assets: manifest.assets});
    const files = [];
    for (const asset of prepared) {
      const folder = asset.group === 'system' || asset.group === 'skill' || asset.group === 'modifier' ? 'icons' : 'components';
      fs.mkdirSync(path.join(output, folder), {recursive: true});
      for (const [size, uri] of Object.entries(asset.versions)) {
        const relative = folder + '/' + asset.id + '@' + size + '.png';
        const bytes = Buffer.from(uri.split(',')[1], 'base64');
        fs.writeFileSync(path.join(output, relative), bytes);
        files.push({asset: asset.id, size, path: relative, sha256: sha(bytes)});
      }
    }
    fs.mkdirSync(path.join(output, 'states'), {recursive: true});
    const scenes = [];
    for (const scene of manifest.scenes) {
      for (const scale of scene.scales || [1]) {
        const uri = await page.evaluate(({scene, scale}) => window.reviewRenderer.renderScene(scene, scale).toDataURL('image/png'), {scene, scale});
        const relative = 'states/' + scene.id + '@' + Math.round(scale * 100) + '.png';
        const bytes = Buffer.from(uri.split(',')[1], 'base64');
        fs.writeFileSync(path.join(output, relative), bytes);
        scenes.push({id: scene.id, scale, path: relative, sha256: sha(bytes)});
      }
    }
    const payload = {...manifest, review_version: sha(fs.readFileSync(manifestPath)), assets: prepared};
    const template = fs.readFileSync(path.join(__dirname, 'gallery.html'), 'utf8');
    const html = template.replace('/*__RENDERER__*/', createResourceRenderer.toString()).replace('/*__DATA__*/{}', JSON.stringify(payload).replaceAll('</', '<\\/'));
    const imagesOnly = process.argv.includes('--images-only');
    if (!imagesOnly) fs.writeFileSync(path.join(output, 'index.html'), html);
    for (const folder of ['icons', 'components', 'states']) {
      fs.mkdirSync(path.join(output, folder), {recursive: true});
      fs.writeFileSync(path.join(output, folder, 'README.md'), '# 候选资源输出\n\n本目录由资源图册构建器生成，用于裁框、尺寸和状态审阅。\n\n## 目录\n\n无下级目录。\n');
    }
    const receipt = {schema: 1, manifest_sha256: sha(fs.readFileSync(manifestPath)), renderer_sha256: sha(fs.readFileSync(path.join(__dirname, 'render.cjs'))), browser: browser.version(), headless: true, assets: prepared.length, files, scenes, gallery_sha256: imagesOnly ? null : sha(Buffer.from(html)), adoption: 'pending'};
    fs.writeFileSync(path.join(output, 'build-receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify({assets: prepared.length, files: files.length, scenes: scenes.length, gallery: imagesOnly ? null : path.join(output, 'index.html')}));
  } finally {
    await browser.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
