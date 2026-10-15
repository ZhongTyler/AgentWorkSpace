"""Fixed on-request portable 4x upscale; preserve native alpha by interpolation."""
import argparse,hashlib,json,pathlib,subprocess,tempfile,time,uuid
from PIL import Image
BASE=pathlib.Path(__file__).resolve().parent;RUNTIME=BASE/'runtime';PORTABLE=RUNTIME/'portable'
def upscale(source,output,model='realesrgan-x4plus',tile=128):
    source=pathlib.Path(source).resolve();output=pathlib.Path(output).resolve()
    if model not in ['realesrgan-x4plus','realesrgan-x4plus-anime']:raise ValueError('Unsupported tested candidate model')
    if tile!=128:raise ValueError('Trial uses fixed128px tiles')
    if output.suffix.lower()!='.png':raise ValueError('Output must be PNG')
    if output.exists() or output.with_suffix('.json').exists():raise FileExistsError('Do not overwrite outputs')
    with Image.open(source) as image:
        if max(image.size)>1536:raise ValueError('Candidate input maximum1536 pixels')
        image.load();original_size=image.size;alpha=image.getchannel('A') if 'A' in image.getbands() else None;rgb=image.convert('RGB')
    lock=json.loads((BASE/'source-lock.json').read_text())
    for row in lock['files']:
        if row['file'].endswith(('realesrgan-ncnn-vulkan.exe',model+'.bin',model+'.param')):
            p=RUNTIME/row['file'];assert hashlib.sha256(p.read_bytes()).hexdigest()==row['sha256'],'Pinned binary/model changed'
    started=time.perf_counter();folder=RUNTIME/'jobs'/uuid.uuid4().hex;folder.mkdir(parents=True);native_input=folder/'input.png';native_output=folder/'output.png';rgb.save(native_input)
    command=[str(PORTABLE/'realesrgan-ncnn-vulkan.exe'),'-i',str(native_input),'-o',str(native_output),'-n',model,'-m',str(PORTABLE/'models'),'-s','4','-t','128','-g','0','-j','1:1:1','-f','png']
    proc=subprocess.run(command,cwd=PORTABLE,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0));(folder/'native.log').write_text(proc.stdout+'\n'+proc.stderr)
    if proc.returncode!=0:raise RuntimeError('Native upscale failed; log '+str(folder/'native.log'))
    with Image.open(native_output) as im:
        assert im.size==(original_size[0]*4,original_size[1]*4),'Native dimension mismatch';result=im.convert('RGB')
        if alpha is not None:result.putalpha(alpha.resize(im.size,Image.Resampling.LANCZOS))
        output.parent.mkdir(parents=True,exist_ok=True);result.save(output)
    r={'source':str(source),'output':str(output),'model':model,'source_tag':lock['tag'],'archive_sha256':lock['archive_sha256_measured'],'scale':4,'tile_size':128,'device':'Vulkan device0','threads':'1:1:1','alpha_policy':'original_alpha_Lanczos_preserved' if alpha is not None else 'RGB_no_alpha','source_dimensions':original_size,'dimensions':result.size,'elapsed_seconds':time.perf_counter()-started,'native_exit_code':proc.returncode,'native_log':str(folder/'native.log'),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'output_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'quality_verified':False};output.with_suffix('.json').write_text(json.dumps(r,indent=2));return r
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('output');p.add_argument('--model',choices=['realesrgan-x4plus','realesrgan-x4plus-anime'],default='realesrgan-x4plus');a=p.parse_args();print(json.dumps(upscale(a.input,a.output,a.model),indent=2))
