#!/usr/bin/env python3
"""Seal the distribution inventory after all source exports have passed."""
import argparse
import json
from pathlib import Path
from publish import inventory
from workspace import ContractError, encoded, load, safe, version


def build(root, release, previous):
    version(release)
    if (root / '.gitmodules').is_file():
        from module_lock import build as build_modules
        return build_modules(root, release, previous)
    guide = safe(root, 'upgrades/' + release + '.md')
    if not guide.is_file():
        raise ContractError('Write the version upgrade guide before sealing')
    result = {'schema_version': 1, 'version': release, 'previous_version': previous, 'components': {}}
    result['compatibility'] = load(safe(root, 'compatibility.json'))
    for name in result['compatibility']['components']:
        source = 'meta/workspace' if name == 'meta' else 'packages/' + name
        marker_path = 'meta/_release.json' if name == 'meta' else source + '/_release.json'
        marker = load(safe(root, marker_path))
        if marker.get('preview') is not False or marker.get('component_id') != name:
            raise ContractError('Source preview cannot be sealed: ' + name)
        dependency = result['compatibility']['components'][name]
        result['components'][name] = {'version': release, 'source': source, 'destination': '' if name == 'meta' else 'modules/' + name, 'required': dependency['requires'], 'provides': dependency['provides'], 'optional': dependency['optional'], 'source_revision': marker['source_revision'], 'files': inventory(safe(root, source))}
    from compatibility import contract
    contract(result)
    safe(root, 'catalog.json').write_bytes(encoded(result))
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--previous', required=True)
    args = parser.parse_args()
    result = build(Path(__file__).absolute().parents[1], args.version, args.previous)
    print(json.dumps({'version': result['version'], 'components': list(result['components'])}))
