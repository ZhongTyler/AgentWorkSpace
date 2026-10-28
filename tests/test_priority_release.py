"""Frozen 1.28.0 recipient use, optional source restoration and actual-predecessor recovery."""
import hashlib,json,os,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class PriorityRelease(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.cache=tempfile.TemporaryDirectory();cls.bundle=ROOT if w.catalog(ROOT)['version']=='1.28.0' else published_bundle(ROOT,'1.28.0',Path(cls.cache.name)/'frozen')
 @classmethod
 def tearDownClass(cls):cls.cache.cleanup()
 def run_command(self,*args,ok=True,env=None):
  p=subprocess.run(list(map(str,args)),capture_output=True,env=env);self.assertEqual(p.returncode==0,ok,(p.stdout+p.stderr).decode('utf8','replace'));return p
 def pick(self,h,*args):return json.loads(self.run_command(sys.executable,'-X','utf8','-B',h/'modules/skills/scripts/skills.py',*args,'--target',h).stdout)
 def test_independent_selected_methods_and_actual_analysis(self):
  with tempfile.TemporaryDirectory() as tmp:
   h=Path(tmp)/'host';h.mkdir();(h/'AGENTS.md').write_bytes(b'EXISTING HOST')
   self.assertTrue(w.install(self.bundle,h,'init',['skills'],True,mode='compatible')['applied'])
   names=['codebase-design','domain-modeling','prototype','writing-for-agents','eval-result-analysis','finesse-ui']
   for platform,directory in [('codex','.agents'),('codebuddy','.codebuddy')]:
    result=self.pick(h,'install','--names',*names,'--platform',platform,'--apply');self.assertTrue(result['applied'])
    for name in names:self.assertEqual((self.bundle/'packages/skills/library'/name/'SKILL.md').read_bytes(),(h/directory/'skills'/name/'SKILL.md').read_bytes())
   self.run_command('node',h/'.agents/skills/eval-result-analysis/scripts/check.mjs')
   self.assertEqual((h/'AGENTS.md').read_bytes(),b'EXISTING HOST');self.assertFalse((h/'modules/tools').exists());self.assertFalse((h/'modules/knowledge').exists())
 def test_offline_tool_restore_and_fixed_launchers(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);h=base/'host';h.mkdir();w.install(self.bundle,h,'init',['tools'],True,mode='compatible');installed=h/'modules/tools';p=base/'tools-home';self.run_command(sys.executable,'-X','utf8','-B',installed/'prepare_home.py','--home',p);chart=p/'integrations/metaphysics-charting';runtime=base/'chart-home'
   canary=h/'private/note.txt';canary.parent.mkdir();canary.write_bytes(b'PRIVATE CANARY')
   result=json.loads(self.run_command(sys.executable,'-X','utf8','-B',chart/'restore.py','--output',runtime).stdout);self.assertEqual(result['files_verified'],1057);self.assertFalse(result['network']);self.assertFalse(result['npm_scripts'])
   self.run_command(sys.executable,'-X','utf8','-B',chart/'restore.py','--output',runtime,ok=False)
   health=json.loads(self.run_command(sys.executable,'-X','utf8','-B',p/'toolbox.py','run','--workflow','metaphysics-charting','--tool','metaphysics-charting','--action','health','--','--chart-home',runtime).stdout);self.assertEqual(health['status'],'pass');self.assertFalse(health['accuracy_verified'])
   self.run_command('node',runtime/'render.mjs','--input',runtime/'example.synthetic.json','--output-dir',base/'svg','--svg-only');self.assertTrue(list((base/'svg').glob('*.svg')))
   self.run_command('node',p/'integrations/bilibili-capture/check-reader.mjs');self.run_command('node',p/'integrations/bilibili-capture/check-platform.mjs')
   self.run_command(sys.executable,'-X','utf8','-B',p/'toolbox.py','run','--workflow','knowledge-feedback','--tool','knowledge-feedback','--action','health')
   self.assertEqual(canary.read_bytes(),b'PRIVATE CANARY');self.assertFalse((chart/'node_modules').exists());self.assertFalse((p/'integrations/bilibili-capture/runtime').exists())
 def test_public_research_bindings_and_evidence_contract(self):
  env=dict(os.environ,FEEDBACK_TOOLS_ROOT=str(self.bundle/'packages/tools'))
  self.run_command('node','--test',self.bundle/'packages/knowledge/tests/research-reports.contract.mjs',env=env)
  catalog=json.loads((self.bundle/'packages/knowledge/research-reports/catalog.json').read_text('utf8'));self.assertEqual(catalog['reports'],[])
 def test_actual_predecessor_full_compatible_upgrade_conflict_and_reverse(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);old=published_bundle(ROOT,'1.27.0',base/'old')
   for mode in ['full','compatible']:
    h=base/mode;h.mkdir()
    if mode=='compatible':(h/'AGENTS.md').write_bytes(b'HOST AUTHORITY')
    selection=['skills','tools','knowledge']
    if mode=='compatible':selection.insert(0,'meta')
    initial=w.install(old,h,'init',selection,True,mode=mode);self.assertTrue(initial['applied']);authority=(h/'AGENTS.md').read_bytes()
    protected=h/'private/receipt.txt';protected.parent.mkdir();protected.write_bytes(b'PRIVATE')
    client=self.pick(h,'install','--names','human-research-expression','--apply')
    edit=h/'modules/knowledge/AGENTS.md';before=edit.read_bytes();edit.write_bytes(before+b'\nOWNER EDIT')
    self.assertTrue(w.install(self.bundle,h,'upgrade',[],True)['conflicts']);self.assertEqual(edit.read_bytes(),before+b'\nOWNER EDIT');edit.write_bytes(before)
    package=w.install(self.bundle,h,'upgrade',[],True);self.assertTrue(package['applied'])
    client_upgrade=self.pick(h,'upgrade','--apply');self.assertTrue(client_upgrade['applied'])
    added=self.pick(h,'install','--names','eval-result-analysis','--apply');self.assertTrue(added['applied'])
    self.pick(h,'rollback','--transaction',added['transaction'],'--apply');self.pick(h,'rollback','--transaction',client_upgrade['transaction'],'--apply');self.assertTrue(w.rollback(h,package['transaction'],True)['applied'])
    self.assertEqual((h/'AGENTS.md').read_bytes(),authority)
    self.assertEqual(w.state(h)['version'],'1.27.0');self.assertEqual(protected.read_bytes(),b'PRIVATE');self.assertTrue((h/'.agents/skills/human-research-expression/SKILL.md').is_file())

if __name__=='__main__':unittest.main()
