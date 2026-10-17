"""Local MCP demand runtime primitives. Standard library only; no tool imports."""
import contextlib
import ctypes
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

MAX_FRAME = 32 * 1024 * 1024
FLAGS = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0


def pack(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':')).encode('utf-8') + b'\n'


def digest(value):
    return hashlib.sha256(pack(value)).hexdigest()


def atomic_json(path, value):
    path = Path(path)
    tmp = path.with_name(path.name + '.' + secrets.token_hex(8) + '.tmp')
    try:
        with tmp.open('xb') as out:
            out.write(pack(value)); out.flush(); os.fsync(out.fileno())
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def protect(data, decrypt=False):
    if os.name != 'nt':
        raise RuntimeError('This local credential profile requires Windows DPAPI')
    from ctypes import wintypes
    class Blob(ctypes.Structure):
        _fields_ = [('size', wintypes.DWORD), ('data', ctypes.POINTER(ctypes.c_ubyte))]
    buf = ctypes.create_string_buffer(data)
    source = Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_ubyte)))
    result = Blob()
    crypt = ctypes.WinDLL('crypt32', use_last_error=True)
    if decrypt:
        ok = crypt.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(result))
    else:
        ok = crypt.CryptProtectData(ctypes.byref(source), 'Tools MCP demand', None, None, None, 1, ctypes.byref(result))
    if not ok:
        raise OSError(ctypes.get_last_error(), 'Local credential operation failed')
    try:
        return ctypes.string_at(result.data, result.size)
    finally:
        ctypes.WinDLL('kernel32').LocalFree(result.data)


def private_read(path):
    return json.loads(protect(Path(path).read_bytes(), decrypt=True))


def private_write(path, value):
    Path(path).write_bytes(protect(pack(value)))


@contextlib.contextmanager
def startup_lock(home):
    import msvcrt
    home = Path(home); home.mkdir(parents=True, exist_ok=True)
    with (home / 'startup.lock').open('a+b') as lock:
        if lock.tell() == 0:
            lock.write(b'0'); lock.flush()
        deadline = time.monotonic() + 20
        while True:
            lock.seek(0)
            try:
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1); break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Demand startup owner busy')
                time.sleep(.05)
        try:
            yield
        finally:
            lock.seek(0); msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


class OwnedJob:
    """A kernel-owned child tree; never enumerates or kills unrelated PIDs."""
    def __init__(self, process):
        self.handle = None
        if os.name != 'nt':
            return
        from ctypes import wintypes
        class Basic(ctypes.Structure):
            _fields_ = [('process_time', ctypes.c_int64), ('job_time', ctypes.c_int64),
                        ('flags', wintypes.DWORD), ('min_ws', ctypes.c_size_t),
                        ('max_ws', ctypes.c_size_t), ('active_limit', wintypes.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD),
                        ('scheduling', wintypes.DWORD)]
        class IO(ctypes.Structure):
            _fields_ = [(x, ctypes.c_uint64) for x in ('read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes')]
        class Extended(ctypes.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('process_mem', ctypes.c_size_t),
                        ('job_mem', ctypes.c_size_t), ('peak_process', ctypes.c_size_t), ('peak_job', ctypes.c_size_t)]
        k = ctypes.WinDLL('kernel32', use_last_error=True)
        k.CreateJobObjectW.restype = wintypes.HANDLE
        k.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        k.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        k.CloseHandle.argtypes = [wintypes.HANDLE]
        self.kernel = k
        handle = k.CreateJobObjectW(None, None)
        limits = Extended(); limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE
        if not handle or not k.SetInformationJobObject(handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
            if handle: k.CloseHandle(handle)
            raise OSError('Cannot establish owned child job')
        if not k.AssignProcessToJobObject(handle, wintypes.HANDLE(int(process._handle))):
            k.CloseHandle(handle)
            raise OSError('Cannot attach owned child job; launch refused')
        self.handle = handle

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle); self.handle = None


class Backend:
    """Raw newline JSON-RPC, including server callbacks and notifications."""
    def __init__(self, profile, env, emit, event):
        import queue
        import threading
        self.profile, self.emit, self.event = profile, emit, event
        self.lock = threading.RLock(); self.write_lock = threading.Lock()
        self.responses = queue.Queue(); self.process = None; self.job = None
        self.current = None; self.owner = None; self.current_id = None; self.seq = 0; self.inflight = 0
        self.last_used = time.monotonic(); self.env = env
        self.initialized = False; self.closed = False
        self.reservations = 0

    def write(self, msg):
        with self.write_lock:
            self.process.stdin.write(pack(msg)); self.process.stdin.flush()

    def _read(self):
        try:
            while True:
                line = self.process.stdout.readline(MAX_FRAME + 1)
                if not line: break
                if len(line) > MAX_FRAME: raise ValueError('Oversized backend frame')
                try: msg = json.loads(line)
                except (ValueError, UnicodeError): raise ValueError('Non-protocol backend stdout')
                if not isinstance(msg, dict): raise ValueError('Invalid backend frame')
                if 'method' not in msg:
                    self.responses.put(msg)
                elif self.current or self.owner:
                    # At most one active call per worker, so progress/callback IDs
                    # cannot cross clients, even if clients reuse the same IDs.
                    self.emit(self.current or self.owner, msg)
        except Exception:
            pass
        finally:
            self.responses.put(None)

    def start(self, init):
        import threading
        if self.closed: raise RuntimeError('Backend already closed')
        if self.process: return
        p = self.profile
        for filename, expected in p.get('fingerprints', {}).items():
            if hashlib.sha256(Path(filename).read_bytes()).hexdigest()!=expected:
                raise RuntimeError('Reviewed backend source changed; recapture required')
        owned_tree=p.get('tree_policy','owned_job')=='owned_job'
        suspended=4 if os.name=='nt' and owned_tree else 0
        self.process = subprocess.Popen([p['command'], *p.get('args', [])],
            cwd=p.get('cwd') or None, env={**self.env, **p.get('env', {})},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            creationflags=FLAGS|suspended, bufsize=0)
        try:
            if owned_tree:self.job = OwnedJob(self.process)
            if suspended:
                from ctypes import wintypes
                resume=ctypes.WinDLL('ntdll').NtResumeProcess
                resume.argtypes=[wintypes.HANDLE];resume.restype=ctypes.c_long
                if resume(wintypes.HANDLE(int(self.process._handle)))!=0:raise OSError('Owned child resume failed')
        except Exception:
            self.process.terminate(); self.process.wait(timeout=5); raise
        threading.Thread(target=self._read, daemon=True).start()
        self.event('backend_start', pid=self.process.pid)
        result = self._exchange({'jsonrpc':'2.0','id':0,'method':'initialize','params':init}, p.get('startup_timeout', 30))
        if 'error' in result: raise RuntimeError('Backend initialization failed')
        self.initialize_result = result['result']
        self.write({'jsonrpc':'2.0','method':'notifications/initialized'})
        # Metadata cache is a discovery optimization, never an invented schema.
        # After startup the live server owns all subsequent catalogs/state.
        self.initialized = True

    def _exchange(self, msg, timeout):
        import queue
        self.seq += 1; backend_id = self.seq
        self.write({**msg, 'id':backend_id})
        deadline = time.monotonic() + timeout
        while True:
            try: result = self.responses.get(timeout=max(.001, deadline-time.monotonic()))
            except queue.Empty: raise TimeoutError('Backend request deadline; outcome unknown, not replayed')
            if result is None: raise RuntimeError('Backend exited; outcome unknown, not replayed')
            if result.get('id') == backend_id:
                return {**result, 'id':msg['id']}
            if time.monotonic() >= deadline: raise TimeoutError('Backend request deadline')

    def request(self, session, msg, init):
        with self.lock:
            if session is not None and (session.closed or msg['id'] in session.cancelled):
                session.cancelled.discard(msg['id'])
                return {'jsonrpc':'2.0','id':msg['id'],'error':{'code':-32800,'message':'Request cancelled before execution'}}
            self.inflight += 1; self.current = session
            self.current_id = msg['id']
            if self.profile['mode']=='session': self.owner = session
            try:
                self.start(init)
                if msg.get('method')=='initialize':return {'jsonrpc':'2.0','id':msg['id'],'result':self.initialize_result}
                return self._exchange(msg, self.profile.get('tool_timeout', 180))
            except Exception:
                self.close(); raise
            finally:
                if session is not None:session.cancelled.discard(msg['id'])
                self.current = None; self.current_id = None; self.inflight -= 1; self.last_used = time.monotonic()

    def notify(self, session, msg):
        if self.process and not self.closed and (self.current is session or self.profile['mode']=='session'):
            # Cancellation request IDs must follow broker remapping.
            if msg.get('method') == 'notifications/cancelled':
                if self.current is not session or msg.get('params',{}).get('requestId')!=self.current_id: return
                msg = {**msg, 'params':{**msg.get('params', {}), 'requestId':self.seq}}
            self.write(msg)

    def close(self):
        if self.closed: return
        self.closed = True
        if self.process:
            try: self.process.stdin.close()
            except OSError: pass
            try: self.process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                if not self.job: self.process.terminate()
            if self.job: self.job.close()
            try: self.process.wait(timeout=5)
            except subprocess.TimeoutExpired: self.process.kill(); self.process.wait(timeout=5)
            self.event('backend_stop', pid=self.process.pid, exit_code=self.process.returncode)
            self.process.stdout.close()
        self.owner = None

    def snapshot(self):
        return {'pid': self.process.pid if self.process and not self.closed else None,
                'in_flight':self.inflight, 'idle_seconds':round(time.monotonic()-self.last_used, 2)}
