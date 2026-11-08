import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { inside } from './check-assets.mjs';
import { readAtlas, changeAtlas, checkAtlas } from './asset-atlas-store.mjs';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf'
};
export async function startAtlas(root, port = 0) {
  root = fs.realpathSync(root);
  const token = crypto.randomBytes(32).toString('hex');
  const lock = path.join(root, 'maintenance/.asset-atlas.lock');
  let lockFd;
  try {
    lockFd = fs.openSync(lock, 'wx');
  } catch {
    const saved = JSON.parse(fs.readFileSync(lock, 'utf8'));
    try {
      process.kill(saved.pid, 0);
    } catch (error) {
      if (error.code !== 'ESRCH') throw Error('资源图册占用状态未知，请检查现有服务');
      fs.unlinkSync(lock);
      return startAtlas(root, port);
    }
    const error = Error('资源图册已运行。请使用现有入口 ' + (saved.url || '启动中'));
    error.existing_url = saved.url;
    throw error;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const origin = 'http://127.0.0.1:' + server.address().port;
      if (req.headers.host !== new URL(origin).host) throw Error('无效主机');
      if (req.headers.origin && req.headers.origin !== origin) throw Error('请求来源不匹配');
      const url = new URL(req.url, origin);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      if (req.method === 'GET' && url.pathname === '/api/state') {
        res.setHeader('Content-Type', mime['.json']);
        res.end(JSON.stringify({
          ...readAtlas(root),
          token
        }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/change') {
        if (req.headers['x-atlas-token'] !== token || !req.headers['content-type']?.startsWith('application/json')) throw Error('保存凭据无效');
        let body = '';
        for await (const part of req) {
          body += part;
          if (Buffer.byteLength(body) > 262144) throw Error('保存内容过大');
        }
        const payload = JSON.parse(body);
        res.setHeader('Content-Type', mime['.json']);
        res.end(JSON.stringify(changeAtlas(root, payload.revision, payload.action)));
        return;
      }
      if (req.method !== 'GET') throw Error('请求不支持');
      const view = JSON.parse(fs.readFileSync(path.join(root, 'maintenance/project-config.json'), 'utf8'));
      const rel = url.pathname === '/' ? view.assets.directory + '/index.html' : url.searchParams.get('path');
      if (url.pathname !== '/' && url.pathname !== '/file') throw Error('入口不存在');
      if (![view.assets.directory + '/', view.engine.directory + '/', 'docs/', 'maintenance/previews/'].some(prefix => rel?.startsWith(prefix))) throw Error('文件不在资源访问范围内');
      if (rel.split('/').some(part => part.startsWith('.'))) throw Error('隐藏文件不可访问');
      const file = inside(root, rel);
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw Error('文件不存在');
      const type = mime[path.extname(file).toLowerCase()] || 'text/plain; charset=utf-8';
      res.setHeader('Content-Type', type);
      if (type === 'image/svg+xml') res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; style-src 'unsafe-inline'");
      res.setHeader('Accept-Ranges', 'bytes');
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) {
          res.writeHead(416);
          res.end();
          return;
        }
        const start = Number(match[1]),
          end = Math.min(match[2] ? Number(match[2]) : stat.size - 1, stat.size - 1);
        if (start > end || start >= stat.size) {
          res.writeHead(416, {
            'Content-Range': 'bytes */' + stat.size
          });
          res.end();
          return;
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Content-Length': end - start + 1
        });
        fs.createReadStream(file, {
          start,
          end
        }).pipe(res);
      } else {
        res.setHeader('Content-Length', stat.size);
        fs.createReadStream(file).pipe(res);
      }
    } catch (error) {
      res.statusCode = error.status || 400;
      res.setHeader('Content-Type', mime['.json']);
      res.end(JSON.stringify({
        error: error.message
      }));
    }
  });
  function cleanup() {
    try {
      fs.closeSync(lockFd);
      fs.unlinkSync(lock);
    } catch {}
  }
  server.once('close', cleanup);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    const url = 'http://127.0.0.1:' + server.address().port;
    fs.writeFileSync(lockFd, JSON.stringify({
      pid: process.pid,
      url,
      root
    }));
    return {
      server,
      url,
      close: () => new Promise(resolve => server.close(resolve))
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || '.');
  if (process.argv.includes('--check')) {
    const result = checkAtlas(root);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.errors.length ? 1 : 0);
  }
  startAtlas(root).then(({
    server,
    url
  }) => {
    console.log('项目资源图册 ' + url + '\n关闭此窗口可停止服务。');
    if (process.argv.includes('--open')) {
      import('node:child_process').then(({
        spawn
      }) => spawn('rundll32', ['url.dll,FileProtocolHandler', url], {
        stdio: 'ignore',
        windowsHide: true
      }));
    }
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
  }).catch(async error => {
    if (error.existing_url && process.argv.includes('--open')) {
      try {
        const response = await fetch(error.existing_url + '/api/state', {
          signal: AbortSignal.timeout(3000)
        });
        if (!response.ok) throw Error('现有服务未就绪');
        console.log('打开现有项目图册 ' + error.existing_url);
        const {
          spawn
        } = await import('node:child_process');
        spawn('rundll32', ['url.dll,FileProtocolHandler', error.existing_url], {
          stdio: 'ignore',
          windowsHide: true
        });
        return;
      } catch {
        console.error('现有服务暂不可访问，请检查原图册窗口');
      }
    }
    console.error(error.message);
    process.exitCode = 1;
  });
}
