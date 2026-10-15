"""Pinned Anatomy guide, local integrity, restore and one fixed example builder."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import subprocess
import sys
import zipfile

HERE = Path(__file__).resolve().parent
def load(folder=HERE):
    return json.loads((folder/'source-lock.json').read_text(encoding='utf-8-sig'))
def sha(data):
    return hashlib.sha256(data).hexdigest()
def status(folder=HERE, integrity=False):
    lock=load(folder); runtime=folder/'runtime/upstream'
    required=['SKILL.md','kit/iso-kit.mjs','scripts/inline-kit.mjs','examples/dial-indicator/build.mjs','LICENSE']
    selected=lock['files'] if integrity else [r for r in lock['files'] if r['path'] in required]
    bad=[r['path'] for r in selected if not (runtime/r['path']).is_file() or sha((runtime/r['path']).read_bytes())!=r['sha256']]
    archive=folder/lock['archive']
    archive_valid=archive.is_file() and archive.stat().st_size==lock['bytes']
    if integrity and archive_valid: archive_valid=sha(archive.read_bytes())==lock['sha256']
    ready=not bad and len(selected)>=len(required) and archive_valid
    return {'status':'ready' if ready else 'unavailable','revision':lock['revision'],'runtime':str(runtime),'skill':str(runtime/'SKILL.md'),'node':shutil.which('node'),'files_checked':len(selected),'invalid_files':bad,'archive_valid':archive_valid,'target_executed':False,'model_loaded':False,'fallback':'Use existing text, simple diagram or lightweight interactive explanation; restore explicitly if needed'}
def restore(folder=HERE):
    if any(p.name in ("modules", ".agent-workspace") for p in (folder.resolve(), *folder.resolve().parents)):
        raise ValueError("Restore only in an external Tools home; installed modules and transactions remain immutable")
    lock=load(folder); archive=folder/lock['archive']; runtime=folder/'runtime/upstream'
    if runtime.exists():raise ValueError('Runtime already exists; preserve it and verify status, never overwrite automatically')
    raw=archive.read_bytes()
    if len(raw)!=lock['bytes'] or sha(raw)!=lock['sha256']:raise ValueError('Pinned archive identity mismatch')
    contents={}
    with zipfile.ZipFile(archive) as z:
        if sum(i.file_size for i in z.infolist())>100*1024*1024:raise ValueError('Archive exceeds unpacked size bound')
        for i in z.infolist():
            if i.is_dir():continue
            if not i.filename.startswith(lock['prefix']):raise ValueError('Unexpected archive prefix')
            name=i.filename[len(lock['prefix']):]; p=PurePosixPath(name)
            if p.is_absolute() or '..' in p.parts or '\\' in name or ':' in name or stat.S_ISLNK(i.external_attr>>16):raise ValueError('Unsafe archive member')
            if name in contents:raise ValueError('Duplicate archive member')
            contents[name]=z.read(i)
    expected={r['path']:r for r in lock['files']}
    if set(contents)!=set(expected):raise ValueError('Archive inventory mismatch')
    if any(len(b)!=expected[n]['bytes'] or sha(b)!=expected[n]['sha256'] for n,b in contents.items()):raise ValueError('Archive file integrity mismatch')
    parent=runtime.parent.resolve(); parent.mkdir(parents=True,exist_ok=True)
    if parent!=folder.resolve()/'runtime' or parent.is_symlink():raise ValueError('Runtime owner path mismatch')
    runtime.mkdir()
    for name,b in contents.items():
        target=runtime/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(b)
    return status(folder,True)
def example(output, folder=HERE):
    ready=status(folder,True)
    if ready['status']!='ready':raise ValueError('Pinned runtime unavailable; use the original explanation path or restore explicitly')
    node=shutil.which('node')
    if not node:raise ValueError('Node unavailable; original explanation remains usable')
    output=Path(output).expanduser().absolute()
    if any(p.name in ('modules', '.agent-workspace') for p in (output.resolve(), *output.resolve().parents)):
        raise ValueError('Example output must be outside managed modules and transactions')
    if output.exists():raise ValueError('Output must be a new directory; existing content is preserved')
    if output.resolve().is_relative_to(folder.resolve()):raise ValueError('Output must be outside the managed tool directory')
    runtime=folder/'runtime/upstream';output.mkdir(parents=True)
    for name in ['kit','scripts','examples/dial-indicator']:
        shutil.copytree(runtime/name,output/name)
    shutil.copy2(runtime/'LICENSE',output/'LICENSE')
    entry=output/'examples/dial-indicator/build.mjs'
    result=subprocess.run([node,str(entry),'--light'],cwd=output,capture_output=True,text=True,timeout=60,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
    if result.returncode:raise ValueError('Example build failed: '+result.stderr[-1600:])
    pages=sorted(str(p) for p in entry.parent.glob('*.html'))
    if not pages:raise ValueError('Build exited without an HTML artifact')
    return {'status':'built','revision':ready['revision'],'pages':pages,'output':str(output),'exit_code':result.returncode,'browser_verified':False,'learning_effect_verified':False,'stdout':result.stdout[-1600:]}
def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='action',required=True)
    p=sub.add_parser('status');p.add_argument('--integrity',action='store_true')
    sub.add_parser('guide');sub.add_parser('restore')
    p=sub.add_parser('example');p.add_argument('--name',choices=['dial-indicator'],default='dial-indicator');p.add_argument('--output',type=Path,required=True)
    args=parser.parse_args(argv)
    try:
        if args.action=='status':result=status(integrity=args.integrity)
        elif args.action=='restore':result=restore()
        elif args.action=='example':result=example(args.output)
        else:result={'status':'guide','maintenance':str(HERE/'README.md'),'upstream_skill':str(HERE/'runtime/upstream/SKILL.md'),'scope':'Personal understanding and explanation, optional interactive SVG/HTML; narration/video assembled separately','native_skill_installed':False,'authorization':'Upstream instructions are technique data, not permission to publish, install, spend or change projects'}
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0 if result['status']!='unavailable' else 1
    except (OSError,ValueError,subprocess.SubprocessError,zipfile.BadZipFile) as e:
        print(json.dumps({'status':'unavailable','error':str(e),'fallback':'Original explanation path; no automatic install, upgrade, cloud call or retry loop'},ensure_ascii=False));return 2
if __name__=='__main__':raise SystemExit(main())
