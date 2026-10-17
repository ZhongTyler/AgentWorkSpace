"""Session-local lazy MCP; desktop-owned .mcp.json remains the live source.

No broker, polling service, package import or backend process on discovery.
The immutable review fixes code/catalog/policy while permitting host pipe IDs
to change on restart. Only this connection's child Job is ever released.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time

from demand_common import Backend, MAX_FRAME, digest, pack

VOLATILE_ENV = {'SKY_CUA_NATIVE_PIPE', 'SKY_CUA_NATIVE_PIPE_DIRECTORY'}


def contract(source):
    result = dict(source)
    result['env'] = {k: v for k, v in source.get('env', {}).items() if k not in VOLATILE_ENV}
    result['env_keys'] = sorted(source.get('env', {}))
    return result


def checked_source(review):
    root = Path(review['plugin_root'])
    identity = json.loads((root / '.codex-plugin/plugin.json').read_text(encoding='utf-8'))
    for key, value in review['identity'].items():
        if identity.get(key) != value:
            raise ValueError('Reviewed plugin identity changed; prepare again')
    source = json.loads((root / '.mcp.json').read_text(encoding='utf-8'))['mcpServers'][review['server']]
    if contract(source) != review['source_contract']:
        raise ValueError('Reviewed plugin transport or policy changed; prepare again')
    for filename, expected in review['fingerprints'].items():
        if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != expected:
            raise ValueError('Reviewed plugin code changed; prepare again')
    return source


class LazySession:
    def __init__(self, review, output=None, inherited_env=False, base_env=None):
        self.review = review
        self.catalog = json.loads(Path(review['catalog']).read_text(encoding='utf-8'))
        if digest(self.catalog) != review['catalog_sha256']:
            raise ValueError('Reviewed catalog changed')
        checked_source(review)
        self.output = output or sys.stdout.buffer
        self.inherited_env = inherited_env
        self.base_env = dict(os.environ) if base_env is None else dict(base_env)
        self.output_lock = threading.Lock()
        self.closed = False
        self.cancelled = set()
        self.worker = None
        self.activating = False
        self.init = None
        self.requests = queue.Queue()
        self.runner = threading.Thread(target=self.execute, daemon=True)
        self.runner.start()

    def event(self, kind, **values):
        # Never record RPC bodies, pipe paths, credentials or environment values.
        with Path(self.review['events']).open('ab') as out:
            out.write(pack({'time': time.time(), 'event': kind, 'profile': self.review['profile'],
                            'facade_pid': os.getpid(), **values}))

    def send(self, message):
        if self.closed:
            return
        try:
            with self.output_lock:
                self.output.write(pack(message))
                self.output.flush()
        except (OSError, ValueError):
            self.closed = True

    def execute(self):
        while True:
            msg = self.requests.get()
            if msg is None:
                return
            if self.closed:
                continue
            try:
                if self.worker is None or self.worker.closed:
                    source = checked_source(self.review)
                    profile = {k: source[k] for k in ('command', 'args', 'cwd', 'env') if k in source}
                    profile.setdefault('cwd', self.review['plugin_root'])
                    if 'backend_args' in self.review:
                        profile['args'] = self.review['backend_args']
                    if self.inherited_env:
                        # Desktop injects thread-specific browser identity and
                        # pipe environment. Keep those live values over defaults.
                        profile['env'] = {k: self.base_env.get(k, v) for k, v in profile.get('env', {}).items()}
                    profile.update(mode='session', fingerprints=self.review['fingerprints'],
                                   startup_timeout=source.get('startup_timeout_sec', 30),
                                   tool_timeout=source.get('tool_timeout_sec', 180))
                    self.worker = Backend(profile, self.base_env, lambda s, m: s.send(m), self.event)
                response = self.worker.request(self, msg, self.init)
            except Exception:
                response = {'jsonrpc': '2.0', 'id': msg['id'], 'error': {
                    'code': -32000, 'message': 'Demand plugin unavailable; outcome may be unknown. No automatic replay.'}}
                self.event('request_failed')
            self.send(response)

    def accept(self, msg):
        if not isinstance(msg, dict):
            raise ValueError('Invalid MCP frame')
        method = msg.get('method')
        if method == 'initialize':
            if self.init is not None:
                raise ValueError('Duplicate initialize')
            self.init = msg['params']
            self.send({'jsonrpc': '2.0', 'id': msg['id'], 'result': self.catalog['initialize']})
        elif method == 'notifications/initialized':
            pass
        elif self.init is None:
            raise ValueError('Initialize required')
        elif method == 'ping' and self.worker is None:
            self.send({'jsonrpc': '2.0', 'id': msg['id'], 'result': {}})
        elif method == 'tools/list' and self.worker is None:
            if msg.get('params', {}).get('cursor'):
                self.send({'jsonrpc': '2.0', 'id': msg['id'], 'error': {'code': -32602, 'message': 'Unknown cached cursor'}})
            else:
                self.send({'jsonrpc': '2.0', 'id': msg['id'], 'result': {'tools': self.catalog['tools']}})
        elif (method == 'tools/call' and self.worker is None and not self.activating
              and 'cold_turn_ended_result' in self.review
              and msg.get('params', {}).get('name') == 'turn_ended'
              and msg.get('params', {}).get('arguments', {}).get('hook_event_name') in ('Stop', 'Interrupt', 'SubagentStop')
              and set(msg.get('params', {}).get('arguments', {})) == {'hook_event_name', 'session_id', 'turn_id'}
              and all(isinstance(v, str) and v for v in msg['params']['arguments'].values())):
            # The empty native runtime's cleanup reply was captured and verified.
            # With no resource ever acquired, Stop must not create one to clean it.
            self.send({'jsonrpc': '2.0', 'id': msg['id'], 'result': self.review['cold_turn_ended_result']})
        elif 'method' in msg and 'id' in msg:
            self.activating = True
            self.requests.put(msg)
        else:
            if method == 'notifications/cancelled':
                self.cancelled.add(msg.get('params', {}).get('requestId'))
            if self.worker:
                self.worker.notify(self, msg)

    def close(self):
        self.closed = True
        self.requests.put(None)
        # EOF means the client is gone, including if it disconnected mid-call.
        # Do not wait for a long tool timeout before releasing the owned tree.
        if self.worker:
            self.worker.close()
        self.runner.join(timeout=8)


def watch_parent():
    if os.name != 'nt':
        return
    from ctypes import wintypes
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = kernel.OpenProcess(0x100000, False, os.getppid())
    if handle:
        try:
            if kernel.WaitForSingleObject(handle, 0xffffffff) == 0:
                # Closing this process closes only its own kill-on-close Job.
                os._exit(0)
        finally:
            kernel.CloseHandle(handle)


def run(review_path, inherited_env=False):
    review = json.loads(Path(review_path).read_text(encoding='utf-8'))
    session = LazySession(review, inherited_env=inherited_env)
    threading.Thread(target=watch_parent, daemon=True).start()
    try:
        while True:
            line = sys.stdin.buffer.readline(MAX_FRAME + 1)
            if not line:
                break
            if len(line) > MAX_FRAME:
                raise ValueError('Oversized MCP frame')
            session.accept(json.loads(line))
    finally:
        session.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review', type=Path, required=True)
    parser.add_argument('--inherited-env', action='store_true')
    try:
        args = parser.parse_args()
        run(args.review, args.inherited_env)
    except Exception:
        print('Demand plugin failed; inspect its reviewed local installation. No RPC or environment data logged.', file=sys.stderr)
        raise SystemExit(1)
