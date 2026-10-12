"""Opt-in pinned REA install and scoped Codex registration; default is a plan."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[1]
VERSION = '6.4.0'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def inventory(path):
    return {p.relative_to(path).as_posix(): digest(p.read_bytes())
            for p in path.rglob('*') if p.is_file()}


def skill_files(runtime):
    source = ROOT / 'skill/rea-investigate'
    result = {p.relative_to(source).as_posix(): p.read_bytes()
              for p in source.rglob('*') if p.is_file()}
    # Maintenance and public trees use the same installer; only public skill
    # contents are portable. The publisher prepares the matching references.
    if not (source / 'references/upstream/SKILL.md').is_file():
        raise ValueError('Use the portable released skill; maintenance skill is host-specific')
    paths = {'runtime': str(runtime), 'integration': str(ROOT), 'version': VERSION}
    result['references/install-paths.json'] = (json.dumps(paths, indent=2)+'\n').encode()
    return result


def config_bytes(config, node, entry):
    original = config.read_bytes() if config.exists() else b''
    value = tomllib.loads(original.decode('utf-8'))
    existing = value.get('mcp_servers', {}).get('rea')
    wanted = {'command': node, 'args': [str(entry), 'mcp']}
    if existing is not None:
        if any(existing.get(k) != v for k, v in wanted.items()) or existing.get('enabled') is False:
            raise ValueError('Existing rea registration differs or is disabled; preserve it and review')
        return original, original
    block = ('\n\n# REA: explicit Research tool setup\n[mcp_servers.rea]\n'
             'command = '+json.dumps(node)+'\nargs = '+json.dumps(wanted['args'])+
             '\nenabled = true\nrequired = false\nstartup_timeout_sec = 30\ntool_timeout_sec = 180\n')
    updated = original + block.encode()
    check = tomllib.loads(updated.decode('utf-8'))
    check['mcp_servers'].pop('rea')
    if 'mcp_servers' not in value:
        check.pop('mcp_servers')
    if check != value:
        raise ValueError('Unrelated configuration changed')
    return original, updated


def setup(runtime, codex_home, install=False, configure=False, skill=False, apply=False):
    runtime, codex_home = runtime.resolve(), codex_home.resolve()
    package = ROOT.parents[1]
    if runtime == package or runtime.is_relative_to(package):
        raise ValueError('Runtime must be outside the installer-owned Research package')
    node = shutil.which('node')
    npm = shutil.which('npm.cmd' if os.name == 'nt' else 'npm')
    if not node or (install and not npm):
        raise ValueError('Install supported Node/npm first; this tool does not install them')
    entry = runtime / 'node_modules/rea-agents/scripts/rea.mjs'
    config = codex_home / 'config.toml'
    marker = runtime / '.research-rea-runtime.json'
    lock = (ROOT / 'package-lock.json').read_bytes()
    owned = {'version': VERSION, 'lock_sha256': digest(lock)}
    if install and runtime.exists():
        if not marker.is_file() or json.loads(marker.read_text()) != owned:
            raise ValueError('Existing runtime is not this pinned owned install; choose a fresh directory')
        if not entry.is_file() or (runtime/'package-lock.json').read_bytes() != lock:
            raise ValueError('Owned runtime is incomplete or changed; preserve it and choose a fresh directory')
    if not install and (configure or skill) and not entry.is_file():
        raise ValueError('Selected runtime is missing; use --install or select an existing runtime')
    original, updated = config_bytes(config, node, entry) if configure else (None, None)
    desired = skill_files(runtime) if skill else None
    destination = codex_home / 'skills/rea-investigate'
    if skill and destination.exists() and inventory(destination) != {k: digest(v) for k, v in desired.items()}:
        raise ValueError('Existing skill differs; preserve it and review before replacement')
    plan = {'apply': apply, 'version': VERSION, 'runtime': str(runtime),
            'install': install, 'configure_codex': configure, 'install_skill': skill,
            'config': str(config) if configure else None,
            'skill_destination': str(destination) if skill else None,
            'target_execution': False}
    if not apply:
        return plan
    if install and not runtime.exists():
        runtime.mkdir(parents=True)
        for name in ('package.json', 'package-lock.json'):
            shutil.copy2(ROOT / name, runtime / name)
        result = subprocess.run([npm, 'ci', '--prefix', str(runtime), '--ignore-scripts',
                                 '--no-audit', '--no-fund'], capture_output=True, text=True,
                                encoding='utf-8', errors='replace')
        (runtime/'install.log').write_text(result.stdout+result.stderr, encoding='utf-8')
        if result.returncode:
            raise ValueError('npm ci failed; retained runtime/install.log, no client registration applied')
        marker.write_text(json.dumps(owned, indent=2)+'\n')
    if install or configure or skill:
        package_json = runtime/'node_modules/rea-agents/package.json'
        if not entry.is_file() or json.loads(package_json.read_text())['version'] != VERSION:
            raise ValueError('REA entry/version check failed; no client registration applied')
    if configure and updated != original:
        config.parent.mkdir(parents=True, exist_ok=True)
        if (config.read_bytes() if config.exists() else b'') != original:
            raise ValueError('Config changed concurrently; retained runtime, no config overwritten')
        if config.exists():
            backups = codex_home/'research-rea-backups'
            backups.mkdir(exist_ok=True)
            backup = backups/('config-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')+'.toml')
            backup.write_bytes(original)
            plan['private_backup'] = str(backup)
        fd, temporary = tempfile.mkstemp(prefix='rea-config-', dir=config.parent)
        with os.fdopen(fd, 'wb') as handle:
            handle.write(updated)
        os.replace(temporary, config)
    if skill and not destination.exists():
        destination.mkdir(parents=True)
        for name, data in desired.items():
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    plan['restart_client_to_verify'] = configure or skill
    return plan


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--codex-home', type=Path, default=Path(os.environ.get('CODEX_HOME', str(Path.home()/'.codex'))))
    parser.add_argument('--install', action='store_true')
    parser.add_argument('--configure-codex', action='store_true')
    parser.add_argument('--skill', action='store_true')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(setup(args.runtime, args.codex_home, args.install,
                               args.configure_codex, args.skill, args.apply), ensure_ascii=False))
    except (ValueError, OSError, KeyError) as error:
        parser.exit(1, str(error)+'\n')
