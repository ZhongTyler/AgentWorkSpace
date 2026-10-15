"""One read-only protocol for local consumers and a future website gateway."""
import hashlib,json,pathlib
from core import Store,Embedding
def load(config_path,mode='bm25'):
 path=pathlib.Path(config_path).resolve();cfg=json.loads(path.read_text(encoding='utf-8'))
 if cfg.get('schema_version')!=1:raise ValueError('unsupported config')
 for k in ['pack','source_root','embedding_dir','dependency_dir']:
  if cfg.get(k):
   p=pathlib.Path(cfg[k]);cfg[k]=str(p if p.is_absolute() else path.parent/p)
 if hashlib.sha256(pathlib.Path(cfg['pack']).read_bytes()).hexdigest()!=cfg['pack_sha256']:raise ValueError('pack changed; activate a complete verified version')
 embedding=None
 if mode=='hybrid':
  if not cfg.get('embedding_files') or not cfg.get('embedding_dir'):raise ValueError('hybrid runtime unavailable')
  for f in cfg['embedding_files']:
   p=pathlib.Path(f['path']);p=p if p.is_absolute() else path.parent/p
   if hashlib.sha256(p.read_bytes()).hexdigest()!=f['sha256']:raise ValueError('embedding asset changed')
  embedding=Embedding(cfg['embedding_dir'],cfg.get('dependency_dir',''))
 store=Store(cfg['pack'],embedding,cfg.get('source_root'),cfg.get('embedding_profile'))
 if store.source_root:
  current={p.relative_to(store.source_root).as_posix() for p in (store.source_root/'wiki').rglob('*.md') if p.name!='README.md' and not p.name.endswith('.template.md')}
  if current!={d['path'] for d in store.docs.values()}:
   store.close();raise ValueError('source inventory changed; rebuild a reviewed version or use original Query')
 return cfg,store
def execute(cfg,store,request,profile_name='local'):
 if not isinstance(request,dict) or set(request)-{'action','question','terms','mode','source_id','limit'}:raise ValueError('unsupported request fields')
 profile=cfg['profiles'][profile_name];action=request.get('action','search');mode=request.get('mode','bm25')
 if action=='read':
  ref=request.get('source_id')
  if ref not in profile['source_ids'] or ref not in store.docs:raise ValueError('source_scope_denied')
  doc=store.docs[ref];store.validate_doc(doc)
  return {'source_id':ref,'source_sha256':doc['sha'],'content':doc['content'],'full_source_read':True,'claim_support':'not_verified','snapshot_id':store.manifest['snapshot_id']}
 question=request.get('question');terms=request.get('terms',[])
 if not isinstance(question,str) or not 0<len(question.strip())<=2000 or not isinstance(terms,list) or len(terms)>40 or any(not isinstance(t,str) or len(t)>2000 for t in terms):raise ValueError('invalid question or terms')
 query=question+' '+' '.join(terms);limit=request.get('limit',18)
 if type(limit) is not int or not 0<=limit<=100:raise ValueError('candidate limit')
 if action=='search':
  result=store.search(query,profile['source_ids'],mode,limit)
  for row in result['candidates']:
   doc=store.docs[row['source_id']];row.update(path=doc['path'],source_sha256=doc['sha'],content_read=False)
  return {**result,'library_id':store.manifest['library_id'],'source_commit':store.manifest['source_commit'],'content_read':False,'writes':False}
 if action=='context':return store.packet(query,profile['source_ids'],mode,profile.get('initial_bytes',9000),profile.get('max_units',4))
 raise ValueError('unsupported action; generation belongs to the host provider')
