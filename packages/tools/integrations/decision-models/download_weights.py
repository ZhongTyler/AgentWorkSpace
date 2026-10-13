"""Pinned public model download with bounded HTTP ranges and streaming SHA-256."""
import concurrent.futures
import json
from pathlib import Path
import shutil
import time
import urllib.request

from restore import BASE, digest


def download():
    started = time.monotonic()
    lock = json.loads((BASE/'source-lock.json').read_text(encoding='utf-8'))
    model = lock['model']
    dest = BASE/'runtime/models/intern-decision-2b'
    dest.mkdir(parents=True, exist_ok=True)
    records = []
    for item in model['files']:
        name, size = item['rfilename'], item['size']
        path = (dest/name).resolve()
        assert path.is_relative_to(dest.resolve())
        expected = item.get('lfs', {}).get('sha256')
        if not path.exists():
            part = path.with_name(path.name+'.part')
            offset = part.stat().st_size if part.exists() else 0
            assert offset <= size
            chunks = []
            folder = dest/'segments'/name
            folder.mkdir(parents=True, exist_ok=True)
            url = f'https://huggingface.co/{model["id"]}/resolve/{model["revision"]}/{name}?download=true'
            for start in range(offset, size, 8 << 20):
                end = min(start+(8 << 20), size)-1
                chunks.append((start, end, folder/f'{start}-{end}'))
            def segment(spec):
                start, end, target = spec
                if target.exists() and target.stat().st_size == end-start+1:
                    return target
                for attempt in range(5):
                    try:
                        req = urllib.request.Request(url, headers={'Range':f'bytes={start}-{end}'})
                        with urllib.request.urlopen(req, timeout=45) as response:
                            if size > (8 << 20):
                                assert response.status == 206
                                assert response.headers.get('Content-Range') == f'bytes {start}-{end}/{size}'
                            temporary = target.with_suffix('.part')
                            with temporary.open('wb') as out:
                                while data := response.read(1 << 20):
                                    out.write(data)
                        assert temporary.stat().st_size == end-start+1
                        temporary.replace(target)
                        return target
                    except Exception:
                        if attempt == 4:
                            raise
                        time.sleep(.5*(attempt+1))
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                for index, _ in enumerate(pool.map(segment, chunks), 1):
                    if index % 16 == 0:
                        print(name, 'segments', index, '/', len(chunks), flush=True)
            with part.open('ab') as out:
                for _, _, chunk in chunks:
                    with chunk.open('rb') as stream:
                        shutil.copyfileobj(stream, out, 1 << 20)
            assert part.stat().st_size == size
            assert not expected or digest(part) == expected, 'Hash mismatch: '+name
            part.replace(path)
            print('Complete verified:', name, flush=True)
        assert path.stat().st_size == size
        value = digest(path)
        assert not expected or value == expected, 'Hash mismatch: '+name
        records.append({'file':name, 'bytes':size, 'sha256':value, 'verified_lfs':bool(expected)})
    receipt = {'model':model['id'], 'revision':model['revision'], 'files':records,
               'elapsed_seconds':round(time.monotonic()-started, 2), 'download_method':'bounded-public-HTTP-range'}
    (BASE/'model-lock.json').write_text(json.dumps(receipt, indent=2)+'\n', encoding='utf-8')
    print('All files verified', sum(x['bytes'] for x in records), flush=True)


if __name__ == '__main__':
    download()
