"""Read-only discovery/health and fixed on-request launchers; never grants authorization."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

BASE=Path(__file__).resolve().parent

def data(path): return json.loads(path.read_text(encoding='utf-8-sig'))

def source_pause_state(base, config):
    """Check current Research selection; preserve conservative standalone defaults."""
    if not config.is_file():return {'status':'unavailable','scope':'No host config; not an external connection check'}
    import tomllib
    servers=tomllib.loads(config.read_text(encoding='utf-8')).get('mcp_servers',{})
    ids=['research-v2ex','research-stackoverflow','research-xiaohongshu']
    policy=base.parent/'Research/sources.json'
    if policy.is_file():
        rows=data(policy)['sources']
        resumed={row.get('mcp') for row in rows if row.get('selection_policy')=='on_request_by_user' and row.get('resume_authorized_at')}
        ids=[name for name in ids if name not in resumed]
    states={name:servers.get(name,{}).get('enabled',False) for name in ids}
    if any(states.values()):raise ValueError('A user-disabled source is enabled; no automatic config repair')
    return {'disabled':ids,'selection_source':'Research/sources.json' if policy.is_file() else 'standalone defaults','secrets_printed':False,'external_authorization_checked':False}

def contained(base,value):
    path=(base/value).resolve()
    if not path.is_relative_to(base.resolve()): raise ValueError('Tool path escapes its owner')
    return path

def catalog(base=BASE):
    registry=data(base/'registry.json'); workflows=data(base/'workflows.json')
    if registry.get('schema_version')!=1 or workflows.get('schema_version')!=1:raise ValueError('Unknown registry schema')
    tools={}; flows={}
    for row in registry['tools']:
        if row['id'] in tools:raise ValueError('Duplicate tool ID')
        path=contained(base,row['root'])
        for value in [row['maintenance']]+row['required_sources']:
            contained(path,value)
        runtime_owner=contained(base.parent,row['external_runtime']) if row.get('external_runtime') else path/'runtime'
        for value in row['required_runtime']:
            if not value.startswith('runtime/'):raise ValueError('Invalid runtime entry')
            contained(runtime_owner,value[len('runtime/'):])
        if not row['actions'] or len(set(row['actions']))!=len(row['actions']):raise ValueError('Invalid actions')
        tools[row['id']]=row
    for row in workflows['workflows']:
        if row['id'] in flows or not set(row['tools'])<=set(tools):raise ValueError('Duplicate workflow or unknown tool')
        entry=(base/row['entry']).resolve()
        if not entry.is_relative_to(base.parent.resolve()):raise ValueError('Workflow entry escapes workspace')
        flows[row['id']]=row
    return tools,flows

def plan(workflow,tool,action,base=BASE):
    tools,flows=catalog(base)
    if workflow not in flows or tool not in flows[workflow]['tools']:raise ValueError('Tool is not registered for this workflow')
    row=tools[tool]
    if action not in row['actions']:raise ValueError('Unknown tool action')
    return {'workflow':workflow,'tool':tool,'action':action,'stage':flows[workflow]['stage'],
            'maintenance':str(contained(base,row['root'])/row['maintenance']),
            'limits':row['limits'],'authorization':'Current task authorization remains required; registry is not permission',
            'fallback':flows[workflow]['default_path'],'side_effects':'None until an explicitly requested run'}

def skills(base=BASE):
    source=base.parent/'shared-skills'
    manifest=data(source/'manifest.json') if (source/'manifest.json').is_file() else {'skills':[]}
    rows=[{'name':r['name'],'source':str(source/r['name']/'SKILL.md'),'owner':'shared-skills'} for r in manifest['skills']]
    rows += [{'name':'rea-investigate','source':str(base/'integrations/rea/skill/rea-investigate/SKILL.md'),'owner':'Tools'},
             {'name':'research-study','source':str(base.parent/'Research/.agents/skills/research-study/SKILL.md'),'owner':'Research'}]
    for row in rows:row['source_present']=Path(row['source']).is_file()
    return rows

def gateway_status(base=BASE):
    state_path=base/'integrations/decision-models/runtime/service-state.json'
    if not state_path.exists():return {'status':'not_started','model_loaded':False}
    state=data(state_path)
    req=urllib.request.Request('http://127.0.0.1:18762/health',headers={'Authorization':'Bearer '+state['token']})
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
    try:
        with opener.open(req,timeout=2) as response:
            payload=json.loads(response.read(65537))
        if payload.get('integration')!='research-intern-decision-2b-v1':raise ValueError('Unexpected local listener identity')
        return {k:payload.get(k) for k in ('status','backend','model_loaded','pid','device','owned_llama_pid','allocation_scope')}
    except urllib.error.HTTPError as exc:raise ValueError('Local listener rejected health request: HTTP '+str(exc.code)) from None
    except urllib.error.URLError as exc:
        reason=exc.reason
        if isinstance(reason,ConnectionRefusedError) or getattr(reason,'winerror',None)==10061 or getattr(reason,'errno',None)==111:
            return {'status':'stopped','model_loaded':False}
        # Some Windows hosts time out rather than refusing a closed loopback
        # port. Confirm absence with the OS table; do not infer idle from timeout.
        if os.name=='nt' and not windows_listener_present():
            return {'status':'stopped','model_loaded':False,'evidence':'OS TCP table has no listening port18762'}
        raise ValueError('Local health unavailable; cannot classify listener as stopped') from None

def windows_listener_present():
    command="$ErrorActionPreference='Stop'; $listeners=@(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object LocalPort -eq 18762); Write-Output $listeners.Count"
    proc=subprocess.run(['powershell.exe','-NoProfile','-Command',command],capture_output=True,text=True,encoding='utf-8',timeout=20)
    if proc.returncode or proc.stdout.strip() not in ('0','1'):raise ValueError('OS TCP listener check unavailable')
    return proc.stdout.strip()=='1'

def dependency_versions(python,names,site=None):
    code='import sys,json,importlib.metadata as m; '
    if site:code+='sys.path.insert(0,'+repr(str(site))+'); '
    code+='print(json.dumps({n:m.version(n) for n in '+repr(names)+'}))'
    proc=subprocess.run([str(python),'-X','utf8','-B','-c',code],capture_output=True,text=True,encoding='utf-8',timeout=20)
    if proc.returncode:raise ValueError('Required Python distribution metadata unavailable')
    return json.loads(proc.stdout)

def health(workflow=None,integrity=False,base=BASE):
    started=time.perf_counter();tools,flows=catalog(base);checks=[]
    if workflow is not None and workflow not in flows:raise ValueError('Unknown workflow')
    selected=flows[workflow]['tools'] if workflow else list(tools)
    if (base/'portable-profile.json').is_file():
        for name in selected:
            row=tools[name];folder=contained(base,row['root'])
            missing=[r for r in [row['maintenance']]+row['required_sources'] if not (folder/r).is_file()]
            runtime=all((folder/r).is_file() for r in row['required_runtime']) if row['required_runtime'] else False
            checks.append({'check':name,'status':'error' if missing else 'observation',
                           'missing_sources':missing,'runtime_files_present':runtime,
                           'connection_quality_verified':False,'runtime_dependencies_verified':False})
        if integrity:
            lock=data(base/'portable-profile.json')['files']
            import hashlib
            bad=[name for name,sha in lock.items() if not (base/name).is_file() or hashlib.sha256((base/name).read_bytes()).hexdigest()!=sha]
            checks.append({'check':'portable_source_integrity','status':'error' if bad else 'pass','changed':bad})
        return {'status':'error' if any(c['status']=='error' for c in checks) else 'pass','checks':checks,
                'scope':'Source inventory only; optional runtime and account setup require explicit validation',
                'model_loaded_by_check':False,'external_sources_queried':False,'configuration_modified':False}
    def record(name,fn):
        try:checks.append({'check':name,'status':'pass','detail':fn()})
        except (OSError,ValueError,KeyError,subprocess.SubprocessError) as exc:
            checks.append({'check':name,'status':'error','detail':type(exc).__name__+': '+str(exc)})
    for name in selected:
        row=tools[name]; folder=contained(base,row['root'])
        def files(row=row,folder=folder):
            required=[row['maintenance']]+row['required_sources']+row['required_runtime']
            missing=[r for r in required if not (folder/r).is_file()]
            if missing:raise ValueError('Missing required files: '+', '.join(missing))
            return {'files_checked':len(required),'declared_status':row['status'],'quality_inferred':False}
        record(name+':files',files)
    if 'decisions' in selected:
        folder=base/'integrations/decision-models'
        def weights():
            count=0
            for name,dirname in [('','intern-decision-2b'),('laya-','laya-multilingual'),('startlux-','startlux-4b-q8')]:
                lock=data(folder/(name+'model-lock.json'))
                for row in lock['files']:
                    p=contained(folder/'runtime/models'/dirname,row['file'])
                    if not p.is_file() or p.stat().st_size!=row['bytes']:raise ValueError('Model file absent or wrong length: '+dirname+'/'+row['file'])
                    count+=1
            return {'files_checked':count,'hashes_checked':False}
        record('decisions:model_lengths',weights)
        record('decisions:client_dependencies',lambda:dependency_versions(folder/'runtime/client/Scripts/python.exe',['mcp','httpx']))
        record('decisions:model_dependencies',lambda:dependency_versions(folder/'runtime/intern-2b/Scripts/python.exe',['torch','transformers','accelerate','psutil']))
        record('decisions:gateway',lambda:gateway_status(base))
        if integrity:
            def verify():
                proc=subprocess.run([sys.executable,'-X','utf8','-B',str(folder/'verify_installation.py')],capture_output=True,text=True,encoding='utf-8',timeout=180)
                if proc.returncode:raise ValueError('Pinned-file integrity verification failed; inspect directly')
                return json.loads(proc.stdout)
            record('decisions:full_integrity',verify)
    if 'media' in selected:
        record('media:dependencies',lambda:dependency_versions(sys.executable,['rapidocr-onnxruntime','imageio-ffmpeg','beautifulsoup4'],base/'integrations/media/runtime'))
    if 'rea' in selected:
        record('rea:node',lambda: {'node':shutil.which('node')} if shutil.which('node') else (_ for _ in ()).throw(ValueError('Node unavailable')))
    def method_sources():
        rows=skills(base)
        if any(not r['source_present'] for r in rows):raise ValueError('Registered skill source missing')
        return {'sources':len(rows),'mirror_installation_verified':False}
    record('skills:canonical_sources',method_sources)
    def pause_state():
        config=Path(os.environ.get('CODEX_HOME',str(Path.home()/'.codex')))/'config.toml'
        return source_pause_state(base,config)
    record('sources:user_pause',pause_state)
    for name in selected:
        old=base.parent/'Research/integrations'/tools[name]['root'].split('/')[-1]
        target=contained(base,tools[name]['root'])
        if old.exists():record(name+':legacy_alias',lambda old=old,target=target:{'same_target':True} if old.resolve()==target else (_ for _ in ()).throw(ValueError('Legacy path has not been migrated to canonical tool source')))
        else:checks.append({'check':name+':legacy_alias','status':'observation','detail':'Absent; restore only if old clients require it'})
    return {'schema_version':1,'kind':'workspace_tool_health','checked_unix':time.time(),'workflow':workflow,'status':'error' if any(r['status']=='error' for r in checks) else 'pass','checks':checks,'elapsed_seconds':round(time.perf_counter()-started,3),'model_loaded_by_check':False,'external_sources_queried':False,'configuration_modified':False,'quality_or_adoption_verified':False}

def launch(workflow,tool,action,args,base=BASE):
    chosen=plan(workflow,tool,action,base);folder=base/catalog(base)[0][tool]['root']
    if action=='guide':return chosen
    if (base/'portable-profile.json').is_file() and not (base/'.tools-home.json').is_file():
        raise ValueError('Prepare an external tools home first; managed package files never own installed runtime')
    if tool=='decisions':
        python=folder/'runtime/client/Scripts/python.exe'
        if action=='classify':
            parse=argparse.ArgumentParser();parse.add_argument('--backend',choices=['intern','laya','startlux'],default='intern');parse.add_argument('--purpose')
            selected,_=parse.parse_known_args(args)
            if selected.backend=='startlux' and selected.purpose!='noncommercial_research':raise ValueError('StartLux requires explicit noncommercial_research purpose')
            cmd=[str(python),'-X','utf8','-B',str(folder/'research_adapter.py'),*args]
        else:
            if args:raise ValueError('Status/unload accept no extra arguments')
            code='import json;from local_runtime import '+('status' if action=='status' else 'stop')+';print(json.dumps('+('status' if action=='status' else 'stop')+'()))'
            cmd=[str(python),'-X','utf8','-B','-c',code]
    elif tool=='rea':
        node=shutil.which('node')
        if not node:raise ValueError('Node unavailable')
        if action=='version':
            if args:raise ValueError('Version accepts no arguments')
            cmd=[node,str(folder/'runtime/node_modules/rea-agents/scripts/rea.mjs'),'--version']
        else:cmd=[node,str(folder/'runtime/node_modules/rea-agents/scripts/rea.mjs'),'analyze-javascript-application',*args]
    elif tool=='media':cmd=[sys.executable,'-X','utf8','-B',str(folder/('capture.py' if action=='capture' else 'ocr.py')),*args]
    elif tool=='anatomy':
        if action not in ('status','restore','example'):raise ValueError('Unknown Anatomy action')
        cmd=[sys.executable,'-X','utf8','-B',str(folder/'anatomy.py'),action,*args]
    elif tool=='retrieval':cmd=[sys.executable,'-X','utf8','-B',str(folder/'cli.py'),action,*args]
    elif tool=='local-image':
        # The launcher fixes the program/action; it is not a shell or arbitrary Python entry.
        parse=argparse.ArgumentParser();parse.add_argument('--tools-home',type=Path,default=base)
        selected,remaining=parse.parse_known_args(args)
        if action not in ('health','run'):raise ValueError('Unknown local-image action')
        python=selected.tools_home/'integrations/cutout/runtime/venv/Scripts/python.exe'
        if not python.is_file():raise ValueError('Local processing Python unavailable; restore through the tool guide')
        cmd=[str(python),'-X','utf8','-B',str(folder/'pipeline.py'),'--tools-home',str(selected.tools_home),action,*remaining]
    else:raise ValueError('Action has no executable launcher')
    return subprocess.run(cmd,cwd=base.parent if tool=='local-image' else folder,check=False).returncode

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest='command',required=True)
    sub.add_parser('list');sub.add_parser('skills')
    h=sub.add_parser('health');h.add_argument('--workflow');h.add_argument('--integrity',action='store_true')
    for name in ('request','run'):
        p=sub.add_parser(name);p.add_argument('--workflow',required=True);p.add_argument('--tool',required=True);p.add_argument('--action',required=True)
    args,extra=parser.parse_known_args(argv)
    if extra and extra[0]=='--':extra=extra[1:]
    try:
        if args.command!='run' and extra:raise ValueError('Unexpected arguments')
        if args.command=='list':t,f=catalog();result={'tools':list(t.values()),'workflows':list(f.values())}
        elif args.command=='skills':result=skills()
        elif args.command=='health':result=health(args.workflow,args.integrity)
        elif args.command=='request':result=plan(args.workflow,args.tool,args.action)
        else:
            result=launch(args.workflow,args.tool,args.action,extra)
            if isinstance(result,int):return result
        print(json.dumps(result,ensure_ascii=False,indent=2))
        return 1 if isinstance(result,dict) and result.get('status')=='error' else 0
    except (ValueError,KeyError,OSError,subprocess.SubprocessError) as exc:
        print(json.dumps({'status':'check_incomplete','error':type(exc).__name__+': '+str(exc)},ensure_ascii=False));return 2

if __name__=='__main__':raise SystemExit(main())
