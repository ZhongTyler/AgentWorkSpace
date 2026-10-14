"""Offline inventory check; does not load the ONNX model or alter configuration."""
import argparse,hashlib,importlib.metadata,json,pathlib
BASE=pathlib.Path(__file__).resolve().parent
def verify(integrity=False):
    lock=json.loads((BASE/'source-lock.json').read_text());p=BASE/'runtime'/lock['file']
    assert p.is_file() and p.stat().st_size==lock['bytes'],'Model missing or wrong length'
    if integrity:
        with p.open('rb') as stream:assert hashlib.file_digest(stream,'sha256').hexdigest()==lock['sha256'],'Model hash changed'
    deps={n:importlib.metadata.version(n) for n in ['onnxruntime','numpy','Pillow','opencv-python-headless']}
    return {'status':'pass','model_revision':lock['revision'],'model_sha256_checked':integrity,'dependencies':deps,'model_loaded':False,'network_queried':False,'quality_verified':False}
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--integrity',action='store_true');args=parser.parse_args();print(json.dumps(verify(args.integrity),indent=2))
