"""Short-lived Codex HTTP header helper; starts one reviewed local gateway."""
import argparse
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.request import ProxyHandler, Request, build_opener

from demand_common import FLAGS, digest, pack, private_read, startup_lock


class ProcessOwner:
    def __init__(self, pid, created=None):
        self.k = ctypes.WinDLL('kernel32', use_last_error=True)
        self.k.OpenProcess.restype = wintypes.HANDLE
        self.k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
        self.k.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
        self.k.CloseHandle.argtypes = [wintypes.HANDLE]
        self.handle = self.k.OpenProcess(0x100000 | 0x1000, False, int(pid))
        if not self.handle:
            raise ValueError('Owner cannot be observed')
        times = [wintypes.FILETIME() for _ in range(4)]
        if not self.k.GetProcessTimes(self.handle, *(ctypes.byref(t) for t in times)):
            self.close()
            raise ValueError('Owner creation time unavailable')
        self.created = (times[0].dwHighDateTime << 32) | times[0].dwLowDateTime
        self.pid = int(pid)
        if created is not None and int(created) != self.created:
            self.close()
            raise ValueError('Owner identity changed')

    def alive(self):
        return self.handle and self.k.WaitForSingleObject(self.handle, 0) == 258

    def close(self):
        if self.handle:
            self.k.CloseHandle(self.handle)
            self.handle = None


def owner_pid():
    # A header helper can be launched through cmd/PowerShell. Bind the nearest
    # Codex ancestor, not that temporary shell. No process is modified or killed.
    class Entry(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('usage', wintypes.DWORD), ('pid', wintypes.DWORD),
                    ('heap', ctypes.c_size_t), ('module', wintypes.DWORD), ('threads', wintypes.DWORD),
                    ('parent', wintypes.DWORD), ('priority', wintypes.LONG), ('flags', wintypes.DWORD),
                    ('name', wintypes.WCHAR * 260)]
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    k.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    k.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(Entry)]
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    handle = k.CreateToolhelp32Snapshot(2, 0)
    if handle == ctypes.c_void_p(-1).value:
        raise ValueError('Cannot identify helper owner')
    entries = {}; entry = Entry(); entry.size = ctypes.sizeof(entry)
    try:
        more = k.Process32FirstW(handle, ctypes.byref(entry))
        while more:
            entries[entry.pid] = (entry.parent, entry.name)
            more = k.Process32NextW(handle, ctypes.byref(entry))
    finally:
        k.CloseHandle(handle)
    pid = os.getppid()
    for _ in range(16):
        parent, name = entries.get(pid, (0, ''))
        if name.lower() == 'codex.exe':
            return pid
        if parent == 0 or parent == pid:
            break
        pid = parent
    # Direct non-Codex tests must specify their own owner explicitly.
    raise ValueError('No Codex owner ancestor')


def request(config, token, path='/health', data=None):
    req = Request('http://127.0.0.1:' + str(config['port']) + path, data=pack(data) if data is not None else None,
                  headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    # Never send private loopback authentication through a configured proxy.
    with build_opener(ProxyHandler({})).open(req, timeout=5) as response:
        return json.load(response)


def headers(home, owner=None, start=True):
    home = home.resolve()
    config = private_read(home / 'http.dpapi')
    if start:
        import hashlib
        for filename, expected in config.get('runtime_sha256', {}).items():
            if hashlib.sha256(Path(__file__).with_name(filename).read_bytes()).hexdigest() != expected:
                raise ValueError('Reviewed HTTP runtime changed')
    token = private_read(home / 'token.dpapi')['token']
    def check():
        reply = request(config, token)
        if reply.get('service') != 'tools-mcp-demand-http-v1' or reply.get('identity') != digest(config):
            raise ValueError('Foreign HTTP listener preserved')
        return reply
    if not start:
        try:
            return check()
        except OSError as error:
            reason = getattr(error, 'reason', error)
            if isinstance(reason, ConnectionRefusedError) or getattr(reason, 'winerror', None) == 10061:
                return {'status': 'stopped'}
            raise
    manifest = private_read(home / 'profiles.dpapi')
    current = ProcessOwner(owner or owner_pid())
    try:
        with startup_lock(home):
            deadline = time.monotonic() + 8
            launched = None
            while time.monotonic() < deadline:
                try:
                    state = check()
                    if state.get('stopping'):
                        time.sleep(.05)
                        continue
                    try:
                        reg = request(config, token, '/register', {'owner': {'pid': current.pid, 'created': current.created},
                            'env': {k: os.environ[k] for k in manifest['environment_names'] if k in os.environ}})
                        return {'Authorization': 'Bearer ' + token, 'X-Tools-Demand-Client': reg['client']}
                    except HTTPError as error:
                        # Registration was explicitly rejected before acceptance.
                        # This never retries a tool request or an accepted RPC.
                        if error.code != 503:
                            raise
                        reply = json.load(error)
                        if reply.get('service') != state['service'] or reply.get('identity') != state['identity']:
                            raise ValueError('Unknown registration listener preserved')
                except OSError as error:
                    reason = getattr(error, 'reason', error)
                    if not isinstance(reason, (ConnectionRefusedError, ConnectionResetError)) and getattr(reason, 'winerror', None) not in (10061, 10054):
                        raise
                    if isinstance(reason, ConnectionResetError):
                        time.sleep(.05)
                        continue
                    if launched:
                        if not launched.alive():
                            raise RuntimeError('Owned gateway exited during startup')
                    else:
                        command = subprocess.list2cmdline([sys.executable, '-B', str(Path(__file__).with_name('demand_http.py').resolve()), '--home', str(home)])
                        pwsh = Path(config['powershell']) if config.get('powershell') else Path(os.environ['USERPROFILE']) / '.cache/codex-runtimes/codex-primary-runtime/dependencies/native/powershell/pwsh.exe'
                        result = subprocess.run([str(pwsh), '-NoProfile', '-NonInteractive', '-File',
                            str(Path(__file__).with_name('demand_http_spawn.ps1').resolve()), '-TaskCommand', command, '-TaskFolder', str(home)],
                            stdin=subprocess.DEVNULL, capture_output=True, creationflags=FLAGS, timeout=7, check=True)
                        launched = ProcessOwner(json.loads(result.stdout.decode('utf-8-sig'))['pid'])
                time.sleep(.05)
            raise RuntimeError('Owned gateway startup deadline')
    finally:
        current.close()
        if 'launched' in locals() and launched:
            launched.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--home', required=True, type=Path)
    p.add_argument('--status', action='store_true')
    p.add_argument('--owner', type=int)
    try:
        a = p.parse_args()
        print(json.dumps(headers(a.home, a.owner, not a.status)))
    except Exception:
        print('Demand HTTP helper failed; no credential or RPC data logged.', file=sys.stderr)
        raise SystemExit(1)
