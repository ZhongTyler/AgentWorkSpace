"""Prepare pinned official extension directories; does not install or enable them."""
import argparse
import hashlib
import io
import json
from pathlib import Path
from urllib.request import urlopen
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parent

def prepare(output, cache=None):
    output = output.resolve()
    for item in json.loads((ROOT/'extensions.json').read_text(encoding='utf-8'))['extensions']:
        dest = output / item['id']
        if dest.exists():
            raise ValueError(f'Preserve existing directory; choose an empty output: {dest}')
        cached = (cache / (item['id']+'.zip')) if cache else None
        data = cached.read_bytes() if cached and cached.is_file() else urlopen(item['archive_url'], timeout=30).read()
        if hashlib.sha256(data).hexdigest() != item['sha256']:
            raise ValueError('Archive hash mismatch: '+item['id'])
        with ZipFile(io.BytesIO(data)) as archive:
            files=[]
            for member in archive.infolist():
                if member.is_dir(): continue
                rel=Path(member.filename)
                if item['strip_root']: rel=Path(*rel.parts[1:])
                target=(dest/rel).resolve()
                if not target.is_relative_to(dest.resolve()):
                    raise ValueError('Archive path escape')
                files.append((member,target))
            for member,target in files:
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(archive.read(member))
        manifest=json.loads((dest/'manifest.json').read_text(encoding='utf-8'))
        if manifest['version'] != item['version']: raise ValueError('Version mismatch')
        refs=[f for cs in manifest.get('content_scripts',[]) for f in cs.get('js',[])]
        worker=manifest.get('background',{}).get('service_worker')
        if worker: refs.append(worker)
        missing=[f for f in refs if not (dest/f).is_file()]
        if missing: raise ValueError('Missing entrypoints: '+str(missing))
        print(item['name'],manifest['version'],'prepared:',dest)
        print('Host permissions:',manifest.get('host_permissions',[]))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'runtime')
    parser.add_argument('--cache',type=Path)
    args=parser.parse_args()
    prepare(args.output,args.cache)
