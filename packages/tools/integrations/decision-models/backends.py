"""Pinned, local-only decision backends. One model resident per gateway process."""
import gc
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.request

BASE=Path(__file__).resolve().parent
RUNTIME=BASE/'runtime'


class Backends:
    def __init__(self):
        self.name=None
        self.engine=None
        self.process=None
        self.llama_key=None
        self.loaded_seconds=0
        self.resource_note=None

    def close(self):
        if self.engine is not None:
            pool=getattr(self.engine,'pool',None)
            if pool:pool.shutdown(wait=True)
        self.engine=None
        if self.process is not None:
            # This exact child belongs to this integration; never stop by process name.
            self.process.terminate()
            try:self.process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                raise RuntimeError('Owned llama-server did not stop; refuse another GPU backend')
            self.process=None
        self.name=None
        self.llama_key=None
        self.resource_note=None
        gc.collect()
        import torch
        if torch.cuda.is_available():torch.cuda.empty_cache()

    def ensure(self,name):
        if name not in ('intern','laya','startlux'):
            raise ValueError('Unknown local backend')
        if self.name==name and self.engine is not None:return False
        # Fail before unloading the current usable backend if the requested backend is absent.
        if name!='intern':
            for file in [BASE/(name+'-source-lock.json'),BASE/(name+'-model-lock.json')]:
                if not file.exists():raise ValueError('Requested backend is not installed and verified')
        self.close()
        started=time.perf_counter()
        try:
            if name=='intern':
                sys.path.insert(0,str(RUNTIME/'upstream'))
                from intern_backend import DirectDeviceDecisionEngine
                self.resource_note=dict(selected_device='cuda',loader='bounded tensor ranges + direct device; unchanged BF16 weights')
                self.engine=DirectDeviceDecisionEngine(RUNTIME/'models/intern-decision-2b')
            elif name=='laya':
                sys.path.insert(0,str(RUNTIME/'upstream-laya'))
                from laya import Agent
                # Upstream patches tokenizer_config for Transformers compatibility. Keep pinned
                # downloads immutable; copy metadata, hardlink the immutable weight blob only.
                source=RUNTIME/'models/laya-multilingual'
                effective=RUNTIME/'effective/laya-multilingual'
                lock=json.loads((BASE/'laya-model-lock.json').read_text(encoding='utf-8'))
                for item in lock['files']:
                    target=effective/item['file']
                    if not target.exists():
                        target.parent.mkdir(parents=True,exist_ok=True)
                        if item['file'].endswith('.safetensors'):os.link(source/item['file'],target)
                        else:shutil.copyfile(source/item['file'],target)
                self.engine=Agent(str(effective),device='cpu',backend='eager')
            else:
                self._start_startlux()
            self.name=name
            self.loaded_seconds=round(time.perf_counter()-started,3)
            return True
        except Exception:
            self.close()
            raise

    def _start_startlux(self):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1',18763))==0:
                raise RuntimeError('Port 18763 occupied; refusing unrelated listener')
        binary=RUNTIME/'llama/llama-server.exe'
        if not binary.exists():raise ValueError('Pinned llama.cpp binary is not installed')
        model=RUNTIME/'models/startlux-4b-q8'
        self.llama_key=secrets.token_urlsafe(32)
        with (RUNTIME/'llama-service.log').open('ab') as log:
            self.process=subprocess.Popen([str(binary),'-m',str(model/'StartLux-Decision-4B-Q8_0.gguf'),
                '--host','127.0.0.1','--port','18763','-ngl','99','-c','4096','--parallel','1',
                '--api-key',self.llama_key],cwd=binary.parent,stdin=subprocess.DEVNULL,stdout=log,stderr=log,
                creationflags=subprocess.CREATE_NO_WINDOW)
        opener=urllib.request.build_opener(urllib.request.ProxyHandler({}))
        deadline=time.monotonic()+100
        while time.monotonic()<deadline:
            if self.process.poll() is not None:raise RuntimeError('Owned llama-server failed; inspect local log')
            try:
                request=urllib.request.Request('http://127.0.0.1:18763/health',headers={'Authorization':'Bearer '+self.llama_key})
                with opener.open(request,timeout=2) as response:
                    if response.status==200:break
            except (OSError,ValueError):pass
            time.sleep(.5)
        else:raise RuntimeError('Owned llama-server startup exceeded 100 seconds')
        sys.path.insert(0,str(RUNTIME/'upstream-startlux'))
        from startlux_decision.gguf_server import GGUFDecision
        key=self.llama_key
        class AuthenticatedGGUF(GGUFDecision):
            def _letter_logprobs(engine,ids,count):
                targets=engine.letters[:count]
                for number in (256,engine.vocab):
                    body=json.dumps(dict(prompt=ids,n_predict=1,temperature=-1,n_probs=number,cache_prompt=False)).encode()
                    request=urllib.request.Request(engine.url,body,{'Content-Type':'application/json','Authorization':'Bearer '+key})
                    with opener.open(request,timeout=110) as response:out=json.loads(response.read())
                    rows=out.get('completion_probabilities',out.get('probs'))
                    got={t['id']:t['logprob'] for t in rows[0]['top_logprobs']}
                    if all(t in got for t in targets):return [got[t] for t in targets]
                raise RuntimeError('Option-letter probabilities missing from llama.cpp response')
        self.engine=AuthenticatedGGUF(str(model),'http://127.0.0.1:18763',1)
        self.engine.max_length=2048

    def predict(self,name,state,questions):
        switched=self.ensure(name)
        started=time.perf_counter()
        if name=='intern':
            result=self.engine.predict(dict(state=state,questions=questions))
            calibration=dict(temperature=1.0,status='unfitted-HF')
            lock=json.loads((BASE/'model-lock.json').read_text(encoding='utf-8'))
        elif name=='laya':
            result=self.engine.system_one(state,questions,max_len=2048,head_max_len=512)
            if result.get('usage',{}).get('truncated'):
                raise ValueError('Laya reported truncated state; retain input and use original Research path')
            if result.get('usage',{}).get('options'):
                raise ValueError('Laya reported collapsed option spans; refuse incomplete question')
            calibration=dict(status='upstream-shipped-temperatures; not locally calibrated',
                             confidence_semantics='inspect upstream answer_confidence versus entropy confidence')
            lock=json.loads((BASE/'laya-model-lock.json').read_text(encoding='utf-8'))
        else:
            answers,usage=self.engine.decide(state,questions)
            result=dict(answers=answers,usage=usage)
            calibration=dict(status='upstream-shipped-per-type-temperatures; not locally validated',
                             confidence_semantics='normalized max probability above uniform')
            lock=json.loads((BASE/'startlux-model-lock.json').read_text(encoding='utf-8'))
        result.update(backend=name,model=lock['model'],revision=lock['revision'],calibration=calibration,
                      advisory_only=True,profile_version='research-topic-v1')
        if name=='intern':
            result['resource']=self.resource_note
        result.setdefault('timing',{}).update(inference_and_format_ms=round((time.perf_counter()-started)*1000,2),
            backend_switched=switched,backend_load_seconds=self.loaded_seconds if switched else 0)
        return result
