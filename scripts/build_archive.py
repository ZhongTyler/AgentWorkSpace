#!/usr/bin/env python3
"""Build a clean aggregate ZIP, with explicitly selected full offline contents."""
import argparse
import io
import json
import os
from pathlib import Path
import subprocess
import uuid
import zipfile

from workspace import ContractError, catalog, digest, relative, safe
from federation import git, verify_module
import module_manager


def git_archive(root, revision):
    result = subprocess.run(['git', '-c', 'safe.directory=' + str(root), '-C', str(root),
                             'archive', '--format=zip', revision], capture_output=True, timeout=180)
    if result.returncode:
        raise ContractError('Cannot archive the fixed Git commit')
    return zipfile.ZipFile(io.BytesIO(result.stdout))


def build(root, output, full=False):
    incoming = catalog(root)
    if incoming['schema_version'] != 2:
        raise ContractError('Use this builder for aggregate schema 2')
    if output.is_relative_to(root):
        raise ContractError('Keep release artifacts outside the source repository')
    safe(output.parent, output.name)
    if git(root, 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=all'):
        raise ContractError('Commit aggregate changes before building an archive')
    commit = git(root, 'rev-parse', 'HEAD')
    modules = incoming['components'] if full else {}
    for name, row in modules.items():
        verify_module(root, row, name)
    output.parent.mkdir(parents=True, exist_ok=True)
    with module_manager.lock(output.parent):
        if output.exists():
            raise ContractError('Archive output already exists')
        temporary = safe(output.parent, '.aws-export-' + uuid.uuid4().hex + '.zip')
        prefix = 'AgentWorkSpace-' + incoming['version'] + '/'
        sources = [(root, commit, '')]
        sources.extend((root / row['module_source'], row['revision'], row['module_source'] + '/') for row in modules.values())
        files = set()
        with zipfile.ZipFile(temporary, 'x', zipfile.ZIP_DEFLATED) as target:
            for source, revision, destination in sources:
                with git_archive(source, revision) as archive:
                    for entry in archive.infolist():
                        if entry.is_dir():
                            continue
                        member = relative(destination + entry.filename)
                        if member in files:
                            raise ContractError('Duplicate archive member')
                        files.add(member)
                        data = archive.read(entry)
                        entry.filename = prefix + member
                        target.writestr(entry, data)
        if os.name == 'nt':
            temporary.rename(output)
        else:
            os.link(temporary, output)
            temporary.unlink()
    return {'archive': output.name, 'commit': commit, 'version': incoming['version'], 'full': full,
            'files': len(files), 'bytes': output.stat().st_size, 'sha256': digest(output.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--full', action='store_true')
    args = parser.parse_args()
    try:
        print(json.dumps(build(args.root.absolute(), args.output.absolute(), args.full), indent=2))
        return 0
    except (ContractError, module_manager.ModuleError, OSError, subprocess.TimeoutExpired) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    raise SystemExit(main())
