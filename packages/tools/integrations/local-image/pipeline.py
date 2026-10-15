"""On-request supervised local game assets. Finite schema; durable, non-overwriting batches."""
import argparse, contextlib, html, inspect, json, pathlib, re, shutil, subprocess, sys, time, uuid
from profiles import PROFILE_VERSION,PROFILES,graph
from runtime_support import digest,gate,read,resources,save,sha
from worker import Worker

BASE=pathlib.Path(__file__).resolve().parent
ASSET_KEYS={'id','profile','prompt','width','height','seed','reference','source','cutout','upscale','target_size','mask','original'}

def strict_keys(row,keys):
    if not isinstance(row,dict) or set(row)-keys:raise ValueError('Unknown schema fields')

def validate(request):
    strict_keys(request,{'schema_version','assets'})
    if request.get('schema_version')!=1 or not isinstance(request.get('assets'),list) or not 1<=len(request['assets'])<=64:raise ValueError('Expected schema1 and1..64 assets')
    names=set();normalized=[]
    for item in request['assets']:
        strict_keys(item,ASSET_KEYS);r=dict(item)
        if not isinstance(r.get('id'),str) or not re.fullmatch(r'[a-z][a-z0-9_-]{0,63}',r['id']) or r['id'] in names:raise ValueError('Unique safe asset IDs required')
        names.add(r['id'])
        if r.get('profile') not in PROFILES:raise ValueError('Unknown profile')
        if not isinstance(r.get('prompt'),str) or not 1<=len(r['prompt'])<=12000:raise ValueError('Prompt missing/too long; never silently truncate')
        for dim in ('width','height'):
            if type(r.get(dim)) is not int or not 256<=r[dim]<=1536 or r[dim]%16:raise ValueError('Dimensions256..1536 multiples16')
        if r['width']*r['height']>1572864:raise ValueError('Maximum1.5MP')
        if type(r.get('seed')) is not int or not 0<=r['seed']<2**63:raise ValueError('Seed must be bounded integer')
        if r.get('cutout','none') not in ('none','cpu','birefnet'):raise ValueError('Unknown cutout')
        if r.get('upscale','none') not in ('none','general','anime'):raise ValueError('Unknown upscale')
        if r.get('reference') and not PROFILES[r['profile']]['reference']:raise ValueError('Native reference unavailable for this profile')
        if bool(r.get('mask'))!=bool(r.get('original')):raise ValueError('Explicit mask requires original and vice versa')
        size=r.get('target_size',[128,128])
        if not isinstance(size,list) or len(size)!=2 or any(type(v) is not int or not 16<=v<=4096 for v in size):raise ValueError('Target size invalid')
        r['target_size']=size
        if r.get('source') and r.get('reference'):raise ValueError('Use a copied source or generation reference, not both')
        for key in ('reference','source','mask','original'):
            if r.get(key):
                p=pathlib.Path(r[key]).resolve()
                if not p.is_file() or p.suffix.lower() not in ('.png','.jpg','.jpeg','.webp'):raise ValueError('Local image input required')
                r[key]=str(p);r[key+'_sha256']=sha(p)
        normalized.append(r)
    return {'schema_version':1,'assets':normalized,'profile_version':PROFILE_VERSION}

def inventory(home,profiles=None,integrity=False):
    home=pathlib.Path(home).resolve();chosen=list(PROFILES) if profiles is None else profiles;rows=[]
    if not chosen:return {'profiles':[],'files':[],'model_loaded':False,'external_query':False}
    flux=read(home/'integrations/flux-klein/source-lock.json')
    suite=read(home/'integrations/image-extension-suite/source-lock.json')
    # Source locks remain the sole restore authority; profiles select their actual components.
    for profile in chosen:
        recipe=graph(profile,'inventory',768,768,1,'inventory')
        required={v for n in recipe.values() for k,v in n['inputs'].items() if k in ('unet_name','clip_name','vae_name')}
        locks=flux['models'] if profile=='flux' else suite['verified_components_by_stage']['G' if profile=='anima' else 'H']
        for name in sorted(required):
            candidates=[r for r in locks if pathlib.Path(r.get('path',r.get('file',''))).name==name]
            if len(candidates)!=1:raise ValueError('Model lock unavailable/ambiguous: '+name)
            r=candidates[0];relative=r.get('path',r.get('file'))
            root=home/'integrations/flux-klein/runtime'/('ComfyUI-'+flux['source']['commit']) if profile=='flux' else home/'integrations/image-extension-suite/runtime'
            if profile!='flux':relative='models/'+relative.removeprefix('split_files/')
            path=root/relative;length=r.get('bytes',r.get('size'))
            if not path.is_file() or path.stat().st_size!=length:raise ValueError('Model missing/incomplete: '+str(path))
            if integrity and sha(path)!=r['sha256']:raise ValueError('Model integrity changed: '+name)
            rows.append({'profile':profile,'path':str(path),'bytes':length,'sha256_expected':r['sha256'],'sha256_verified':integrity})
    return {'profiles':chosen,'files':rows,'model_loaded':False,'external_query':False}

def verified_stage(path,fingerprint):
    receipt=path.with_suffix('.stage.json')
    if not receipt.exists():
        if path.exists():raise FileExistsError('Untracked output preserved; explicit audit required')
        return None
    record=read(receipt)
    if record['fingerprint']!=fingerprint:raise ValueError('Stage recipe/input changed; refuse resume')
    if record['status']=='success':
        for r in record['outputs']:
            if not pathlib.Path(r['path']).is_file() or sha(r['path'])!=r['sha256']:raise ValueError('Stage output missing/changed; preserved')
        return record
    if path.exists():raise FileExistsError('Partial failed output preserved; retry in a new batch')
    return None

def child(command,log,commit_gib=None):
    gate(resources(),commit_gib=commit_gib);started=time.monotonic();samples=[]
    with log.open('x',encoding='utf-8') as stream:
        proc=subprocess.Popen([str(v) for v in command],stdout=stream,stderr=subprocess.STDOUT,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        try:
            while proc.poll() is None:
                r=resources();samples.append(r);gate(r)
                if time.monotonic()-started>180:raise TimeoutError('Processing180s')
                time.sleep(.5)
            if proc.returncode:raise RuntimeError('Processing failed: '+str(log))
        finally:
            if proc.poll() is None:proc.kill();proc.wait(timeout=20)
    return {'seconds':time.monotonic()-started,'resource_samples':samples,'exit_code':proc.returncode}

def normalize(source,dest,size):
    from PIL import Image
    with Image.open(source) as image:
        image=image.convert('RGBA');image.thumbnail(tuple(size),Image.Resampling.LANCZOS)
        canvas=Image.new('RGBA',tuple(size));canvas.alpha_composite(image,((size[0]-image.width)//2,(size[1]-image.height)//2));canvas.save(dest)
    return {'operation':'contain_and_center_no_implicit_crop','target_size':size,'alpha_trim':False}

def preview(source,dest):
    from PIL import Image,ImageDraw
    with Image.open(source) as image:
        image=image.convert('RGBA');thumb=image.copy();thumb.thumbnail((512,512))
        w=max(thumb.width,image.width);h=thumb.height+image.height+72
        if w>4096 or h>8192:raise ValueError('Preview too large')
        canvas=Image.new('RGB',(w*2,h));draw=ImageDraw.Draw(canvas)
        for i,color in enumerate(('#eeeeee','#222222')):
            x=i*w;draw.rectangle((x,0,x+w,h),fill=color)
            canvas.paste(thumb,(x,24),thumb);canvas.paste(image,(x,thumb.height+60),image)
            draw.text((x+4,4),'Light' if i==0 else 'Dark',fill='#444444' if i==0 else '#dddddd')
        canvas.save(dest)
    return {'operation':'light_dark_actual_size_preview','quality_verified':False}

def stage(dest,spec,fn):
    fingerprint=digest(spec);existing=verified_stage(dest,fingerprint)
    if existing:return existing
    if dest.with_suffix('.stage.json').exists():raise FileExistsError('Failed attempt preserved; use a new batch for an authorized retry')
    if dest.with_suffix('.json').exists():raise FileExistsError('Prior processing receipt preserved')
    dest.parent.mkdir(parents=True,exist_ok=True);record={'fingerprint':fingerprint,'spec':spec,'status':'failed'};started=time.perf_counter()
    try:
        record['detail']=fn();outputs=[dest]
        # Retain and check side receipts and masks if produced by the underlying tool.
        outputs += [p for p in (dest.with_suffix('.json'),dest.with_name(dest.stem+'.mask.png'),dest.with_suffix('.generation.json')) if p.exists()]
        if not dest.is_file():raise RuntimeError('Stage produced no output')
        record.update(status='success',outputs=[{'path':str(p),'sha256':sha(p),'bytes':p.stat().st_size} for p in outputs]);return record
    except BaseException as exc:record['error']=repr(exc);raise
    finally:record['seconds']=time.perf_counter()-started;save(dest.with_suffix('.stage.json'),record)

def run(request_path,output,home,resume=False,port=8211,limit=None):
    normalized=validate(read(request_path));home=pathlib.Path(home).resolve();output=pathlib.Path(output).resolve()
    identity=digest(normalized);state_path=output/'batch.json'
    if state_path.exists():
        if not resume:raise FileExistsError('Existing batch; explicit --resume required')
        state=read(state_path)
        if state['request_sha256']!=identity:raise ValueError('Batch request changed; refuse resume')
    else:
        if output.exists() and any(output.iterdir()):raise FileExistsError('Nonempty unowned output directory')
        state={'schema_version':1,'request':normalized,'request_sha256':identity,'status':'prepared','assets':{},'sessions':[],'quality_verified':False,'project_adopted':False,'cost':None}
    output.mkdir(parents=True,exist_ok=True)
    # Exclusive batch lock also covers processing and state files.
    lock=output/'active.lock';token=uuid.uuid4().hex;shared=None
    with lock.open('x',encoding='utf-8') as stream:json.dump({'pid':__import__('os').getpid(),'token':token},stream)
    try:
        runtime=home/'integrations/local-image/runtime';runtime.mkdir(parents=True,exist_ok=True)
        shared=runtime/'pipeline-owner.json'
        with shared.open('x',encoding='utf-8') as stream:json.dump({'pid':__import__('os').getpid(),'token':token,'batch':str(output)},stream)
        shared_owned=True
        if 'error' in state:state.setdefault('prior_errors',[]).append(state.pop('error'))
        selected=list(dict.fromkeys(r['profile'] for r in normalized['assets'] if not r.get('source')));model_inventory=inventory(home,selected)
        state['sessions'].append({'started_unix':time.time(),'request_path':str(pathlib.Path(request_path).resolve()),'tools_home':str(home),'models':model_inventory,'resume':resume,'pipeline_source_sha256':sha(__file__),'worker_source_sha256':sha(BASE/'worker.py')})
        state['status']='running';save(state_path,state)
        todo=[]
        for asset in normalized['assets']:
            if asset.get('source'):
                dest=output/'sources'/(asset['id']+'.png');spec={'operation':'copy_existing_source','source_sha256':asset['source_sha256'],'source_path':asset['source']}
                def copy_source(asset=asset,dest=dest):
                    from PIL import Image
                    with Image.open(asset['source']) as im:
                        im.load()
                        if im.size!=(asset['width'],asset['height']) or im.format!='PNG':raise ValueError('Copied source must be PNG with declared dimensions')
                    shutil.copyfile(asset['source'],dest);return {'model_invoked':False,'source_sha256':asset['source_sha256']}
                stage(dest,spec,copy_source)
                state['assets'].setdefault(asset['id'],{'source':str(dest),'source_sha256':sha(dest),'status':'source_copied','model_invoked':False});continue
            dest=output/'sources'/(asset['id']+'.png');spec={'operation':'generate','asset':asset,'profile_version':PROFILE_VERSION,'profile_source_sha256':sha(BASE/'profiles.py'),'model_inventory':model_inventory}
            if not verified_stage(dest,digest(spec)):todo.append((asset,dest,spec))
            else:state['assets'].setdefault(asset['id'],{'source':str(dest),'source_sha256':sha(dest),'status':'source_generated'})
        if limit is not None:todo=todo[:limit]
        if todo:
            with Worker(home,output,port) as worker:
                for asset,dest,spec in sorted(todo,key=lambda r:selected.index(r[0]['profile'])):
                    reference=worker.import_image(asset['reference']) if asset.get('reference') else None
                    recipe=graph(asset['profile'],asset['prompt'],asset['width'],asset['height'],asset['seed'],'local_'+token+'_'+asset['id'],reference)
                    stage(dest,spec,lambda recipe=recipe,dest=dest:worker.execute(recipe,dest))
                    state['assets'][asset['id']]={'source':str(dest),'source_sha256':sha(dest),'status':'source_generated'};save(state_path,state)
                    print(asset['id']+' source_generated',flush=True)
        processing_python=home/'integrations/cutout/runtime/venv/Scripts/python.exe';gpu_python=home/'integrations/flux-klein/runtime/venv/Scripts/python.exe'
        for asset in normalized['assets']:
            source=output/'sources'/(asset['id']+'.png')
            if not source.is_file():continue
            current=source;stages=[]
            if asset.get('mask'):
                dest=output/'processed'/(asset['id']+'-masked.png');spec={'op':'mask_composite','original_sha256':asset['original_sha256'],'mask_sha256':asset['mask_sha256'],'edited_sha256':sha(current)}
                cmd=[processing_python,home/'integrations/image-composite/composite.py','--original',asset['original'],'--edited',current,'--mask',asset['mask'],'--output',dest]
                stages.append(stage(dest,spec,lambda cmd=cmd,dest=dest:child(cmd,dest.with_name(dest.stem+'-'+token+'.log'))));current=dest
            if asset.get('cutout','none')!='none':
                kind=asset['cutout'];dest=output/'processed'/(asset['id']+'-'+kind+'.png');script=home/('integrations/cutout/cutout.py' if kind=='cpu' else 'integrations/birefnet/cutout.py')
                matting_python=home/'integrations/birefnet/runtime/venv/Scripts/python.exe'
                cmd=[processing_python if kind=='cpu' else matting_python,script,current,dest];spec={'op':kind,'input_sha256':sha(current),'tool_source_sha256':sha(script),'tool_lock_sha256':sha(script.parent/'source-lock.json'),'environment':'cutout' if kind=='cpu' else 'birefnet'}
                stages.append(stage(dest,spec,lambda cmd=cmd,dest=dest,kind=kind:child(cmd,dest.with_name(dest.stem+'-'+token+'.log'),10 if kind=='birefnet' else None)));current=dest
            if asset.get('upscale','none')!='none':
                kind=asset['upscale'];dest=output/'processed'/(asset['id']+'-upscaled.png');script=home/'integrations/realesrgan/upscale.py';model='realesrgan-x4plus' if kind=='general' else 'realesrgan-x4plus-anime'
                cmd=[processing_python,script,current,dest,'--model',model];spec={'op':'upscale','model':model,'input_sha256':sha(current),'tool_source_sha256':sha(script),'tool_lock_sha256':sha(script.parent/'source-lock.json')}
                stages.append(stage(dest,spec,lambda cmd=cmd,dest=dest:child(cmd,dest.with_name(dest.stem+'-'+token+'.log'))));current=dest
            dest=output/'candidates'/(asset['id']+'.png');spec={'op':'normalize','input_sha256':sha(current),'target_size':asset['target_size'],'implementation_sha256':digest(inspect.getsource(normalize))}
            stages.append(stage(dest,spec,lambda current=current,dest=dest,asset=asset:normalize(current,dest,asset['target_size'])))
            view=output/'previews'/(asset['id']+'.png');spec={'op':'preview','input_sha256':sha(dest),'implementation_sha256':digest(inspect.getsource(preview))}
            stages.append(stage(view,spec,lambda dest=dest,view=view:preview(dest,view)))
            state['assets'][asset['id']].update(candidate=str(dest),candidate_sha256=sha(dest),preview=str(view),stages=stages,status='awaiting_visual_review',adopted=False)
            save(state_path,state)
        state['status']='awaiting_visual_review' if len(state['assets'])==len(normalized['assets']) and all(r['status']=='awaiting_visual_review' for r in state['assets'].values()) else 'partial'
        state['sessions'][-1]['finished_unix']=time.time();save(state_path,state)
        return {'status':state['status'],'batch':str(state_path),'assets':len(state['assets']),'project_adopted':False}
    except BaseException as exc:
        state.update(status='stopped',error=repr(exc));state.setdefault('failed_sessions',[]).append({'failed_unix':time.time(),'error':repr(exc)});save(state_path,state);raise
    finally:
        if shared is not None and locals().get('shared_owned'):
            if read(shared).get('token')!=token:raise RuntimeError('Shared pipeline owner changed; preserved')
            shared.unlink()
        if read(lock).get('token')!=token:raise RuntimeError('Batch lock ownership changed; preserved')
        lock.unlink()

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--tools-home',type=pathlib.Path,default=BASE.parents[1]);s=p.add_subparsers(dest='action',required=True)
    h=s.add_parser('health');h.add_argument('--integrity',action='store_true')
    r=s.add_parser('run');r.add_argument('--request',required=True);r.add_argument('--output',required=True);r.add_argument('--resume',action='store_true');r.add_argument('--port',type=int,default=8211);r.add_argument('--limit',type=int)
    args=p.parse_args()
    try:
        if args.action=='health':result=inventory(args.tools_home,integrity=args.integrity)
        else:
            if not 1024<=args.port<=65535 or args.limit is not None and not 1<=args.limit<=64:raise ValueError('Invalid port/limit')
            result=run(args.request,args.output,args.tools_home,args.resume,args.port,args.limit)
        print(json.dumps(result,ensure_ascii=False,indent=2));return 0
    except (OSError,ValueError,RuntimeError,MemoryError,TimeoutError,KeyError,subprocess.SubprocessError) as exc:
        print(json.dumps({'status':'stopped','error':repr(exc)},ensure_ascii=False));return 2
if __name__=='__main__':raise SystemExit(main())
