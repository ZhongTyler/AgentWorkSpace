"""One-shot loopback credential entry; Windows DPAPI only, no credential logging."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs


class Blob(ctypes.Structure):
    _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]


def protect(value):
    raw = value.encode('utf-8')
    buffer = (ctypes.c_ubyte * len(raw)).from_buffer_copy(raw)
    source, output = Blob(len(raw), buffer), Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    crypt.CryptProtectData.argtypes = [ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.c_void_p,
                                      ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob)]
    crypt.CryptProtectData.restype = wintypes.BOOL
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.LocalFree.argtypes = [ctypes.c_void_p]
    kernel.LocalFree.restype = ctypes.c_void_p
    if not crypt.CryptProtectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise OSError('Windows credential encryption failed')
    try:
        return ctypes.string_at(output.data, output.size)
    finally:
        kernel.LocalFree(output.data)


def serve(probe_only=False):
    if os.name != 'nt':
        raise SystemExit('This credential entry requires Windows DPAPI.')
    directory = Path(os.environ['LOCALAPPDATA']) / 'ResearchMCP/secrets'
    route = '/connect/' + secrets.token_urlsafe(24)
    page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Research 本机知乎连接</title>
<style>body{font:18px system-ui;max-width:700px;margin:70px auto;padding:24px;line-height:1.8}input{width:95%;padding:12px;font-size:18px}button{padding:12px 28px;margin-top:20px;font-size:18px}</style>
<h1>连接知乎到 Research</h1><p>将知乎官网生成的 Access Secret 填在下面。它只提交到本机，并使用 Windows 当前用户加密保存到本机应用数据目录。</p>
<p>无需发到聊天。保存后我会验证接口与可用额度；不会充值或执行付费任务。</p>
<form method="post" autocomplete="off"><input type="hidden" name="csrf" value="CSRF_TOKEN"><label>知乎 Access Secret<br><input name="secret" type="password" autocomplete="off" required maxlength="4096"></label><br><button>加密保存到本机</button></form></html>'''.replace('CSRF_TOKEN', route.rsplit('/', 1)[-1])

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def reply(self, status, body):
            data = body.encode('utf-8')
            self.send_response(status)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('X-Frame-Options', 'DENY')
            self.send_header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
            self.end_headers()
            self.wfile.write(data)

        def valid(self):
            # The in-app browser can proxy localhost and rewrite Origin/Host.
            # Require an unguessable route, plus a separate same-page form token on POST.
            return self.path == route

        def do_GET(self):
            self.reply(200, page) if self.valid() else self.reply(404, 'Not found')

        def do_POST(self):
            if not self.valid():
                self.reply(403, 'Forbidden')
                return
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 1 or size > 8192:
                    raise ValueError('Invalid input size')
                fields = parse_qs(self.rfile.read(size).decode('utf-8'))
                if not secrets.compare_digest(fields.get('csrf', [''])[0], route.rsplit('/', 1)[-1]):
                    self.reply(403, 'Forbidden (form expired; open the current local entry page)')
                    return
                if probe_only:
                    self.reply(200, '<title>Local form transport verified</title><p>Test passed; no credentials saved.</p>')
                    print(json.dumps({'browser_form_transport_verified': True, 'credentials_saved': False}), flush=True)
                    threading.Thread(target=self.server.shutdown, daemon=True).start()
                    return
                value = fields.get('secret', [''])[0].strip()
                if not value or len(value) > 4096:
                    raise ValueError('Empty or oversized value')
                encrypted = protect(value)
                directory.mkdir(parents=True, exist_ok=True)
                temp = directory / 'ZHIHU_ACCESS_SECRET.dpapi.tmp'
                temp.write_bytes(encrypted)
                temp.replace(directory / 'ZHIHU_ACCESS_SECRET.dpapi')
                self.reply(200, '<meta charset="utf-8"><title>Research 已保存</title><h1>已加密保存到本机</h1><p>现在可以回到聊天，我会检查实际连接。此页不显示令牌。</p>')
                print(json.dumps({'saved': 'ZHIHU_ACCESS_SECRET', 'encrypted': True}), flush=True)
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            except Exception:
                self.reply(400, '<meta charset="utf-8"><p>保存失败，请检查填写内容后重试。未输出凭据。</p>')

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    print(json.dumps({'local_entry_url': f'http://127.0.0.1:{server.server_port}{route}'}), flush=True)
    timer = threading.Timer(3600, server.shutdown)
    timer.start()
    try:
        server.serve_forever()
    finally:
        timer.cancel()
        server.server_close()


if __name__ == '__main__':
    serve()
