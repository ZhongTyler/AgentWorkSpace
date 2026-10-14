"""Exercise real published predecessors without weakening the production version gate."""
import io,json,subprocess,sys,tarfile
from pathlib import Path
import workspace as w

def run(args):
    r=subprocess.run([str(x) for x in args],capture_output=True)
    if r.returncode:raise RuntimeError((r.stdout+r.stderr).decode('utf-8','replace'))
    return r.stdout

def published_bundle(repository,version,destination):
    """Restore a frozen historical release instead of interpreting it as latest."""
    w.version(version)
    destination.mkdir(parents=True)
    raw=run(['git','-c','safe.directory='+repository.as_posix(),'-C',repository,'archive','v'+version])
    with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
        for entry in archive:
            if entry.isdir():continue
            if not entry.isfile():raise AssertionError('Historical bundle contains a non-file')
            p=w.safe(destination,entry.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(entry).read())
    if w.catalog(destination)['version']!=version:raise AssertionError('Historical catalog identity mismatch')
    return destination


def advance_to_predecessor(root,host,cache,history_repository=None):
    history_repository=history_repository or root
    current=w.state(host)['version'];wanted=w.catalog(root)['previous_version'];chain=[]
    while wanted!=current:
        if wanted in chain:raise AssertionError('Published predecessor cycle')
        w.version(wanted);chain.append(wanted)
        raw=run(['git','-c','safe.directory='+history_repository.as_posix(),'-C',history_repository,'show','v'+wanted+':catalog.json'])
        wanted=json.loads(raw)['previous_version']
    steps=[]
    for version in reversed(chain):
        bundle=cache/version;bundle.mkdir(parents=True)
        raw=run(['git','-c','safe.directory='+history_repository.as_posix(),'-C',history_repository,'archive','v'+version])
        with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
            for entry in archive:
                if entry.isfile():
                    p=w.safe(bundle,entry.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(entry).read())
        value=json.loads(run([sys.executable,'-X','utf8','-B',bundle/'scripts/workspace.py','upgrade','--target',host,'--apply']))
        assert value['applied'] and w.state(host)['version']==version
        steps.append({'version':version,'bundle':bundle,'transaction':value['transaction']})
    return steps

def rollback_history(host,steps):
    for step in reversed(steps):
        value=json.loads(run([sys.executable,'-X','utf8','-B',step['bundle']/'scripts/workspace.py','rollback','--target',host,'--transaction',step['transaction'],'--apply']))
        assert value['applied']
