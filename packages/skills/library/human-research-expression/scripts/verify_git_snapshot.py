"""Read frozen blob bytes in one Git batch; never modify Git or source files."""
import argparse,hashlib,json,subprocess
from pathlib import Path

def verify(repo,ref,files):
 repo=Path(repo).resolve()
 if ref is None or any(c in ref for c in '\r\n\0'):raise ValueError('Invalid revision')
 if not isinstance(files,dict) or not files:raise ValueError('Non-empty frozen file map required')
 names=sorted(files)
 for name in names:
  if not name or Path(name).is_absolute() or Path(name).drive or '\\' in name or any(c in name for c in '\r\n\0') or '..' in Path(name).parts:raise ValueError('Unsafe repository-relative path')
  if len(files[name])!=64 or any(c not in '0123456789abcdef' for c in files[name]):raise ValueError('Expected SHA-256 required')
 requests=''.join(ref+':'+name+'\n' for name in names).encode('utf8')
 r=subprocess.run(['git','-c','safe.directory='+repo.as_posix(),'-C',str(repo),'cat-file','--batch'],input=requests,capture_output=True)
 if r.returncode:raise ValueError('Git batch failed: '+r.stderr.decode('utf8','replace')[:400])
 data=r.stdout;pos=0;issues=[]
 for name in names:
  line_end=data.find(b'\n',pos)
  if line_end<0:raise ValueError('Incomplete Git response')
  header=data[pos:line_end].split();pos=line_end+1
  if header and header[-1]==b'missing':issues.append(dict(path=name,reason='missing object'));continue
  if len(header)!=3:raise ValueError('Invalid Git object header')
  try:size=int(header[2])
  except ValueError:raise ValueError('Invalid object size')
  if size<0 or pos+size>=len(data) or data[pos+size:pos+size+1]!=b'\n':raise ValueError('Incomplete object bytes')
  digest=hashlib.sha256(data[pos:pos+size]).hexdigest();pos+=size+1
  if header[1]!=b'blob':issues.append(dict(path=name,reason='non-blob object'))
  elif digest!=files[name]:issues.append(dict(path=name,reason='SHA-256 mismatch',actual_sha256=digest))
 if pos!=len(data):raise ValueError('Unexpected extra Git bytes')
 return dict(pass_=not issues,files=len(names),issues=issues,git_processes=1,ref=ref,meaning='Exact blob identity, not source meaning or research completeness')

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,required=True);p.add_argument('--ref',default='HEAD',help='Use an empty prefix via --ref INDEX for index blobs');p.add_argument('--snapshot',type=Path,required=True);p.add_argument('--key',default='frozen_files');p.add_argument('--out',type=Path);a=p.parse_args()
 doc=json.loads(a.snapshot.read_text(encoding='utf8'));files=doc[a.key] if a.key else doc
 result=verify(a.repo,'' if a.ref=='INDEX' else a.ref,files)
 output=json.dumps(result,ensure_ascii=False,indent=2)+'\n'
 if a.out:a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(output,encoding='utf8')
 print(json.dumps({k:v for k,v in result.items() if k!='issues'},ensure_ascii=False))
 if result['issues']:print(json.dumps(result['issues'][:5],ensure_ascii=False))
 if not result['pass_']:raise SystemExit(1)
if __name__=='__main__':main()
