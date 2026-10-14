"""Prepare a new external reference home; no network, downloads or upstream execution."""
import argparse,hashlib,json,shutil
from pathlib import Path

BASE=Path(__file__).resolve().parent

def prepare(home,base=BASE):
    base=base.resolve();home=home.resolve()
    if home.exists():raise ValueError('Destination exists; preserve it and choose a new reference home')
    if home==base or home.is_relative_to(base) or base.is_relative_to(home):raise ValueError('Reference home overlaps package')
    if any(p.name in ('modules','.agent-workspace') for p in (home,*home.parents)):raise ValueError('Reference home must be outside managed modules and transactions')
    profile=json.loads((base/'portable-profile.json').read_text(encoding='utf-8'))
    for name,sha in profile['files'].items():
        path=(base/name).resolve()
        if not path.is_relative_to(base) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:raise ValueError('Reference package checksum differs: '+name)
    home.mkdir(parents=True)
    for name in [*profile['files'],'portable-profile.json']:
        target=home/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(base/name,target)
    (home/'.reference-home.json').write_text(json.dumps({'schema_version':1,'source_profile':hashlib.sha256((base/'portable-profile.json').read_bytes()).hexdigest(),'runtime_installed':False})+'\n',encoding='utf-8')
    return {'prepared':True,'home':str(home),'downloaded':False,'upstream_executed':False}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--home',type=Path,required=True)
    print(json.dumps(prepare(p.parse_args().home)))
