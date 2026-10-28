"""Recover only Zhihu's transport; preserve shared HTTP clients and credentials."""
import argparse,copy,hashlib,json,os,shutil,socket,sys,tomllib
from pathlib import Path
from demand_common import private_read,private_write,digest
from demand_admin import section,write_config

NAME='research-zhihu'
TRANSPORT={'url','http_headers_helper','http_headers','env_http_headers','bearer_token_env_var','command','args','cwd'}
FILES=['demand_common.py','demand_broker.py','demand_proxy.py']

def replace_section(raw, expected, replacement):
    text,start,end=section(raw,NAME)
    if text[start:end]!=expected:raise ValueError('Zhihu transport changed concurrently; preserve it')
    return (text[:start]+replacement+text[end:]).encode('utf-8')

def native_section(spec,python,proxy,home):
    policy={k:v for k,v in spec.items() if k not in TRANSPORT}
    if any(isinstance(v,dict) for v in policy.values()):raise ValueError('Nested policy needs explicit review')
    target={**policy,'command':str(python),'args':['-B',str(proxy),'--home',str(home),'--profile',NAME]}
    return '[mcp_servers.'+NAME+']\n'+''.join(k+' = '+json.dumps(v,ensure_ascii=False)+'\n' for k,v in target.items())+'\n'

def prepare(home,shared,config,port=18129):
    if home.exists():raise ValueError('Use a fresh recovery home; old evidence preserved')
    raw=config.read_bytes();spec=tomllib.loads(raw.decode('utf-8'))['mcp_servers'][NAME]
    if spec.get('url')!='http://127.0.0.1:18089/mcp/'+NAME or set(spec.get('enabled_tools',[]))!={'zhihu_search','hot_list'}:
        raise ValueError('Unexpected existing Zhihu transport or allowlist')
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',port))==0:raise ValueError('Existing listener preserved')
    manifest=private_read(shared/'profiles.dpapi');profile=copy.deepcopy(manifest['profiles'][NAME])
    if profile['mode']!='shared' or profile['source'].get('enabled_tools')!=spec['enabled_tools']:raise ValueError('Unexpected backend policy')
    for filename,expected in profile['fingerprints'].items():
        if hashlib.sha256(Path(filename).read_bytes()).hexdigest()!=expected:raise ValueError('Backend bytes changed')
    cache=Path(profile['catalog']).read_bytes()
    if digest(json.loads(cache))!=profile['catalog_sha256']:raise ValueError('Cached catalog changed')
    home.mkdir(parents=True);runtime=home/'runtime';runtime.mkdir();hashes={}
    for name in FILES:
        source=Path(__file__).with_name(name);target=runtime/name;shutil.copyfile(source,target);hashes[name]=hashlib.sha256(target.read_bytes()).hexdigest()
    cat=home/'catalogs';cat.mkdir();(cat/(NAME+'.json')).write_bytes(cache);profile['catalog']=str(cat/(NAME+'.json'))
    # Only this backend gets a stable, same-user credential-reader baseline.
    # No token is copied into a profile, command argument or public receipt.
    for key in ('SYSTEMROOT','WINDIR','USERPROFILE','LOCALAPPDATA'):
        if key not in os.environ:raise ValueError('Missing same-user platform baseline')
        profile.setdefault('env',{})[key]=os.environ[key]
    original_bridge=Path(profile['source']['args'][0]).with_name('auth-http-bridge.mjs')
    profile['fingerprints'][str(original_bridge)]=hashlib.sha256(original_bridge.read_bytes()).hexdigest()
    import secrets
    private_write(home/'token.dpapi',{'token':secrets.token_hex(32)})
    private_write(home/'profiles.dpapi',{'schema':1,'port':port,'broker_idle_seconds':30,'environment_names':manifest['environment_names'],'profiles':{NAME:profile}})
    text,start,end=section(raw,NAME);before=text[start:end];after=native_section(spec,Path(sys.executable),runtime/'demand_proxy.py',home)
    replacement=replace_section(raw,before,after)
    private_write(home/'rollback.dpapi',{'config':str(config),'before':before,'after':after})
    record={'profile':NAME,'runtimeHashes':hashes,'beforeConfigSha256':hashlib.sha256(raw).hexdigest(),'preparedConfigSha256':hashlib.sha256(replacement).hexdigest(),
            'python':sys.executable,'proxy':str(runtime/'demand_proxy.py'),'home':str(home),'backendChanged':False,'catalogChanged':False,'toolsPolicyChanged':False,
            'processesTerminated':0,'existingHttpConnectionsReloaded':False,'port':port,'nativeHostReconnectRequired':True}
    (home/'prepared.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
    return record

def action(phase,home):
    record=json.loads((home/'prepared.json').read_text());back=private_read(home/'rollback.dpapi');path=Path(back['config'])
    for name,value in record['runtimeHashes'].items():
        if hashlib.sha256((home/'runtime'/name).read_bytes()).hexdigest()!=value:raise ValueError('Frozen recovery runtime changed')
    manifest=private_read(home/'profiles.dpapi')
    if set(manifest['profiles'])!={NAME}:raise ValueError('Recovery profile scope changed')
    profile=manifest['profiles'][NAME]
    for filename,expected in profile['fingerprints'].items():
        if hashlib.sha256(Path(filename).read_bytes()).hexdigest()!=expected:raise ValueError('Backend bytes changed')
    if digest(json.loads(Path(profile['catalog']).read_bytes()))!=profile['catalog_sha256']:raise ValueError('Cached catalog changed')
    raw=path.read_bytes()
    if phase=='apply':
        if hashlib.sha256(raw).hexdigest()!=record['beforeConfigSha256']:raise ValueError('Config changed since prepare; re-review without overwriting')
        after=replace_section(raw,back['before'],back['after']);write_config(path,raw,after)
    elif phase=='rollback':
        after=replace_section(raw,back['after'],back['before']);write_config(path,raw,after)
        return {'rolledBack':True,'processesTerminated':0,'otherConfigurationPreserved':True}
    else:
        replace_section(raw,back['after'],back['before'])
    return {'configured':True,'profile':NAME,'processesTerminated':0,'otherConfigurationPreserved':True,'nativeHostReconnectRequired':True}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('action',choices=['prepare','apply','check','rollback']);p.add_argument('--home',type=Path,required=True);p.add_argument('--shared-home',type=Path);p.add_argument('--config',type=Path)
    a=p.parse_args()
    if a.action=='prepare':
        if not a.shared_home or not a.config:p.error('prepare requires shared-home and config')
        result=prepare(a.home,a.shared_home,a.config)
    else:result=action(a.action,a.home)
    print(json.dumps(result))
