"""Build the aggregate lock from independently committed module repositories."""
from workspace import ContractError, digest, encoded, load, safe, version
from federation import payload_inventory, git, read_catalog
import module_manager


def build(root, release, previous):
    version(release)
    if not safe(root, 'upgrades/' + release + '.md').is_file():
        raise ContractError('Write the upgrade and recovery guide before sealing')
    compatibility = load(safe(root, 'compatibility.json'))
    result = {'schema_version': 2, 'version': release, 'previous_version': previous,
              'compatibility': compatibility, 'components': {}}
    for name, capability in compatibility['components'].items():
        prefix = 'meta' if name == 'meta' else 'packages/' + name
        module = safe(root, prefix)
        metadata = module_manager.manifest(module)
        module_manager.verify(module)
        status = git(module, 'status', '--porcelain', '--untracked-files=all')
        if status:
            raise ContractError('Commit the module before locking its version: ' + name)
        if metadata['id'] != name or metadata['provides'] != capability['provides'] or metadata['requires'] != capability['requires']:
            raise ContractError('Module capabilities differ from the aggregate contract')
        source = prefix + '/workspace' if name == 'meta' else prefix
        result['components'][name] = {
            'name': metadata['name'], 'version': metadata['version'], 'module_source': prefix, 'source': source,
            'destination': '' if name == 'meta' else 'modules/' + name,
            'required': metadata['requires'], 'provides': metadata['provides'], 'optional': metadata['optional'],
            'repository': metadata['repository'], 'revision': git(module, 'rev-parse', 'HEAD'),
            'module_manifest_sha256': digest((module / 'module.json').read_bytes()),
            'module_inventory_sha256': digest((module / 'module-files.json').read_bytes()),
            'files': payload_inventory(safe(root, source)), 'related': metadata['related'],
            'runtime': metadata['runtime'], 'interfaces': metadata['interfaces'],
        }
    safe(root, 'catalog.json').write_bytes(encoded(result))
    return read_catalog(root)
