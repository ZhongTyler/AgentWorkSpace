"""One same-user HTTP discovery process for many Codex MCP connections.

Backend ownership, sharing, cancellation and callbacks reuse the reviewed broker.
Discovery never starts a backend. No credentials or RPC bodies are logged.
"""
import argparse
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import queue
import secrets
import socket
import threading
import time
from urllib.parse import urlsplit

from demand_broker import Broker
from demand_common import MAX_FRAME, atomic_json, digest, pack, private_read
from demand_http_headers import ProcessOwner


SERVICE = 'tools-mcp-demand-http-v1'


class Draining(Exception):
    pass


class Session:
    def __init__(self, gateway, profile, registration, init):
        self.gateway = gateway
        self.profile = profile
        self.env = registration['env']
        self.owner = registration['owner']
        self.registration = registration['key']
        self.init = init
        self.scope = secrets.token_hex(24)
        self.worker = None
        self.plugin = None
        self.closed = False
        self.cancelled = set()
        self.lock = threading.RLock()
        self.pending = {}
        self.unsolicited = queue.Queue(maxsize=128)

    def send(self, msg):
        with self.lock:
            if self.closed:
                return
            if 'method' not in msg and msg.get('id') in self.pending:
                self.pending[msg['id']].put(msg)
            elif self.pending:
                # A request's SSE stream accepts progress and reverse requests.
                next(iter(self.pending.values())).put(msg)
            else:
                try:
                    self.unsolicited.put_nowait(msg)
                except queue.Full:
                    self.close()

    def close(self):
        with self.lock:
            if self.closed:
                return
            self.closed = True
            for inbox in self.pending.values():
                inbox.put(None)
            try:
                self.unsolicited.put_nowait(None)
            except queue.Full:
                pass
        with self.gateway.broker.lock:
            self.gateway.broker.sessions.discard(self)
            self.gateway.broker.last_used = time.monotonic()
        with self.gateway.lock:
            if not any(not s.closed and s.registration == self.registration for s in self.gateway.sessions.values()):
                reg = self.gateway.registrations.pop(self.registration, None)
                if reg:
                    reg['owner'].close()
        if self.worker and self.worker.profile['mode'] == 'session':
            self.worker.close()
        if self.plugin:
            self.plugin.close()


class Gateway:
    def __init__(self, home):
        self.home = Path(home)
        self.broker = Broker(home)
        self.config = private_read(self.home / 'http.dpapi')
        self.token = private_read(self.home / 'token.dpapi')['token']
        self.lock = threading.RLock()
        self.registrations = {}
        self.sessions = {}
        self.catalogs = {}
        self.reviews = {}
        for name, profile in self.broker.manifest['profiles'].items():
            if 'plugin_review' in profile:
                from demand_plugin import checked_source
                review = json.loads(Path(profile['plugin_review']).read_bytes())
                checked_source(review)
                cache = json.loads(Path(review['catalog']).read_bytes())
                if digest(cache) != review['catalog_sha256']:
                    raise ValueError('Reviewed plugin catalog changed')
                self.reviews[name] = review
                self.catalogs[name] = cache
                continue
            cache = json.loads(Path(profile['catalog']).read_bytes())
            if digest(cache) != profile['catalog_sha256'] or cache['profile_sha256'] != digest(profile['source']):
                raise ValueError('Reviewed catalog changed')
            self.catalogs[name] = cache

    def execute(self, session, msg):
        if session.profile not in self.reviews:
            self.broker.execute(session, msg)
            return
        from demand_plugin import LazySession
        class Output:
            def write(self, raw):
                session.send(json.loads(raw))
            def flush(self):
                pass
        try:
            with session.lock:
                if session.closed:
                    return
                if session.plugin is None:
                    session.plugin = LazySession(self.reviews[session.profile], output=Output(), base_env=session.env)
                    session.plugin.init = session.init
                session.plugin.accept(msg)
        except Exception:
            session.send({'jsonrpc': '2.0', 'id': msg['id'], 'error': {
                'code': -32000, 'message': 'Demand plugin unavailable. No automatic replay.'}})

    def workers(self):
        with self.broker.lock:
            result = [{'profile': k[0], **w.snapshot()} for k, w in self.broker.workers.items() if not w.closed]
        with self.lock:
            sessions = list(self.sessions.values())
        for session in sessions:
            worker = session.plugin.worker if session.plugin else None
            if worker and not worker.closed:
                result.append({'profile': session.profile, **worker.snapshot()})
        return result

    def register(self, data):
        env = data['env']
        names = set(self.broker.manifest['environment_names'])
        if not isinstance(env, dict) or set(env) - names or not all(isinstance(v, str) for v in env.values()):
            raise ValueError('Invalid forwarded environment')
        owner = ProcessOwner(data['owner']['pid'], data['owner']['created'])
        if not owner.alive():
            owner.close()
            raise ValueError('Registration owner exited')
        key = secrets.token_hex(32)
        with self.lock, self.broker.lock:
            if self.broker.stopping:
                owner.close()
                raise Draining()
            self.registrations[key] = {'key': key, 'owner': owner, 'env': env, 'time': time.monotonic()}
            self.broker.last_used = time.monotonic()
        self.broker.event('http_registration', owner_pid=owner.pid, gateway_pid=os.getpid())
        return key

    def maintain(self, server):
        try:
            self._maintain()
        finally:
            self.broker.stopping = True
            server.shutdown()

    def _maintain(self):
        while not self.broker.stopping:
            time.sleep(.25)
            with self.lock:
                for key, reg in list(self.registrations.items()):
                    used = [s for s in self.sessions.values() if s.registration == key and not s.closed]
                    if not reg['owner'].alive() or (not used and time.monotonic() - reg['time'] > 30):
                        for session in used:
                            session.close()
                        reg['owner'].close()
                        self.registrations.pop(key, None)
                    elif not used:
                        # Codex runs helpers through a shell; the first initialize
                        # can arrive several seconds after registration returns.
                        with self.broker.lock:
                            self.broker.last_used = time.monotonic()
                self.sessions = {k: v for k, v in self.sessions.items() if not v.closed}
                if not self.registrations and not self.sessions:
                    # The shared gateway has its own backend trees. When every
                    # registered host is gone, none has a remaining consumer.
                    for worker in list(self.broker.workers.values()):
                        worker.close()

    def run(self):
        gateway = self
        class Handler(BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def log_message(self, *args):
                pass

            def reply(self, status, data=None, headers=None):
                raw = pack(data) if data is not None else b''
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(raw)))
                for k, v in (headers or {}).items():
                    self.send_header(k, v)
                self.end_headers()
                self.wfile.write(raw)

            def authorized(self):
                # Exact loopback host plus bearer prevents DNS rebinding/CSRF.
                host = self.headers.get('Host', '')
                if host != '127.0.0.1:' + str(gateway.config['port']) or self.headers.get('Origin'):
                    self.reply(403)
                    self.close_connection = True
                    return False
                if not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + gateway.token):
                    self.reply(401)
                    self.close_connection = True
                    return False
                return True

            def context(self):
                profile = urlsplit(self.path).path.removeprefix('/mcp/')
                key = self.headers.get('X-Tools-Demand-Client', '')
                with gateway.lock:
                    reg = gateway.registrations.get(key)
                if profile not in gateway.catalogs or not reg or not reg['owner'].alive():
                    gateway.broker.event('http_context_rejected', known_profile=profile in gateway.catalogs,
                                         known_registration=bool(reg), owner_alive=bool(reg and reg['owner'].alive()))
                    self.reply(404)
                    return None, None
                return profile, reg

            def existing(self, profile, reg):
                sid = self.headers.get('Mcp-Session-Id', '')
                with gateway.lock:
                    session = gateway.sessions.get(sid)
                if not session or session.closed or session.profile != profile or session.registration != reg['key']:
                    self.reply(404)
                    return None
                return session

            def body(self):
                if self.headers.get('Transfer-Encoding'):
                    raise ValueError('Chunked bodies are unsupported')
                size = int(self.headers.get('Content-Length', '0'))
                if size < 1 or size > MAX_FRAME:
                    raise ValueError('Invalid request size')
                return json.loads(self.rfile.read(size))

            def sse_start(self):
                self.send_response(200)
                self.send_header('Content-Type', 'text/event-stream')
                self.send_header('Cache-Control', 'no-cache')
                self.send_header('Connection', 'close')
                self.end_headers()
                self.close_connection = True

            def sse(self, msg):
                self.wfile.write(b'event: message\ndata: ' + pack(msg).rstrip(b'\n') + b'\n\n')
                self.wfile.flush()

            def do_POST(self):
                if not self.authorized():
                    return
                try:
                    msg = self.body()
                    if self.path == '/register':
                        self.reply(200, {'client': gateway.register(msg)})
                        return
                    profile, reg = self.context()
                    if profile is None:
                        return
                    if not isinstance(msg, dict):
                        raise ValueError('Invalid JSON-RPC frame')
                    method = msg.get('method')
                    if method == 'initialize':
                        if self.headers.get('Mcp-Session-Id'):
                            raise ValueError('Duplicate initialize')
                        session = Session(gateway, profile, reg, msg['params'])
                        with gateway.lock:
                            gateway.sessions[session.scope] = session
                        with gateway.broker.lock:
                            gateway.broker.sessions.add(session)
                        self.reply(200, {'jsonrpc': '2.0', 'id': msg['id'], 'result': gateway.catalogs[profile]['initialize']},
                                   {'Mcp-Session-Id': session.scope})
                        return
                    session = self.existing(profile, reg)
                    if session is None:
                        return
                    cold = session.worker is None and session.plugin is None
                    if method == 'notifications/initialized':
                        self.reply(202)
                    elif 'id' not in msg or 'method' not in msg:
                        if method == 'notifications/cancelled':
                            session.cancelled.add(msg.get('params', {}).get('requestId'))
                        if session.worker:
                            session.worker.notify(session, msg)
                        if session.plugin:
                            session.plugin.accept(msg)
                        self.reply(202)
                    elif method == 'ping' and cold:
                        self.reply(200, {'jsonrpc': '2.0', 'id': msg['id'], 'result': {}})
                    elif method == 'tools/list' and cold:
                        result = {'error': {'code': -32602, 'message': 'Unknown cached cursor'}} if msg.get('params', {}).get('cursor') else {'result': {'tools': gateway.catalogs[profile]['tools']}}
                        self.reply(200, {'jsonrpc': '2.0', 'id': msg['id'], **result})
                    elif (cold and method == 'tools/call' and profile in gateway.reviews
                          and 'cold_turn_ended_result' in gateway.reviews[profile]
                          and msg.get('params', {}).get('name') == 'turn_ended'
                          and set(msg.get('params', {}).get('arguments', {})) == {'hook_event_name', 'session_id', 'turn_id'}
                          and msg['params']['arguments']['hook_event_name'] in ('Stop', 'Interrupt', 'SubagentStop')
                          and all(isinstance(v, str) and v for v in msg['params']['arguments'].values())):
                        self.reply(200, {'jsonrpc': '2.0', 'id': msg['id'], 'result': gateway.reviews[profile]['cold_turn_ended_result']})
                    else:
                        inbox = queue.Queue()
                        with session.lock:
                            if msg['id'] in session.pending:
                                raise ValueError('Duplicate in-flight request ID')
                            session.pending[msg['id']] = inbox
                        try:
                            gateway.broker.pool.submit(gateway.execute, session, msg)
                            self.sse_start()
                            while not session.closed:
                                try:
                                    response = inbox.get(timeout=1)
                                except queue.Empty:
                                    self.wfile.write(b': keepalive\n\n'); self.wfile.flush()
                                    continue
                                if response is None:
                                    break
                                self.sse(response)
                                if 'method' not in response and response.get('id') == msg['id']:
                                    break
                        finally:
                            with session.lock:
                                session.pending.pop(msg['id'], None)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass
                except Draining:
                    self.reply(503, {'service': SERVICE, 'identity': digest(gateway.config), 'stopping': True})
                except (ValueError, KeyError, TypeError):
                    self.reply(400)
                    self.close_connection = True

            def do_GET(self):
                if not self.authorized():
                    return
                if self.path == '/health':
                    with gateway.broker.lock:
                        count = len(gateway.broker.sessions)
                    self.reply(200, {'service': SERVICE, 'identity': digest(gateway.config), 'pid': os.getpid(),
                                     'sessions': count, 'workers': gateway.workers(), 'stopping': gateway.broker.stopping})
                    return
                profile, reg = self.context()
                if profile is None:
                    return
                session = self.existing(profile, reg)
                if session is None:
                    return
                self.sse_start()
                try:
                    while not session.closed:
                        try:
                            msg = session.unsolicited.get(timeout=1)
                        except queue.Empty:
                            self.wfile.write(b': keepalive\n\n'); self.wfile.flush()
                            continue
                        if msg is None:
                            break
                        self.sse(msg)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

            def do_DELETE(self):
                if not self.authorized():
                    return
                profile, reg = self.context()
                if profile is None:
                    return
                session = self.existing(profile, reg)
                if session:
                    session.close()
                    self.reply(200)

        class Server(ThreadingHTTPServer):
            daemon_threads = True
            allow_reuse_address = False
            request_queue_size = 128
            def server_bind(self):
                if os.name == 'nt':
                    self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
                super().server_bind()
        with Server(('127.0.0.1', self.config['port']), Handler) as server:
            atomic_json(self.home / 'http-status.json', {'service': SERVICE, 'pid': os.getpid()})
            threading.Thread(target=self.broker.maintain, daemon=True).start()
            threading.Thread(target=self.maintain, args=(server,), daemon=True).start()
            try:
                server.serve_forever(poll_interval=.25)
            finally:
                self.broker.event('http_gateway_stop', pid=os.getpid())
                self.broker.stopping = True
                for session in list(self.sessions.values()):
                    session.close()
                for worker in list(self.broker.workers.values()):
                    worker.close()
                self.broker.pool.shutdown(wait=True)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--home', required=True, type=Path)
    args = p.parse_args()
    try:
        Gateway(args.home).run()
    except Exception:
        raise SystemExit(1)
