"""Public synthetic round trip and private-data-preserving predecessor recovery."""
import hashlib,importlib.util,json,os,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
class RetrievalRelease(unittest.TestCase):
 def test_public_scope_and_optional_dependency(self):
  tools=ROOT/'packages/tools';knowledge=ROOT/'packages/knowledge'
  self.assertTrue((tools/'integrations/retrieval/core.py').is_file());self.assertTrue((knowledge/'system/query/retrieval-adapter.mjs').is_file())
  for base in [tools,knowledge]:
   for p in base.rglob('*'):
    if p.is_file():
     self.assertFalse(p.suffix in ['.sqlite','.onnx'],str(p));self.assertNotIn('retrieval.local.json',p.name)
     if p.suffix in ['.py','.mjs','.json','.md','.txt']:
      s=p.read_text(encoding='utf-8-sig')
      for value in ['codex://threads/','E:/TylerWorkSpace','C:\\Users\\Admin','xsec_token=','MonsterContainment','answer-preregistered']:
       self.assertNotIn(value,s,str(p))
  self.assertNotIn('tools',w.catalog(ROOT)['components']['knowledge']['required'])
 def test_fresh_installed_packages_execute_synthetic_consumer(self):
  with tempfile.TemporaryDirectory(prefix='retrieval-installed-') as tmp:
   host=pathlib.Path(tmp)/'host';host.mkdir();(host/'AGENTS.md').write_bytes(b'HOST AUTHORITY\n')
   result=w.install(ROOT,host,'init',['tools','knowledge','meta'],True,mode='compatible');self.assertTrue(result['applied']);self.assertEqual(b'HOST AUTHORITY\n',(host/'AGENTS.md').read_bytes())
   env={**os.environ,'TOOLS_ROOT':str(host/'modules/tools'),'PYTHON_EXECUTABLE':sys.executable}
   r=subprocess.run(['node',str(host/'modules/knowledge/tests/retrieval.contract.mjs')],capture_output=True,env=env);self.assertEqual(0,r.returncode,r.stderr.decode(errors='replace'));self.assertEqual('pass',json.loads(r.stdout)['status'])
   self.assertFalse((host/'modules/knowledge/system/query/retrieval.local.json').exists());self.assertFalse(list((host/'modules/knowledge').rglob('*.sqlite')))
 def test_installed_post_review_refresh_and_actual_hook(self):
  with tempfile.TemporaryDirectory(prefix='retrieval-lifecycle-installed-') as tmp:
   host=pathlib.Path(tmp)/'host';result=w.install(ROOT,host,'init',['tools','knowledge'],True);self.assertTrue(result['applied'])
   env={**os.environ,'TOOLS_ROOT':str(host/'modules/tools'),'PYTHON_EXECUTABLE':sys.executable}
   for name in ['retrieval-maintenance.contract.mjs','retrieval-hook.contract.mjs']:
    p=subprocess.run(['node',str(host/'modules/knowledge/tests'/name)],env=env,capture_output=True);self.assertEqual(0,p.returncode,p.stderr.decode(errors='replace')+p.stdout.decode(errors='replace'));self.assertIn('"status":"pass"',p.stdout.decode())
 def test_immediate_predecessor_upgrade_conflict_and_reverse(self):
  with tempfile.TemporaryDirectory(prefix='retrieval-upgrade-') as tmp:
   tmp=pathlib.Path(tmp);old=tmp/'old';old.mkdir();raw=subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v'+w.catalog(ROOT)['previous_version']])
   import tarfile,io
   with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    for item in archive:
     if item.isfile():p=w.safe(old,item.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(item).read())
   spec=importlib.util.spec_from_file_location('old_retrieval_workspace',old/'scripts/workspace.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
   for mode in ['full','compatible']:
    host=tmp/mode
    if mode=='compatible':host.mkdir();(host/'AGENTS.md').write_bytes(b'USER RULES\n')
    installed=prior.install(old,host,'init',['tools','knowledge']+(['meta'] if mode=='compatible' else []),True,mode=mode);self.assertTrue(installed['applied'])
    protected={host/'modules/knowledge/wiki/user.md':b'PRIVATE ORIGINAL\r\n',host/'modules/knowledge/system/query/retrieval.local.json':b'{"private":"binding"}',host/'external-tools/runtime/model.bin':b'OWN RUNTIME'}
    for p,b in protected.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b)
    authority=(host/'AGENTS.md').read_bytes();managed=host/'modules/knowledge/system/query/README.md';original=managed.read_bytes();managed.write_bytes(original+b'\n// User edit\n')
    denied=w.install(ROOT,host,'upgrade',[],False);self.assertTrue(denied['conflicts']);self.assertTrue(managed.read_bytes().endswith(b'// User edit\n'));managed.write_bytes(original)
    upgrade=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(upgrade['applied']);self.assertTrue((host/'modules/tools/integrations/retrieval/core.py').is_file());self.assertTrue(w.rollback(host,upgrade['transaction'],True)['applied']);self.assertEqual(original,managed.read_bytes());self.assertEqual(authority,(host/'AGENTS.md').read_bytes())
    for p,b in protected.items():self.assertEqual(b,p.read_bytes())
if __name__=='__main__':unittest.main()
