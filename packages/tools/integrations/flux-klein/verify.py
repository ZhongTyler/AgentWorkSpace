"""Offline installation check; no model loading, external request, or repair."""
import argparse,hashlib,importlib.metadata,json,pathlib,sys
root=pathlib.Path(__file__).resolve().parent;runtime=root/'runtime'
def verify(integrity=False):
    lock=json.loads((root/'source-lock.json').read_text())
    source=pathlib.Path((runtime/'source-path.txt').read_text().strip()).resolve()
    if source!=runtime/('ComfyUI-'+lock['source']['commit']):raise ValueError('Unexpected pinned source path')
    if not (runtime/'venv/Scripts/python.exe').is_file():raise ValueError('Dedicated Python missing')
    if not (source/'main.py').is_file():raise ValueError('ComfyUI source missing')
    files=[]
    for m in lock['models']:
        p=(source/m['path']).resolve()
        if not p.is_relative_to(source) or not p.is_file() or p.stat().st_size!=m['bytes']:raise ValueError('Incomplete model '+m['path'])
        if integrity and hashlib.file_digest(p.open('rb'),'sha256').hexdigest()!=m['sha256']:raise ValueError('Model changed '+m['path'])
        files.append({'path':m['path'],'bytes':m['bytes'],'sha256_verified':integrity})
    print(json.dumps({'status':'pass','source_commit':lock['source']['commit'],'files':files,'models_loaded':False,'network_used':False,'scope':'installation inventory and optional exact hashes; not runtime quality or long stability'},indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--integrity',action='store_true');verify(p.parse_args().integrity)
