"""Versioned upgrade from existing demand transports; never reloads clients."""
import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib

from demand_admin import section, write_config
from demand_common import atomic_json, digest, private_read, private_write
from demand_plugin import checked_source

FILES = ['demand_common.py', 'demand_broker.py', 'demand_plugin.py', 'demand_http.py',
         'demand_http_headers.py', 'demand_http_spawn.ps1', 'demand_managed_http.mjs']
PROFILES = ['rea', 'steam', 'research-reddit', 'research-decisions', 'research-juejin',
            'research-zhihu', 'local-research-pilot', 'godot', 'research-hn', 'research-rss']
PLUGINS = [('plugin-code-review', 'code-review', '26.1013.31256'),
           ('plugin-cua', 'unified-computer-use', '26.1013.31256')]
TRANSPORT_KEYS = {'command', 'args', 'cwd', 'env', 'env_vars', 'url', 'auth', 'http_headers',
                  'env_http_headers', 'bearer_token_env_var', 'http_headers_helper'}


def http_spec(original, helper, port, name):
    # The desktop supplies this capability to its native STDIO child. A cached
    # HTTP catalog can look healthy while the header helper never receives it.
    # Do not discover another client's pipe or freeze a stale pipe into config.
    forwarded = [v.get('name') if isinstance(v, dict) else v for v in original.get('env_vars', [])]
    if name == 'plugin-codex-app' or 'CODEX_APP_TOOLS_PIPE_PATH' in forwarded or 'CODEX_APP_TOOLS_PIPE_PATH' in original.get('env', {}):
        raise ValueError('Host-bound app tools require the native desktop STDIO transport')
    if original.get('experimental_environment') == 'remote':
        raise ValueError('Remote executor placement is outside this local adapter')
    return {**{k: v for k, v in original.items() if k not in TRANSPORT_KEYS},
            'url': f'http://127.0.0.1:{port}/mcp/{name}', 'http_headers_helper': helper}


def render(name, spec):
    def value(v):
        if isinstance(v, dict):
            return '{ ' + ', '.join(json.dumps(k) + ' = ' + value(item) for k, item in v.items()) + ' }'
        if isinstance(v, list):
            return '[' + ', '.join(value(item) for item in v) + ']'
        return json.dumps(v, ensure_ascii=False)
    lines = ['[mcp_servers.' + name + ']']
    for key, item in spec.items():
        if not isinstance(item, dict):
            lines.append(key + ' = ' + value(item))
    for key, item in spec.items():
        if isinstance(item, dict):
            lines += ['', '[mcp_servers.' + name + '.' + key + ']']
            lines += [json.dumps(k) + ' = ' + value(v) for k, v in item.items()]
    return '\n'.join(lines) + '\n\n'


def config_change(raw, records, reverse=False):
    text = raw.decode('utf-8')
    for record in records:
        before, after = record['original'], record['replacement']
        if reverse:
            before, after = after, before
        if record['kind'] == 'section':
            _, start, end = section(text.encode(), record['name'])
            if text[start:end] != before:
                raise ValueError('Configuration owner changed; preserved')
            text = text[:start] + after + text[end:]
        elif before:
            if text.count(before) != 1:
                raise ValueError('Unload setting owner changed; preserved')
            text = text.replace(before, after, 1)
        else:
            text = after + text
    tomllib.loads(text)
    return text.encode('utf-8')


def prepare(home, config, source_home, plugin_home, port=18089):
    if home.exists():
        raise ValueError('Choose a fresh immutable home')
    home.mkdir(parents=True)
    # Desktop MSIX virtualizes newly written LocalAppData files. WMI starts
    # outside that package context and needs the actual physical directory.
    home = home.resolve()
    root = Path(__file__).parent
    hashes = {n: hashlib.sha256((root / n).read_bytes()).hexdigest() for n in FILES}
    revision = digest(hashes)[:20]
    runtime = home / 'runtime' / revision
    runtime.mkdir(parents=True)
    for name in FILES:
        shutil.copyfile(root / name, runtime / name)
    (home / 'catalogs').mkdir()
    manifest = copy.deepcopy(private_read(source_home / 'profiles.dpapi'))
    manifest['profiles'] = {k: v for k, v in manifest['profiles'].items() if k in PROFILES + ['plugin-code-review']}
    manifest.update(port=0, broker_idle_seconds=30)
    helper = subprocess.list2cmdline([sys.executable, '-X', 'utf8', '-B', str(runtime / 'demand_http_headers.py'), '--home', str(home)])
    raw = config.read_bytes(); parsed = tomllib.loads(raw.decode('utf-8'))
    records = []
    for name in PROFILES:
        current = parsed['mcp_servers'][name]
        argv = current.get('args', [])
        if 'demand_proxy.py' not in ' '.join(argv) or str(source_home) not in argv or name not in argv:
            raise ValueError('Expected existing owned demand transport')
        if current.get('env', {}) != manifest['profiles'][name]['source'].get('env', {}):
            raise ValueError('Native environment changed; recapture before upgrading')
        text, start, end = section(raw, name)
        records.append({'kind': 'section', 'name': name, 'original': text[start:end],
                        'replacement': render(name, http_spec(current, helper, port, name))})
    # This installed core accepts the setting; the private lifecycle probe tests
    # its behavior, including an active locally mocked turn, before apply.
    unload = parsed.get('thread_unload_delay_secs', 1800)
    if not isinstance(unload, int) or unload < 0:
        raise ValueError('Unexpected unload policy')
    if unload > 120:
        text = raw.decode('utf-8')
        header = re.search(r'(?m)^\s*\[', text)
        top = text[:header.start()] if header else text
        found = re.search(r'(?m)^thread_unload_delay_secs\s*=.*(?:\r?\n|$)', top)
        original = found[0] if found else ''
        records.append({'kind': 'setting', 'original': original, 'replacement': 'thread_unload_delay_secs = 120\n'})
    plugin_records = []
    old_plugins = json.loads((plugin_home / 'prepared.json').read_bytes())
    for name, package, version in PLUGINS:
        folder = Path(os.environ['USERPROFILE']) / '.codex/plugins/cache/openai-bundled' / package / version
        identity_path = folder / '.codex-plugin/plugin.json'
        identity_bytes = identity_path.read_bytes(); identity = json.loads(identity_bytes)
        old_transport = folder / identity['mcpServers']
        original_transport = json.loads(old_transport.read_bytes())
        server, current = next(iter(original_transport['mcpServers'].items()))
        if name == 'plugin-code-review':
            if 'demand_proxy.py' not in ' '.join(current.get('args', [])):
                raise ValueError('Expected owned code-review facade')
        else:
            review = json.loads((plugin_home / (name + '-review.json')).read_bytes())
            checked_source(review)
            previous = next(r for r in old_plugins['records'] if r['profile'] == name)
            if identity_bytes.decode('utf-8') != previous['replacement'] or old_transport.read_bytes().decode('utf-8') != previous['transport_contents']:
                raise ValueError('Plugin owner changed after prior installation')
            catalog = home / 'catalogs' / (name + '.json')
            shutil.copyfile(review['catalog'], catalog)
            review['catalog'] = str(catalog); review['events'] = str(home / 'events.jsonl')
            review_path = home / (name + '-review.json'); atomic_json(review_path, review)
            manifest['profiles'][name] = {'mode': 'session', 'plugin_review': str(review_path)}
        target = folder / '.demand-http.mcp.json'
        if target.exists():
            raise ValueError('Another HTTP transport owner exists')
        replacement = copy.deepcopy(identity); replacement['mcpServers'] = './.demand-http.mcp.json'
        transport = copy.deepcopy(original_transport)
        transport['mcpServers'][server] = http_spec(current, helper, port, name)
        plugin_records.append({'path': str(identity_path), 'original': identity_bytes.decode('utf-8'),
            'replacement': json.dumps(replacement, ensure_ascii=False, indent=2) + '\n',
            'transport': str(target), 'transport_contents': json.dumps(transport, ensure_ascii=False, indent=2) + '\n'})
    for name, profile in manifest['profiles'].items():
        if 'plugin_review' in profile:
            continue
        cache = json.loads(Path(profile['catalog']).read_bytes())
        if digest(cache) != profile['catalog_sha256'] or cache['profile_sha256'] != digest(profile['source']):
            raise ValueError('Old catalog differs')
        target = home / 'catalogs' / (name + '.json')
        shutil.copyfile(profile['catalog'], target); profile['catalog'] = str(target)
    for kind, offset in [('hn', 2), ('rss', 4)]:
        profile = manifest['profiles']['research-' + kind]
        previous_wrapper = profile['args'][0]
        profile['args'] = [str(runtime / 'demand_managed_http.mjs')]
        profile['fingerprints'].pop(previous_wrapper, None)
        profile['fingerprints'][str(runtime / 'demand_managed_http.mjs')] = hashes['demand_managed_http.mjs']
        profile['env']['TOOLS_DEMAND_HTTP_HOME'] = str(home / ('managed-' + kind))
        profile['env']['TOOLS_DEMAND_PORT'] = str(port + offset)
    private_write(home / 'profiles.dpapi', manifest)
    private_write(home / 'token.dpapi', {'token': os.urandom(32).hex()})
    http_config = {'port': port, 'runtime_revision': revision, 'runtime_sha256': hashes}
    private_write(home / 'http.dpapi', http_config)
    private_write(home / 'changes.dpapi', {'config': str(config), 'records': records, 'plugins': plugin_records})
    cua = next(r for r in old_plugins['records'] if 'cua_entry' in r)
    prepared = {'schema': 1, 'runtime_revision': revision, 'runtime_sha256': hashes,
                'profiles': list(manifest['profiles']), 'thread_unload_delay_secs': min(unload, 120),
                'manifest_sha256': digest(manifest), 'http_sha256': digest(http_config),
                'review_sha256': {spec['plugin_review']: hashlib.sha256(Path(spec['plugin_review']).read_bytes()).hexdigest()
                                  for spec in manifest['profiles'].values() if 'plugin_review' in spec},
                'cua_entry': cua['cua_entry'], 'cua_entry_sha256': hashlib.sha256(Path(cua['cua_entry']).read_bytes()).hexdigest()}
    atomic_json(home / 'prepared.json', prepared)
    return {'profiles': len(manifest['profiles']), 'runtime_revision': revision, 'backends_started': False}


def audit_runtime(home):
    prepared = json.loads((home / 'prepared.json').read_bytes())
    runtime = home / 'runtime' / prepared['runtime_revision']
    if any(hashlib.sha256((runtime / n).read_bytes()).hexdigest() != h for n, h in prepared['runtime_sha256'].items()):
        raise ValueError('Immutable runtime changed')
    if hashlib.sha256(Path(prepared['cua_entry']).read_bytes()).hexdigest() != prepared['cua_entry_sha256']:
        raise ValueError('Desktop CUA entry changed; preserve it and recheck')
    if digest(private_read(home / 'profiles.dpapi')) != prepared['manifest_sha256'] or digest(private_read(home / 'http.dpapi')) != prepared['http_sha256']:
        raise ValueError('Immutable HTTP settings changed')
    if any(hashlib.sha256(Path(p).read_bytes()).hexdigest() != h for p, h in prepared['review_sha256'].items()):
        raise ValueError('Immutable plugin review changed')
    return prepared


def apply(home, reverse=False):
    audit_runtime(home)
    changes = private_read(home / 'changes.dpapi')
    path = Path(changes['config']); before = path.read_bytes()
    after = config_change(before, changes['records'], reverse)
    for r in changes['plugins']:
        expected = r['replacement'] if reverse else r['original']
        if Path(r['path']).read_bytes() != expected.encode('utf-8'):
            raise ValueError('Plugin owner changed; preserved')
        target = Path(r['transport'])
        if reverse:
            if target.read_bytes() != r['transport_contents'].encode('utf-8'):
                raise ValueError('HTTP transport owner changed; preserved')
        elif target.exists():
            raise ValueError('HTTP transport owner appeared; preserved')
    written = []
    try:
        for r in changes['plugins']:
            if not reverse:
                with Path(r['transport']).open('xb') as out:
                    out.write(r['transport_contents'].encode('utf-8'))
            written.append(r)
            write_config(Path(r['path']), (r['replacement'] if reverse else r['original']).encode('utf-8'),
                         (r['original'] if reverse else r['replacement']).encode('utf-8'))
        write_config(path, before, after)
    except Exception:
        for r in reversed(written):
            target = Path(r['path'])
            owned = (r['original'] if reverse else r['replacement']).encode('utf-8')
            previous = (r['replacement'] if reverse else r['original']).encode('utf-8')
            current = target.read_bytes()
            if current == owned:
                write_config(target, owned, previous)
            elif current != previous:
                raise ValueError('Concurrent plugin owner preserved; inspect frozen change plan')
            transport = Path(r['transport'])
            if not reverse and transport.read_bytes() == r['transport_contents'].encode('utf-8'):
                transport.unlink()
        raise
    # Retain immutable data and HTTP transport files on rollback: clients that
    # already hold a URL/registration may finish without being restarted.
    atomic_json(home / ('rollback-receipt.json' if reverse else 'apply-receipt.json'),
                {'config_sha256': hashlib.sha256(after).hexdigest(), 'reloaded': False, 'stopped_processes': 0})
    return {'applied': not reverse, 'reloaded': False, 'stopped_processes': 0}


def check(home):
    audit_runtime(home)
    changes = private_read(home / 'changes.dpapi')
    # Reverse in memory validates exact owned segments, preserving unrelated edits.
    config_change(Path(changes['config']).read_bytes(), changes['records'], True)
    for r in changes['plugins']:
        if Path(r['path']).read_bytes() != r['replacement'].encode('utf-8') or Path(r['transport']).read_bytes() != r['transport_contents'].encode('utf-8'):
            raise ValueError('Installed wiring differs')
    manifest = private_read(home / 'profiles.dpapi')
    for spec in manifest['profiles'].values():
        if 'plugin_review' in spec:
            review = json.loads(Path(spec['plugin_review']).read_bytes())
            checked_source(review)
            if digest(json.loads(Path(review['catalog']).read_bytes())) != review['catalog_sha256']:
                raise ValueError('Reviewed catalog changed')
        elif digest(json.loads(Path(spec['catalog']).read_bytes())) != spec['catalog_sha256']:
            raise ValueError('Reviewed catalog changed')
    return {'runtime_unchanged': True, 'wiring_unchanged': True, 'desktop_cua_entry_unchanged': True, 'backends_started': False}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action', choices=['prepare', 'apply', 'check', 'rollback'])
    p.add_argument('--home', required=True, type=Path)
    p.add_argument('--config', type=Path)
    p.add_argument('--source-home', type=Path)
    p.add_argument('--plugin-home', type=Path)
    p.add_argument('--port', type=int, default=18089)
    a = p.parse_args()
    if a.action == 'prepare':
        result = prepare(a.home, a.config, a.source_home, a.plugin_home, a.port)
    elif a.action == 'check':
        result = check(a.home)
    else:
        result = apply(a.home, a.action == 'rollback')
    print(json.dumps(result))
