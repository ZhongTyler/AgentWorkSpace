"""Pinned local BiRefNet matting candidate; loads no remote code or extra backbone."""
import argparse,ctypes,hashlib,importlib,json,pathlib,sys,time,types
import numpy as np
import torch
from PIL import Image
from safetensors.torch import load_file
from accelerate import init_empty_weights
BASE=pathlib.Path(__file__).resolve().parent
class Matting:
    def __init__(self,device='cuda'):
        if sys.platform=='win32':
            class MEM(ctypes.Structure):
                _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(n,ctypes.c_ulonglong) for n in ['total_phys','avail_phys','total_commit','avail_commit','total_virtual','avail_virtual','avail_extended']]
            memory=MEM();memory.length=ctypes.sizeof(memory);ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory))
            if memory.avail_commit<10*1024**3:raise MemoryError('Experimental model requires10GiB free Windows commit; not admitted in current workflow')
        start=time.perf_counter();self.lock=json.loads((BASE/'source-lock.json').read_text());source=BASE/'runtime/source'
        for row in self.lock['source_files']:
            assert hashlib.sha256((source/row['file']).read_bytes()).hexdigest()==row['sha256'],'Pinned source changed'
        weights=BASE/self.lock['file'];assert weights.stat().st_size==self.lock['bytes']
        with weights.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==self.lock['sha256'],'Model SHA mismatch'
        package=types.ModuleType('pinned_birefnet');package.__path__=[str(source)];sys.modules['pinned_birefnet']=package
        module=importlib.import_module('pinned_birefnet.birefnet')
        with init_empty_weights(include_buffers=False):self.model=module.BiRefNet(bb_pretrained=False)
        self.model.load_state_dict(load_file(str(weights),device='cpu'),strict=True,assign=True)
        self.device=device;self.dtype=torch.float16 if device=='cuda' else torch.float32;torch.set_num_threads(4)
        self.model.to(device=device,dtype=self.dtype).eval();self.load_seconds=time.perf_counter()-start
    def run(self,source,output):
        source=pathlib.Path(source).resolve();output=pathlib.Path(output).resolve();mask_path=output.with_name(output.stem+'.mask.png');receipt_path=output.with_suffix('.json')
        if output.suffix.lower()!='.png':raise ValueError('Output must be PNG')
        if any(p.exists() for p in [output,mask_path,receipt_path]):raise FileExistsError('Do not overwrite evidence')
        started=time.perf_counter()
        with Image.open(source) as im:rgb=im.convert('RGB');size=rgb.size;arr=np.asarray(rgb.resize((1024,1024),Image.Resampling.BILINEAR),dtype=np.float32)/255
        data=torch.from_numpy(arr.transpose(2,0,1).copy()).unsqueeze(0).to(device=self.device,dtype=self.dtype)
        mean=torch.tensor([.485,.456,.406],device=self.device,dtype=self.dtype)[None,:,None,None];std=torch.tensor([.229,.224,.225],device=self.device,dtype=self.dtype)[None,:,None,None]
        if self.device=='cuda':torch.cuda.reset_peak_memory_stats()
        with torch.inference_mode():pred=self.model((data-mean)/std)[-1].sigmoid().float().cpu()[0,0].numpy()
        if not np.isfinite(pred).all():raise ValueError('Non-finite model output')
        alpha=Image.fromarray((pred.clip(0,1)*255).astype(np.uint8)).resize(size,Image.Resampling.BILINEAR);rgba=rgb.copy();rgba.putalpha(alpha);output.parent.mkdir(parents=True,exist_ok=True);rgba.save(output);alpha.save(mask_path)
        record={'source':str(source),'output':str(output),'mask':str(mask_path),'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'output_sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'model_id':self.lock['model_id'],'revision':self.lock['revision'],'model_sha256':self.lock['sha256'],'device':self.device,'dtype':str(self.dtype),'input_resolution':[1024,1024],'dimensions':size,'alpha_extrema':alpha.getextrema(),'load_seconds':self.load_seconds,'processing_seconds':time.perf_counter()-started,'peak_torch_allocated_bytes':torch.cuda.max_memory_allocated() if self.device=='cuda' else None,'quality_verified':False,'rgb_unmodified':True};receipt_path.write_text(json.dumps(record,indent=2));return record
    def unload(self):
        self.model.to('cpu');del self.model
        if self.device=='cuda':torch.cuda.empty_cache()
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('output');p.add_argument('--device',choices=['cuda','cpu'],default='cuda');a=p.parse_args();tool=Matting(a.device)
    try:print(json.dumps(tool.run(a.input,a.output),indent=2))
    finally:tool.unload()
