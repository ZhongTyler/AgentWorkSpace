#!/usr/bin/env python3
"""Portable, data-preserving workspace installation. Python 3.10+, stdlib only."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import shutil
import subprocess
import sys
import uuid

SCHEMA = 1
STATE = '.agent-workspace/state.json'


class ContractError(Exception):
    pass


def digest(data: bytes | None) -> str | None:
    return None if data is None else hashlib.sha256(data).hexdigest()


def encoded(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf-8')


def relative(value: str) -> str:
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise ContractError(f'Invalid portable path: {value!r}')
    parts = PurePosixPath(value).parts
    if value.startswith('/') or any(p in ('', '.', '..') or p.endswith((' ', '.')) for p in value.split('/')):
        raise ContractError(f'Invalid portable path: {value!r}')
    for part in parts:
        if re.search(r'[<>"|?*\x00-\x1f]', part) or re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I):
            raise ContractError(f'Reserved path: {value!r}')
    return '/'.join(parts)


def safe(root: Path, name: str) -> Path:
    name = relative(name)
    path = root / name
    for item in [root, *root.parents]:
        if item.exists() and (item.is_symlink() or getattr(item.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ContractError(f'Linked path is not allowed: {item}')
    cursor = root
    for part in PurePosixPath(name).parts:
        cursor = cursor / part
        if cursor.is_symlink() or (cursor.exists() and getattr(cursor.lstat(), 'st_file_attributes', 0) & 0x400):
            raise ContractError(f'Linked path is not allowed: {cursor}')
        if cursor.exists() and cursor != path and not cursor.is_dir():
            raise ContractError(f'Parent is not a directory: {cursor}')
    if not path.resolve().is_relative_to(root.resolve()):
        raise ContractError(f'Path escapes target: {name}')
    return path


def read(path: Path) -> bytes | None:
    if path.exists() and not path.is_file():
        raise ContractError(f'Expected a regular file: {path}')
    return path.read_bytes() if path.exists() else None


def load(path: Path):
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except (ValueError, OSError) as error:
        raise ContractError(f'Cannot read JSON contract: {path}') from error


def version(value: str):
    if not isinstance(value, str) or not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ContractError(f'Unsupported version: {value!r}')
    return tuple(int(n) for n in value.split('.'))


def catalog(bundle: Path):
    result = load(safe(bundle, 'catalog.json'))
    if result.get('schema_version') != SCHEMA:
        raise ContractError('Unsupported catalog schema')
    version(result.get('version'))
    names = set(result.get('components', {}))
    allowed = {'meta', 'brainstorm', 'fromdemotospec', 'knowledge', 'skills', 'game-analysis-decision', 'game-presentation', 'prototype-assets', 'travel', 'research', 'tools', 'game-project'}
    if not names or not names <= allowed or 'meta' not in names:
        raise ContractError('Catalog must contain meta and supported packages')
    if 'compatibility' in result:
        if load(safe(bundle, 'compatibility.json')) != result['compatibility']:
            raise ContractError('Capability contract differs from the sealed catalog')
        from compatibility import contract
        contract(result)
    destinations = set()
    for name, item in result['components'].items():
        version(item.get('version'))
        source = safe(bundle, item['source'])
        if not source.is_dir() or not item.get('files'):
            raise ContractError(f'Empty or missing component: {name}')
        expected_destination = '' if name == 'meta' else 'modules/' + name
        if item.get('destination') != expected_destination:
            raise ContractError(f'Unexpected component destination: {name}')
        actual = set()
        for directory, folders, files in os.walk(source, followlinks=False):
            for child in folders + files:
                safe(source, (Path(directory) / child).relative_to(source).as_posix())
            actual.update((Path(directory) / child).relative_to(source).as_posix() for child in files)
        if actual != set(item['files']):
            raise ContractError(f'Component inventory differs: {name}')
        for file, expected in item['files'].items():
            file = relative(file)
            if digest(read(safe(source, file))) != expected:
                raise ContractError(f'Component checksum differs: {name}/{file}')
            target = relative('/'.join(p for p in (item['destination'], file) if p))
            folded = target.casefold()
            if folded in destinations or folded.startswith(('.agent-workspace/', '.git/')) or folded in ('.git', '.agent-workspace'):
                raise ContractError(f'Overlapping or reserved destination: {target}')
            destinations.add(folded)
    return result


def state(target: Path):
    content = read(safe(target, STATE))
    if content is None:
        return None
    result = load(safe(target, STATE))
    if result.get('schema_version') != SCHEMA:
        raise ContractError('Unsupported installed state schema')
    version(result.get('version'))
    if not isinstance(result.get('files'), dict) or not isinstance(result.get('components'), dict):
        raise ContractError('Malformed installation state')
    for name, item in result['files'].items():
        relative(name)
        if name.casefold().startswith(('.agent-workspace/', '.git/')) or item.get('component') not in result['components']:
            raise ContractError('Invalid managed file ownership')
        if not re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', '')):
            raise ContractError('Invalid installed checksum')
    return result


def package_name(name, incoming):
    return name


def plan(bundle: Path, target: Path, operation: str, packages: list[str], mode=None, profile=None, needs=()):
    incoming = catalog(bundle)
    old = state(target)
    installed_mode = (old or {}).get('mode', 'full')
    mode = mode or installed_mode
    if mode not in ('full', 'compatible') or old and mode != installed_mode:
        raise ContractError('Installation modes cannot be switched in place; preserve the current host')
    if mode == 'full' and (profile is not None or needs):
        raise ContractError('Use audit or compatible mode for existing providers and need recommendations')
    if target == bundle or target.is_relative_to(bundle) or mode == 'full' and bundle.is_relative_to(target):
        raise ContractError('The distribution and installation destinations must be separate')
    if mode == 'compatible' and bundle.is_relative_to(target / '.agent-workspace'):
        raise ContractError('Distribution cannot be inside installation metadata')
    if operation != 'init' and old is None:
        raise ContractError('Initialize the root workspace first')
    for name in packages:
        if name not in incoming['components'] or name == 'meta' and mode == 'full':
            raise ContractError(f'Unknown package: {name}')
    if old and old['version'] == incoming['version'] and old.get('catalog_sha256') != digest(encoded(incoming)):
        raise ContractError('Published version changed in place; use a new version')
    if old and old['version'] != incoming['version']:
        if operation != 'upgrade':
            raise ContractError('Use upgrade before adding packages from another release')
        if version(old['version']) >= version(incoming['version']) or old['version'] != incoming.get('previous_version'):
            raise ContractError('Only the declared previous version can be upgraded; follow the release chain')
        guide = safe(bundle, 'upgrades/' + incoming['version'] + '.md')
        if not guide.is_file():
            raise ContractError('Missing version upgrade guide')
    audit_result = None
    if mode == 'compatible':
        from compatibility import audit
        audit_result = audit(incoming, target, packages, needs, profile)
        if audit_result['required'] or not audit_result['selected']:
            return {**audit_result, 'operation': operation, 'components': audit_result['selected'], 'changes': [], 'conflicts': [], 'applied': False}, {}
    selected = set((old or {}).get('components', {})) | ({'meta'} if mode == 'full' else set()) | set(packages)
    next_state = {'schema_version': SCHEMA, 'version': incoming['version'], 'catalog_sha256': digest(encoded(incoming)), 'components': {}, 'files': {}}
    if mode == 'compatible':
        next_state.update(mode=mode, profile=audit_result['profile'])
    desired = {}
    for component in sorted(selected):
        item = incoming['components'][component]
        location = 'modules/meta' if component == 'meta' and mode == 'compatible' else item['destination']
        component_root = target / location
        if mode == 'compatible' and (component_root.is_relative_to(bundle) or bundle.is_relative_to(component_root)):
            raise ContractError('Selected component would overlap the distribution')
        next_state['components'][component] = item['version']
        for file, sha in item['files'].items():
            destination = '/'.join(p for p in (location, file) if p)
            desired[destination] = read(safe(bundle, item['source'] + '/' + file))
            next_state['files'][destination] = {'sha256': sha, 'component': component}
    if mode == 'compatible':
        from compatibility import BRIDGE, bridge
        desired[BRIDGE] = bridge(selected, audit_result['profile']['providers'])
        next_state['files'][BRIDGE] = {'sha256': digest(desired[BRIDGE]), 'component': sorted(selected)[0]}
    changes, conflicts = [], []
    old_files = (old or {}).get('files', {})
    for name in sorted(set(old_files) | set(desired)):
        before = read(safe(target, name))
        before_sha, after_sha = digest(before), digest(desired.get(name))
        known = old_files.get(name)
        # Unchanged upstream files retain user edits, deletions and their original baseline.
        if known and after_sha == known['sha256']:
            continue
        if before_sha == after_sha:
            continue
        if (known and before_sha != known['sha256']) or (not known and before is not None):
            conflicts.append(name)
        else:
            changes.append({'path': name, 'before_sha256': before_sha, 'after_sha256': after_sha})
    before_state = read(safe(target, STATE))
    new_state = encoded(next_state)
    if before_state != new_state:
        desired[STATE] = new_state
        changes.append({'path': STATE, 'before_sha256': digest(before_state), 'after_sha256': digest(new_state)})
    report = {'operation': operation, 'version': incoming['version'], 'components': sorted(selected), 'changes': changes, 'conflicts': conflicts, 'applied': False}
    if audit_result is not None:
        report.update(mode=mode, audit=audit_result, ready=audit_result['ready'])
    return report, desired


def write(path: Path, data: bytes | None):
    if data is None:
        path.unlink(missing_ok=True)
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name('.aw-' + uuid.uuid4().hex)
    try:
        with temporary.open('xb') as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextlib.contextmanager
def lock(target: Path):
    path = safe(target, '.agent-workspace/install.lock')
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        handle = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise ContractError('Another installation owns the lock; inspect it before recovery') from error
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(encoded({'pid': os.getpid()}))
        yield
    finally:
        path.unlink(missing_ok=True)


def rollback(target: Path, transaction: str, apply=False):
    if not re.fullmatch(r'[0-9a-f]{32}', transaction):
        raise ContractError('Invalid transaction ID')
    folder = safe(target, '.agent-workspace/transactions/' + transaction)
    record = load(safe(folder, 'transaction.json'))
    if record.get('schema_version') != SCHEMA:
        raise ContractError('Unsupported transaction schema')
    conflicts, actions = [], []
    if record.get('moves'):
        raise ContractError('Old package-name move transactions require their original release tool')
    for entry in reversed(record['changes']):
        name = relative(entry['path']).casefold()
        if name == '.git' or name.startswith('.git/') or (name == '.agent-workspace' or name.startswith('.agent-workspace/')) and entry['path'] != STATE:
            raise ContractError('Reserved recovery path')
        current = digest(read(safe(target, entry['path'])))
        if current == entry['before_sha256']:
            continue
        if current != entry['after_sha256']:
            conflicts.append(entry['path'])
            continue
        original = read(safe(folder, 'before/' + digest(entry['path'].encode('utf-8')))) if entry['before_sha256'] is not None else None
        if digest(original) != entry['before_sha256']:
            raise ContractError('Recovery backup checksum differs')
        actions.append((entry['path'], original))
    if apply and not conflicts:
        for name, content in actions:
            write(safe(target, name), content)
        record['status'] = 'rolled_back'
        write(safe(folder, 'transaction.json'), encoded(record))
    return {'transaction': transaction, 'changes': [name for name, _ in actions], 'conflicts': conflicts, 'applied': apply and not conflicts}


def install(bundle: Path, target: Path, operation: str, packages: list[str], apply=False, fail_after=None, mode=None, profile=None, needs=()):
    report, desired = plan(bundle, target, operation, packages, mode, profile, needs)
    if not apply or report['conflicts'] or not report['changes']:
        return report
    with lock(target):
        # Replan after acquiring the lock; never trust a stale preview.
        report, desired = plan(bundle, target, operation, packages, mode, profile, needs)
        if report['conflicts'] or report.get('ready') is False or not report['changes']:
            return report
        return apply_changes(target, report, desired, fail_after)


def apply_changes(target, report, desired, fail_after=None):
    """Caller holds the exclusive lock and has just revalidated its plan."""
    transaction = uuid.uuid4().hex
    folder = safe(target, '.agent-workspace/transactions/' + transaction)
    folder.mkdir(parents=True)
    for entry in report['changes']:
        original = read(safe(target, entry['path']))
        if digest(original) != entry['before_sha256']:
            raise ContractError('Workspace changed while preparing transaction')
        if original is not None:
            write(safe(folder, 'before/' + digest(entry['path'].encode('utf-8'))), original)
    record = {'schema_version': SCHEMA, 'status': 'prepared', 'changes': report['changes']}
    write(safe(folder, 'transaction.json'), encoded(record))
    try:
        for index, entry in enumerate(report['changes'], 1):
            path = safe(target, entry['path'])
            if digest(read(path)) != entry['before_sha256']:
                raise ContractError('Workspace changed during transaction: ' + entry['path'])
            write(path, desired.get(entry['path']))
            if fail_after == index:
                raise OSError('Injected transaction failure')
        record['status'] = 'applied'
        write(safe(folder, 'transaction.json'), encoded(record))
    except Exception:
        recovered = rollback(target, transaction, apply=True)
        if recovered['conflicts']:
            raise ContractError(f'Transaction {transaction} needs manual recovery: {recovered["conflicts"]}')
        raise
    report.update(applied=True, transaction=transaction)
    return report


def adoption_plan(bundle, target, packages):
    incoming, installed = catalog(bundle), state(target)
    if installed and installed.get('mode') == 'compatible':
        raise ContractError('Legacy adoption uses the original full-mode release chain, not compatible registration')
    if installed is None or installed['version'] != incoming['version'] or installed['catalog_sha256'] != digest(encoded(incoming)):
        raise ContractError('Initialize the current root before adopting legacy packages')
    if not packages:
        raise ContractError('Specify the legacy package to adopt')
    for name in packages:
        if name not in ('brainstorm', 'fromdemotospec', 'knowledge') or name in installed['components']:
            raise ContractError('Only an unregistered supported legacy package can be adopted')
        legacy_name = name
        legacy = load(safe(bundle, 'upgrades/legacy/' + legacy_name + '.json'))
        package_root = safe(target, 'modules/' + name)
        marker = load(safe(package_root, '_release.json'))
        if legacy.get('schema_version') != 1 or marker.get('source_revision') != legacy.get('source_revision'):
            raise ContractError('Unknown legacy package; preserve it and use manual migration')
        installed['components'][name] = 'legacy'
        for file, variants in legacy['files'].items():
            current = digest(read(safe(package_root, file)))
            baseline = current if current in variants else legacy['canonical_sha256'][file]
            installed['files']['modules/' + name + '/' + relative(file)] = {'sha256': baseline, 'component': name}
    content = encoded(installed)
    report = {'operation': 'adopt', 'components': packages, 'changes': [{'path': STATE, 'before_sha256': digest(read(safe(target, STATE))), 'after_sha256': digest(content)}], 'conflicts': [], 'applied': False}
    return report, {STATE: content}


def adopt(bundle, target, packages, apply=False):
    report, desired = adoption_plan(bundle, target, packages)
    if apply:
        with lock(target):
            report, desired = adoption_plan(bundle, target, packages)
            return apply_changes(target, report, desired)
    return report


def doctor():
    checks = {'python': {'available': sys.version_info >= (3, 10), 'version': sys.version.split()[0]}}
    executable = shutil.which('git')
    checks['git_for_ingest'] = {'available': executable is not None, 'version': subprocess.run([executable, '--version'], capture_output=True, text=True, timeout=15).stdout.strip() if executable else None}
    for name, command in [('node', ['node', '--version']), ('powershell', ['pwsh', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'])]:
        executable = shutil.which(command[0])
        if executable is None:
            checks[name] = {'available': False, 'version': None}
            continue
        result = subprocess.run([executable, *command[1:]], capture_output=True, text=True, timeout=15)
        found = result.stdout.strip()
        match = re.match(r'v?(\d+)\.', found)
        checks[name] = {'available': result.returncode == 0 and match is not None and int(match[1]) >= (22 if name == 'node' else 7), 'version': found}
    return {'ready': all(item['available'] for item in checks.values()), 'requirements': checks, 'writes': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['audit', 'init', 'add', 'upgrade', 'adopt', 'status', 'rollback', 'verify', 'doctor'])
    parser.add_argument('--bundle', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--target', type=Path)
    parser.add_argument('--packages', nargs='*', default=[])
    parser.add_argument('--transaction')
    parser.add_argument('--mode', choices=['full', 'compatible'])
    parser.add_argument('--profile', type=Path, help='Reviewed existing capability providers with local evidence hashes')
    parser.add_argument('--needs', nargs='*', default=[], help='Audit needs: collaboration brainstorm prototype knowledge')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        bundle = args.bundle.absolute()
        if args.operation == 'doctor':
            result = doctor()
        elif args.operation == 'verify':
            incoming = catalog(bundle)
            result = {'verified': True, 'version': incoming['version']}
        else:
            if args.target is None:
                raise ContractError('--target is required')
            target = args.target.absolute()
            if args.operation == 'audit':
                if args.apply:
                    raise ContractError('Audit is read-only; use init/add/upgrade for a selected plan')
                from compatibility import audit
                result = audit(catalog(bundle), target, args.packages, args.needs, args.profile)
            elif args.operation == 'status':
                installed = state(target)
                result = {'installed': installed is not None, 'version': (installed or {}).get('version'), 'mode': (installed or {}).get('mode', 'full'), 'components': (installed or {}).get('components', {}), 'modified': [name for name, item in (installed or {}).get('files', {}).items() if digest(read(safe(target, name))) != item['sha256']]}
            elif args.operation == 'adopt':
                result = adopt(bundle, target, args.packages, args.apply)
            elif args.operation == 'rollback':
                if args.apply:
                    with lock(target):
                        result = rollback(target, args.transaction or '', apply=True)
                else:
                    result = rollback(target, args.transaction or '')
            else:
                result = install(bundle, target, args.operation, args.packages, args.apply, mode=args.mode, profile=args.profile, needs=args.needs)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get('conflicts') or result.get('ready') is False else 0
    except (ContractError, OSError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.modules.setdefault('workspace', sys.modules[__name__])
    sys.exit(main())
