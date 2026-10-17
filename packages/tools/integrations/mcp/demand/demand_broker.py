"""Authenticated same-user loopback broker. Only fixed reviewed profiles run."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hmac
import json
import os
from pathlib import Path
import secrets
import socket
import threading
import time

from demand_common import Backend, MAX_FRAME, atomic_json, digest, pack, private_read


class Broker:
    def __init__(self, home):
        self.home = Path(home)
        self.manifest = private_read(self.home / 'profiles.dpapi')
        self.token = private_read(self.home / 'token.dpapi')['token']
        self.identity = digest(self.manifest)
        self.instance = secrets.token_hex(16)
        self.lock = threading.RLock(); self.workers = {}; self.sessions = set()
        self.pool = ThreadPoolExecutor(max_workers=64)
        self.last_used = time.monotonic(); self.stopping = False

    def event(self, kind, **values):
        # No RPC bodies, paths, environment values, tokens or upstream errors.
        with self.lock:
            with (self.home / 'events.jsonl').open('ab') as out:
                out.write(pack({'time':time.time(), 'event':kind, 'instance':self.instance, **values}))

    def worker(self, session):
        profile = self.manifest['profiles'][session.profile]
        names=profile.get('environment_names',self.manifest['environment_names'])
        env={k:v for k,v in session.env.items() if k.upper() in {n.upper() for n in names}}
        # Codex can vary PATH/TEMP between threads. Those launch details must
        # not multiply a fixed same-user backend. Only explicitly forwarded
        # profile inputs partition a shared worker (session-bound tools never share).
        share_names={n.upper() for n in profile.get('share_environment_names',[])}
        share_inputs={k:v for k,v in env.items() if k.upper() in share_names}
        key = (session.profile, session.scope if profile['mode']=='session' else digest(share_inputs))
        with self.lock:
            old = self.workers.get(key)
            if not old or old.closed:
                old = Backend(profile, env, lambda s,m:s.send(m),
                              lambda kind,**v:self.event(kind, profile=session.profile, **v))
                self.workers[key] = old
            session.worker = old
            old.reservations += 1
            return old

    def execute(self, session, msg):
        if session.closed: return
        worker = None
        try:
            worker = self.worker(session)
            init = dict(session.init)
            if worker.profile['mode']=='shared':
                # Shared read-only servers cannot request per-client sampling or
                # roots. Their approved profiles need only tool request/response.
                init['capabilities'] = {}
            result = worker.request(session, msg, init)
        except Exception:
            result = {'jsonrpc':'2.0','id':msg['id'],'error':{
                'code':-32000,'message':'Demand backend unavailable; call outcome may be unknown. No automatic replay.'}}
            self.event('request_failed', profile=session.profile)
        finally:
            if worker:
                with self.lock:worker.reservations -= 1
        session.send(result)
        if session.closed and session.worker and session.worker.profile['mode']=='session':
            with session.worker.lock: session.worker.close()

    def serve(self, conn):
        session = Session(conn)
        stream = None
        registered = False
        try:
            conn.settimeout(5)
            stream = conn.makefile('rb')
            line = stream.readline(MAX_FRAME+1)
            if len(line)>MAX_FRAME: return
            hello = json.loads(line)
            if not hmac.compare_digest(str(hello.get('token','')), self.token): return
            if hello.get('identity') != self.identity: return
            if hello.get('op')=='status':
                with self.lock:
                    session.send({'service':'tools-mcp-demand-v1','identity':self.identity,
                        'instance':self.instance,'pid':os.getpid(),'sessions':len(self.sessions),
                        'workers':[{'profile':key[0],**worker.snapshot()} for key,worker in self.workers.items() if not worker.closed]})
                return
            profile = self.manifest['profiles'].get(hello.get('profile'))
            if not profile: return
            env = hello.get('env', {})
            if not isinstance(env,dict) or set(env)-set(self.manifest['environment_names']): return
            if not all(isinstance(k,str) and isinstance(v,str) for k,v in env.items()): return
            session.profile = hello['profile']; session.env = env; session.init = hello['init']
            with self.lock: self.sessions.add(session)
            registered = True
            session.send({'service':'tools-mcp-demand-v1','ready':True,'pid':os.getpid(),'instance':self.instance})
            conn.settimeout(None)
            while not self.stopping:
                line=stream.readline(MAX_FRAME+1)
                if not line: break
                if len(line)>MAX_FRAME: break
                msg=json.loads(line)
                if not isinstance(msg,dict): break
                if 'method' in msg and 'id' in msg:
                    self.pool.submit(self.execute,session,msg)
                else:
                    if msg.get('method')=='notifications/cancelled':session.cancelled.add(msg.get('params',{}).get('requestId'))
                    # Includes backend-initiated callback responses.
                    if session.worker:session.worker.notify(session,msg)
        except (OSError, ValueError, KeyError, TypeError):
            pass
        finally:
            session.closed=True
            if stream: stream.close()
            try: conn.close()
            except OSError: pass
            with self.lock:
                self.sessions.discard(session)
                if registered:self.last_used=time.monotonic()
            worker=session.worker
            if worker and worker.profile['mode']=='session' and not worker.inflight:
                with worker.lock: worker.close()

    def maintain(self):
        while not self.stopping:
            time.sleep(.25)
            with self.lock:
                workers=list(self.workers.values())
            for worker in workers:
                if worker.closed or worker.profile['mode']!='shared': continue
                if worker.lock.acquire(blocking=False):
                    try:
                        with self.lock:referenced=any(s.worker is worker for s in self.sessions)
                        idle=worker.profile.get('idle_seconds',120)
                        expired=(idle is not None and time.monotonic()-worker.last_used>=idle)
                        unused=worker.profile.get('release_when_unused',False) and not referenced
                        if not worker.inflight and not worker.reservations and (expired or unused):
                            worker.close()
                    finally: worker.lock.release()
            with self.lock:
                self.workers={key:worker for key,worker in self.workers.items() if not worker.closed or worker.reservations}
                active=any(not x.closed for x in self.workers.values())
                if not active and not self.sessions and time.monotonic()-self.last_used>=self.manifest.get('broker_idle_seconds',30):
                    self.stopping=True

    def run(self):
        with socket.socket() as listener:
            listener.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
            listener.bind(('127.0.0.1',self.manifest['port'])); listener.listen(64); listener.settimeout(.5)
            atomic_json(self.home/'broker.json',{'service':'tools-mcp-demand-v1','identity':self.identity,
                'pid':os.getpid(),'instance':self.instance,'port':self.manifest['port']})
            self.event('broker_start',pid=os.getpid())
            threading.Thread(target=self.maintain,daemon=True).start()
            try:
                while not self.stopping:
                    try: conn,addr=listener.accept()
                    except socket.timeout: continue
                    if addr[0]!='127.0.0.1': conn.close(); continue
                    threading.Thread(target=self.serve,args=(conn,),daemon=True).start()
            finally:
                self.stopping=True
                for worker in list(self.workers.values()): worker.close()
                self.pool.shutdown(wait=True)
                self.event('broker_stop',pid=os.getpid())


class Session:
    def __init__(self,conn):
        self.conn=conn; self.lock=threading.Lock(); self.closed=False
        self.scope=secrets.token_hex(16); self.worker=None
        self.cancelled=set()

    def send(self,msg):
        if self.closed: return
        try:
            with self.lock: self.conn.sendall(pack(msg))
        except OSError: self.closed=True


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--home',required=True)
    try: Broker(p.parse_args().home).run()
    except Exception:
        # Fail closed, never report arbitrary exception bodies to MCP clients.
        raise SystemExit(1)
