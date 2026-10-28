"""Tiny stdlib STDIO facade. Catalog discovery starts no backend or broker."""
import argparse
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import threading
import time

from demand_common import FLAGS, MAX_FRAME, digest, pack, private_read, startup_lock


def connect(home, manifest, init, profile, allow_start=True, status=False):
    token=private_read(home/'token.dpapi')['token']
    identity=digest(manifest)
    env={k:os.environ[k] for k in manifest['environment_names'] if k in os.environ}
    hello={'token':token,'identity':identity,'op':'status' if status else 'connect',
           'profile':profile,'init':init,'env':env}
    def attempt():
        conn=socket.create_connection(('127.0.0.1',manifest['port']),timeout=3)
        try:
            conn.sendall(pack(hello)); stream=conn.makefile('rb')
            raw=stream.readline(MAX_FRAME+1)
            if not raw or len(raw)>MAX_FRAME: raise RuntimeError('Unknown broker listener; preserved')
            ready=json.loads(raw)
            if ready.get('service')!='tools-mcp-demand-v1': raise RuntimeError('Unknown broker identity; preserved')
            conn.settimeout(None)
            return conn,stream,ready
        except Exception:
            conn.close(); raise
    try: return attempt()
    except ConnectionRefusedError:
        if not allow_start: raise
    with startup_lock(home):
        try: return attempt()
        except ConnectionRefusedError: pass
        with (home/'broker.stderr.log').open('ab') as log:
            child=subprocess.Popen([sys.executable,'-B',str(Path(__file__).with_name('demand_broker.py')),'--home',str(home)],
                stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=log,creationflags=FLAGS,close_fds=True)
        deadline=time.monotonic()+8
        while time.monotonic()<deadline:
            try: return attempt()
            except ConnectionRefusedError:
                if child.poll() is not None: raise RuntimeError('Owned broker did not start')
                time.sleep(.05)
        raise RuntimeError('Owned broker startup deadline')


def run(home, profile):
    manifest=private_read(home/'profiles.dpapi')
    spec=manifest['profiles'][profile]
    cache=json.loads(Path(spec['catalog']).read_text(encoding='utf-8'))
    if cache['profile_sha256']!=digest(spec['source']): raise RuntimeError('Catalog source differs')
    if digest(cache)!=spec['catalog_sha256']:raise RuntimeError('Catalog integrity differs')
    conn=None; stream=None; init=None; output_lock=threading.Lock()
    def emit(msg):
        with output_lock:
            sys.stdout.buffer.write(pack(msg));sys.stdout.buffer.flush()
    def watch_parent():
        if os.name!='nt':return
        import ctypes
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32')
        kernel.OpenProcess.restype=wintypes.HANDLE
        kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
        handle=kernel.OpenProcess(0x100000,False,os.getppid())
        if handle and kernel.WaitForSingleObject(handle,0xffffffff)==0:os._exit(0)
    threading.Thread(target=watch_parent,daemon=True).start()
    def read_remote():
        try:
            while True:
                line=stream.readline(MAX_FRAME+1)
                if not line or len(line)>MAX_FRAME: break
                emit(json.loads(line))
        except (OSError,ValueError): pass
        # Never reconnect/replay a call after the broker has accepted it.
        os._exit(1)
    try:
        while True:
            line=sys.stdin.buffer.readline(MAX_FRAME+1)
            if not line: break
            if len(line)>MAX_FRAME: raise ValueError('Oversized MCP frame')
            msg=json.loads(line)
            if not isinstance(msg,dict): raise ValueError('Invalid MCP frame')
            method=msg.get('method')
            if method=='initialize':
                if init is not None: raise ValueError('Duplicate initialize')
                init=msg['params']
                emit({'jsonrpc':'2.0','id':msg['id'],'result':cache['initialize']})
            elif method=='notifications/initialized': pass
            elif method=='ping' and conn is None:
                emit({'jsonrpc':'2.0','id':msg['id'],'result':{}})
            elif method=='tools/list' and conn is None:
                if msg.get('params',{}).get('cursor'):
                    emit({'jsonrpc':'2.0','id':msg['id'],'error':{'code':-32602,'message':'Unknown cached cursor'}})
                else: emit({'jsonrpc':'2.0','id':msg['id'],'result':{'tools':cache['tools']}})
            elif method and method.startswith('notifications/') and conn is None: pass
            else:
                if init is None: raise ValueError('Initialize required')
                if conn is None:
                    conn,stream,_=connect(home,manifest,init,profile)
                    threading.Thread(target=read_remote,daemon=True).start()
                conn.sendall(pack(msg))
    finally:
        if conn:
            try: conn.shutdown(socket.SHUT_RDWR)
            except OSError: pass
            conn.close()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--home',required=True,type=Path)
    p.add_argument('--profile');p.add_argument('--status',action='store_true')
    a=p.parse_args()
    try:
        if a.status:
            manifest=private_read(a.home/'profiles.dpapi')
            try:
                conn,stream,result=connect(a.home,manifest,{},'',False,True)
                print(json.dumps(result));conn.close()
            except ConnectionRefusedError: print(json.dumps({'service':'tools-mcp-demand-v1','status':'stopped'}))
        else: run(a.home,a.profile)
    except Exception:
        print('Demand MCP failed; inspect the owned local runtime. No credential or RPC data logged.',file=sys.stderr)
        raise SystemExit(1)
