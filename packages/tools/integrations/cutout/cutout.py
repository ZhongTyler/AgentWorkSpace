"""Local CPU illustration segmentation; preserves raw RGB and predicts alpha."""
import argparse,hashlib,json,pathlib,time
import cv2
import numpy as np
import onnxruntime as ort
from PIL import Image
BASE=pathlib.Path(__file__).resolve().parent
class Cutout:
    def __init__(self):
        tools_home=BASE.parents[1]
        if (tools_home/'portable-profile.json').exists() and not (tools_home/'.tools-home.json').is_file():
            raise ValueError('Prepare an external Tools home before segmentation; managed modules are read-only')
        self.lock=json.loads((BASE/'source-lock.json').read_text())
        p=BASE/'runtime'/self.lock['file']
        if p.stat().st_size!=self.lock['bytes']:raise ValueError('Incomplete segmentation model')
        with p.open('rb') as stream:
            if hashlib.file_digest(stream,'sha256').hexdigest()!=self.lock['sha256']:raise ValueError('Segmentation model hash mismatch')
        options=ort.SessionOptions();options.intra_op_num_threads=2;options.inter_op_num_threads=1
        start=time.perf_counter();self.session=ort.InferenceSession(str(p),sess_options=options,providers=['CPUExecutionProvider']);self.load_seconds=time.perf_counter()-start
        self.input=self.session.get_inputs()[0]
        shape=self.input.shape;self.size=int(shape[-1]) if isinstance(shape[-1],int) else 1024
    def run(self,source,output):
        source=pathlib.Path(source).resolve();output=pathlib.Path(output).resolve()
        mask_path=output.with_name(output.stem+'.mask.png');receipt_path=output.with_suffix('.json')
        if any(p.exists() for p in (output,mask_path,receipt_path)):raise FileExistsError('Do not overwrite prior cutout evidence')
        start=time.perf_counter()
        with Image.open(source) as im:rgb=np.asarray(im.convert('RGB'))
        h0,w0=rgb.shape[:2];s=self.size
        h,w=(s,max(1,int(s*w0/h0))) if h0>w0 else (max(1,int(s*h0/w0)),s)
        ph,pw=s-h,s-w;data=np.zeros((s,s,3),dtype=np.float32)
        data[ph//2:ph//2+h,pw//2:pw//2+w]=cv2.resize(rgb.astype(np.float32)/255,(w,h))
        tensor=np.transpose(data,(2,0,1))[None]
        pred=self.session.run(None,{self.input.name:tensor})[0][0,0]
        pred=pred[ph//2:ph//2+h,pw//2:pw//2+w]
        mask=np.clip(cv2.resize(pred,(w0,h0)),0,1)
        alpha=(mask*255).astype(np.uint8)
        rgba=np.dstack((rgb,alpha));output.parent.mkdir(parents=True,exist_ok=True)
        Image.fromarray(rgba).save(output)
        Image.fromarray(alpha).save(mask_path)
        receipt={'source':str(source),'output':str(output),'mask':str(mask_path),'model_revision':self.lock['revision'],'model_sha256':self.lock['sha256'],'provider':'CPUExecutionProvider','model_load_seconds':self.load_seconds,'processing_seconds':time.perf_counter()-start,'dimensions':[w0,h0],'alpha_extrema':[int(alpha.min()),int(alpha.max())],'foreground_fraction_alpha_gt_16':float((alpha>16).mean()),'semi_transparent_fraction':float(((alpha>16)&(alpha<240)).mean()),'source_sha256':hashlib.file_digest(source.open('rb'),'sha256').hexdigest(),'output_sha256':hashlib.file_digest(output.open('rb'),'sha256').hexdigest(),'quality_or_material_transparency_verified':False}
        output.with_suffix('.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2),encoding='utf-8')
        return receipt
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('output');a=p.parse_args();print(json.dumps(Cutout().run(a.input,a.output),indent=2))
