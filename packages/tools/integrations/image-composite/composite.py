"""Explicit mask composition; image generation and mask selection are external."""
import argparse,hashlib,json,pathlib,time
from PIL import Image
def sha(p):return hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()
def composite(original,edited,mask,output):
    paths=[pathlib.Path(p).resolve() for p in [original,edited,mask,output]];original,edited,mask,output=paths;receipt=output.with_suffix('.json')
    if output.exists() or receipt.exists():raise FileExistsError('Output or receipt exists; refusing overwrite')
    if output.suffix.lower()!='.png':raise ValueError('PNG output required')
    for p in paths[:3]:
        if not p.is_file():raise FileNotFoundError(p)
    start=time.perf_counter()
    with Image.open(original) as o,Image.open(edited) as e,Image.open(mask) as m:
        o=o.convert('RGBA');e=e.convert('RGBA');m=m.convert('L')
        if o.size!=e.size or o.size!=m.size:raise ValueError('Dimensions must match exactly; implicit resizing prohibited')
        if max(o.size)>8192:raise ValueError('Maximum dimension8192')
        result=Image.composite(e,o,m);outside=m.point(lambda x:255 if x==0 else 0);unchanged=Image.composite(result,o,outside).tobytes()==o.tobytes()
        assert unchanged,'Outside mask changed'
        output.parent.mkdir(parents=True,exist_ok=True);result.save(output)
    record={'operation':'explicit_mask_pixel_composition','inputs':[{'path':str(p),'sha256':sha(p)} for p in paths[:3]],'output':str(output),'output_sha256':sha(output),'outside_zero_mask_byte_identical':unchanged,'seconds':time.perf_counter()-start,'limitations':'Not masked diffusion or semantic edit; inside/boundary quality needs separate review'}
    receipt.write_text(json.dumps(record,indent=2),encoding='utf-8');return record
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    for arg in ['original','edited','mask','output']:p.add_argument('--'+arg,required=True)
    print(json.dumps(composite(**vars(p.parse_args())),indent=2))
