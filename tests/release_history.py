"""Exercise real published predecessors without weakening the production version gate."""
import io,json,subprocess,sys,tarfile
from pathlib import Path
import workspace as w

def run(args):
    r=subprocess.run([str(x) for x in args],capture_output=True)
    if r.returncode:raise RuntimeError((r.stdout+r.stderr).decode('utf-8','replace'))
    return r.stdout

def advance_to_predecessor(root,host,cache):
    current=w.state(host)['version'];wanted=w.catalog(root)['previous_version'];chain=[]
    while wanted!=current:
        if wanted in chain:raise AssertionError('Published predecessor cycle')
        w.version(wanted);chain.append(wanted)
        raw=run(['git','-c','safe.directory='+root.as_posix(),'-C',root,'show','v'+wanted+':catalog.json'])
        wanted=json.loads(raw)['previous_version']
    steps=[]
    for version in reversed(chain):
        bundle=cache/version;bundle.mkdir(parents=True)
        raw=run(['git','-c','safe.directory='+root.as_posix(),'-C',root,'archive','v'+version])
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
