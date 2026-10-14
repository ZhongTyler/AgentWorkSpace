"""Pinned local game references. No upstream program or dependency is executed."""
from __future__ import annotations
import argparse,hashlib,json,os,re,tarfile,time,urllib.request,uuid
from pathlib import Path,PurePosixPath

ROOT=Path(__file__).resolve().parent
RESEARCH=ROOT.parent

def sha256_file(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''):h.update(block)
    return h.hexdigest()

def canonical(value)->bytes:
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))+'\n').encode('utf-8')

def rename_owned_source(staging:Path,destination:Path):
    # Windows may briefly deny a directory rename after many newly written files.
    # Retry only that same owned rename; permanent denial remains a visible error.
    for attempt in range(4):
        if destination.exists():raise ValueError('Refusing to replace an existing source directory')
        try:
            staging.rename(destination);return
        except PermissionError as e:
            if getattr(e,'winerror',None) not in (5,32,33) or attempt==3:raise
            time.sleep(0.05*2**attempt)

def inside(base:Path,relative:str)->Path:
    p=PurePosixPath(relative)
    if not relative or p.is_absolute() or '\\' in relative or any(x in ('','.','..') for x in p.parts):
        raise ValueError('Unsafe relative path: '+relative)
    for part in p.parts:
        if any(c in part for c in '<>:"|?*') or part.endswith((' ','.')):
            raise ValueError('Not a portable Windows path: '+relative)
        if part.split('.')[0].upper() in {'CON','PRN','AUX','NUL',*(f'COM{i}' for i in range(1,10)),*(f'LPT{i}' for i in range(1,10))}:
            raise ValueError('Reserved Windows path: '+relative)
    result=(base/Path(*p.parts)).resolve()
    if os.path.commonpath([str(base.resolve()),str(result)])!=str(base.resolve()):
        raise ValueError('Path escapes reference root')
    return result

def scan_source(source:Path,types:dict[str,dict])->list[dict]:
    actual={p.relative_to(source).as_posix():p for p in source.rglob('*') if p.is_file()}
    if set(actual)!=set(types):
        raise ValueError('Source membership changed: '+repr({'missing':sorted(set(types)-set(actual))[:8],'extra':sorted(set(actual)-set(types))[:8]}))
    rows=[]
    for name in sorted(types):
        p=inside(source,name)
        if p.is_symlink():raise ValueError('Unexpected filesystem symlink: '+name)
        content=p.read_bytes()
        rows.append({'path':name,'kind':types[name]['kind'],'git_mode':types[name]['git_mode'],
                     'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),
                     'git_blob_sha1':hashlib.sha1(b'blob '+str(len(content)).encode()+b'\0'+content).hexdigest()})
    return rows

def extract_source(archive:Path,destination:Path)->tuple[list[dict],str]:
    if destination.exists():raise ValueError('Refusing to replace an existing source directory')
    destination.parent.mkdir(parents=True,exist_ok=True)
    # Temporary extraction belongs to this library; partial failures remain for diagnosis.
    # Public source snapshots must inherit the host workspace ACL. Python's
    # Windows mkdtemp applies a private DACL that can exclude sandbox readers.
    staging=destination.parent/('.extract-'+uuid.uuid4().hex)
    staging.mkdir()
    types={};seen=set();prefix=None;expanded=0
    with tarfile.open(archive,'r:gz') as tf:
        for m in tf:
            parts=PurePosixPath(m.name).parts
            if not parts or PurePosixPath(m.name).is_absolute() or '..' in parts:
                raise ValueError('Unsafe archive member: '+m.name)
            if prefix is None:prefix=parts[0]
            if parts[0]!=prefix:raise ValueError('Archive contains multiple roots')
            if len(parts)==1:
                if not m.isdir():raise ValueError('Archive root is not a directory')
                continue
            name='/'.join(parts[1:]);p=inside(staging,name)
            if m.isdir():p.mkdir(parents=True,exist_ok=True);continue
            if name.casefold() in seen:raise ValueError('Duplicate/case-colliding archive member: '+name)
            seen.add(name.casefold())
            if not (m.isfile() or m.issym()):raise ValueError('Unsupported archive member type: '+name)
            expanded+=m.size if m.isfile() else len(m.linkname.encode())
            if expanded>8*1024**3:raise ValueError('Expanded snapshot exceeds 8GiB')
            p.parent.mkdir(parents=True,exist_ok=True)
            if m.issym():
                # Git's core.symlinks=false representation: preserve link target bytes, never follow it.
                p.write_bytes(m.linkname.encode('utf-8'));kind='symlink_as_text';mode='120000'
            else:
                f=tf.extractfile(m)
                if f is None:raise ValueError('Missing member bytes: '+name)
                with f,p.open('xb') as out:
                    while block:=f.read(1024*1024):out.write(block)
                kind='file';mode='100755' if m.mode&0o111 else '100644'
            types[name]={'kind':kind,'git_mode':mode}
    rows=scan_source(staging,types)
    # Both paths are resolved and constrained to this library before the directory rename.
    inside(ROOT,staging.relative_to(ROOT).as_posix())
    inside(ROOT,destination.relative_to(ROOT).as_posix())
    rename_owned_source(staging,destination)
    return rows,prefix or ''

def load_catalog():
    return json.loads((ROOT/'catalog.json').read_text(encoding='utf-8'))

def stored_path(relative):
    if relative.startswith('reference-library/'):
        return inside(ROOT,relative[len('reference-library/'):])
    return inside(RESEARCH,relative)

def require_external_home():
    profile=ROOT/'portable-profile.json'
    if not profile.exists():return
    marker=ROOT/'.reference-home.json'
    if any(p.name in ('modules','.agent-workspace') for p in (ROOT,*ROOT.parents)) or not marker.is_file():
        raise ValueError('Prepare an external reference home before restoring; managed modules are read-only')
    value=json.loads(marker.read_text(encoding='utf-8'))
    if value.get('source_profile')!=sha256_file(profile):raise ValueError('Reference home profile changed')
    data=json.loads(profile.read_text(encoding='utf-8'))
    for name,sha in data['files'].items():
        if sha256_file(inside(ROOT,name))!=sha:raise ValueError('Reference template changed: '+name)

def entry_for(catalog,identifier):
    selected=[x for x in catalog['selected'] if x['id']==identifier]
    if len(selected)!=1:raise ValueError('Not an installed reference id: '+identifier)
    return selected[0]

def load_manifest(entry):
    p=stored_path(entry['manifest']['path'])
    if sha256_file(p)!=entry['manifest']['sha256']:raise ValueError('Manifest identity changed')
    return json.loads(p.read_text(encoding='utf-8'))

def verify_entry(entry):
    archive=stored_path(entry['archive']['path'])
    if sha256_file(archive)!=entry['archive']['sha256']:raise ValueError('Archive hash mismatch: '+entry['id'])
    manifest=load_manifest(entry)
    types={x['path']:{'kind':x['kind'],'git_mode':x['git_mode']} for x in manifest['files']}
    source=stored_path(entry['source']['path'])
    current={'files':scan_source(source,types)}
    if canonical(current)!=canonical({'files':manifest['files']}):raise ValueError('Source bytes changed: '+entry['id'])
    for notice in entry['licenses']['saved_notices']:
        if sha256_file(stored_path(notice['path']))!=notice['sha256']:raise ValueError('Saved license changed')
    return {'id':entry['id'],'revision':entry['revision'],'status':'verified_snapshot','files':len(manifest['files']),
            'archive_bytes':archive.stat().st_size,'source_bytes':sum(x['bytes'] for x in manifest['files']),
            'runtime_status':'not_tested','adoption_status':'reference_only'}

def restore_entry(entry,download=False):
    require_external_home()
    archive=stored_path(entry['archive']['path'])
    if not archive.exists():
        if not download:raise ValueError('Archive missing; explicit --download is required for network recovery')
        url=entry['archive']['url']
        expected=f"https://codeload.github.com/{entry['repository']}/tar.gz/{entry['revision']}"
        if url!=expected or not re.fullmatch('[0-9a-f]{40}',entry['revision']):raise ValueError('Unexpected archive origin or revision')
        archive.parent.mkdir(parents=True,exist_ok=True);part=archive.with_suffix('.gz.part')
        count=0
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'TylerResearchSpace-pinned-source/1.0'}),timeout=35) as r,part.open('wb') as f:
            while block:=r.read(1024*1024):
                count+=len(block)
                if count>2*1024**3:raise ValueError('Archive exceeds 2GiB')
                f.write(block)
        if sha256_file(part)!=entry['archive']['sha256']:raise ValueError('Recovered archive hash mismatch; original lock retained')
        part.rename(archive)
    if sha256_file(archive)!=entry['archive']['sha256']:raise ValueError('Archive hash mismatch; refusing extraction')
    source=stored_path(entry['source']['path'])
    if not source.exists():
        rows,prefix=extract_source(archive,source)
        manifest_path=stored_path(entry['manifest']['path']);candidate=canonical({'files':rows})
        if hashlib.sha256(candidate).hexdigest()!=entry['manifest']['sha256']:
            raise ValueError('Recovered source manifest mismatch; original lock retained')
        manifest_path.parent.mkdir(parents=True,exist_ok=True)
        if not manifest_path.exists():manifest_path.write_bytes(candidate)
        elif manifest_path.read_bytes()!=candidate:raise ValueError('Existing manifest changed; refusing overwrite')
    elif not stored_path(entry['manifest']['path']).exists():
        raise ValueError('Source exists but manifest is missing; preserve source and recover in a clean library copy')
    return verify_entry(entry)

def main():
    p=argparse.ArgumentParser(description=__doc__);s=p.add_subparsers(dest='command',required=True)
    a=s.add_parser('list');a.add_argument('--query',default='');a.add_argument('--include-backups',action='store_true')
    a=s.add_parser('locate');a.add_argument('--id',required=True);a.add_argument('--path')
    a=s.add_parser('verify');a.add_argument('--id')
    a=s.add_parser('restore');a.add_argument('--id',required=True);a.add_argument('--download',action='store_true')
    args=p.parse_args();catalog=load_catalog()
    if args.command=='list':
        rows=catalog['selected']+(catalog['backups'] if args.include_backups else [])
        rows=[x for x in rows if args.query.casefold() in json.dumps(x,ensure_ascii=False).casefold()]
        print(json.dumps([{'id':x['id'],'name':x['name'],'status':x['status'],'topics':x['topics'],'revision':x.get('revision'),'source':x.get('source',{}).get('path')} for x in rows],ensure_ascii=False,indent=2));return
    if args.command=='verify':
        entries=[entry_for(catalog,args.id)] if args.id else catalog['selected']
        print(json.dumps([verify_entry(e) for e in entries],ensure_ascii=False,indent=2));return
    entry=entry_for(catalog,args.id)
    if args.command=='restore':print(json.dumps(restore_entry(entry,args.download),ensure_ascii=False,indent=2));return
    source=stored_path(entry['source']['path'])
    if not source.is_dir():raise ValueError('Local source is missing; restore the pinned snapshot first')
    result={'id':entry['id'],'revision':entry['revision'],'source':str(source),'entrypoints':entry['entrypoints'],'license_summary':entry['licenses']['summary']}
    if args.path:
        manifest=load_manifest(entry);item=next((x for x in manifest['files'] if x['path']==args.path),None)
        if item is None:raise ValueError('Path is not part of the pinned source manifest')
        target=inside(source,args.path)
        if sha256_file(target)!=item['sha256']:raise ValueError('Requested source file changed')
        result.update(path=str(target),sha256=item['sha256'],kind=item['kind'])
    print(json.dumps(result,ensure_ascii=False,indent=2))

if __name__=='__main__':
    try:main()
    except (ValueError,OSError,KeyError,tarfile.TarError) as e:
        print(json.dumps({'status':'failed','error':str(e)},ensure_ascii=False));raise SystemExit(2)
