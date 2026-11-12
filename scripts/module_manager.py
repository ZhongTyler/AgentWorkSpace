#!/usr/bin/env python3
"""Standalone module verification and optional peer retrieval. Python 3.10+, stdlib."""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import sys
import uuid


class ModuleError(Exception):
    pass


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + '\n').encode('utf8')


def relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise ModuleError('Expected a portable relative path')
    parts = value.split('/')
    for part in parts:
        if part in ('', '.', '..') or part.endswith((' ', '.')) or re.search(r'[<>"|?*\x00-\x1f]', part):
            raise ModuleError('Invalid relative path')
        if re.fullmatch(r'(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?', part, re.I):
            raise ModuleError('Reserved relative path')
    if PurePosixPath(value).is_absolute():
        raise ModuleError('Absolute path is not a module member')
    return value


def safe(root, name):
    path = root / relative(name)
    for cursor in [root, *root.parents, *path.parents, path]:
        if cursor.is_symlink() or cursor.exists() and getattr(cursor.lstat(), 'st_file_attributes', 0) & 0x400:
            raise ModuleError('Linked paths require explicit owner handling')
    if not path.resolve().is_relative_to(root.resolve()):
        raise ModuleError('Path escapes module root')
    return path


def load(path):
    try:
        return json.loads(path.read_text('utf8'))
    except (OSError, ValueError) as error:
        raise ModuleError('Cannot read module contract at ' + str(path)) from error


def descriptor(value):
    if not isinstance(value, dict):
        raise ModuleError('Expected a module object')
    if value.get('schema_version') != 1 or not isinstance(value.get('id'), str) or not re.fullmatch(r'[a-z][a-z0-9-]*', value['id']):
        raise ModuleError('Unsupported module identity')
    if not isinstance(value.get('version'), str) or not re.fullmatch(r'\d+\.\d+\.\d+', value['version']):
        raise ModuleError('Unsupported module version')
    if not isinstance(value.get('repository'), str) or not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git', value['repository']):
        raise ModuleError('Expected an explicit HTTPS GitHub repository')
    return value


def manifest(root):
    return descriptor(load(safe(root, 'module.json')))


def inventory(root):
    result = {}
    for folder, directories, files in os.walk(root, followlinks=False):
        directories[:] = [name for name in directories if name not in ('.git', '.module-manager', '__pycache__')]
        for name in directories + files:
            path = Path(folder) / name
            safe(root, path.relative_to(root).as_posix())
        for name in files:
            path = Path(folder) / name
            member = path.relative_to(root).as_posix()
            if member in ('.git', 'module-files.json') or member.endswith('.pyc'):
                continue
            result[member] = hashlib.sha256(path.read_bytes()).hexdigest()
    return result


def verify(root):
    module = manifest(root)
    record = load(safe(root, 'module-files.json'))
    if not isinstance(record, dict) or record.get('schema_version') != 1 or record.get('id') != module['id'] or record.get('version') != module['version']:
        raise ModuleError('Module inventory identity differs')
    if not isinstance(record.get('files'), dict) or not record['files']:
        raise ModuleError('Empty module inventory')
    for member, digest in record['files'].items():
        safe(root, member)
        if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-f]{64}', digest):
            raise ModuleError('Invalid module file digest')
    actual = inventory(root)
    if actual != record['files']:
        raise ModuleError('Module inventory differs from its published baseline')
    return {'verified': True, 'id': module['id'], 'version': module['version'], 'files': len(actual)}


def seal(root, apply=False):
    module = manifest(root)
    actual = inventory(root)
    tracked = set(git(root, 'ls-files').splitlines()) - {'module-files.json'}
    if set(actual) != tracked:
        raise ModuleError('Review and explicitly stage new files before sealing. Keep user data outside the module.')
    record = {'schema_version': 1, 'id': module['id'], 'version': module['version'], 'files': actual}
    result = {'id': module['id'], 'version': module['version'], 'files': len(actual), 'applied': False}
    if apply:
        temporary = safe(root, '.module-manager/inventory-' + uuid.uuid4().hex + '.json')
        temporary.parent.mkdir(parents=True, exist_ok=True)
        temporary.write_bytes(encoded(record))
        os.replace(temporary, safe(root, 'module-files.json'))
        result['applied'] = True
    return result


def discover(target):
    roots = [target]
    for folder in (target, safe(target, 'modules'), safe(target, 'packages')):
        if folder.is_dir():
            roots.extend(child for child in sorted(folder.iterdir())[:100]
                         if child.is_dir() and not child.name.startswith('.') and child.name != 'node_modules')
    found = []
    for root in dict.fromkeys(roots):
        try:
            if safe(root, 'module.json').is_file():
                value = manifest(root)
                found.append({'id': value['id'], 'version': value['version'], 'path': str(root), 'assurance': 'candidate'})
        except ModuleError:
            continue
    return found


REVIEW = ['responsibility-overlap', 'inputs-outputs-and-entrypoints', 'authority-and-data-ownership', 'integration-and-recovery']


def plan(root, target, names):
    own = manifest(root)
    if not isinstance(own.get('related', []), list):
        raise ModuleError('Expected a related-module list')
    peers = {item['id']: descriptor(item) for item in own.get('related', [])}
    if len(peers) != len(own.get('related', [])) or own['id'] in peers:
        raise ModuleError('Duplicate or recursive peer identity')
    if not set(names) <= set(peers):
        raise ModuleError('Choose a declared related module')
    candidates = discover(target)
    reuse, fetch, conflicts = [], [], []
    for name in dict.fromkeys(names):
        peer = peers[name]
        matches = [item for item in candidates if item['id'] == name]
        if len(matches) > 1:
            conflicts.append({'id': name, 'reason': 'Multiple module instances require owner selection'})
        elif matches:
            item = matches[0]
            try:
                verify(Path(item['path']))
                current = manifest(Path(item['path']))
                if current['repository'] != peer['repository'] or current['version'] != peer['version']:
                    raise ModuleError('Existing module has a different source or version; review upgrade separately')
                reuse.append({**item, 'assurance': 'verified-module-baseline'})
            except ModuleError as error:
                conflicts.append({'id': name, 'path': item['path'], 'reason': str(error)})
        else:
            path = safe(target, 'modules/' + name)
            if path.exists():
                conflicts.append({'id': name, 'path': str(path), 'reason': 'Existing directory needs compatibility review'})
            else:
                fetch.append({**peer, 'destination': str(path)})
    entries = []
    for folder in [target, *[Path(item['path']) for item in candidates]]:
        for name in ('README.md', 'AGENTS.md'):
            if safe(folder, name).is_file():
                entries.append(str(folder / name))
    return {'module': own['id'], 'target': str(target), 'fetch': fetch, 'reuse': reuse, 'conflicts': conflicts,
            'package_review': {'criteria': REVIEW, 'entry_documents': sorted(set(entries)), 'assurance': 'needs-agent-workflow-review'},
            'ready': not conflicts, 'applied': False}


def git(root, *arguments):
    command = ['git', '-c', 'safe.directory=' + str(root), '-c', 'credential.helper=', '-c', 'core.quotepath=false',
               '-c', 'core.autocrlf=false', '-C', str(root), *arguments]
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf8', errors='replace', timeout=180)
    if result.returncode:
        raise ModuleError('Git operation failed. Preserved staging can be inspected. ' + result.stderr[-1000:])
    return result.stdout.strip()


@contextlib.contextmanager
def lock(target):
    file = safe(target, '.module-manager/install.lock')
    file.parent.mkdir(parents=True, exist_ok=True)
    try:
        handle = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except FileExistsError as error:
        raise ModuleError('Another module operation owns the workspace lock') from error
    try:
        with os.fdopen(handle, 'wb') as stream:
            stream.write(encoded({'pid': os.getpid()}))
        yield
    finally:
        file.unlink(missing_ok=True)


def fetch(root, target, names, apply=False, source_root=None):
    report = plan(root, target, names)
    if not apply or not report['ready'] or not report['fetch']:
        return report
    with lock(target):
        report = plan(root, target, names)
        if not report['ready']:
            return report
        transaction = uuid.uuid4().hex
        staging = safe(target, '.module-manager/staging/' + transaction)
        staging.mkdir(parents=True)
        receipt = safe(target, '.module-manager/transactions/' + transaction + '.json')
        receipt.parent.mkdir(parents=True, exist_ok=True)
        record = {'status': 'preparing', 'installed': [], 'staging': str(staging), 'source_override': str(source_root) if source_root else None}
        receipt.write_bytes(encoded(record))
        try:
            for peer in report['fetch']:
                source = str(safe(source_root, peer['id'])) if source_root else peer['repository']
                git(target, 'clone', '--depth', '1', '--single-branch', '--branch', 'v' + peer['version'], '--', source, str(staging / peer['id']))
                verify(staging / peer['id'])
                current = manifest(staging / peer['id'])
                if any(current[key] != peer[key] for key in ('id', 'version', 'repository')):
                    raise ModuleError('Retrieved peer identity differs')
            record['status'] = 'committing'
            receipt.write_bytes(encoded(record))
            for peer in report['fetch']:
                destination = safe(target, 'modules/' + peer['id'])
                if destination.exists():
                    raise ModuleError('Destination changed during retrieval')
                destination.parent.mkdir(parents=True, exist_ok=True)
                (staging / peer['id']).rename(destination)
                record['installed'].append({'id': peer['id'], 'path': str(destination), 'commit': git(destination, 'rev-parse', 'HEAD')})
                receipt.write_bytes(encoded(record))
            record['status'] = 'complete'
            receipt.write_bytes(encoded(record))
            report.update(applied=True, transaction=transaction, installed=record['installed'])
        except Exception:
            record['status'] = 'failed-with-preserved-state'
            receipt.write_bytes(encoded(record))
            raise
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['verify', 'seal', 'related', 'audit', 'fetch'])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--target', type=Path)
    parser.add_argument('--modules', nargs='*', default=[])
    parser.add_argument('--source-root', type=Path, help='Explicit local module mirror for offline retrieval')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        root = args.root.absolute()
        if args.operation == 'verify':
            result = verify(root)
        elif args.operation == 'seal':
            result = seal(root, args.apply)
        elif args.operation == 'related':
            value = manifest(root)
            result = {'id': value['id'], 'related': value.get('related', [])}
        else:
            if args.target is None:
                raise ModuleError('--target is required')
            if args.operation == 'audit' and args.apply:
                raise ModuleError('Audit is read-only')
            result = fetch(root, args.target.absolute(), args.modules,
                           args.apply if args.operation == 'fetch' else False,
                           args.source_root.absolute() if args.source_root else None)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if result.get('conflicts') else 0
    except (ModuleError, OSError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
