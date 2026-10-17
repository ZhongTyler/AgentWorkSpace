"""Capture real catalogs and install reversible scoped demand profiles locally."""
import argparse
import copy
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sys
import tomllib

from demand_common import Backend, atomic_json, digest, private_read, private_write

BASE_ENV = ['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','TEMP','TMP','USERPROFILE',
            'LOCALAPPDATA','APPDATA','PROGRAMDATA','HOMEDRIVE','HOMEPATH','SYSTEMDRIVE',
            'PROGRAMFILES','PROGRAMFILES(X86)','COMMONPROGRAMFILES','HOME','USERNAME',
            'HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','SSL_CERT_FILE','SSL_CERT_DIR',
            'REQUESTS_CA_BUNDLE','CURL_CA_BUNDLE','NODE_EXTRA_CA_CERTS','LANG','LC_ALL','TZ']


def environment(names):
    return {k:v for k,v in os.environ.items() if k.upper() in {n.upper() for n in names}}


def spec_from_config(name, source, mode, home):
    if not source.get('command'): raise ValueError('Expected a command profile')
    spec={k:copy.deepcopy(source[k]) for k in ('command','args','cwd','env') if k in source}
    spec.update(source=source,mode=mode,catalog=str(home/'catalogs'/(name+'.json')),
                startup_timeout=source.get('startup_timeout_sec',30),
                tool_timeout=source.get('tool_timeout_sec',180),idle_seconds=120)
    files={}
    for item in source.get('args',[]):
        path=Path(item)
        if path.is_absolute() and path.is_file() and path.suffix in ('.py','.mjs','.js'):
            files[str(path)]=hashlib.sha256(path.read_bytes()).hexdigest()
    spec['fingerprints']=files
    spec['environment_names']=BASE_ENV+source.get('env_vars',[])
    spec['share_environment_names']=source.get('env_vars',[])
    return spec


def capture(name, spec, env):
    notices=[]
    worker=Backend(spec,env,lambda session,msg:notices.append(msg.get('method')),
                   lambda *args,**kwargs:None)
    init={'protocolVersion':'2025-06-18','capabilities':{},'clientInfo':{'name':'tools-demand-capture','version':'1'}}
    try:
        worker.start(init)
        tools=[];cursor=None;seen=set()
        while True:
            response=worker.request(None,{'jsonrpc':'2.0','id':10,'method':'tools/list',
                'params':{'cursor':cursor} if cursor else {}},init)
            if 'error' in response: raise ValueError('Live catalog failed')
            tools.extend(response['result']['tools']);cursor=response['result'].get('nextCursor')
            if not cursor:break
            if cursor in seen:raise ValueError('Repeated catalog cursor')
            seen.add(cursor)
        if not tools:raise ValueError('Empty live catalog')
        value={'schema':1,'profile_sha256':digest(spec['source']),
               'initialize':worker.initialize_result,'tools':tools}
        atomic_json(spec['catalog'],value)
        spec['catalog_sha256']=digest(value)
        return {'profile':name,'tools':len(tools),'catalog_sha256':digest(value),
                'child_pid':worker.process.pid,'source_unchanged':True}
    finally:
        worker.close()


def section(raw, name):
    text=raw.decode('utf-8')
    headers=list(re.finditer(r'(?m)^\[[^\]\r\n]+\][ \t]*\r?$',text))
    hits=[]
    for i,m in enumerate(headers):
        title=m[0].strip().strip('[]')
        if title=='mcp_servers.'+name or title.startswith('mcp_servers.'+name+'.'):
            hits.append((m.start(),headers[i+1].start() if i+1<len(headers) else len(text)))
    if not hits or any(a[1]!=b[0] for a,b in zip(hits,hits[1:])):
        raise ValueError('Missing or noncontiguous profile')
    return text,hits[0][0],hits[-1][1]


def switch(raw,name,python,proxy,home):
    parsed=tomllib.loads(raw.decode());old=parsed['mcp_servers'][name]
    if not (old.get('command') or old.get('url')):raise ValueError('Expected original transport')
    if any('demand_proxy.py' in str(x) for x in old.get('args',[])):
        raise ValueError('Already managed; do not overwrite')
    keep={k:v for k,v in old.items() if k not in ('command','args','cwd','url','auth','http_headers_helper','bearer_token_env_var','http_headers','env_http_headers')}
    new={**keep,'command':str(python),'args':['-B',str(proxy),'--home',str(home),'--profile',name]}
    lines=['[mcp_servers.'+name+']']
    for key,value in new.items():
        if isinstance(value,dict):continue
        lines.append(key+' = '+json.dumps(value,ensure_ascii=False))
    for key,value in new.items():
        if not isinstance(value,dict):continue
        lines.extend(['','[mcp_servers.'+name+'.'+key+']'])
        for k,v in value.items():lines.append(json.dumps(k)+' = '+json.dumps(v,ensure_ascii=False))
    replacement='\n'.join(lines)+'\n\n'
    text,start,end=section(raw,name)
    updated=(text[:start]+replacement+text[end:]).encode()
    after=tomllib.loads(updated.decode())
    before_other={**parsed,'mcp_servers':{k:v for k,v in parsed['mcp_servers'].items() if k!=name}}
    after_other={**after,'mcp_servers':{k:v for k,v in after['mcp_servers'].items() if k!=name}}
    if before_other!=after_other:raise ValueError('Unrelated configuration changed')
    return updated,{'name':name,'original':text[start:end],'replacement':replacement,
                    'before_sha256':hashlib.sha256(raw).hexdigest(),
                    'after_sha256':hashlib.sha256(updated).hexdigest()}


def write_config(path,before,after):
    if path.read_bytes()!=before:raise ValueError('Concurrent config owner edit preserved')
    tmp=path.with_name(path.name+'.demand-'+secrets.token_hex(8))
    try:
        with tmp.open('xb') as out:out.write(after);out.flush();os.fsync(out.fileno())
        if path.read_bytes()!=before:raise ValueError('Concurrent config owner edit preserved')
        os.replace(tmp,path)
    finally:tmp.unlink(missing_ok=True)


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--home',required=True,type=Path);p.add_argument('--config',type=Path)
    p.add_argument('--profile');p.add_argument('--mode',choices=['session','shared'],default='session')
    p.add_argument('--capture',action='store_true');p.add_argument('--apply',action='store_true')
    p.add_argument('--rollback',type=Path);p.add_argument('--port',type=int,default=18079)
    a=p.parse_args();a.home.mkdir(parents=True,exist_ok=True)
    manifest_path=a.home/'profiles.dpapi'
    manifest=private_read(manifest_path) if manifest_path.exists() else {
        'schema':1,'port':a.port,'broker_idle_seconds':30,'environment_names':BASE_ENV.copy(),'profiles':{}}
    if not (a.home/'token.dpapi').exists():private_write(a.home/'token.dpapi',{'token':secrets.token_hex(32)})
    if a.rollback:
        record=private_read(a.rollback);raw=a.config.read_bytes();text=raw.decode()
        if text.count(record['replacement'])!=1:raise ValueError('Managed profile changed; preserve owner edits')
        after=text.replace(record['replacement'],record['original'],1).encode()
        if a.apply:write_config(a.config,raw,after)
        print(json.dumps({'action':'rollback','applied':a.apply,'profile':record['name']}));return
    if not a.config or not a.profile:p.error('--config and --profile required')
    raw=a.config.read_bytes();source=tomllib.loads(raw.decode())['mcp_servers'][a.profile]
    if a.capture:
        spec=spec_from_config(a.profile,source,a.mode,a.home)
        (a.home/'catalogs').mkdir(exist_ok=True)
        extra=source.get('env_vars',[])
        if not all(isinstance(x,str) for x in extra):raise ValueError('Remote env forwarding not supported by local profile')
        for name in extra:
            if name not in manifest['environment_names']:manifest['environment_names'].append(name)
        result=capture(a.profile,spec,environment(manifest['environment_names']))
        manifest['profiles'][a.profile]=spec
        private_write(manifest_path,manifest)
        print(json.dumps({'action':'capture',**result}));return
    spec=manifest['profiles'][a.profile]
    if spec['source']!=source:raise ValueError('Configuration changed after catalog capture')
    after,record=switch(raw,a.profile,sys.executable,Path(__file__).with_name('demand_proxy.py'),a.home)
    backup=None
    if a.apply:
        backups=a.home/'config-backups';backups.mkdir(exist_ok=True)
        backup=backups/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'-'+a.profile+'.dpapi')
        private_write(backup,record);write_config(a.config,raw,after)
    print(json.dumps({'action':'switch','profile':a.profile,'applied':a.apply,
                     'unrelated_config_preserved':True,'backup':str(backup) if backup else None}))


if __name__=='__main__':main()
