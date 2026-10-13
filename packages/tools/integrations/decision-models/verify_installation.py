"""Read-only verification of pinned local files; no download, load, or config changes."""
import hashlib
import json
from pathlib import Path
import time
import zipfile

BASE=Path(__file__).resolve().parent
def digest(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(8<<20),b''):h.update(block)
    return h.hexdigest()

def verify():
    started=time.perf_counter(); checks=[]
    for name,folder in [('intern','intern-decision-2b'),('laya','laya-multilingual'),('startlux','startlux-4b-q8')]:
        file='model-lock.json' if name=='intern' else name+'-model-lock.json'
        lock=json.loads((BASE/file).read_text(encoding='utf-8'))
        for row in lock['files']:
            path=BASE/'runtime/models'/folder/row['file']
            if digest(path)!=row['sha256']:raise RuntimeError(f'{name}: checksum mismatch {row["file"]}')
        checks.append(dict(kind='model',backend=name,files=len(lock['files']),bytes=sum(r['bytes'] for r in lock['files']),verified=True))
        source='source-lock.json' if name=='intern' else name+'-source-lock.json'
        lock=json.loads((BASE/source).read_text(encoding='utf-8'))
        archive=BASE/lock['archive']
        if digest(archive)!=lock['archive_sha256']:raise RuntimeError(f'{name}: source archive mismatch')
        with zipfile.ZipFile(archive) as bundle:
            for row in lock['files']:
                if hashlib.sha256(bundle.read(row['path'])).hexdigest()!=row['sha256']:
                    raise RuntimeError(f'{name}: archived source mismatch {row["path"]}')
        checks.append(dict(kind='source_archive',backend=name,files=len(lock['files']),verified=True))
    lock=json.loads((BASE/'llama-lock.json').read_text(encoding='utf-8'))
    for row in lock['assets']:
        archive=BASE/'runtime/downloads'/row['name']
        if digest(archive)!=row['sha256']:raise RuntimeError('llama archive checksum mismatch')
        with zipfile.ZipFile(archive) as bundle:
            for member in bundle.infolist():
                if not member.is_dir():
                    path=BASE/'runtime/llama'/member.filename
                    if hashlib.sha256(path.read_bytes()).digest()!=hashlib.sha256(bundle.read(member)).digest():
                        raise RuntimeError(f'llama installed file mismatch: {member.filename}')
    checks.append(dict(kind='llama_archive_and_extracted_files',verified=True,tag=lock['tag']))
    original=BASE/'runtime/models/laya-multilingual'
    effective=BASE/'runtime/effective/laya-multilingual'
    checks.append(dict(kind='laya_immutable_source_and_effective_copy',
        weights_same_file=(original/'model.safetensors').samefile(effective/'model.safetensors'),
        original_metadata_sha256=digest(original/'tokenizer/tokenizer_config.json'),
        effective_metadata_sha256=digest(effective/'tokenizer/tokenizer_config.json')))
    return dict(checked_unix=time.time(),checks=checks,elapsed_seconds=round(time.perf_counter()-started,3))

if __name__=='__main__':
    print(json.dumps(verify(),ensure_ascii=False,indent=2))
