#!/usr/bin/env python3
"""Prepare or check GitHub Release metadata without making network requests."""
import argparse
import json
from pathlib import Path
import re
import sys


TAG = re.compile(r'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\Z')
SEPARATOR = ' — '


def title(tag, summary):
    if not isinstance(tag, str) or not TAG.fullmatch(tag):
        raise ValueError('Use a stable release tag: vMAJOR.MINOR.PATCH (no leading zeros)')
    if (not isinstance(summary, str) or not 3 <= len(summary) <= 72
            or not summary.isascii() or not summary[0].isupper()
            or any(c.isspace() and c != ' ' for c in summary)
            or any(ord(c) < 32 or ord(c) == 127 for c in summary)
            or summary != ' '.join(summary.split())
            or re.search(r'(?i)AgentWorkSpace|\bv?[0-9]+\.[0-9]+\.[0-9]+\b', summary)):
        raise ValueError('Use a short English summary (3–72 characters, initial capital), without a repository name, version or extra whitespace')
    return tag + SEPARATOR + summary


def check(release):
    if not isinstance(release, dict):
        raise ValueError('Expected one release object')
    tag, name = release.get('tag_name'), release.get('name')
    if not isinstance(name, str) or SEPARATOR not in name:
        raise ValueError('Release name must be: vMAJOR.MINOR.PATCH — Short English summary')
    summary = name.split(SEPARATOR, 1)[1]
    if name != title(tag, summary):
        raise ValueError('Release title version must match tag_name exactly')
    return name


def create_payload(tag, summary, notes):
    if not isinstance(notes, str) or not notes.strip():
        raise ValueError('Release notes must not be empty')
    return {'tag_name': tag, 'name': title(tag, summary), 'body': notes,
            'draft': False, 'prerelease': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for command in ('title', 'create-payload'):
        p = sub.add_parser(command)
        p.add_argument('--tag', required=True)
        p.add_argument('--summary', required=True)
        if command == 'create-payload':
            p.add_argument('--notes-file', required=True, type=Path)
    p = sub.add_parser('check')
    p.add_argument('--file', required=True, type=Path,
                   help='GitHub API release object or list (all pages)')
    args = parser.parse_args(argv)
    try:
        if args.command == 'title':
            print(title(args.tag, args.summary))
        elif args.command == 'create-payload':
            notes = args.notes_file.read_text(encoding='utf-8-sig')
            print(json.dumps(create_payload(args.tag, args.summary, notes), ensure_ascii=False, indent=2))
        else:
            data = json.loads(args.file.read_text(encoding='utf-8-sig'))
            releases = data if isinstance(data, list) else [data]
            if not releases:
                raise ValueError('No releases to check')
            for release in releases:
                check(release)
            print(json.dumps({'checked': len(releases), 'valid': True}))
    except (ValueError, OSError) as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
