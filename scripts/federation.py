"""Versioned module metadata, selective retrieval and verified instance reuse."""
from pathlib import Path
import re
import subprocess

from workspace import ContractError, digest, encoded, load, read, relative, safe, version
import module_manager


def read_catalog(bundle):
    value = load(safe(bundle, 'catalog.json'))
    if value.get('schema_version') != 2:
        raise ContractError('Expected module catalog schema 2')
    version(value.get('version'))
    if load(safe(bundle, 'compatibility.json')) != value.get('compatibility'):
        raise ContractError('Capability contract differs from the sealed catalog')
    destinations = set()
    if not value.get('components'):
        raise ContractError('Module catalog is empty')
    for name, row in value['components'].items():
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name):
            raise ContractError('Invalid module ID')
        version(row.get('version'))
        root = 'meta' if name == 'meta' else 'packages/' + name
        if row.get('module_source') != root or row.get('source') != (root + '/workspace' if name == 'meta' else root):
            raise ContractError('Unexpected module source')
        if row.get('destination') != ('' if name == 'meta' else 'modules/' + name):
            raise ContractError('Unexpected module destination')
        if not re.fullmatch(r'[0-9a-f]{40}', row.get('revision', '')):
            raise ContractError('A fixed module commit is required')
        if not re.fullmatch(r'https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.git', row.get('repository', '')):
            raise ContractError('Invalid module repository')
        if not all(re.fullmatch(r'[0-9a-f]{64}', row.get(field, '')) for field in ('module_manifest_sha256', 'module_inventory_sha256')) or not row.get('files'):
            raise ContractError('Missing module manifest or file inventory')
        for member, sha in row['files'].items():
            relative(member)
            if not re.fullmatch(r'[0-9a-f]{64}', sha):
                raise ContractError('Invalid file digest')
            destination = '/'.join(p for p in (row['destination'], member) if p).casefold()
            if destination in destinations or destination.startswith(('.git/', '.agent-workspace/')) or destination in ('.git', '.agent-workspace'):
                raise ContractError('Overlapping or reserved module destination')
            destinations.add(destination)
    from compatibility import contract
    contract(value)
    return value


def payload_inventory(root):
    actual = module_manager.inventory(root)
    record = root / 'module-files.json'
    if record.is_file():
        actual['module-files.json'] = digest(record.read_bytes())
    return actual


def verify_module(bundle, row, expected_id):
    root = safe(bundle, row['module_source'])
    try:
        value = module_manager.manifest(root)
        module_manager.verify(root)
    except module_manager.ModuleError as error:
        raise ContractError(str(error)) from error
    if value['id'] != expected_id or value['version'] != row['version'] or value['repository'] != row['repository']:
        raise ContractError('Module identity differs from the AWS lock')
    if digest(read(safe(root, 'module.json'))) != row['module_manifest_sha256']:
        raise ContractError('Module manifest differs from the AWS lock')
    if digest(read(safe(root, 'module-files.json'))) != row['module_inventory_sha256']:
        raise ContractError('Module inventory differs from the AWS lock')
    if payload_inventory(safe(bundle, row['source'])) != row['files']:
        raise ContractError('Module payload differs from the AWS lock')
    if (root / '.git').exists() and git(root, 'rev-parse', 'HEAD') != row['revision']:
        raise ContractError('Module Git commit differs from the AWS lock')
    return {'id': expected_id, 'version': row['version'], 'revision': row['revision'], 'verified': True}


def missing(bundle, catalog, names):
    return [name for name in sorted(names) if not safe(bundle, catalog['components'][name]['module_source'] + '/module.json').is_file()]


def git(root, *arguments):
    command = ['git', '-c', 'safe.directory=' + str(root), '-c', 'credential.helper=',
               '-c', 'core.autocrlf=false', '-C', str(root), *arguments]
    result = subprocess.run(command, capture_output=True, text=True, encoding='utf8', errors='replace', timeout=180)
    if result.returncode:
        raise ContractError('Module Git operation failed: ' + result.stderr[-1200:])
    return result.stdout.strip()


def prepare(bundle, catalog, names, apply=False, source_root=None):
    if not set(names) <= set(catalog['components']):
        raise ContractError('Unknown selected module')
    pending = missing(bundle, catalog, names)
    report = {'modules': sorted(names), 'download': pending, 'applied': False}
    if not apply or not names:
        return report
    if not pending:
        report['verified'] = [verify_module(bundle, catalog['components'][name], name) for name in sorted(names)]
        return report
    # This source-side lock is separate from the recipient installation lock.
    try:
        with module_manager.lock(bundle):
            for name in missing(bundle, catalog, names):
                row = catalog['components'][name]
                destination = safe(bundle, row['module_source'])
                if destination.exists() and any(destination.iterdir()):
                    raise ContractError('Existing source directory needs owner review: ' + name)
                if (bundle / '.git').exists() and (bundle / '.gitmodules').is_file() and source_root is None:
                    git(bundle, 'submodule', 'update', '--init', '--depth', '1', '--', row['module_source'])
                else:
                    stage = safe(bundle, '.module-manager/staging/' + name + '-' + row['revision'])
                    if stage.exists():
                        raise ContractError('Preserved retrieval staging exists; inspect before retrying')
                    stage.parent.mkdir(parents=True, exist_ok=True)
                    source = str(safe(source_root, name)) if source_root else row['repository']
                    git(bundle, 'clone', '--depth', '1', '--single-branch', '--branch', 'v' + row['version'], '--', source, str(stage))
                    if git(stage, 'rev-parse', 'HEAD') != row['revision']:
                        raise ContractError('Retrieved tag does not match the locked commit')
                    if destination.exists():
                        destination.rmdir()
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    stage.rename(destination)
                verify_module(bundle, row, name)
            report['verified'] = [verify_module(bundle, catalog['components'][name], name) for name in sorted(names)]
    except module_manager.ModuleError as error:
        raise ContractError(str(error)) from error
    report['applied'] = True
    return report


def external_root(target, record):
    return target if record['path'] == '.' else safe(target, record['path'])


def external_valid(target, record):
    try:
        root = external_root(target, record)
        value = module_manager.manifest(root)
        module_manager.verify(root)
        return value['version'] == record['version'] and digest(read(safe(root, 'module.json'))) == record['module_manifest_sha256']
    except (module_manager.ModuleError, ContractError, OSError):
        return False


def reusable(target, catalog, names, installed):
    candidates = module_manager.discover(target)
    external = dict((installed or {}).get('external_modules', {}))
    conflicts = []
    for name in sorted(names):
        row = catalog['components'][name]
        if name in external:
            item = external[name]
            if item['version'] != row['version'] or item['module_manifest_sha256'] != row['module_manifest_sha256'] or not external_valid(target, item):
                conflicts.append('External module needs separate owner-reviewed upgrade: ' + name)
            continue
        if name in (installed or {}).get('components', {}):
            continue
        matches = [item for item in candidates if item['id'] == name]
        if not matches:
            continue
        if len(matches) != 1:
            conflicts.append('Multiple existing module instances require selection: ' + name)
            continue
        root = Path(matches[0]['path'])
        item = {'path': root.relative_to(target).as_posix(), 'version': row['version'], 'module_manifest_sha256': row['module_manifest_sha256']}
        if external_valid(target, item):
            external[name] = item
        else:
            conflicts.append('Existing module differs from the selected published identity: ' + name)
    return external, conflicts
