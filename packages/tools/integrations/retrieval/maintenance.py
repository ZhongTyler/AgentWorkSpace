"""Post-review derived-cache maintenance; never edits knowledge or approval evidence."""
import hashlib,json,os,pathlib,subprocess,sys,time,uuid
from cli import build,git
from service import load,execute

def refresh(root,binding_path,revision,review_paths,review_ref):
 root=root.resolve();binding_path=binding_path.resolve()
 if not binding_path.exists():return {'status':'skipped','reason':'optional_local_binding_absent'}
 original=binding_path.read_bytes();binding=json.loads(original)
 policy=binding.get('maintenance',{})
 if policy.get('enabled') is not True:return {'status':'skipped','reason':'maintenance_not_enabled'}
 if not review_ref or not isinstance(review_paths,list):raise ValueError('reviewed commit scope and review reference required')
 revision=git(root,'rev-parse','--verify',revision+'^{commit}').decode().strip()
 if revision!=git(root,'rev-parse','HEAD').decode().strip():raise ValueError('reviewed revision must be current HEAD')
 def resolve(s):
  p=pathlib.Path(s);return p.resolve() if p.is_absolute() else (binding_path.parent/p).resolve()
 versions=resolve(policy['versions_root'])
 if versions.is_relative_to(root) or versions==root:raise ValueError('cache home must remain outside Knowledge')
 cfg_path=resolve(binding['runtime_config']);cfg=json.loads(cfg_path.read_text(encoding='utf-8'))
 if set(cfg['profiles'])!={'local'}:raise ValueError('automatic refresh is only for the local library view')
 if resolve(str(pathlib.Path(cfg_path.parent)/cfg['source_root']))!=root:raise ValueError('source root mismatch')
 lock=json.loads((cfg_path.parent/'source-lock.json').read_text(encoding='utf-8'))
 previous=lock['knowledge_commit'];git(root,'merge-base','--is-ancestor',previous,revision)
 delta=git(root,'diff','--name-only','-z',previous,revision,'--','wiki').decode().split('\0')
 delta={p for p in delta if p.endswith('.md') and pathlib.PurePosixPath(p).name!='README.md' and not p.endswith('.template.md')}
 if delta-set(review_paths):raise ValueError('Wiki changes outside reviewed scope')
 # Validate inventory and source bytes even for unchanged commits; dirty drafts never activate.
 try:
  _,store=load(cfg_path);store.search('cache validation',list(store.docs),'bm25',0);store.close()
  current=True
 except (ValueError,OSError,KeyError):current=False
 if not delta and current:return {'status':'unchanged','source_commit':previous,'reviewed_revision':revision,'activated':False}
 if not delta:raise ValueError('uncommitted source drift; preserve binding and use Query')
 versions.mkdir(parents=True,exist_ok=True);guard=versions/'refresh.lock'
 try:fd=os.open(guard,os.O_CREAT|os.O_EXCL|os.O_WRONLY)
 except FileExistsError:return {'status':'busy','reason':'another_refresh_owner','activated':False}
 os.write(fd,uuid.uuid4().hex.encode());os.close(fd)
 started=time.perf_counter();version=versions/(revision[:12]+'-'+uuid.uuid4().hex[:8]);
 try:
  version.mkdir()
  bm=build(root,version/'bm25',revision)
  cfg_new,s=load(bm['config']);execute(cfg_new,s,{'question':'cache validation','limit':1});s.close()
  new={**binding,'runtime_config':bm['config']};hybrid={'status':'not_requested'}
  if policy.get('refresh_hybrid') is True:
   try:
    emb=resolve(policy['embedding_config']);python=binding.get('hybrid_python',binding['python'])
    p=subprocess.run([python,'-X','utf8','-B',str(pathlib.Path(__file__).with_name('cli.py')),'build','--root',str(root),'--home',str(version/'hybrid'),'--revision',revision,'--embedding-config',str(emb)],capture_output=True,timeout=600)
    if p.returncode:raise ValueError('hybrid_build_unavailable')
    h=json.loads(p.stdout);other=json.loads((version/'hybrid/source-lock.json').read_text(encoding='utf-8'))
    fresh=json.loads((version/'bm25/source-lock.json').read_text(encoding='utf-8'))
    if other!=fresh:raise ValueError('hybrid source identity mismatch')
    # A real hybrid read must succeed before activating its pointer.
    p=subprocess.run([python,'-X','utf8','-B',str(pathlib.Path(__file__).with_name('cli.py')),'search','--config',h['config'],'--mode','hybrid'],input=b'{"question":"cache validation","limit":1}',capture_output=True,timeout=60)
    if p.returncode:raise ValueError('hybrid_validation_unavailable')
    new['hybrid_runtime_config']=h['config'];hybrid={'status':'updated','seconds':h['seconds']}
   except (ValueError,OSError,KeyError,subprocess.SubprocessError):
    new.pop('hybrid_runtime_config',None);hybrid={'status':'unavailable','fallback':'original Query on hybrid request; fresh BM25 remains available'}
  elif 'hybrid_runtime_config' in new:
   new.pop('hybrid_runtime_config');hybrid={'status':'not_refreshed','fallback':'original Query on hybrid request'}
  # Revalidate after optional expensive work and refuse concurrent edits or pointer changes.
  cfg_new,s=load(bm['config']);execute(cfg_new,s,{'question':'cache validation','limit':1});s.close()
  if git(root,'rev-parse','HEAD').decode().strip()!=revision or binding_path.read_bytes()!=original:raise ValueError('concurrent HEAD or binding change; no activation')
  (version/'previous-binding.json').write_bytes(original)
  receipt={'status':'updated','reviewed_revision':revision,'previous_source_commit':previous,'review_ref':review_ref,'review_paths':sorted(review_paths),'bm25':bm,'hybrid':hybrid,'seconds':time.perf_counter()-started,'activated':True,'knowledge_content_writes':False}
  temporary=binding_path.with_name(binding_path.name+'.'+uuid.uuid4().hex+'.tmp')
  temporary.write_text(json.dumps(new,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');os.replace(temporary,binding_path)
  (version/'refresh-receipt.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  return receipt
 finally:guard.unlink()
