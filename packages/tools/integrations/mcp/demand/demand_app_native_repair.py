"""Scoped recovery of desktop app tools; never reload or terminate any client."""
import argparse
import hashlib
import json
from pathlib import Path
import os
import secrets
from demand_common import private_read
from demand_http_install import audit_runtime, config_change


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def native_manifest(raw, source):
    identity = json.loads(raw)
    if identity.get('name') != 'codex-app-tools' or identity.get('version') != '0.1.6' or identity.get('mcpServers') != './.demand-http.mcp.json':
        raise ValueError('Unexpected plugin identity or transport owner')
    spec = source.get('mcpServers', {}).get('codex_app', {})
    if spec.get('command', '').lower() != 'cmd.exe' or spec.get('args') != ['/d', '/s', '/c', 'call', './scripts/launch_codex_app_tools_mcp.cmd', './server.mjs'] or 'CODEX_APP_TOOLS_PIPE_PATH' not in spec.get('env_vars', []):
        raise ValueError('Desktop-generated native transport changed')
    identity['mcpServers'] = './.mcp.json'
    return (json.dumps(identity, ensure_ascii=False, indent=2) + '\n').encode('utf-8')


def shared_check(home, manifest_path, app_bytes):
    """Retain every existing shared-owner guard, with one explicit amendment."""
    audit_runtime(home)
    changes = private_read(home / 'changes.dpapi')
    config_change(Path(changes['config']).read_bytes(), changes['records'], reverse=True)
    matched = False
    for record in changes['plugins']:
        path = Path(record['path'])
        expected = record['replacement'].encode('utf-8')
        if path.resolve() == manifest_path.resolve():
            matched = True
            expected = app_bytes
        if path.read_bytes() != expected or Path(record['transport']).read_bytes() != record['transport_contents'].encode('utf-8'):
            raise ValueError('Another shared/plugin owner changed; preserved')
    if not matched:
        raise ValueError('App plugin is not owned by this shared installation')


def replace_guarded(path, before, after):
    if path.read_bytes() != before:
        raise ValueError('Concurrent manifest owner change; preserved')
    temporary = path.with_name(path.name + '.repair-' + secrets.token_hex(6))
    try:
        temporary.write_bytes(after)
        if path.read_bytes() != before:
            raise ValueError('Concurrent manifest owner change; preserved')
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def repair(action, home, plugin, evidence):
    path = plugin / '.codex-plugin/plugin.json'
    if action == 'apply':
        if evidence.exists():
            raise ValueError('Use a fresh evidence directory; existing recovery record preserved')
        before = path.read_bytes()
        after = native_manifest(before, json.loads((plugin / '.mcp.json').read_bytes()))
        shared_check(home, path, before)
        evidence.mkdir(parents=True)
        (evidence / 'before-manifest.json').write_bytes(before)
        (evidence / 'after-manifest.json').write_bytes(after)
        record = {'schema': 1, 'home': str(home.resolve()), 'plugin': str(plugin.resolve()),
                  'beforeSha256': digest(before), 'afterSha256': digest(after),
                  'processesTerminated': 0, 'otherPluginWiringChanged': False,
                  'nativeConnectionVerified': False, 'reloadRequiredForExistingHttpClients': True}
        (evidence / 'receipt.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
        replace_guarded(path, before, after)
    else:
        record = json.loads((evidence / 'receipt.json').read_bytes())
        if record['home'] != str(home.resolve()) or record['plugin'] != str(plugin.resolve()):
            raise ValueError('Recovery target changed')
        before, after = [(evidence / (name + '-manifest.json')).read_bytes() for name in ('before', 'after')]
        if digest(before) != record['beforeSha256'] or digest(after) != record['afterSha256']:
            raise ValueError('Recovery bytes changed')
        shared_check(home, path, after)
        if action == 'rollback':
            replace_guarded(path, after, before)
            return {'nativeManifest': False, 'rolledBack': True, 'processesTerminated': 0}
    shared_check(home, path, after)
    return {'nativeManifest': True, 'otherWiringVerified': True, 'processesTerminated': 0,
            'nativeConnectionVerified': False, 'reloadRequiredForExistingHttpClients': True}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['apply', 'check', 'rollback'])
    parser.add_argument('--home', required=True, type=Path)
    parser.add_argument('--plugin', required=True, type=Path)
    parser.add_argument('--evidence', required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(repair(args.action, args.home, args.plugin, args.evidence)))
