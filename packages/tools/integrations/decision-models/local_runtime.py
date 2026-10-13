"""One shared, loopback-only inference process; no model loaded by the MCP client."""
import contextlib
import json
import msvcrt
import os
from pathlib import Path
import secrets
import subprocess
import sys
import time

import httpx

BASE = Path(__file__).resolve().parent
RUNTIME = BASE / 'runtime'
PYTHON = RUNTIME / 'intern-2b/Scripts/python.exe'
STATE = RUNTIME / 'service-state.json'
URL = 'http://127.0.0.1:18762'
IDENTITY = 'research-intern-decision-2b-v1'


@contextlib.contextmanager
def startup_lock():
    RUNTIME.mkdir(parents=True, exist_ok=True)
    with (RUNTIME / 'startup.lock').open('a+b') as handle:
        if handle.tell() == 0:
            handle.write(b'0'); handle.flush()
        deadline = time.monotonic() + 160
        while True:
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                break
            except OSError:
                if time.monotonic() >= deadline:
                    raise RuntimeError('Another local model startup is still in progress')
                time.sleep(.25)
        try:
            yield
        finally:
            handle.seek(0); msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)


def connection():
    return json.loads(STATE.read_text(encoding='utf-8')) if STATE.exists() else None


def request(method, endpoint, payload=None, timeout=10):
    state = connection()
    if not state:
        raise RuntimeError('Local service has not been started')
    with httpx.Client(trust_env=False, follow_redirects=False, timeout=timeout) as client:
        response = client.request(method, URL + endpoint, json=payload,
                                  headers={'Authorization': 'Bearer ' + state['token']})
        response.raise_for_status()
        result = response.json()
    if result.get('integration') != IDENTITY:
        raise RuntimeError('Unexpected local service identity')
    return result


def status():
    try:
        return request('GET', '/health', timeout=2)
    except (httpx.NetworkError, httpx.RemoteProtocolError, httpx.TimeoutException, RuntimeError):
        return {'integration': IDENTITY, 'status': 'stopped', 'model_loaded': False}


def ensure_started():
    if status().get('model_loaded'):
        return
    with startup_lock():
        if status().get('model_loaded'):
            return
        # Refuse to take over an unrelated listener, even if an old state file exists.
        import socket
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', 18762)) == 0:
                raise RuntimeError('Port 18762 is occupied; inspect it before retrying')
        state = {'token': secrets.token_urlsafe(32), 'integration': IDENTITY}
        STATE.write_text(json.dumps(state), encoding='utf-8')
        env = dict(os.environ, HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1',
                   HF_HUB_DISABLE_TELEMETRY='1', PYTHONUTF8='1')
        with (RUNTIME / 'service.log').open('ab') as log:
            process = subprocess.Popen([str(PYTHON), '-X', 'utf8', '-B', str(BASE / 'service.py')],
                cwd=BASE, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW)
        deadline = time.monotonic() + 150
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError(f'Local model startup failed (exit {process.returncode}); inspect runtime/service.log and available system commit memory')
            if status().get('model_loaded'):
                return
            time.sleep(.5)
        process.terminate()
        raise RuntimeError('Local model startup exceeded 150 seconds')


def predict(state, questions):
    ensure_started()
    return request('POST', '/v1/decisions', {'state': state, 'questions': questions}, timeout=120)


def stop():
    if not status().get('model_loaded'):
        return {'integration': IDENTITY, 'status': 'already_stopped'}
    return request('POST', '/shutdown')


if __name__ == '__main__':
    print(json.dumps(stop() if sys.argv[1:] == ['stop'] else status(), ensure_ascii=False))
