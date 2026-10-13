"""Run pinned REA from an explicitly selected external runtime."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__, add_help=False)
    parser.add_argument('--launcher-help', action='help')
    parser.add_argument('--runtime', type=Path, default=os.environ.get('REA_RUNTIME'))
    args, forwarded = parser.parse_known_args()
    if not args.runtime:
        parser.error('Select --runtime or set REA_RUNTIME; see integrations/rea/README.md')
    entry = args.runtime.resolve() / 'node_modules/rea-agents/scripts/rea.mjs'
    node = shutil.which('node')
    if not node or not entry.is_file():
        parser.error('Node or pinned REA entry is missing; restore the selected runtime')
    return subprocess.call([node, str(entry), *forwarded])


if __name__ == '__main__':
    raise SystemExit(main())
