"""Portable read-only RAG retrieval core. Generated SQLite pack is not a knowledge owner."""
from __future__ import annotations
import collections,hashlib,json,math,pathlib,re,sqlite3,time
VERSION='retrieval-core-v1'
def digest(data):return hashlib.sha256(data).hexdigest()
def terms(text):
 out=[]
 for m in re.finditer(r'[\u3400-\u9fff]+|[a-z0-9]+(?:[._%-][a-z0-9]+)*',text.lower()):
  s=m.group();out.extend([s[i:i+2] for i in range(len(s)-1)] if '\u3400'<=s[0]<='\u9fff' and len(s)>1 else [s])
 return out
def units_for(path,text):
 lines=text.splitlines(keepends=True);starts=[];fence=False;h2='';offset=0
 for number,line in enumerate(lines,1):
  if re.match(r'^\s*(```|~~~)',line):fence=not fence
  m=None if fence else re.match(r'^(#{2,3})\s+(.+?)\s*$',line)
  if m:
   if len(m[1])==2:h2=m[2]
   starts.append((offset,number,h2 if len(m[1])==2 else h2+' / '+m[2]))
  offset+=len(line)
 if not starts:starts=[(0,1,pathlib.PurePosixPath(path).stem)]
 out=[]
 for i,(start,line,heading) in enumerate(starts):
  end=starts[i+1][0] if i+1<len(starts) else len(text);body=text[start:end]
  if heading in ['来源','相关页面']:continue
  out.append({'id':'u-'+digest((path+'\0'+str(start)+'\0'+digest(body.encode())).encode())[:20],'path':path,'heading':heading,'start_line':line,'end_line':line+body.count('\n'),'start_char':start,'end_char':end,'content':body})
 return out
class Embedding:
 def __init__(self,model_dir,dependency_dir):
  import os,sys
  os.environ['TOKENIZERS_PARALLELISM']='false';sys.path.insert(0,str(dependency_dir))
  import numpy as np
  import onnxruntime as ort
  from tokenizers import Tokenizer
  self.np=np;self.tok=Tokenizer.from_file(str(pathlib.Path(model_dir)/'tokenizer.json'));self.tok.enable_truncation(max_length=512)
  o=ort.SessionOptions();o.intra_op_num_threads=2;o.inter_op_num_threads=1;o.enable_cpu_mem_arena=False;o.enable_mem_pattern=False
  self.session=ort.InferenceSession(str(pathlib.Path(model_dir)/'onnx/model_quantized.onnx'),sess_options=o,providers=['CPUExecutionProvider']);self.truncated=0
 def encode(self,text,query=False):
  if query:text='为这个句子生成表示以用于检索相关文章：'+text
  e=self.tok.encode(text);self.truncated+=int(bool(e.overflowing));np=self.np
  inp={'input_ids':np.array([e.ids],dtype=np.int64),'attention_mask':np.array([e.attention_mask],dtype=np.int64),'token_type_ids':np.array([e.type_ids],dtype=np.int64)}
  v=self.session.run(None,{i.name:inp[i.name] for i in self.session.get_inputs()})[0][0,0];v=v/np.linalg.norm(v);assert len(v)==512 and np.isfinite(v).all();return v.astype(np.float32)
def build_pack(source_root,source_lock,out,embedding,embedding_profile,allowed_paths=None):
 t=time.perf_counter();source_root=pathlib.Path(source_root).resolve();out=pathlib.Path(out);out.parent.mkdir(parents=True,exist_ok=True)
 if out.exists():raise FileExistsError('Use a new immutable pack path')
 db=sqlite3.connect(out);db.executescript('CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE docs(id TEXT PRIMARY KEY,path TEXT,sha TEXT,content TEXT); CREATE TABLE units(id TEXT PRIMARY KEY,doc TEXT,heading TEXT,start_line INTEGER,end_line INTEGER,content TEXT); CREATE TABLE chunks(id INTEGER PRIMARY KEY,unit TEXT,text TEXT,vector BLOB);')
 files=[f for f in source_lock['files'] if f['path'].startswith('wiki/') and (allowed_paths is None or f['path'] in allowed_paths)];identities=[];chunk_count=0
 try:
  for f in files:
   p=(source_root/f['path']).resolve()
   if not p.is_relative_to(source_root) or p.is_symlink():raise ValueError('outside source root')
   b=p.read_bytes();assert digest(b)==f['sha256'];text=b.decode('utf-8');doc='knowledge:wiki:'+f['path'].split('/',1)[1].removesuffix('.md')
   db.execute('INSERT INTO docs VALUES(?,?,?,?)',(doc,f['path'],f['sha256'],text));identities.append([doc,f['sha256']])
   for u in units_for(f['path'],text):
    db.execute('INSERT INTO units VALUES(?,?,?,?,?,?)',(u['id'],doc,u['heading'],u['start_line'],u['end_line'],u['content']))
    for pos in range(0,len(u['content']),200):
     chunk=pathlib.PurePosixPath(f['path']).stem+' / '+u['heading']+'\n'+u['content'][pos:pos+260]
     vec=embedding.encode(chunk).tobytes() if embedding else None
     db.execute('INSERT INTO chunks(unit,text,vector) VALUES(?,?,?)',(u['id'],chunk,vec));chunk_count+=1
  manifest={'schema':1,'core_version':VERSION,'library_id':source_lock.get('library_id','knowledge'),'source_commit':source_lock['knowledge_commit'],'source_identities':identities,'embedding_profile':embedding_profile,'chunker':'semantic-heading-h2-h3/char260-stride200-v1','policy':'owner-private explicit allowlist only; no public publishing grant','created_seconds':time.perf_counter()-t}
  manifest['snapshot_id']=digest(json.dumps({k:v for k,v in manifest.items() if k!='created_seconds'},ensure_ascii=False,sort_keys=True).encode())
  db.execute('INSERT INTO meta VALUES(?,?)',('manifest',json.dumps(manifest,ensure_ascii=False)));db.commit()
 finally:db.close()
 return {**manifest,'documents':len(files),'chunks':chunk_count,'bytes':out.stat().st_size}
class Store:
 def __init__(self,pack,embedding=None,source_root=None,expected_embedding_profile=None):
  self.pack=pathlib.Path(pack).resolve();self.db=sqlite3.connect(self.pack.as_uri()+'?mode=ro',uri=True,check_same_thread=False);self.db.row_factory=sqlite3.Row
  self.manifest=json.loads(self.db.execute("SELECT value FROM meta WHERE key='manifest'").fetchone()[0]);self.embedding=embedding;self.source_root=pathlib.Path(source_root).resolve() if source_root else None
  if expected_embedding_profile and self.manifest['embedding_profile']!=expected_embedding_profile:raise ValueError('embedding profile mismatch')
  self.docs={r['id']:dict(r) for r in self.db.execute('SELECT * FROM docs')};self.units={r['id']:dict(r) for r in self.db.execute('SELECT * FROM units')};self.chunks=[dict(r) for r in self.db.execute('SELECT * FROM chunks')]
  self.tf=[collections.Counter(terms(c['text'])) for c in self.chunks];self.lengths=[sum(f.values()) for f in self.tf]
 def close(self):self.db.close()
 def validate_doc(self,doc):
  if digest(doc['content'].encode())!=doc['sha']:raise ValueError('pack source identity corrupted')
  if self.source_root:
   p=(self.source_root/doc['path']).resolve()
   if not p.is_relative_to(self.source_root) or not p.exists() or digest(p.read_bytes())!=doc['sha']:raise ValueError('source changed/missing; rebuild or fall back to Query')
 def search(self,query,allowed_ids,mode='bm25',limit=30):
  if mode not in ['bm25','hybrid','auto']:raise ValueError('unsupported retrieval mode')
  if not isinstance(query,str) or not query.strip() or len(query)>2000:raise ValueError('invalid query')
  if mode=='hybrid' and not self.embedding:raise ValueError('hybrid unavailable; select bm25 explicitly')
  used='hybrid' if mode=='hybrid' or mode=='auto' and self.embedding else 'bm25';allowed=set(allowed_ids)&self.docs.keys()
  # Scope filtering precedes scoring/statistics, so hidden documents do not enter ranking.
  ids=[i for i,c in enumerate(self.chunks) if self.units[c['unit']]['doc'] in allowed]
  for docid in allowed:self.validate_doc(self.docs[docid])
  df=collections.Counter()
  for i in ids:df.update(self.tf[i].keys())
  avg=sum(self.lengths[i] for i in ids)/len(ids) if ids else 1;qw=set(terms(query));lex={};vec={}
  for i in ids:
   f=self.tf[i];score=sum(math.log(1+(len(ids)-df[w]+.5)/(df[w]+.5))*f[w]*2.2/(f[w]+1.2*(.25+.75*self.lengths[i]/avg)) for w in qw if w in f);u=self.chunks[i]['unit'];lex[u]=max(lex.get(u,0),score)
  lp=sorted((u for u,s in lex.items() if s>0),key=lambda u:(-lex[u],u));rank_scores=lex
  if used=='hybrid':
   qv=self.embedding.encode(query,query=True);np=self.embedding.np
   for i in ids:
    c=self.chunks[i]
    if c['vector'] is None:raise ValueError('pack has no vectors')
    score=float(np.frombuffer(c['vector'],dtype=np.float32)@qv);u=c['unit'];vec[u]=max(vec.get(u,-2),score)
   vp=sorted(vec,key=lambda u:(-vec[u],u));rank_scores=collections.defaultdict(float)
   for weight,ls in [(.3,lp),(.7,vp)]:
    for rank,u in enumerate(ls[:40],1):rank_scores[u]+=weight/(60+rank)
   ranked=sorted(rank_scores,key=lambda u:(-rank_scores[u],u))
  else:ranked=lp
  return {'requested_mode':mode,'used_mode':used,'snapshot_id':self.manifest['snapshot_id'],'candidates':[{'id':u,'source_id':self.units[u]['doc'],'heading':self.units[u]['heading'],'score':rank_scores[u],'bytes':len(self.units[u]['content'].encode())} for u in ranked[:limit]],'claim_support':'not_verified','scope_documents':len(allowed)}
 def packet(self,query,allowed_ids,mode='bm25',max_bytes=9000,max_units=4,exclude=()):
  if not 1<=max_units<=6 or not 1<=max_bytes<=35000:raise ValueError('budget out of range')
  result=self.search(query,allowed_ids,mode);seen=set(exclude);selected=[];used=0;skipped=[]
  for c in result['candidates']:
   if c['id'] in seen:continue
   u=self.units[c['id']];doc=self.docs[u['doc']];content=u['content'];n=len(content.encode())
   if n+used>max_bytes or len(selected)>=max_units:skipped.append({'id':u['id'],'reason':'complete_unit_budget'});continue
   selected.append({'id':u['id'],'source_id':u['doc'],'source_sha256':doc['sha'],'heading':u['heading'],'start_line':u['start_line'],'end_line':u['end_line'],'content':content,'read_scope':'complete_heading_unit_not_complete_source'});used+=n;seen.add(u['id'])
  return {**result,'evidence':selected,'evidence_bytes':used,'budget_skipped':skipped,'budget_bytes':max_bytes,'full_source_read':False,'support':'prototype_context_only; not official Knowledge Query semantic approval'}
 def export(self,destination,allowed_ids):
  destination=pathlib.Path(destination)
  if destination.exists():raise FileExistsError('export must be new')
  allowed=set(allowed_ids)&self.docs.keys();target=sqlite3.connect(destination)
  self.db.backup(target)
  try:
   target.execute('DELETE FROM chunks WHERE unit IN (SELECT id FROM units WHERE doc NOT IN (%s))'%(','.join('?' for _ in allowed) or "''"),tuple(allowed))
   target.execute('DELETE FROM units WHERE doc NOT IN (%s)'%(','.join('?' for _ in allowed) or "''"),tuple(allowed));target.execute('DELETE FROM docs WHERE id NOT IN (%s)'%(','.join('?' for _ in allowed) or "''"),tuple(allowed))
   m={**self.manifest,'source_identities':[[i,self.docs[i]['sha']] for i in sorted(allowed)],'projection_of':self.manifest['snapshot_id']};m['snapshot_id']=digest(json.dumps(m,ensure_ascii=False,sort_keys=True).encode());target.execute('UPDATE meta SET value=? WHERE key=?',(json.dumps(m,ensure_ascii=False),'manifest'));target.commit();target.execute('VACUUM');target.commit()
  finally:target.close()
  return m
