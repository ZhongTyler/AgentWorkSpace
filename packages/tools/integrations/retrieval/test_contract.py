"""Synthetic public fixtures only; actual local/HTTP behavior, no model/API calls."""
import json,pathlib,secrets,socket,sqlite3,subprocess,sys,tempfile,time,unittest,urllib.request,urllib.error
from cli import build
from service import load,execute
B=pathlib.Path(__file__).resolve().parent
class Contracts(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='retrieval-contract-');self.root=pathlib.Path(self.temp.name);self.source=self.root/'library';(self.source/'wiki/nested').mkdir(parents=True)
  (self.source/'wiki/alpha.md').write_text('# Alpha\n\n## 条件\n囤积并不一定是错误。恐怖生存的资源稀缺可以形成体验。\n',encoding='utf-8')
  (self.source/'wiki/nested/beta.md').write_text('# Beta\n\n## 数值\n伤害稳定10，无恢复时，20血需2击，35血需4击。\n',encoding='utf-8')
  g=['git','-C',str(self.source)];subprocess.run(g+['init','-q'],check=True);subprocess.run(g+['add','.'],check=True);subprocess.run(g+['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixture'],check=True)
  self.home=self.root/'versions/v1';build(self.source,self.home,'HEAD');self.config=self.home/'config.json'
 def tearDown(self):self.temp.cleanup()
 def test_default_no_model_and_stale_exact_identity(self):
  cfg,s=load(self.config);p=execute(cfg,s,{'question':'囤积 资源'});self.assertTrue(p['candidates']);self.assertFalse(p['content_read']);self.assertEqual('bm25',p['used_mode']);self.assertFalse(p['writes'])
  data=self.source/'wiki/alpha.md';data.write_bytes(data.read_bytes()+b' changed');self.assertRaises(ValueError,lambda:execute(cfg,s,{'question':'资源'}));s.close()
 def test_nested_ids_budgets_scope_and_no_hybrid_substitute(self):
  cfg,s=load(self.config);ids=list(s.docs);self.assertIn('knowledge:wiki:nested/beta',ids)
  self.assertRaises(ValueError,lambda:load(self.config,'hybrid'));self.assertRaises(ValueError,lambda:execute(cfg,s,{'question':'资源','mode':'hybrid'}))
  cfg['profiles']['empty']={'source_ids':[]};self.assertFalse(execute(cfg,s,{'question':'资源'},'empty')['candidates'])
  self.assertFalse(s.packet('资源',ids,'bm25',1,4)['evidence']);self.assertRaises(ValueError,lambda:execute(cfg,s,{'question':'资源','profile':'local'}));s.close()
 def test_explicit_build_preserves_sources_and_rejects_dirty(self):
  before={str(p):p.read_bytes() for p in self.source.rglob('*.md')};self.assertRaises(ValueError,lambda:build(self.source,self.home,'HEAD'))
  p=self.source/'wiki/alpha.md';p.write_bytes(p.read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'));home=self.root/'versions/crlf';build(self.source,home,'HEAD');cfg,s=load(home/'config.json');self.assertTrue(execute(cfg,s,{'question':'囤积'})['candidates']);s.close()
  self.assertEqual(before[str(p)].replace(b'\r\n',b'\n'),p.read_bytes().replace(b'\r\n',b'\n'));p.write_bytes(p.read_bytes()+b' altered meaning');self.assertRaises(ValueError,lambda:build(self.source,self.root/'dirty','HEAD'))
 def test_new_source_invalidates_old_index_without_rebuild(self):
  (self.source/'wiki/new.md').write_text('# New\nNew approved-or-draft material requires explicit review and new index.\n')
  self.assertRaises(ValueError,lambda:load(self.config))
 def test_export_is_physical_projection_and_full_read(self):
  cfg,s=load(self.config);dest=self.root/'view.sqlite';ref='knowledge:wiki:alpha';s.export(dest,[ref]);s.close();cfg['pack']=str(dest);cfg['pack_sha256']=__import__('hashlib').sha256(dest.read_bytes()).hexdigest();cfg['source_root']=None;cfg['profiles']['local']['source_ids']=[ref];path=self.root/'web.json';path.write_text(json.dumps(cfg),encoding='utf-8');cfg,s=load(path)
  self.assertEqual([ref],list(s.docs));self.assertNotIn('beta',dest.read_bytes().decode('utf-8',errors='ignore'));r=execute(cfg,s,{'action':'read','source_id':ref});self.assertTrue(r['full_source_read']);self.assertIn('恐怖',r['content']);self.assertRaises(ValueError,lambda:execute(cfg,s,{'action':'read','source_id':'knowledge:wiki:nested/beta'}));s.close()
 def test_real_http_parity_auth_scope_and_generation_absent(self):
  cfg=json.loads(self.config.read_text(encoding='utf-8'));cfg['profiles']['restricted']={'source_ids':[]};self.config.write_text(json.dumps(cfg),encoding='utf-8');token=secrets.token_hex(12);restricted=secrets.token_hex(12);keys=self.root/'keys.json';keys.write_text(json.dumps({token:'local',restricted:'restricted'}))
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  log=(self.root/'server.log').open('wb');p=subprocess.Popen([sys.executable,'-B',str(B/'cli.py'),'serve','--config',str(self.config),'--keys',str(keys),'--port',str(port)],stdout=log,stderr=log)
  def request(body,auth=token,route='/v1/search',origin=None):
   headers={'Authorization':'Bearer '+auth,'Content-Type':'application/json'}
   if origin:headers['Origin']=origin
   req=urllib.request.Request(f'http://127.0.0.1:{port}'+route,data=json.dumps(body).encode(),headers=headers)
   try:
    with urllib.request.urlopen(req,timeout=3) as r:return r.status,json.load(r)
   except urllib.error.HTTPError as e:return e.code,json.load(e)
  try:
   for i in range(30):
    if p.poll() is not None:raise RuntimeError('server exited before readiness')
    try:code,r=request({'question':'资源'});break
    except (urllib.error.URLError,ConnectionError):time.sleep(.1)
   else:self.fail('server unavailable')
   cfg,s=load(self.config);self.assertEqual(execute(cfg,s,{'question':'资源'}),r);s.close()
   self.assertEqual(401,request({'question':'资源'},auth='invalid')[0]);self.assertEqual(403,request({'question':'资源'},origin='https://other.invalid')[0]);self.assertEqual(400,request({'question':'资源','profile':'local'},auth=restricted)[0]);self.assertEqual([],request({'question':'资源'},auth=restricted)[1]['candidates']);self.assertEqual(400,request({'source_id':'knowledge:wiki:alpha'},auth=restricted,route='/v1/read')[0]);self.assertEqual(404,request({'question':'资源'},route='/v1/answer')[0]);self.assertEqual(503,request({'question':'资源','mode':'hybrid'})[0])
  finally:p.terminate();p.wait(timeout=10);log.close()
if __name__=='__main__':unittest.main()
