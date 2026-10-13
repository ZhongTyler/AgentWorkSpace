"""Local OCR assistance with traceable GIF samples; never an ingest acceptance gate."""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'runtime'))

def run(inputs, output):
    from PIL import Image
    from rapidocr_onnxruntime import RapidOCR
    output=output.resolve()
    if output.exists() and any(output.iterdir()): raise ValueError('Preserve output; choose an empty directory')
    paths=[p.absolute() for p in inputs]
    if any(not p.is_file() for p in paths): raise ValueError('Missing input file')
    output.mkdir(parents=True,exist_ok=True)
    engine=RapidOCR(det_use_cuda=False,cls_use_cuda=False,rec_use_cuda=False,intra_op_num_threads=4)
    records=[]
    for index,path in enumerate(paths,1):
        with Image.open(path) as im:
            n=getattr(im,'n_frames',1)
            targets=sorted({0,n//4,n//2,3*n//4,n-1}) if n>1 else [0]
            positions=[]
            cumulative=0
            for f in range(n):
                im.seek(f)
                if f in targets:
                    frame=output/f'{index:03}-frame-{f:05}.png'
                    im.convert('RGB').save(frame)
                    start=time.perf_counter()
                    boxes,_=engine(str(frame))
                    positions.append({'frame_index':f,'start_ms':cumulative,'sample':frame.name,'ocr_seconds':round(time.perf_counter()-start,3),'boxes':boxes or []})
                cumulative+=im.info.get('duration',0)
            records.append({'input':str(path),'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'size':list(im.size),'frame_count':n,'duration_ms':cumulative,'samples':positions})
    manifest={'tool':'rapidocr_onnxruntime','version':'1.4.4','mode':'CPU, 4 threads','evidence_boundary':'OCR candidates; manually verify necessary text, diagram relations and animation coverage','inputs':records}
    (output/'ocr-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('OCR assistance saved:',output/'ocr-manifest.json')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('images',type=Path,nargs='+')
    args=parser.parse_args()
    run(args.images,args.output)
