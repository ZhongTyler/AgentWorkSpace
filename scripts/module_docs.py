#!/usr/bin/env python3
"""Generate module-local and aggregate panoramas from module.json relationships."""
import argparse
import json
from pathlib import Path
import re


START = '<!-- module-panorama:start -->'
END = '<!-- module-panorama:end -->'


def block(modules, focus=None):
    selected = modules if focus is None else {focus: modules[focus]}
    nodes = {name: value['name'] for name, value in selected.items()}
    edges = []
    for name, value in selected.items():
        for peer in value['related']:
            if focus is not None or peer.get('panorama'):
                nodes[peer['id']] = peer['name']
                edges.append((name, peer['id']))
    lines = [START, '```mermaid', 'flowchart LR']
    for name, label in sorted(nodes.items()):
        if not re.fullmatch(r'[a-z][a-z0-9-]*', name) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9]*', label):
            raise ValueError('Invalid graph identifier or label')
        lines.append('    ' + name.replace('-', '_') + '["' + label + '"]')
    for source, target in sorted(set(edges)):
        lines.append('    ' + source.replace('-', '_') + ' -.-> ' + target.replace('-', '_'))
    lines.extend(['```', '', '虚线表示可选协作。具体用途与接口见 module.json 和协作说明。 / Dashed edges indicate optional cooperation. See module.json and the cooperation guide.', END])
    return '\n'.join(lines)


def replace(path, rendered, check=False):
    text = path.read_text('utf8')
    if text.count(START) != 1 or text.count(END) != 1:
        raise ValueError('One panorama region is required in ' + str(path))
    before, rest = text.split(START, 1)
    _, after = rest.split(END, 1)
    desired = before + rendered + after
    if check:
        if desired != text:
            raise ValueError('Stale panorama in ' + str(path))
    else:
        path.write_text(desired, encoding='utf8', newline='\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    root = args.root.absolute()
    if (root / 'module.json').is_file():
        value = json.loads((root / 'module.json').read_text('utf8'))
        rendered = block({value['id']: value}, value['id'])
    else:
        catalog = json.loads((root / 'catalog.json').read_text('utf8'))
        modules = {}
        for name, row in catalog['components'].items():
            modules[name] = json.loads((root / row['module_source'] / 'module.json').read_text('utf8'))
        rendered = block(modules)
    for name in ('README.md', 'README.en.md'):
        replace(root / name, rendered, args.check)
    print(json.dumps({'panoramas': 2, 'checked': args.check}))


if __name__ == '__main__':
    main()
