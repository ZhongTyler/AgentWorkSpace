"""Explicit maintenance builds; ordinary search/read/context never write or call a model."""
import argparse,hashlib,json,pathlib,subprocess,sys,tempfile,time
from core import build_pack,Embedding
from service import load,execute
def git(root,*args):
 return subprocess.check_output(['git','-c','safe.directory='+root.as_posix(),'-C',str(root),*args])
def normalized(b):return b.replace(b'\r\n',b'\n')
def build(root,home,revision,embedding_config=None):
 root=root.resolve();home=home.resolve()
 if home.exists() or home.is_relative_to(root):raise ValueError('new versioned home outside Knowledge required')
 revision=git(root,'rev-parse','--verify',revision+'^{commit}').decode().strip();files=[];start=time.perf_counter()
 entries=git(root,'ls-tree','-r','-z',revision,'--','wiki').split(b'\0')
 for entry in entries:
  if not entry:continue
  meta,name=entry.split(b'\t',1);name=name.decode('utf-8')
  if not name.endswith('.md') or pathlib.PurePosixPath(name).name=='README.md' or name.endswith('.template.md'):continue
  if not meta.startswith(b'100644 blob '):raise ValueError('non-regular committed Wiki')
  path=root/name
  if path.is_symlink() or not path.resolve().is_relative_to(root):raise ValueError('linked source outside owner')
  committed=git(root,'show',revision+':'+name);actual=path.read_bytes()
  if normalized(committed)!=normalized(actual):raise ValueError('uncommitted semantic Wiki change; keep Query and build after reviewed commit')
  files.append({'path':name,'sha256':hashlib.sha256(actual).hexdigest(),'committed_blob':meta.split()[-1].decode(),'newline_only_difference':actual!=committed})
 if not files:raise ValueError('no committed Wiki; use original Query with the empty library')
 embedding=None;emb={};profile='none'
 if embedding_config:
  # A trusted local config is required; no provider command or automatic download.
  emb_path=pathlib.Path(embedding_config).resolve();emb=json.loads(emb_path.read_text(encoding='utf-8'))
  for k in ['embedding_dir','dependency_dir']:
   p=pathlib.Path(emb[k]);emb[k]=str(p if p.is_absolute() else emb_path.parent/p)
  if not emb.get('embedding_files'):raise ValueError('pinned embedding files required')
  for f in emb['embedding_files']:
   p=pathlib.Path(f['path']);p=p if p.is_absolute() else emb_path.parent/p;f['path']=str(p)
   if hashlib.sha256(p.read_bytes()).hexdigest()!=f['sha256']:raise ValueError('embedding asset changed')
  profile=emb['embedding_profile'];embedding=Embedding(emb['embedding_dir'],emb['dependency_dir'])
 home.mkdir(parents=True);pack=home/'knowledge.sqlite';source_lock={'knowledge_commit':revision,'library_id':'knowledge','files':files}
 result=build_pack(root,source_lock,home/'building.sqlite',embedding,profile);(home/'building.sqlite').rename(pack)
 ids=[r[0] for r in result['source_identities']]
 cfg={'schema_version':1,'pack':'knowledge.sqlite','pack_sha256':hashlib.sha256(pack.read_bytes()).hexdigest(),'source_root':str(root),'embedding_profile':profile,'profiles':{'local':{'source_ids':ids,'initial_bytes':9000,'max_units':4}}}
 if embedding:cfg.update({k:emb[k] for k in ['embedding_dir','dependency_dir','embedding_files']})
 (home/'config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');(home/'source-lock.json').write_text(json.dumps(source_lock,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 return {'status':'built','source_commit':revision,'documents':len(files),'chunks':result['chunks'],'pack_bytes':pack.stat().st_size,'mode':'hybrid_capable' if embedding else 'bm25','seconds':time.perf_counter()-start,'config':str(home/'config.json'),'knowledge_writes':False,'activated':False}
def main():
 if hasattr(sys.stdout,'reconfigure'):sys.stdout.reconfigure(encoding='utf-8')
 p=argparse.ArgumentParser();sub=p.add_subparsers(dest='action',required=True)
 b=sub.add_parser('build');b.add_argument('--root',type=pathlib.Path,required=True);b.add_argument('--home',type=pathlib.Path,required=True);b.add_argument('--revision',default='HEAD');b.add_argument('--embedding-config')
 for name in ['search','context','read']:
  q=sub.add_parser(name);q.add_argument('--config',type=pathlib.Path,required=True);q.add_argument('--mode',choices=['bm25','hybrid'],default='bm25');q.add_argument('--profile',default='local');q.add_argument('--request',default='-')
 q=sub.add_parser('export');q.add_argument('--config',type=pathlib.Path,required=True);q.add_argument('--profile',required=True);q.add_argument('--destination',type=pathlib.Path,required=True)
 q=sub.add_parser('serve');q.add_argument('--config',type=pathlib.Path,required=True);q.add_argument('--keys',type=pathlib.Path,required=True);q.add_argument('--port',type=int,default=18971);q.add_argument('--allow-hybrid',action='store_true')
 q=sub.add_parser('refresh');q.add_argument('--root',type=pathlib.Path,required=True);q.add_argument('--binding',type=pathlib.Path,required=True);q.add_argument('--revision',default='HEAD')
 q=sub.add_parser('health')
 a=p.parse_args()
 try:
  if a.action=='build':out=build(a.root,a.home,a.revision,a.embedding_config)
  elif a.action=='refresh':
   from maintenance import refresh
   request=json.loads(sys.stdin.read());out=refresh(a.root,a.binding,a.revision,request['review_paths'],request['review_ref'])
  elif a.action=='health':out={'status':'available','core':'retrieval-core-v1','default':'bm25','model_loaded':False,'external_query':False,'writes':False}
  elif a.action=='serve':
   from http_api import serve
   return serve(a.config,a.keys,a.port,a.allow_hybrid)
  else:
   mode=getattr(a,'mode','bm25');cfg,store=load(a.config,mode)
   try:
    if a.action=='export':
     manifest=store.export(a.destination,cfg['profiles'][a.profile]['source_ids']);out={'status':'exported','manifest':manifest,'pack_sha256':hashlib.sha256(a.destination.read_bytes()).hexdigest(),'source_root_required':False}
    else:
     request=json.loads(sys.stdin.read() if a.request=='-' else pathlib.Path(a.request).read_text(encoding='utf-8'));request={**request,'action':a.action,'mode':mode};out=execute(cfg,store,request,a.profile)
   finally:store.close()
  print(json.dumps(out,ensure_ascii=False));return 0
 except (ValueError,KeyError,OSError,subprocess.SubprocessError) as e:
  print(json.dumps({'status':'unavailable','reason':str(e),'fallback':'original Query','writes':a.action in ['build','refresh']},ensure_ascii=False));return 2
if __name__=='__main__':raise SystemExit(main())
