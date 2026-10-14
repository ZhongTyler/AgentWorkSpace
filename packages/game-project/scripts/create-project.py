"""Create a new, independent project workspace from reviewed template files."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def text_bytes(path):
    return path.read_text(encoding='utf-8-sig').replace('\r\n', '\n').replace('\r', '\n').encode('utf-8')


def unlinked(path):
    # Check the lexical path before resolve can hide a symlink/junction.
    for item in (*reversed(path.parents), path):
        if item.is_symlink() or (hasattr(item, 'is_junction') and item.is_junction()):
            raise ValueError('Linked paths require separate review: ' + str(item))


def relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise ValueError('Invalid template path')
    p = Path(value)
    if p.is_absolute() or any(x in ('', '.', '..', '.git') for x in value.split('/')):
        raise ValueError('Unsafe template path: ' + value)
    return p


def plan(target, name, identity, engine, bundle=ROOT):
    bundle = Path(bundle).resolve()
    target = Path(os.path.abspath(Path(target).expanduser()))
    unlinked(target)
    if target.exists():
        raise ValueError('Target already exists; review existing projects instead of overwriting them')
    if target.is_relative_to(bundle) or any(x.casefold() in {'modules', '.git', '.agent-workspace', '.agent-skills'} for x in target.parts):
        raise ValueError('Project must be outside the package and managed module/state directories')
    if not name or len(name) > 80 or any(ord(c) < 32 for c in name) or '__PROJECT_' in name:
        raise ValueError('Project name must be 1–80 characters without control characters or template tokens')
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,63}', identity):
        raise ValueError('Project ID must use lowercase ASCII letters, digits, hyphens or underscores')
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,63}', engine) or engine.casefold() in {
        'docs', 'assets', 'builds', 'maintenance', 'demo', 'modules', 'con', 'prn', 'aux', 'nul',
        *('com' + str(n) for n in range(1, 10)), *('lpt' + str(n) for n in range(1, 10))}:
        raise ValueError('Engine directory must be a distinct safe folder name')
    manifest_path = bundle / 'template-inventory.json'
    if not manifest_path.exists():
        manifest_path = bundle / 'release-input/curated/template-inventory.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    if manifest.get('schema_version') != 1 or manifest.get('template') != 'godot-project' or not manifest.get('files'):
        raise ValueError('Invalid template inventory')
    files = {}
    for name_in_template, expected in manifest['files'].items():
        rel = relative(name_in_template)
        source = bundle / 'template' / rel
        unlinked(source)
        data = text_bytes(source)
        if digest(data) != expected:
            raise ValueError('Template changed; review and reseal before creating a project: ' + str(rel))
        dest = Path(engine, *rel.parts[1:]) if rel.parts[0] == 'Game' else rel
        if rel.as_posix() == 'maintenance/project-config.json':
            config = json.loads(data)
            config['project'].update(id=identity, name=name)
            config['engine']['directory'] = engine
            config['maintenance']['managed_roots'] = [engine if x == 'Game' else x for x in config['maintenance']['managed_roots']]
            config['template']['inventory_sha256'] = digest(text_bytes(manifest_path))
            data = (json.dumps(config, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
        else:
            content = data.decode('utf-8').replace('__PROJECT_NAME__', name).replace('__PROJECT_ID__', identity)
            if engine != 'Game':
                content = content.replace('Game/', engine + '/')
            data = content.encode('utf-8')
        key = dest.as_posix()
        if key.casefold() in {x.casefold() for x in files}:
            raise ValueError('Duplicate project output')
        files[key] = data
    report = {'target': str(target), 'template': manifest['template'], 'template_version': manifest['version'],
              'project_id': identity, 'engine_directory': engine, 'engine_created': False,
              'files': {key: digest(data) for key, data in sorted(files.items())}, 'applied': False}
    return report, files


def create(target, name, identity, engine='Game', apply=False, bundle=ROOT):
    report, files = plan(target, name, identity, engine, bundle)
    if not apply:
        return report
    dest = Path(report['target'])
    unlinked(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    unlinked(dest)
    # Atomic reservation: an existing target, including a concurrent creator, is never replaced.
    dest.mkdir()
    created = []
    directories = {dest}
    try:
        for key, data in files.items():
            path = dest / key
            unlinked(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            directories.update(p for p in path.parents if p == dest or p.is_relative_to(dest))
            with path.open('xb') as stream:
                stream.write(data)
            created.append((path, data))
        for path, data in created:
            if path.read_bytes() != data:
                raise ValueError('Project bytes changed during creation: ' + str(path))
    except Exception:
        # Recover only exact bytes written by this attempt; preserve other writers' data.
        for path, data in reversed(created):
            if not path.is_symlink() and path.is_file() and path.read_bytes() == data:
                path.unlink()
        for path in sorted(directories, key=lambda p: len(p.parts), reverse=True):
            try:
                path.rmdir()
            except OSError:
                pass
        raise
    report['applied'] = True
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', type=Path, required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--id', required=True)
    parser.add_argument('--engine-directory', default='Game')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(create(args.target, args.name, args.id, args.engine_directory, args.apply), ensure_ascii=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({'error': str(error), 'applied': False}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == '__main__':
    sys.exit(main())
