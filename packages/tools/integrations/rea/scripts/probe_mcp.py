"""Read-only stdio handshake, catalog and optional JS analysis; no target execution."""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path)
    parser.add_argument('--runtime', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    base = Path(__file__).resolve().parents[1]
    runtime = args.runtime.resolve() if args.runtime else base / 'runtime'
    entry = runtime / 'node_modules/rea-agents/scripts/rea.mjs'
    node = shutil.which('node')
    if not node or not entry.is_file():
        raise SystemExit('Pinned REA runtime or Node is missing')
    args.output.mkdir(parents=True, exist_ok=False)
    if args.target:
        target = args.target.resolve(strict=True)
        before = {str(p.relative_to(target)): hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in target.rglob('*') if p.is_file()}
    started = time.monotonic()
    proc = subprocess.Popen([node, str(entry), 'mcp'], stdin=subprocess.PIPE,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            text=True, encoding='utf-8', errors='replace',
                            env={**os.environ, 'PYTHONUTF8': '1'}, cwd=base)
    messages = queue.Queue()
    stderr = []
    def reader():
        for line in proc.stdout:
            messages.put(json.loads(line))
        messages.put(None)
    def errors():
        stderr.extend(proc.stderr)
    threading.Thread(target=reader, daemon=True).start()
    err_thread = threading.Thread(target=errors, daemon=True)
    err_thread.start()
    def send(message):
        proc.stdin.write(json.dumps(message, ensure_ascii=False) + '\n')
        proc.stdin.flush()
    def request(number, method, params, timeout=90):
        send({'jsonrpc': '2.0', 'id': number, 'method': method, 'params': params})
        deadline = time.monotonic() + timeout
        while True:
            msg = messages.get(timeout=max(0.01, deadline-time.monotonic()))
            if msg is None:
                raise RuntimeError('MCP stdout closed before response')
            if msg.get('id') == number:
                if 'error' in msg:
                    raise RuntimeError(msg['error'])
                return msg['result']
    def save(name, data):
        raw = json.dumps(data, ensure_ascii=False, separators=(',', ':')).encode()
        (args.output / name).write_bytes(gzip.compress(raw, mtime=0))
        return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
    receipt = {'date': datetime.datetime.now().astimezone().isoformat(),
               'node': node, 'entry': str(entry), 'transport': 'stdio',
               'client': 'independent JSON-RPC probe, not current Codex tool session',
               'target_executed': False}
    try:
        init = request(1, 'initialize', {'protocolVersion': '2025-11-25',
                       'capabilities': {}, 'clientInfo': {'name': 'research-rea-probe', 'version': '1.0.0'}})
        receipt['initialize'] = init
        send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        catalog = request(2, 'tools/list', {})
        all_tools = list(catalog['tools'])
        cursor = catalog.get('nextCursor')
        page = 10
        while cursor:
            catalog = request(page, 'tools/list', {'cursor': cursor})
            all_tools.extend(catalog['tools'])
            cursor = catalog.get('nextCursor')
            page += 1
        receipt['catalog'] = save('catalog.json.gz', {'tools': all_tools})
        receipt['catalog']['tool_count'] = len(all_tools)
        selected = next(t for t in all_tools if t['name'] == 'analyze_javascript_application')
        (args.output/'selected-tool.json').write_text(json.dumps(selected, indent=2)+'\n', encoding='utf-8')
        if args.target:
            params = {'input_path': str(target), 'format': 'auto', 'integrity_policy': 'fail'}
            if 'detail' in selected['inputSchema'].get('properties', {}):
                params['detail'] = 'summary'
            result = request(3, 'tools/call', {'name': selected['name'], 'arguments': params})
            receipt['analysis'] = {'tool': selected['name'], 'arguments': params,
                                   **save('analysis.json.gz', result), 'is_error': result.get('isError', False)}
            if result.get('isError'):
                raise RuntimeError('REA tool returned isError; inspect retained analysis')
            after = {str(p.relative_to(target)): hashlib.sha256(p.read_bytes()).hexdigest()
                     for p in target.rglob('*') if p.is_file()}
            assert before == after, 'Target changed'
            receipt['target_unchanged'] = True
        receipt['status'] = 'passed'
    except Exception as exc:
        receipt['status'] = 'failed'
        receipt['failure'] = repr(exc)
        raise
    finally:
        proc.stdin.close()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.terminate()
            proc.wait(timeout=5)
        err_thread.join(timeout=2)
        (args.output/'stderr.txt').write_text(''.join(stderr), encoding='utf-8')
        receipt['elapsed_seconds'] = round(time.monotonic()-started, 3)
        receipt['server_exit_code'] = proc.returncode
        (args.output/'receipt.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
        print(json.dumps(receipt, ensure_ascii=False))


if __name__ == '__main__':
    main()
