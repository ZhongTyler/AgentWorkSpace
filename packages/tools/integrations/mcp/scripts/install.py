"""Install pinned research MCPs; render or merge only owned Codex registrations."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib

BASE = Path(__file__).resolve().parents[1]
BEGIN = '# BEGIN research-sources managed MCP registrations'
END = '# END research-sources managed MCP registrations'


def run(args):
    subprocess.run([str(x) for x in args], check=True)


def quote(value):
    return json.dumps(str(value).replace('\\', '/'), ensure_ascii=False)


def render(runtime, node, servers):
    lines = [BEGIN]
    for s in servers:
        lines += ['', '[mcp_servers.' + s['id'] + ']']
        local_auth = os.name == 'nt' and s['id'] in ['research-github', 'research-v2ex', 'research-zhihu']
        if local_auth:
            args = [str(runtime / 'launch-auth.mjs'), s['id'], shutil.which('pwsh') or 'powershell.exe']
            lines += ['command = ' + quote(node),
                      'args = ' + json.dumps([x.replace('\\', '/') for x in args], ensure_ascii=False)]
        elif s['kind'] == 'http':
            lines.append('url = ' + quote(s['url']))
        elif s['kind'] == 'python':
            entry = runtime / 'reddit-venv' / ('Scripts/reddit-rss-mcp.exe' if os.name == 'nt' else 'bin/reddit-rss-mcp')
            lines.append('command = ' + quote(entry))
        elif s['kind'] == 'node':
            entry = runtime / 'node_modules' / s['entry']
            args = [str(entry)]
            lines += ['command = ' + quote(node), 'args = ' + json.dumps([str(x).replace('\\', '/') for x in args], ensure_ascii=False)]
        else:
            raise ValueError('Unsupported MCP transport: ' + s['kind'])
        lines += ['enabled = ' + str(s['enabled']).lower(), 'required = false',
                  'startup_timeout_sec = 30', 'tool_timeout_sec = 45',
                  'enabled_tools = ' + json.dumps(s['tools'])]
        if s.get('env_vars') and not local_auth:
            lines.append('env_vars = ' + json.dumps(s['env_vars']))
        if s.get('headers') and not local_auth:
            lines.append('http_headers = { ' + ', '.join(quote(k) + ' = ' + quote(v) for k, v in s['headers'].items()) + ' }')
        if s.get('token_env') and not local_auth:
            lines.append('bearer_token_env_var = ' + quote(s['token_env']))
        if s.get('env'):
            lines += ['[mcp_servers.' + s['id'] + '.env]']
            lines += [k + ' = ' + quote(v) for k, v in s['env'].items()]
    return '\n'.join(lines) + '\n' + END + '\n'


def merge(current, block, owned):
    if current.count(BEGIN) != current.count(END) or current.count(BEGIN) > 1:
        raise ValueError('Malformed managed block; preserve config and inspect manually.')
    outside = re.sub(re.escape(BEGIN) + r'.*?' + re.escape(END) + r'\r?\n?', '', current, flags=re.S)
    parsed = tomllib.loads(outside)
    overlap = set(parsed.get('mcp_servers', {})) & set(owned)
    if overlap:
        raise ValueError('Existing non-owned registrations would collide: ' + ', '.join(sorted(overlap)))
    combined = outside.rstrip() + '\n\n' + block
    # Initial package defaults must not disable accounts already connected on this host.
    previous = tomllib.loads(current).get('mcp_servers', {})
    for name in owned:
        if name in previous and isinstance(previous[name].get('enabled'), bool):
            enabled = str(previous[name]['enabled']).lower()
            combined = re.sub(r'(\[mcp_servers\.' + re.escape(name) + r'\][\s\S]*?\nenabled = )(true|false)',
                              lambda m: m[1] + enabled, combined, count=1)
    tomllib.loads(combined)
    return combined


def verify_archives():
    locks = [json.loads((BASE / 'source-lock.json').read_text(encoding='utf-8'))['sources'],
             [json.loads((BASE / 'reddit-package-lock.json').read_text(encoding='utf-8'))],
             json.loads((BASE / 'npm-package-lock.json').read_text(encoding='utf-8'))['packages'],
             [json.loads((BASE / 'xhs-compat-lock.json').read_text(encoding='utf-8'))]]
    for rec in sum(locks, []):
        if not rec.get('file'):
            continue
        path = (BASE / rec['file']).resolve()
        if not path.is_relative_to((BASE / 'vendor').resolve()):
            raise ValueError('Archive outside vendor: ' + rec['file'])
        if hashlib.sha256(path.read_bytes()).hexdigest() != rec['sha256']:
            raise ValueError('Archive checksum mismatch: ' + rec['file'])


def repair_juejin(runtime):
    package = json.loads((runtime / 'node_modules/agent-search-mcp/package.json').read_text(encoding='utf-8'))
    if package['version'] != '3.2.1':
        raise ValueError('Juejin repair is reviewed only for agent-search-mcp 3.2.1; inspect a different version first.')
    target = runtime / 'node_modules/agent-search-mcp/dist/tools/fetch-tools.js'
    current = target.read_text(encoding='utf-8')
    start = current.index('export async function fetchJuejinArticle(url) {')
    end = current.index('/** Register the GitHub README fetch tool. */', start)
    replacement = '''export async function fetchJuejinArticle(url) {
    return readPublicJuejinArticle(url);
}
'''
    prefix = "import { fetchJuejinArticle as readPublicJuejinArticle } from './research-juejin-reader.mjs';\n"
    updated = current[:start] + replacement + current[end:]
    if prefix not in updated:
        updated = prefix + updated
    shutil.copy2(BASE / 'scripts/juejin-reader.mjs', target.parent / 'research-juejin-reader.mjs')
    target.write_text(updated, encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--node', default=shutil.which('node'))
    parser.add_argument('--npm', default=shutil.which('npm.cmd') or shutil.which('npm'))
    parser.add_argument('--uv', default=shutil.which('uv'))
    parser.add_argument('--config', type=Path)
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--repair-juejin', action='store_true', help='Apply the saved public-page reader repair to an existing runtime')
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    runtime = args.runtime.resolve()
    if runtime == BASE or runtime.is_relative_to(BASE):
        raise ValueError('Runtime must be outside the distributable integration directory.')
    if not args.node:
        raise ValueError('Node.js >=24 is required.')
    version = subprocess.check_output([args.node, '--version'], text=True).strip()
    if int(version.lstrip('v').split('.')[0]) < 24:
        raise ValueError('Node.js >=24 is required.')
    verify_archives()
    if args.install:
        if not args.npm or not args.uv:
            raise ValueError('npm and uv are required for --install.')
        runtime.mkdir(parents=True, exist_ok=True)
        for name in ['package.json', 'package-lock.json']:
            shutil.copy2(BASE / name, runtime / name)
        run([args.npm, 'ci', '--prefix', runtime, '--ignore-scripts', '--no-fund'])
        run([args.uv, 'venv', '--allow-existing', runtime / 'reddit-venv', '--python', sys.executable])
        run([args.uv, 'pip', 'sync', '--python', runtime / 'reddit-venv' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python'), BASE / 'reddit-requirements.lock'])
    if args.install or args.repair_juejin:
        repair_juejin(runtime)
    if args.install or args.apply:
        runtime.mkdir(parents=True, exist_ok=True)
        for name in ['launch-auth.ps1', 'launch-auth.mjs', 'connect-local.py', 'auth-http-bridge.mjs']:
            shutil.copy2(BASE / 'scripts' / name, runtime / name)
    servers = json.loads((BASE / 'servers.json').read_text(encoding='utf-8'))['servers']
    block = render(runtime, args.node, servers)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(block, encoding='utf-8')
    if args.apply:
        if not args.config:
            raise ValueError('--config is required for --apply.')
        current = args.config.read_text(encoding='utf-8-sig') if args.config.exists() else ''
        combined = merge(current, block, [s['id'] for s in servers])
        args.config.parent.mkdir(parents=True, exist_ok=True)
        if args.config.exists():
            backup = args.config.with_name(args.config.name + '.research-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S') + '.bak')
            shutil.copy2(args.config, backup)
        temp = args.config.with_suffix('.research.tmp')
        temp.write_text(combined, encoding='utf-8')
        temp.replace(args.config)
        print('Research MCP registrations saved; existing enabled states preserved, new account entries default disabled.')
    else:
        print('Preview complete; configuration unchanged.' + (' Template: ' + str(args.output) if args.output else ''))


if __name__ == '__main__':
    main()
