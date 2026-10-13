"""Review then run with Python3.12. Restore only this integration's pinned inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import zipfile

BASE = Path(__file__).resolve().parent


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(8 << 20), b''):
            value.update(chunk)
    return value.hexdigest()


def restore_source():
    lock = json.loads((BASE / 'source-lock.json').read_text(encoding='utf-8'))
    archive = BASE / lock['archive']
    assert digest(archive) == lock['archive_sha256']
    source = BASE / 'runtime/upstream'
    source.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as bundle:
        for item in lock['files']:
            target = (source / item['path']).resolve()
            assert target.is_relative_to(source.resolve())
            data = bundle.read(item['path'])
            assert hashlib.sha256(data).hexdigest() == item['sha256']
            if target.exists():
                assert digest(target) == item['sha256'], f'Existing source differs: {target}'
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    return lock


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--uv', required=True, help='Absolute path to reviewed uv executable')
    parser.add_argument('--weights', action='store_true', help='Download or verify pinned model weights')
    args = parser.parse_args()
    lock = restore_source()
    venv = BASE / 'runtime/intern-2b'
    if not venv.exists():
        subprocess.run([args.uv, 'venv', '--python', sys.executable, str(venv)], check=True)
    python = venv / 'Scripts/python.exe'
    subprocess.run([args.uv, 'pip', 'install', '--python', str(python), 'torch==2.9.1', 'torchvision==0.24.1', '--index-url', 'https://download.pytorch.org/whl/cu128'], check=True)
    requirements = BASE / ('requirements-lock.txt' if (BASE / 'requirements-lock.txt').exists() else 'requirements.txt')
    subprocess.run([args.uv, 'pip', 'install', '--python', str(python), '-r', str(requirements)], check=True)
    client = BASE / 'runtime/client'
    if not client.exists():
        subprocess.run([args.uv, 'venv', '--python', sys.executable, str(client)], check=True)
    client_requirements = BASE / ('requirements-client-lock.txt' if (BASE / 'requirements-client-lock.txt').exists() else 'requirements-client.txt')
    subprocess.run([args.uv, 'pip', 'install', '--python', str(client / 'Scripts/python.exe'), '-r', str(client_requirements)], check=True)
    if args.weights:
        from download_weights import download
        download()
