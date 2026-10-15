"""Windows resource gates and durable receipts, without loading an ML model."""
import ctypes, hashlib, json, os, pathlib, subprocess, time, uuid

def sha(path):
    with pathlib.Path(path).open('rb') as stream: return hashlib.file_digest(stream,'sha256').hexdigest()

def digest(value): return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def read(path): return json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))

def save(path, value):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with tmp.open('x',encoding='utf-8') as stream:
        json.dump(value,stream,ensure_ascii=False,indent=2);stream.flush();os.fsync(stream.fileno())
    os.replace(tmp,path)

def resources():
    if os.name!='nt': raise ValueError('This pinned runtime resource policy requires Windows')
    class MEM(ctypes.Structure):
        _fields_=[('length',ctypes.c_ulong),('load',ctypes.c_ulong)]+[(n,ctypes.c_ulonglong) for n in ['total_phys','avail_phys','total_commit','avail_commit','total_virtual','avail_virtual','avail_extended']]
    memory=MEM();memory.length=ctypes.sizeof(memory)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(memory)): raise OSError('Memory status unavailable')
    r={'unix':time.time(),'available_physical_bytes':memory.avail_phys,'available_commit_bytes':memory.avail_commit,'total_commit_bytes':memory.total_commit}
    p=subprocess.run(['nvidia-smi','--query-gpu=memory.used,memory.free,utilization.gpu,temperature.gpu,power.draw','--format=csv,noheader,nounits'],capture_output=True,text=True,timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if p.returncode: raise OSError('GPU resource status unavailable')
    values=[v.strip() for v in p.stdout.strip().splitlines()[0].split(',')]
    r.update(zip(['gpu_total_used_mib','gpu_free_mib','gpu_utilization_percent','gpu_temperature_c'],map(int,values[:4])))
    try:r['gpu_power_w']=float(values[4])
    except ValueError:r['gpu_power_w']=None
    return r

def gate(r, startup=False, commit_gib=None):
    physical=(5 if startup else 2)*1024**3;commit=(commit_gib or (5 if startup else 1))*1024**3
    if r['available_physical_bytes']<physical or r['available_commit_bytes']<commit or r['gpu_total_used_mib']>=12000 or r['gpu_free_mib']<(8192 if startup else 256):
        raise MemoryError('Resource stop; do not change system settings automatically: '+json.dumps(r))

def bounds(path,base):
    path=pathlib.Path(path).resolve();base=pathlib.Path(base).resolve()
    if not path.is_relative_to(base):raise ValueError('Path escapes owner')
    return path

class GpuLease:
    """Reserve the existing cross-tool GPU owner file; never reclaim stale/foreign owners."""
    def __init__(self,home,folder,kind):
        self.path=pathlib.Path(home)/'integrations/local-image/runtime/owner.json'
        self.folder=pathlib.Path(folder).resolve();self.kind=kind;self.token=uuid.uuid4().hex;self.owned=False
    def __enter__(self):
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.path.open('x',encoding='utf-8') as stream:
            json.dump({'owner_pid':os.getpid(),'token':self.token,'folder':str(self.folder),'kind':self.kind},stream)
        self.owned=True;return self
    def __exit__(self,exc_type,exc,tb):
        if self.owned:
            if read(self.path).get('token')!=self.token:raise RuntimeError('GPU owner changed; preserved')
            self.path.unlink();self.owned=False
