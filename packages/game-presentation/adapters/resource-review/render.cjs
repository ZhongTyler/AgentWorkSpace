/* Shared by the offline review page and the headless image exporter. */
function createResourceRenderer() {
  const assets = new Map();
  const sources = new Map();

  function canvas(width, height) {
    const result = document.createElement('canvas');
    result.width = width;
    result.height = height;
    const context = result.getContext('2d', {willReadFrequently: true});
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    return result;
  }

  async function image(uri) {
    const result = new Image();
    result.src = uri;
    await result.decode();
    return result;
  }

  async function loadSources(images) {
    for (const [key, uri] of Object.entries(images)) {
      sources.set(key, await image(uri));
    }
  }

  function resample(input, width, height) {
    let current = input;
    while (current.width > width * 2 && current.height > height * 2) {
      const next = canvas(Math.ceil(current.width / 2), Math.ceil(current.height / 2));
      next.getContext('2d').drawImage(current, 0, 0, next.width, next.height);
      current = next;
    }
    const result = canvas(width, height);
    result.getContext('2d').drawImage(current, 0, 0, width, height);
    return result;
  }

  function crop(specification) {
    const source = sources.get(specification.source);
    if (!source) throw new Error('Missing source ' + specification.source);
    const [left, top, right, bottom] = specification.region;
    const width = right - left;
    const height = bottom - top;
    if (!specification.region.every(Number.isInteger) || left < 0 || top < 0 || right > source.width || bottom > source.height || width <= 0 || height <= 0) {
      throw new Error('Invalid crop region ' + specification.id);
    }
    const isolated = canvas(width, height);
    isolated.getContext('2d').drawImage(source, left, top, width, height, 0, 0, width, height);
    if (specification.require_edge_clear) {
      const pixels = isolated.getContext('2d').getImageData(0, 0, width, height).data;
      const alpha = (x, y) => pixels[(y * width + x) * 4 + 3];
      const threshold = specification.edge_alpha || 160;
      for (let x = 0; x < width; x++) {
        if (alpha(x, 0) >= threshold || alpha(x, height - 1) >= threshold) throw new Error('Visible crop edge ' + specification.id);
      }
      for (let y = 0; y < height; y++) {
        if (alpha(0, y) >= threshold || alpha(width - 1, y) >= threshold) throw new Error('Visible crop edge ' + specification.id);
      }
    }
    if (!specification.square) return isolated;
    const side = specification.master_size || 256;
    const occupancy = specification.occupancy || 0.8;
    const scale = side * occupancy / Math.max(width, height);
    const result = canvas(side, side);
    result.getContext('2d').drawImage(isolated, (side - width * scale) / 2, (side - height * scale) / 2, width * scale, height * scale);
    return result;
  }

  function prepare(specifications) {
    const result = [];
    for (const specification of specifications) {
      const master = crop(specification);
      assets.set(specification.id, master);
      const versions = {native: master.toDataURL('image/png')};
      for (const size of specification.sizes || []) {
        versions[size] = resample(master, size, size).toDataURL('image/png');
      }
      result.push({...specification, width: master.width, height: master.height, versions});
    }
    return result;
  }

  async function loadPrepared(specifications) {
    for (const specification of specifications) {
      assets.set(specification.id, await image(specification.versions.native));
    }
  }

  function ninePatch(context, bitmap, layer) {
    const [left, top, right, bottom] = layer.insets;
    const sx = [0, left, bitmap.width - right, bitmap.width];
    const sy = [0, top, bitmap.height - bottom, bitmap.height];
    const cornerScale = Math.min(1, layer.w / bitmap.width, layer.h / bitmap.height);
    const dx = [layer.x, layer.x + left * cornerScale, layer.x + layer.w - right * cornerScale, layer.x + layer.w].map(Math.round);
    const dy = [layer.y, layer.y + top * cornerScale, layer.y + layer.h - bottom * cornerScale, layer.y + layer.h].map(Math.round);
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        context.drawImage(bitmap, sx[col], sy[row], sx[col + 1] - sx[col], sy[row + 1] - sy[row], dx[col], dy[row], dx[col + 1] - dx[col], dy[row + 1] - dy[row]);
      }
    }
  }

  function renderScene(scene, scale = 1) {
    if (scale !== 1) return resample(renderScene(scene), Math.round(scene.width * scale), Math.round(scene.height * scale));
    const result = canvas(scene.width, scene.height);
    const context = result.getContext('2d');
    for (const layer of scene.layers) {
      context.save();
      context.globalAlpha = layer.opacity === undefined ? 1 : layer.opacity;
      if (layer.kind === 'image') {
        const bitmap = assets.get(layer.asset);
        if (!bitmap) throw new Error('Unknown image asset ' + layer.asset);
        if (layer.rotation) {
          context.translate(layer.x + layer.w / 2, layer.y + layer.h / 2);
          context.rotate(layer.rotation * Math.PI / 180);
          context.drawImage(bitmap, -layer.w / 2, -layer.h / 2, layer.w, layer.h);
        } else if (layer.insets) ninePatch(context, bitmap, layer);
        else context.drawImage(bitmap, layer.x, layer.y, layer.w, layer.h);
      } else if (layer.kind === 'text') {
        context.fillStyle = layer.color || '#254e40';
        context.font = `${layer.weight || 400} ${layer.size || 24}px "Microsoft YaHei",sans-serif`;
        context.textAlign = layer.align || 'left';
        context.textBaseline = 'top';
        const lines = layer.text.split('\n');
        lines.forEach((line, index) => context.fillText(line, layer.x, layer.y + index * (layer.line_height || (layer.size || 24) * 1.45), layer.max_width || 1800));
      } else if (layer.kind === 'line') {
        context.strokeStyle = layer.color || '#23746e';
        context.lineWidth = layer.width || 3;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.setLineDash(layer.dash || []);
        context.beginPath();
        layer.points.forEach(([x, y], index) => index ? context.lineTo(x, y) : context.moveTo(x, y));
        context.stroke();
      } else if (layer.kind === 'circle') {
        context.fillStyle = layer.color;
        context.beginPath();
        context.arc(layer.x, layer.y, layer.r, 0, Math.PI * 2);
        context.fill();
      } else if (layer.kind === 'rect') {
        context.fillStyle = layer.color;
        context.beginPath();
        context.roundRect(layer.x, layer.y, layer.w, layer.h, layer.radius || 0);
        context.fill();
      }
      context.restore();
    }
    return result;
  }

  return {loadSources, prepare, loadPrepared, renderScene};
}

if (typeof module !== 'undefined') module.exports = {createResourceRenderer};
