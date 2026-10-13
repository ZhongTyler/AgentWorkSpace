"""Restore pinned additional backends; never fetch or execute arbitrary setup scripts."""
import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import shutil
import time
import urllib.request
import zipfile

BASE=Path(__file__).resolve().parent
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(8<<20),b''):h.update(block)
    return h.hexdigest()

def download_file(url,path,size,expected=None):
    path=path.resolve()
    assert path.is_relative_to((BASE/'runtime').resolve())
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists():
        assert path.stat().st_size==size
        assert not expected or digest(path)==expected
        return
    folder=path.parent/(path.name+'.segments')
    folder.mkdir(exist_ok=True)
    specs=[(start,min(start+(8<<20),size)-1) for start in range(0,size,8<<20)]
    def chunk(spec):
        start,end=spec
        target=folder/f'{start}-{end}'
        if target.exists() and target.stat().st_size==end-start+1:return target
        for attempt in range(5):
            try:
                request=urllib.request.Request(url,headers={'Range':f'bytes={start}-{end}','User-Agent':'TylerResearch-local-pilot'})
                with urllib.request.urlopen(request,timeout=60) as response:
                    if size>(8<<20):
                        assert response.status==206 and response.headers.get('Content-Range')==f'bytes {start}-{end}/{size}'
                    temporary=target.with_suffix('.part')
                    with temporary.open('wb') as stream:
                        shutil.copyfileobj(response,stream,1<<20)
                assert temporary.stat().st_size==end-start+1
                temporary.replace(target)
                return target
            except Exception:
                if attempt==4:raise
                time.sleep(attempt+1)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for i,_ in enumerate(pool.map(chunk,specs),1):
            if i%32==0:print(path.name,'segments',i,'/',len(specs),flush=True)
    part=path.with_name(path.name+'.part')
    with part.open('wb') as out:
        for start,end in specs:
            with (folder/f'{start}-{end}').open('rb') as stream:shutil.copyfileobj(stream,out,1<<20)
    assert part.stat().st_size==size
    assert not expected or digest(part)==expected, 'Upstream SHA-256 mismatch'
    part.replace(path)
    # Only generated segments of this verified file; no existing user data or recursive deletion.
    for start,end in specs:(folder/f'{start}-{end}').unlink()
    folder.rmdir()
    print('verified',path.name,flush=True)

def restore_model(name):
    manifest=json.loads((BASE/(name+'-model-manifest.json')).read_text(encoding='utf-8'))
    assert manifest['license']==('apache-2.0' if name=='laya' else 'cc-by-nc-4.0')
    dest=BASE/'runtime/models'/('laya-multilingual' if name=='laya' else 'startlux-4b-q8')
    records=[];started=time.perf_counter()
    for item in manifest['files']:
        file=item['rfilename']
        if file=='.gitattributes' or file.endswith('.py') or file.startswith('startlux_decision/') or file=='requirements.txt':continue
        path=(dest/file).resolve()
        assert path.is_relative_to(dest.resolve())
        url=f'https://huggingface.co/{manifest["id"]}/resolve/{manifest["revision"]}/{file}?download=true'
        expected=item.get('lfs',{}).get('sha256')
        download_file(url,path,item['size'],expected)
        records.append(dict(file=file,bytes=path.stat().st_size,sha256=digest(path),upstream_lfs_verified=bool(expected)))
    receipt=dict(model=manifest['id'],revision=manifest['revision'],license=manifest['license'],files=records,
        elapsed_seconds=round(time.perf_counter()-started,2),method='bounded-public-HTTP-ranges')
    (BASE/(name+'-model-lock.json')).write_text(json.dumps(receipt,indent=2)+'\n',encoding='utf-8')
    print(name,'all verified',sum(r['bytes'] for r in records),flush=True)

def restore_source(name):
    lock=json.loads((BASE/(name+'-source-lock.json')).read_text(encoding='utf-8'))
    archive=BASE/lock['archive']
    assert digest(archive)==lock['archive_sha256']
    dest=BASE/'runtime'/('upstream-'+name)
    with zipfile.ZipFile(archive) as bundle:
        for item in lock['files']:
            target=(dest/item['path']).resolve()
            assert target.is_relative_to(dest.resolve())
            data=bundle.read(item['path'])
            assert hashlib.sha256(data).hexdigest()==item['sha256']
            if target.exists():assert digest(target)==item['sha256']
            else:
                target.parent.mkdir(parents=True,exist_ok=True)
                target.write_bytes(data)

def restore_llama():
    lock=json.loads((BASE/'llama-lock.json').read_text(encoding='utf-8'))
    dest=BASE/'runtime/llama'
    for item in lock['assets']:
        archive=BASE/'runtime/downloads'/item['name']
        download_file(item['url'],archive,item['size'],item['sha256'])
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                target=(dest/member.filename).resolve()
                assert target.is_relative_to(dest.resolve())
                if member.is_dir():target.mkdir(parents=True,exist_ok=True)
                else:
                    data=bundle.read(member)
                    target.parent.mkdir(parents=True,exist_ok=True)
                    if target.exists():assert target.read_bytes()==data
                    else:target.write_bytes(data)
    print('llama extracted',lock['tag'],flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('backend',choices=['laya','startlux','llama'])
    args=parser.parse_args()
    if args.backend=='llama':restore_llama()
    else:
        restore_source(args.backend)
        restore_model(args.backend)
