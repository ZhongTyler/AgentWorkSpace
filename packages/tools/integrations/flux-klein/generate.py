"""On-request FLUX.2 klein 4B generation against the dedicated loopback ComfyUI."""
import argparse, hashlib, json, pathlib, shutil, subprocess, threading, time, urllib.request, uuid

BASE=pathlib.Path(__file__).resolve().parent
RUNTIME=BASE/'runtime'
URL='http://127.0.0.1:8199'
OPENER=urllib.request.build_opener(urllib.request.ProxyHandler({}))

def api(path, payload=None):
    body=json.dumps(payload).encode() if payload is not None else None
    request=urllib.request.Request(URL+path,data=body,headers={'Content-Type':'application/json'})
    with OPENER.open(request,timeout=30) as r:
        data=r.read()
        return json.loads(data) if data else {}

def workflow(text,width,height,seed,prefix,reference=None,encoder='qwen_3_4b_fp4_flux2.safetensors'):
    graph={
      '1':{'class_type':'UNETLoader','inputs':{'unet_name':'flux-2-klein-4b-fp8.safetensors','weight_dtype':'default'}},
      '2':{'class_type':'CLIPLoader','inputs':{'clip_name':encoder,'type':'flux2','device':'default'}},
      '3':{'class_type':'VAELoader','inputs':{'vae_name':'flux2-vae.safetensors'}},
      '4':{'class_type':'CLIPTextEncode','inputs':{'text':text,'clip':['2',0]}},
      '5':{'class_type':'EmptyFlux2LatentImage','inputs':{'width':width,'height':height,'batch_size':1}},
      '6':{'class_type':'RandomNoise','inputs':{'noise_seed':seed}},
      '7':{'class_type':'BasicGuider','inputs':{'model':['1',0],'conditioning':['4',0]}},
      '8':{'class_type':'KSamplerSelect','inputs':{'sampler_name':'euler'}},
      '9':{'class_type':'Flux2Scheduler','inputs':{'steps':4,'width':width,'height':height}},
      '10':{'class_type':'SamplerCustomAdvanced','inputs':{'noise':['6',0],'guider':['7',0],'sampler':['8',0],'sigmas':['9',0],'latent_image':['5',0]}},
      '11':{'class_type':'VAEDecode','inputs':{'samples':['10',0],'vae':['3',0]}},
      '12':{'class_type':'SaveImage','inputs':{'images':['11',0],'filename_prefix':prefix}},
    }
    if reference:
        graph['13']={'class_type':'LoadImage','inputs':{'image':reference}}
        graph['14']={'class_type':'VAEEncode','inputs':{'pixels':['13',0],'vae':['3',0]}}
        graph['15']={'class_type':'ReferenceLatent','inputs':{'conditioning':['4',0],'latent':['14',0]}}
        graph['7']['inputs']['conditioning']=['15',0]
    return graph

def generate(args):
    tools_home=BASE.parents[1]
    if (tools_home/'portable-profile.json').exists() and not (tools_home/'.tools-home.json').is_file():
        raise ValueError('Prepare an external Tools home before generation; managed modules are read-only')
    if args.width%16 or args.height%16 or not 256<=args.width<=1536 or not 256<=args.height<=1536:
        raise ValueError('Pilot dimensions must be multiples of 16, between 256 and 1536')
    if args.width*args.height>1572864: raise ValueError('Pilot maximum is 1.5 megapixels')
    lock=json.loads((BASE/'source-lock.json').read_text())
    comfy=RUNTIME/('ComfyUI-'+lock['source']['commit'])
    for s in lock['models']:
        p=comfy/s['path']
        if not p.is_file() or p.stat().st_size!=s['bytes']: raise ValueError('Incomplete model: '+s['path'])
    encoder=getattr(args,'encoder','qwen_3_4b_fp4_flux2.safetensors')
    if encoder=='qwen_3_4b.safetensors' and (comfy/'models/text_encoders'/encoder).stat().st_size!=8044982048:
        raise ValueError('Legacy BF16 encoder missing or incomplete')
    system=api('/system_stats')['system']
    expected_main=str(comfy/'main.py').replace('\\','/').casefold()
    if system.get('comfyui_version')!='0.39.0' or not any(str(arg).replace('\\','/').casefold()==expected_main for arg in system.get('argv',[])):
        raise ValueError('Unexpected listener identity; refusing to unload or execute')
    queue=api('/queue')
    if queue['queue_running'] or queue['queue_pending']: raise ValueError('Dedicated server is busy; queue or resume later')
    job_id='pilot_'+uuid.uuid4().hex
    reference=None
    if args.reference:
        source=pathlib.Path(args.reference).resolve()
        if source.suffix.lower() not in ('.png','.jpg','.jpeg','.webp'): raise ValueError('Unsupported reference image')
        configured=pathlib.Path((RUNTIME/'source-path.txt').read_text().strip()).resolve()
        if configured!=comfy: raise ValueError('Unexpected source owner')
        reference=job_id+source.suffix.lower()
        shutil.copyfile(source,comfy/'input'/reference)
    graph=workflow(args.prompt,args.width,args.height,args.seed,job_id,reference,encoder)
    sample_stop=threading.Event(); samples=[]
    def sample():
        while not sample_stop.is_set():
            try:
                r=subprocess.run(['nvidia-smi','--query-gpu=memory.used,utilization.gpu','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
                if r.returncode==0:
                    values=r.stdout.strip().splitlines()[0].split(',')
                    samples.append({'seconds':time.perf_counter()-started,'total_gpu_memory_mib':int(values[0]),'gpu_utilization_percent':int(values[1])})
            except Exception: pass
            sample_stop.wait(1)
    started=time.perf_counter(); thread=threading.Thread(target=sample,daemon=True); thread.start()
    receipt={'job_id':job_id,'prompt':args.prompt,'width':args.width,'height':args.height,'seed':args.seed,'steps':4,'encoder':encoder,'workflow':graph,'reference':str(pathlib.Path(args.reference).resolve()) if args.reference else None,'memory_policy':'unload_models_and_reset_cache_before_each_job','source_commit':lock['source']['commit'],'server_argv':system.get('argv',[])}
    try:
        api('/free',{'unload_models':True,'free_memory':True})
        # The server flag is processed asynchronously; this bounded delay is
        # included in measured end-to-end latency, not hidden as setup time.
        time.sleep(1)
        receipt['memory_recycle_seconds']=time.perf_counter()-started
        result=api('/prompt',{'prompt':graph,'client_id':job_id}); receipt['submission']=result
        prompt_id=result['prompt_id']
        while time.perf_counter()-started<900:
            history=api('/history/'+prompt_id)
            if prompt_id in history:
                entry=history[prompt_id]; receipt['history']=entry
                if entry['status']['status_str']!='success': raise RuntimeError('Comfy execution failed; inspect receipt')
                files=[]
                for output in entry['outputs'].values():
                    for image in output.get('images',[]):
                        p=(RUNTIME/'outputs'/image.get('subfolder','')/image['filename']).resolve()
                        if not p.is_relative_to((RUNTIME/'outputs').resolve()): raise ValueError('Output escapes owner')
                        files.append({'path':str(p),'sha256':hashlib.file_digest(p.open('rb'),'sha256').hexdigest(),'bytes':p.stat().st_size})
                receipt['files']=files; receipt['status']='success'; break
            time.sleep(.25)
        else: raise TimeoutError('Generation exceeded pilot limit; inspect dedicated queue before retry')
    except Exception as e:
        receipt['status']='failed'; receipt['error']=repr(e); raise
    finally:
        sample_stop.set(); thread.join(timeout=6)
        receipt['end_to_end_seconds']=time.perf_counter()-started
        receipt['gpu_samples']=samples
        receipt['peak_total_gpu_memory_mib']=max((s['total_gpu_memory_mib'] for s in samples),default=None)
        folder=RUNTIME/'receipts'; folder.mkdir(exist_ok=True)
        (folder/(job_id+'.json')).write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in receipt.items() if k not in ('history','workflow','gpu_samples')},ensure_ascii=False,indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prompt',required=True); parser.add_argument('--width',type=int,default=768)
    parser.add_argument('--height',type=int,default=768); parser.add_argument('--seed',type=int,default=20261014)
    parser.add_argument('--reference')
    parser.add_argument('--encoder',choices=['qwen_3_4b.safetensors','qwen_3_4b_fp4_flux2.safetensors'],default='qwen_3_4b_fp4_flux2.safetensors')
    generate(parser.parse_args())
