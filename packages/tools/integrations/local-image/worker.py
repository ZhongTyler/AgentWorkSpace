"""Dedicated offline Comfy process. Refuses an occupied port; stops only its child."""
import json, os, pathlib, shutil, socket, subprocess, time, urllib.request, uuid
from runtime_support import bounds,digest,gate,read,resources,save,sha

class Worker:
    def __init__(self,tools_home,folder,port=8211):
        self.home=pathlib.Path(tools_home).resolve();self.folder=pathlib.Path(folder).resolve();self.port=port
        self.proc=None;self.token=uuid.uuid4().hex
        old=self.home/'integrations/flux-klein/runtime'
        lock=read(self.home/'integrations/flux-klein/source-lock.json')
        self.comfy=old/('ComfyUI-'+lock['source']['commit']);self.python=old/'venv/Scripts/python.exe'
        if pathlib.Path((old/'source-path.txt').read_text().strip()).resolve()!=self.comfy.resolve():raise ValueError('Comfy source identity changed')
        if not self.python.is_file() or not (self.comfy/'main.py').is_file():raise FileNotFoundError('Pinned Comfy runtime unavailable')
        self.runtime=self.home/'integrations/local-image/runtime';self.runtime.mkdir(parents=True,exist_ok=True)
        self.lock_path=self.runtime/'owner.json';self.owned=False
        self.input=self.folder/'worker/input';self.output=self.folder/'worker/output'
        self.opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        self.samples=[]

    def api(self,path,payload=None):
        req=urllib.request.Request('http://127.0.0.1:'+str(self.port)+path,data=json.dumps(payload).encode() if payload is not None else None,headers={'Content-Type':'application/json'})
        with self.opener.open(req,timeout=10) as response:
            raw=response.read();return json.loads(raw) if raw else {}

    def sample(self):
        r=resources();self.samples.append(r);gate(r);return r

    def __enter__(self):
        gate(resources(),startup=True)
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1',self.port))==0:raise RuntimeError('Selected loopback port occupied; foreign listener preserved')
        self.folder.mkdir(parents=True,exist_ok=True)
        # Exclusive shared owner crosses worktrees; a stale owner is an audited recovery, never auto-deleted.
        with self.lock_path.open('x',encoding='utf-8') as stream:json.dump({'owner_pid':os.getpid(),'token':self.token,'folder':str(self.folder),'port':self.port},stream)
        self.owned=True
        try:
            self.input.mkdir(parents=True,exist_ok=True);self.output.mkdir(parents=True,exist_ok=True)
            paths=self.folder/'worker/paths.yaml'
            models=self.home/'integrations/image-extension-suite/runtime/models'
            paths.write_text('retained:\n  base_path: '+json.dumps(str(models).replace('\\','/'))+'\n  diffusion_models: diffusion_models\n  text_encoders: text_encoders\n  vae: vae\n',encoding='utf-8')
            command=[str(self.python),'-X','utf8','-B',str(self.comfy/'main.py'),'--listen','127.0.0.1','--port',str(self.port),'--disable-auto-launch','--disable-all-custom-nodes','--offline','--reserve-vram','2','--disable-pinned-memory','--disable-async-offload','--extra-model-paths-config',str(paths),'--input-directory',str(self.input),'--output-directory',str(self.output)]
            self.command=command;self.started=time.monotonic()
            with (self.folder/('worker-'+self.token+'.out.log')).open('x',encoding='utf-8') as stdout,(self.folder/('worker-'+self.token+'.err.log')).open('x',encoding='utf-8') as stderr:
                self.proc=subprocess.Popen(command,cwd=self.comfy,stdout=stdout,stderr=stderr,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
            save(self.folder/'worker-live.json',{'status':'starting','pid':self.proc.pid,'command':command,'owner_token':self.token})
            while time.monotonic()-self.started<90:
                self.sample()
                if self.proc.poll() is not None:raise RuntimeError('Owned Comfy exited before ready')
                try:system=self.api('/system_stats');break
                except (OSError,ValueError):time.sleep(.5)
            else:raise TimeoutError('Worker startup90s')
            argv=[str(x).replace('\\','/').casefold() for x in system['system']['argv']]
            if system['system'].get('comfyui_version')!='0.39.0' or any(str(p).replace('\\','/').casefold() not in argv for p in [self.comfy/'main.py',paths,self.input,self.output]):raise RuntimeError('Unexpected listener identity')
            self.identity={'pid':self.proc.pid,'command':command,'server':system,'startup_seconds':time.monotonic()-self.started,'owner_token':self.token}
            save(self.folder/'worker-live.json',{'status':'running',**self.identity});return self
        except BaseException as exc:self.__exit__(type(exc),exc,None);raise

    def import_image(self,path):
        path=pathlib.Path(path).resolve();name='owned_'+sha(path)+path.suffix.lower();dest=self.input/name
        if dest.exists():
            if sha(dest)!=sha(path):raise ValueError('Owned input changed')
        else:shutil.copyfile(path,dest)
        return name

    def execute(self,graph,dest):
        dest=pathlib.Path(dest)
        if dest.exists():raise FileExistsError('Source already exists; refusing overwrite')
        queue=self.api('/queue')
        if queue['queue_running'] or queue['queue_pending']:raise RuntimeError('Owned worker busy; no queue interference')
        first=len(self.samples);started=time.perf_counter();record={'graph':graph,'worker':self.identity,'status':'failed'}
        try:
            self.api('/free',{'unload_models':True,'free_memory':True});time.sleep(1);self.sample()
            submission=self.api('/prompt',{'prompt':graph,'client_id':'localimage_'+self.token});record['submission']=submission
            prompt_id=submission['prompt_id']
            while time.perf_counter()-started<180:
                self.sample();hist=self.api('/history/'+prompt_id)
                if prompt_id in hist:
                    record['history']=hist[prompt_id]
                    if hist[prompt_id]['status']['status_str']!='success':raise RuntimeError('Comfy inference failed; see original history')
                    break
                time.sleep(.5)
            else:raise TimeoutError('Image180s')
            output=record['history']['outputs']['12']['images'][0];src=bounds(self.output/output.get('subfolder','')/output['filename'],self.output)
            dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dest)
            record.update(status='success',output=str(dest),output_sha256=sha(dest))
            return record
        except BaseException as exc:record['error']=repr(exc);raise
        finally:
            samples=self.samples[first:];record.update(seconds=time.perf_counter()-started,resource_samples=samples,peak_gpu_total_used_mib=max((r['gpu_total_used_mib'] for r in samples),default=None),min_available_physical_bytes=min((r['available_physical_bytes'] for r in samples),default=None),min_available_commit_bytes=min((r['available_commit_bytes'] for r in samples),default=None))
            save(dest.with_suffix('.generation.json'),record)

    def __exit__(self,exc_type,exc,tb):
        stop_receipt=None
        if self.proc and self.proc.poll() is None:
            try:
                stopped=subprocess.run(['taskkill.exe','/PID',str(self.proc.pid),'/T','/F'],capture_output=True,text=True,timeout=20)
                stop_receipt={'taskkill_exit':stopped.returncode,'stdout':stopped.stdout,'stderr':stopped.stderr}
                # Popen's handle belongs to our child; fallback never targets a foreign PID.
                if stopped.returncode and self.proc.poll() is None:self.proc.kill();stop_receipt['own_handle_fallback']=True
                self.proc.wait(timeout=20)
            except BaseException as stop_error:
                save(self.folder/'worker-live.json',{'status':'stop_failed','pid':self.proc.pid,'owner_token':self.token,'error':repr(exc) if exc else None,'stop_error':repr(stop_error),'stop_receipt':stop_receipt,'owner_lock_preserved':True})
                raise
        if self.owned:
            save(self.folder/'worker-live.json',{'status':'stopped','pid':self.proc.pid if self.proc else None,'owner_token':self.token,'error':repr(exc) if exc else None,'stopped_unix':time.time(),'stop_receipt':stop_receipt})
            if read(self.lock_path).get('token')!=self.token:raise RuntimeError('Worker lock ownership changed; preserved')
            self.lock_path.unlink();self.owned=False
