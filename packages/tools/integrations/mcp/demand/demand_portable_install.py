"""Explicit Windows STDIO-to-HTTP setup; no plugin edits or client reloads."""
import argparse, copy, hashlib, json, os, re, shutil, socket, subprocess, sys, tomllib
from pathlib import Path
from demand_admin import BASE_ENV, capture, environment, section, spec_from_config, write_config
from demand_common import atomic_json, digest, private_read, private_write

FILES = ('demand_common.py','demand_broker.py','demand_plugin.py','demand_http.py',
         'demand_http_headers.py','demand_http_spawn.ps1')
KEYS = {'command','args','cwd','env','env_vars','url','auth','http_headers',
        'env_http_headers','bearer_token_env_var','http_headers_helper'}
SUPPORTED_CORE = 'codex-cli 0.163.0-alpha.10.2'

def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def render(name, spec):
    def value(item):
        if isinstance(item,dict):
            return '{ '+', '.join(json.dumps(k)+' = '+value(v) for k,v in item.items())+' }'
        if isinstance(item,list):
            return '['+', '.join(map(value,item))+']'
        return json.dumps(item,ensure_ascii=False)
    return '[mcp_servers.'+name+']\n'+''.join(json.dumps(k)+' = '+value(v)+'\n' for k,v in spec.items())+'\n'

def rewrite(raw, records, reverse=False):
    text = raw.decode('utf-8')
    for record in records:
        before,after = record['original'],record['replacement']
        if reverse:
            before,after = after,before
        if record['kind']=='section':
            _,start,end = section(text.encode(),record['name'])
        else:
            first = re.search(r'(?m)^\[',text)
            top = text[:first.start()] if first else text
            match = re.search(r'(?m)^thread_unload_delay_secs\s*=.*(?:\r?\n|$)',top)
            start,end = match.span() if match else (0,0)
        if text[start:end]!=before:
            raise ValueError('Managed configuration changed; preserve owner edits')
        text = text[:start]+after+text[end:]
    before_parsed,after_parsed = tomllib.loads(raw.decode('utf-8')),tomllib.loads(text)
    owned = {r['name'] for r in records if r['kind']=='section'}
    setting = any(r['kind']=='setting' for r in records)
    def unrelated(value):
        value = copy.deepcopy(value)
        if 'mcp_servers' in value:
            value['mcp_servers'] = {k:v for k,v in value['mcp_servers'].items() if k not in owned}
        if setting:
            value.pop('thread_unload_delay_secs',None)
        return value
    if unrelated(before_parsed)!=unrelated(after_parsed):
        raise ValueError('Unrelated configuration changed; preserve original bytes')
    return text.encode('utf-8')

def plan(home, config, profiles, shared=(), port=18089, powershell=None, unload=None, codex=None):
    home,config = Path(home).resolve(),Path(config).resolve()
    base = Path(__file__).resolve().parent
    if home.exists() or home==base or home.is_relative_to(base) or base.is_relative_to(home) or config.is_relative_to(home):
        raise ValueError('Choose a fresh external home without source or configuration overlap')
    if any(p.name in ('modules','.agent-workspace') for p in (home,*home.parents)):
        raise ValueError('Runtime must remain outside managed modules and transactions')
    profiles,shared = list(profiles),set(shared)
    if not profiles or len(set(profiles))!=len(profiles) or not shared.issubset(profiles):
        raise ValueError('Select unique profiles; shared profiles must be explicitly selected')
    if not 1024<=port<=65535:
        raise ValueError('Select an unprivileged loopback port')
    powershell = Path(powershell).resolve() if powershell else None
    if not powershell or not powershell.is_file():
        raise ValueError('Provide an existing PowerShell executable')
    raw = config.read_bytes()
    parsed = tomllib.loads(raw.decode('utf-8'))
    selected = {}
    for name in profiles:
        if not re.fullmatch(r'[A-Za-z0-9_-]+',name):
            raise ValueError('Profile names require letters, digits, hyphens or underscores')
        source = parsed.get('mcp_servers',{}).get(name)
        if not source or not source.get('command') or source.get('url') or source.get('experimental_environment')=='remote':
            raise ValueError('Only selected local native STDIO transports are supported')
        if any('demand_' in str(a) for a in source.get('args',[])):
            raise ValueError('Existing demand owner preserved; follow its own recovery procedure')
        if not all(isinstance(n,str) for n in source.get('env_vars',[])):
            raise ValueError('Only named local environment forwarding is supported')
        section(raw,name)
        selected[name] = copy.deepcopy(source)
    if unload is not None:
        if not 1<=unload<=1800 or not codex:
            raise ValueError('Unload setting requires an explicit verified Codex executable')
        result = subprocess.run([str(codex),'--version'],capture_output=True,text=True,timeout=10,check=True)
        if result.stdout.strip()!=SUPPORTED_CORE:
            raise ValueError('Unload setting is verified only for the documented core version')
        old = parsed.get('thread_unload_delay_secs',1800)
        if not isinstance(old,int) or isinstance(old,bool) or old<unload:
            raise ValueError('Preserve an existing shorter or unsupported unload setting')
    return {'home':str(home),'config':str(config),'profiles':selected,'shared':sorted(shared),
            'port':port,'powershell':str(powershell),'unload':unload,'config_sha256':sha(config)}

def prepare(settings):
    if os.name!='nt':
        raise ValueError('This adapter requires Windows DPAPI, CIM and owned process jobs')
    home,config = Path(settings['home']),Path(settings['config'])
    if home.exists() or sha(config)!=settings['config_sha256']:
        raise ValueError('Preparation baseline changed; plan again')
    with socket.socket() as probe:
        probe.settimeout(.3)
        if probe.connect_ex(('127.0.0.1',settings['port']))==0:
            raise ValueError('Existing loopback listener preserved; choose another port')
    home.mkdir(parents=True)
    home = home.resolve()  # Physical path for a gateway outside the desktop MSIX context.
    root = Path(__file__).parent
    hashes = {name:sha(root/name) for name in FILES}
    revision = digest(hashes)[:20]
    runtime = home/'runtime'/revision
    runtime.mkdir(parents=True)
    for name in FILES:
        shutil.copyfile(root/name,runtime/name)
    (home/'catalogs').mkdir()
    manifest = {'schema':1,'port':0,'broker_idle_seconds':30,'environment_names':BASE_ENV.copy(),'profiles':{}}
    records = []
    raw = config.read_bytes()
    helper = subprocess.list2cmdline([sys.executable,'-X','utf8','-B',str(runtime/'demand_http_headers.py'),'--home',str(home)])
    for name,source in settings['profiles'].items():
        spec = spec_from_config(name,source,'shared' if name in settings['shared'] else 'session',home)
        for n in spec['environment_names']:
            if n not in manifest['environment_names']:
                manifest['environment_names'].append(n)
        capture(name,spec,environment(spec['environment_names']))
        manifest['profiles'][name] = spec
        _,start,end = section(raw,name)
        replacement = {k:v for k,v in source.items() if k not in KEYS}
        replacement.update(url=f'http://127.0.0.1:{settings["port"]}/mcp/{name}',http_headers_helper=helper)
        records.append({'kind':'section','name':name,'original':raw.decode()[start:end],'replacement':render(name,replacement)})
    if settings['unload'] is not None:
        text = raw.decode()
        first = re.search(r'(?m)^\[',text)
        top = text[:first.start()] if first else text
        match = re.search(r'(?m)^thread_unload_delay_secs\s*=.*(?:\r?\n|$)',top)
        records.append({'kind':'setting','original':match[0] if match else '',
                        'replacement':f'thread_unload_delay_secs = {settings["unload"]}\n'})
    rewrite(raw,records)
    if sha(config)!=settings['config_sha256']:
        raise ValueError('Configuration changed during capture; preserved, choose a new home')
    http = {'port':settings['port'],'runtime_revision':revision,'runtime_sha256':hashes,'powershell':settings['powershell']}
    changes = {'config':str(config),'records':records}
    for name,value in [('profiles',manifest),('http',http),('token',{'token':os.urandom(32).hex()}),('changes',changes)]:
        private_write(home/(name+'.dpapi'),value)
    atomic_json(home/'prepared.json',{'schema':1,'runtime_revision':revision,'runtime_sha256':hashes,
        'manifest_sha256':digest(manifest),'http_sha256':digest(http),'changes_sha256':digest(changes)})
    return {'prepared':True,'profiles':len(manifest['profiles']),'config_modified':False,'gateway_started':False,'home':str(home)}

def audit(home, native=True):
    home = Path(home).resolve()
    prepared = json.loads((home/'prepared.json').read_bytes())
    runtime = home/'runtime'/prepared['runtime_revision']
    if any(sha(runtime/name)!=expected for name,expected in prepared['runtime_sha256'].items()):
        raise ValueError('Frozen runtime changed')
    values = {}
    for name in ('profiles','http','changes'):
        values[name] = private_read(home/(name+'.dpapi'))
        if digest(values[name])!=prepared[{'profiles':'manifest_sha256','http':'http_sha256','changes':'changes_sha256'}[name]]:
            raise ValueError('Frozen settings changed')
    for spec in values['profiles']['profiles'].values():
        cache = json.loads(Path(spec['catalog']).read_bytes())
        if digest(cache)!=spec['catalog_sha256'] or cache['profile_sha256']!=digest(spec['source']):
            raise ValueError('Captured catalog changed')
        if native and any(sha(path)!=expected for path,expected in spec['fingerprints'].items()):
            raise ValueError('Reviewed native source changed; capture into a new home')
    return values['changes']

def apply(home, reverse=False):
    home = Path(home).resolve()
    changes = audit(home,native=not reverse)
    if not reverse and (home/'apply-receipt.json').exists():
        raise ValueError('Applied home retained; prepare a fresh version for upgrades')
    config = Path(changes['config'])
    before = config.read_bytes()
    after = rewrite(before,changes['records'],reverse)
    write_config(config,before,after)
    atomic_json(home/('rollback-receipt.json' if reverse else 'apply-receipt.json'),
                {'config_sha256':sha(config),'reloaded':False,'stopped_processes':0})
    return {'applied':not reverse,'rolled_back':reverse,'reloaded':False,'stopped_processes':0}

def check(home):
    changes = audit(home)
    rewrite(Path(changes['config']).read_bytes(),changes['records'],True)
    return {'runtime_unchanged':True,'wiring_unchanged':True,'backends_started':False}

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['plan','prepare','apply','check','rollback'])
    p.add_argument('--home',required=True,type=Path)
    p.add_argument('--config',type=Path)
    p.add_argument('--profiles',nargs='+')
    p.add_argument('--shared',nargs='*',default=[])
    p.add_argument('--port',type=int,default=18089)
    p.add_argument('--powershell',type=Path)
    p.add_argument('--unload-delay-secs',type=int)
    p.add_argument('--codex-executable',type=Path)
    a = p.parse_args()
    try:
        if a.action in ('plan','prepare'):
            if not a.config or not a.profiles:
                p.error('--config and --profiles are required')
            settings = plan(a.home,a.config,a.profiles,a.shared,a.port,a.powershell,a.unload_delay_secs,a.codex_executable)
            result = prepare(settings) if a.action=='prepare' else {
                'profiles':list(settings['profiles']),'shared':settings['shared'],'port':settings['port'],
                'unload_delay_secs':settings['unload'],'config_modified':False,'backends_started':False}
        elif a.action=='check':
            result = check(a.home)
        else:
            result = apply(a.home,a.action=='rollback')
        print(json.dumps(result))
        return 0
    except Exception:
        print('MCP adapter failed; preserve the home and inspect its local baseline. No private data logged.',file=sys.stderr)
        return 1

if __name__=='__main__':
    raise SystemExit(main())
