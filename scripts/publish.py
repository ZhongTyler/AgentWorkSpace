#!/usr/bin/env python3
"""Export an explicitly curated source directly into this distribution repository."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from workspace import ContractError, digest, encoded, relative, safe


def git(root, *args):
    repository = next((p for p in (root, *root.parents) if (p / '.git').exists()), root)
    run = subprocess.run(['git', '-c', 'safe.directory=' + repository.as_posix(), '-C', str(root), *args], capture_output=True, text=True)
    if run.returncode:
        raise ContractError('Cannot read source Git state')
    return run.stdout.strip()


def inventory(root):
    result = {}
    for directory, folders, files in os.walk(root, followlinks=False):
        for name in folders + files:
            safe(root, (Path(directory) / name).relative_to(root).as_posix())
        for name in files:
            path = Path(directory) / name
            result[path.relative_to(root).as_posix()] = digest(path.read_bytes())
    return result


def stage(source, destination):
    manifest_path = safe(source, 'release-input/manifest.json')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8-sig'))
    if manifest.get('release_schema') != 1:
        raise ContractError('Unknown source manifest schema')
    expected_output = {'meta': 'meta', 'brainstorm': 'packages/brainstorm', 'fromdemotospec': 'packages/fromdemotospec', 'knowledge': 'packages/knowledge', 'skills': 'packages/skills', 'game-analysis-decision': 'packages/game-analysis-decision', 'game-presentation': 'packages/game-presentation', 'prototype-assets': 'packages/prototype-assets', 'travel': 'packages/travel', 'research': 'packages/research', 'tools': 'packages/tools', 'game-project': 'packages/game-project'}
    component = manifest.get('component_id')
    if component not in expected_output or manifest.get('output_path') != expected_output[component]:
        raise ContractError('Unknown or mismatched publication target')
    if component in ('research', 'tools'):
        # Reject private inputs before reading any content or inspecting source Git.
        roots = {'README.md', 'AGENTS.md', 'LICENSE', 'LICENSE-NOTICE.md',
                 'RESEARCH_PROTOCOL.md', 'sources.json', 'templates', '.agents',
                 'proactive', 'game-research', 'integrations', 'toolbox.py', 'prepare_home.py', 'registry.json', 'workflows.json', 'portable-profile.json'}
        if component == 'research':
            roots -= {'toolbox.py', 'prepare_home.py', 'registry.json', 'workflows.json', 'portable-profile.json'}
            roots.add('reference-library')
        else:
            roots.add('docs')
        if any(manifest.get(key) for key in ('root_files', 'copy_directories', 'text_replacements')):
            raise ContractError('Research publication requires explicit curated inputs')
        for item in manifest.get('copy_files', []):
            name = relative(item['source'])
            target = relative(item['target'])
            if target.startswith('reference-library/') and target not in {'reference-library/README.md','reference-library/catalog.json','reference-library/library.py','reference-library/prepare_home.py','reference-library/portable-profile.json'} and not target.startswith('reference-library/licenses/'):
                raise ContractError('Reference library requires explicit portable metadata, code or license inputs')
            if component == 'tools' and target.startswith('docs/') and target != 'docs/decision-model-policy.md':
                raise ContractError('Tools documentation requires the explicit portable policy whitelist')
            if name != 'release-input/curated/' + target or target.split('/')[0] not in roots or any(
                    part in {'.git', '.runtime', 'runtime', 'node_modules', '__pycache__', 'private', 'raw', 'runs', 'checks', 'local-status.json', 'validation.json', 'connection-status.json', 'runtime-copy-receipt.json', 'install-paths.json', '.tools-home.json'}
                    for part in target.split('/')) or not re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', '')):
                raise ContractError('Research input is outside the reviewed public whitelist')
            vendors = ('integrations/mcp/vendor/', 'integrations/rea/vendor/')
            if component == 'tools':
                vendors += ('integrations/decision-models/vendor/',)
            if target.endswith(('.tgz', '.tar.gz', '.zip')) and not target.startswith(vendors):
                raise ContractError('Research archives must use the reviewed vendor directory')
    if component == 'game-project':
        if any(manifest.get(key) for key in ('root_files', 'copy_directories', 'text_replacements')):
            raise ContractError('GameProject requires explicit pinned public inputs')
        public_roots = {'README.md', 'AGENTS.md', 'LICENSE', 'template-inventory.json'}
        for item in manifest.get('copy_files', []):
            name, target = relative(item['source']), relative(item['target'])
            valid = ((target in public_roots and name == 'release-input/curated/' + target)
                     or (target.startswith('template/') and name == target and
                         (target.endswith(('.md', '.json', '.mjs')) or target.endswith(('/.gitignore', '/.gitattributes'))))
                     or (target in {'scripts/create-project.py', 'tests/test_create.py'} and name == target))
            if not valid or any(part in {'.git', '.godot', '.import', 'node_modules', '__pycache__', 'private', 'runtime', 'plans', 'demo'} for part in target.split('/')) or not re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', '')):
                raise ContractError('GameProject input is outside the pinned template whitelist')
    if component == 'travel':
        # Travel contains private sibling projects in its source repository.
        # Select explicit public files before any directory traversal.
        roots = {'README.md', 'AGENTS.md', 'SKILL.md', '00-全流程与事实分工.md',
                 'package.json', '.gitignore', '.gitattributes', 'THIRD_PARTY.md',
                 'LICENSE', 'LICENSE-NOTICE.md', 'scripts', 'web', 'skills',
                 '运行', '流程', '模板', 'examples', 'tests', 'schemas'}
        if any(manifest.get(key) for key in ('root_files', 'copy_directories', 'text_replacements')):
            raise ContractError('Travel publication requires explicit public file inputs')
        for item in manifest.get('copy_files', []):
            name = relative(item['source'])
            if name != item['target'] or name.split('/')[0] not in roots or any(
                    part in {'.git', '.runtime', 'node_modules', '__pycache__', 'private', 'raw'}
                    for part in name.split('/')):
                raise ContractError('Travel input is outside the public workflow whitelist')
    if manifest.get('strip_sections') or manifest.get('remove_lines'):
        raise ContractError('Unsupported source transformations must be resolved before publication')
    seen = set()

    def copy(src, target, expected_hash=None):
        src, target = safe(source, src), safe(destination, target)
        folded = target.relative_to(destination).as_posix().casefold()
        if folded in seen or not src.is_file():
            raise ContractError('Missing or duplicate curated input')
        seen.add(folded)
        target.parent.mkdir(parents=True, exist_ok=True)
        # Explicitly curated media preserves exact bytes; textual sources normalize LF.
        data = src.read_bytes()
        if expected_hash is not None and digest(data) != expected_hash:
            raise ContractError('Curated input checksum differs: ' + str(src.relative_to(source)))
        archive = component in ('research', 'tools') and src.name.endswith(('.tgz', '.tar.gz', '.zip'))
        metadata = component == 'tools' and 'vendor' in target.parts and any(part.endswith('-model-metadata') for part in target.parts)
        if archive or metadata or src.suffix.lower() in {'.png', '.wav', '.ogg', '.otf', '.ttf', '.jpg', '.webp'}:
            target.write_bytes(data)
        else:
            content = data.decode('utf-8-sig').replace('\r\n', '\n').replace('\r', '\n')
            target.write_text(content, encoding='utf-8', newline='\n')

    for item in manifest.get('copy_files', []):
        if component in ('brainstorm', 'knowledge', 'skills', 'game-analysis-decision', 'game-presentation', 'prototype-assets') and not item['source'].startswith('release-input/curated/'):
            raise ContractError('This component only permits curated inputs')
        copy(item['source'], item['target'], item.get('sha256') if component in ('research', 'tools', 'game-project') else None)
    for name in manifest.get('root_files', []):
        copy(name, name)
    for item in manifest.get('copy_directories', []):
        origin = safe(source, item['source'])
        entries = inventory(origin)
        if len(entries) != item['expected_files']:
            raise ContractError('Source directory inventory changed')
        for name in entries:
            copy(item['source'] + '/' + name, item['target'] + '/' + name)
    count = manifest.get('expected_file_count_without_marker', manifest.get('expected_file_count'))
    if len(seen) != count:
        raise ContractError(f'Curated file count mismatch: {len(seen)} != {count}')
    for item in manifest.get('text_replacements', []):
        path = safe(destination, item['file'])
        text = path.read_text(encoding='utf-8')
        if text.count(item['old']) != item['expected_count']:
            raise ContractError('Replacement anchor differs: ' + item['file'])
        path.write_text(text.replace(item['old'], item['new']), encoding='utf-8', newline='\n')
    for name in manifest.get('empty_directories', manifest.get('directories', [])):
        if isinstance(name, str):
            safe(destination, name).mkdir(parents=True, exist_ok=True)
    validation = manifest.get('validation', {})
    for name in validation.get('required_directories', []):
        safe(destination, name).mkdir(parents=True, exist_ok=True)
    for name in validation.get('forbidden_files', []) + validation.get('forbidden_root_files', []):
        if safe(destination, name).exists():
            raise ContractError('Forbidden file in package: ' + name)
    for path in destination.rglob('*.md'):
        text = path.read_text(encoding='utf-8')
        for pattern in validation.get('forbidden_patterns', []):
            if pattern in text:
                raise ContractError('Forbidden reference: ' + pattern)
        prose = re.sub(r'```.*?```', '', text, flags=re.S)
        prose = re.sub(r'`[^`\n]*`', '', prose)
        for link in re.findall(r'\]\(([^\s)]+)(?:\s+"[^"]*")?\)', prose):
            link = link.split('#')[0]
            if not link or '{{' in link or link.startswith('<') or re.match(r'[a-zA-Z][a-zA-Z0-9+.-]*:', link):
                continue
            from urllib.parse import unquote
            linked = (path.parent / unquote(link)).resolve()
            if not linked.is_relative_to(destination.resolve()) or not linked.exists():
                raise ContractError('Unresolved portable link: ' + str(path.relative_to(destination)) + ' -> ' + link)
    revision = git(source, 'rev-parse', 'HEAD')
    dirty = bool(git(source, 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=all', '--ignore-submodules=all'))
    manifest_bytes = manifest_path.read_text(encoding='utf-8-sig').replace('\r\n', '\n').encode('utf-8')
    marker = {'release_schema': 1, 'component_id': component, 'source_revision': revision, 'generator_version': '3.0.0', 'generated_at': git(source, 'log', '-1', '--format=%cI'), 'manifest_sha256': digest(manifest_bytes), 'file_count': len(seen), 'preview': dirty}
    (destination / '_release.json').write_bytes(encoded(marker))
    return manifest, dirty


def export(source: Path, distribution: Path, apply=False):
    distribution = distribution.absolute()
    if not safe(distribution, 'AGENTS.md').is_file() or not safe(distribution, 'scripts/workspace.py').is_file():
        raise ContractError('Destination is not an AgentWorkSpace distribution')
    source = source.absolute()
    with tempfile.TemporaryDirectory(prefix='agentworkspace-export-') as temporary:
        prepared = Path(temporary) / 'component'
        prepared.mkdir()
        manifest, dirty = stage(source, prepared)
        target = safe(distribution, manifest['output_path'])
        wanted, current = inventory(prepared), inventory(target) if target.exists() else {}
        changed = wanted != current
        if apply and dirty:
            raise ContractError('Commit source changes before publishing; validation preview remains available')
        result = {'component': manifest['component_id'], 'changed': changed, 'source_dirty': dirty, 'applied': False}
        if apply and changed:
            target.parent.mkdir(parents=True, exist_ok=True)
            staged = safe(distribution, '.publish-' + uuid.uuid4().hex)
            backup = safe(distribution, '.publish-' + uuid.uuid4().hex)
            shutil.copytree(prepared, staged)
            replaced = False
            completed = False
            try:
                if target.exists():
                    target.rename(backup)
                staged.rename(target)
                replaced = True
                if inventory(target) != wanted:
                    raise ContractError('Published bytes differ after replacement')
                completed = True
            except Exception:
                if replaced and target.exists():
                    shutil.rmtree(safe(distribution, manifest['output_path']))
                if backup.exists():
                    backup.rename(target)
                raise
            finally:
                # A failed restore must retain the original backup for recovery.
                for path in (staged, backup) if completed else (staged,):
                    if path.exists():
                        shutil.rmtree(safe(distribution, path.name))
            result['applied'] = True
        return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--distribution', type=Path, default=Path(__file__).absolute().parents[1])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        result = export(args.source, args.distribution, args.apply)
        print(json.dumps(result, ensure_ascii=False))
        return 2 if result['changed'] and not args.apply else 0
    except (OSError, ValueError, KeyError, ContractError) as error:
        print(json.dumps({'error': str(error)}, ensure_ascii=False), file=sys.stderr)
        return 3


if __name__ == '__main__':
    sys.exit(main())
