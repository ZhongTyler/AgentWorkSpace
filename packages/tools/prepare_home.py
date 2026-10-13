"""Copy immutable tool templates to a NEW, user-selected external tools home. No install/network."""
import argparse, json, shutil
from pathlib import Path

BASE=Path(__file__).resolve().parent

def prepare(home,base=BASE):
    base=base.resolve(); home=home.resolve()
    if home.exists():raise ValueError('Destination exists; retain it and choose a fresh versioned tools home')
    # Package and workspace transaction trees must never own runtime.
    if home==base or home.is_relative_to(base) or base.is_relative_to(home):raise ValueError('Tools home overlaps package')
    if any(p.name in ('modules','.agent-workspace') for p in (home,*home.parents)):
        raise ValueError('Tools home must be outside managed modules and transaction state')
    profile=json.loads((base/'portable-profile.json').read_text(encoding='utf-8'))
    import hashlib
    for name,sha in profile['files'].items():
        path=(base/name).resolve()
        if not path.is_relative_to(base) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=sha:
            raise ValueError('Package source checksum differs: '+name)
    home.parent.mkdir(parents=True,exist_ok=True)
    try:
        home.mkdir()
        for name in [*profile['files'],'portable-profile.json']:
            target=home/name;target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(base/name,target)
        (home/'.tools-home.json').write_text(json.dumps({'schema_version':1,'source_profile':hashlib.sha256((base/'portable-profile.json').read_bytes()).hexdigest(),'runtime_installed':False})+'\n',encoding='utf-8')
    except Exception:
        # Preserve a partial copy for inspection; never recursively remove a supplied path.
        raise
    return {'prepared':True,'home':str(home),'runtime_installed':False,'client_modified':False}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--home',type=Path,required=True)
    a=p.parse_args();print(json.dumps(prepare(a.home)))
