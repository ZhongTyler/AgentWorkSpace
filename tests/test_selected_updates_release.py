"""Frozen 1.29.0 recipient use, optional source restoration and actual-predecessor recovery."""
import hashlib,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class SelectedUpdatesRelease(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.cache=tempfile.TemporaryDirectory();cls.bundle=ROOT if w.catalog(ROOT)['version']=='1.29.0' else published_bundle(ROOT,'1.29.0',Path(cls.cache.name)/'frozen')
 @classmethod
 def tearDownClass(cls):cls.cache.cleanup()
 def run_command(self,*args,ok=True,env=None):
  p=subprocess.run(list(map(str,args)),capture_output=True,env=env);self.assertEqual(p.returncode==0,ok,(p.stdout+p.stderr).decode('utf8','replace'));return p
 def pick(self,h,*args):return json.loads(self.run_command(sys.executable,'-X','utf8','-B',h/'modules/skills/scripts/skills.py',*args,'--target',h).stdout)
 def test_selected_methods_without_other_modules(self):
  for client in ['codex','codebuddy']:
   with tempfile.TemporaryDirectory() as tmp:
    h=Path(tmp)/'host';h.mkdir();(h/'AGENTS.md').write_bytes(b'EXISTING HOST')
    w.install(self.bundle,h,'init',['skills'],True,mode='compatible')
    names=['game-runtime-patterns','pixel-asset-production','session-handoff','game-feel','game-ui-ux']
    result=self.pick(h,'install','--names',*names,'--platform',client,'--apply');self.assertTrue(result['applied'])
    target=h/('.agents/skills' if client=='codex' else '.codebuddy/skills')
    for name in names:self.assertTrue((target/name/'SKILL.md').is_file())
    self.assertEqual((h/'AGENTS.md').read_bytes(),b'EXISTING HOST')
    for name in ['tools','knowledge','game-presentation']:self.assertFalse((h/'modules'/name).exists())
    for name in ['game-feel','game-ui-ux']:self.assertTrue((target/name/'LICENSE').is_file());self.assertTrue((target/name/'NOTICE').is_file())
 def test_public_research_bindings_and_evidence_contract(self):
  env=dict(os.environ,FEEDBACK_TOOLS_ROOT=str(self.bundle/'packages/tools'),RESEARCH_TEST_PYTHON=sys.executable)
  self.run_command('node','--test',self.bundle/'packages/knowledge/tests/research-reports.contract.mjs',env=env)
  catalog=json.loads((self.bundle/'packages/knowledge/research-reports/catalog.json').read_text('utf8'));self.assertEqual(catalog['reports'],[])
 def test_actual_predecessor_full_compatible_upgrade_conflict_and_reverse(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);old=published_bundle(ROOT,'1.28.0',base/'old')
   for mode in ['full','compatible']:
    h=base/mode;h.mkdir()
    if mode=='compatible':(h/'AGENTS.md').write_bytes(b'HOST AUTHORITY')
    selection=['skills','knowledge','research','game-analysis-decision']
    if mode=='compatible':selection.insert(0,'meta')
    initial=w.install(old,h,'init',selection,True,mode=mode);self.assertTrue(initial['applied']);authority=(h/'AGENTS.md').read_bytes()
    protected=h/'private/receipt.txt';protected.parent.mkdir();protected.write_bytes(b'PRIVATE')
    client=self.pick(h,'install','--names','human-research-expression','--apply')
    edit=h/'modules/knowledge/README.md';before=edit.read_bytes();edit.write_bytes(before+b'\nOWNER EDIT')
    self.assertTrue(w.install(self.bundle,h,'upgrade',[],True)['conflicts']);self.assertEqual(edit.read_bytes(),before+b'\nOWNER EDIT');edit.write_bytes(before)
    package=w.install(self.bundle,h,'upgrade',[],True);self.assertTrue(package['applied'])
    client_upgrade=self.pick(h,'upgrade','--apply');self.assertTrue(client_upgrade['applied'])
    added=self.pick(h,'install','--names','game-runtime-patterns','--apply');self.assertTrue(added['applied'])
    self.pick(h,'rollback','--transaction',added['transaction'],'--apply');self.pick(h,'rollback','--transaction',client_upgrade['transaction'],'--apply');self.assertTrue(w.rollback(h,package['transaction'],True)['applied'])
    self.assertEqual((h/'AGENTS.md').read_bytes(),authority)
    self.assertEqual(w.state(h)['version'],'1.28.0');self.assertEqual(protected.read_bytes(),b'PRIVATE');self.assertTrue((h/'.agents/skills/human-research-expression/SKILL.md').is_file())

 def test_research_compiler_and_navigation_without_optional_packages(self):
  package=self.bundle/'packages/research/game-research/deep-game-analysis'
  self.run_command(sys.executable,'-B','-m','unittest','discover','-s',package,'-p','test_workflow.py')
  self.run_command(sys.executable,'-B','-m','unittest','discover','-s',package/'reader-navigation','-p','test_build.py')
  self.run_command('node','--test',package/'reader-navigation/test_modes.cjs')
 def test_new_knowledge_synthetic_contracts(self):
  k=self.bundle/'packages/knowledge'
  names=['system/query/query-completion.test.mjs','system/sync/source-url-boundary.test.mjs','system/sync/approved-source-projections.test.mjs','system/sync/manual-publication-replay.test.mjs','system/sync/snapshot-admission.test.mjs','tests/wiki-group-threshold-assessment.contract.mjs']
  self.run_command('node','--test',*[k/name for name in names])

if __name__=='__main__':unittest.main()
