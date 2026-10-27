"""Frozen1.27.0 actual-predecessor, independent methods and reverse recovery."""
import json,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class ResearchWritingRelease(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.cache=tempfile.TemporaryDirectory();cls.bundle=ROOT if w.catalog(ROOT)['version']=='1.27.0' else published_bundle(ROOT,'1.27.0',Path(cls.cache.name)/'frozen')
 @classmethod
 def tearDownClass(cls):cls.cache.cleanup()
 def run_script(self,script,*args,ok=True):
  p=subprocess.run([sys.executable,'-X','utf8','-B',str(script),*map(str,args)],capture_output=True);self.assertEqual(p.returncode==0,ok,(p.stdout+p.stderr).decode('utf-8','replace'));return p
 def pick(self,h,*args,ok=True):return json.loads(self.run_script(h/'modules/skills/scripts/skills.py',*args,'--target',h,ok=ok).stdout)
 def test_predecessor_upgrade_clients_portable_tools_and_reverse(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);old=published_bundle(ROOT,'1.26.0',base/'old')
   for mode in ['full','compatible']:
    h=base/mode;h.mkdir();private=h/'reports/private.md';private.parent.mkdir();private.write_bytes(b'PRIVATE CANARY')
    if mode=='compatible':(h/'AGENTS.md').write_bytes(b'EXISTING AUTHORITY')
    self.assertTrue(w.install(old,h,'init',['skills','research'],True,mode=mode)['applied']);authority=(h/'AGENTS.md').read_bytes()
    custom=h/'.agents/skills/user-owned/SKILL.md';custom.parent.mkdir(parents=True);custom.write_bytes(b'USER METHOD')
    for platform in ['codex','codebuddy']:self.pick(h,'install','--names','evidence-audit','--platform',platform,'--apply')
    rules=h/'modules/research/game-research/deep-game-analysis/README.md';before=rules.read_bytes();rules.write_bytes(before+b'\nUSER EDIT')
    self.assertTrue(w.install(self.bundle,h,'upgrade',[],True)['conflicts']);self.assertEqual(before+b'\nUSER EDIT',rules.read_bytes());rules.write_bytes(before)
    package=w.install(self.bundle,h,'upgrade',[],True);self.assertTrue(package['applied'])
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     chosen=h/folder/'skills';review=chosen/'evidence-audit/references/research-review.md';self.assertFalse(review.exists());self.assertFalse((chosen/'human-research-expression').exists())
     humanizer=chosen/'humanizer-zh/SKILL.md';humanizer_before=humanizer.read_bytes() if humanizer.exists() else None
     upgrade=self.pick(h,'upgrade','--platform',platform,'--apply');self.assertTrue(upgrade['applied']);self.assertTrue(review.is_file())
     install=self.pick(h,'install','--names','human-research-expression','anti-defensive-writing','--platform',platform,'--apply');self.assertTrue(install['applied'])
     skill=chosen/'human-research-expression/SKILL.md';data=skill.read_bytes();self.assertEqual((self.bundle/'packages/skills/library/human-research-expression/SKILL.md').read_bytes(),data)
     self.assertTrue((chosen/'anti-defensive-writing/LICENSE').is_file());self.assertTrue((chosen/'human-research-expression/scripts/assemble_html.py').is_file());self.assertEqual(humanizer_before,humanizer.read_bytes() if humanizer.exists() else None)
     self.run_script(chosen/'human-research-expression/scripts/test_render_visual_html.py')
     skill.write_bytes(data+b'\nUSER EDIT');self.assertTrue(self.pick(h,'rollback','--transaction',install['transaction'],'--platform',platform,'--apply',ok=False)['conflicts']);self.assertEqual(data+b'\nUSER EDIT',skill.read_bytes());skill.write_bytes(data)
     self.pick(h,'rollback','--transaction',install['transaction'],'--platform',platform,'--apply');self.assertFalse(skill.exists())
     self.pick(h,'rollback','--transaction',upgrade['transaction'],'--platform',platform,'--apply');self.assertFalse(review.exists())
    tools=h/'modules/research/game-research/deep-game-analysis';example=base/(mode+'-exercise');self.run_script(tools/'example_dossier.py','--output',example)
    self.run_script(tools/'dossier.py','check','--manifest',example/'manifest.json');self.run_script(tools/'dossier.py','return','--manifest',example/'manifest.json','--request',example/'request.json','--output',example/'returned.json')
    returned=json.loads((example/'returned.json').read_text(encoding='utf-8'));self.assertEqual(returned['dossier_coverage_status'],'partial')
    handoff=base/(mode+'-handoff');self.run_script(tools/'dossier.py','export','--manifest',example/'manifest.json','--output',handoff);self.run_script(tools/'dossier.py','check-bundle','--manifest',handoff/'portable-manifest.json')
    self.assertTrue(w.rollback(h,package['transaction'],True)['applied']);self.assertEqual('1.26.0',w.state(h)['version']);self.assertEqual(before,rules.read_bytes())
    self.assertEqual(authority,(h/'AGENTS.md').read_bytes());self.assertEqual(b'PRIVATE CANARY',private.read_bytes());self.assertEqual(b'USER METHOD',custom.read_bytes())
    for name in ['tools','knowledge']:self.assertFalse((h/'modules'/name).exists())
    if mode=='compatible':self.assertFalse((h/'modules/meta').exists())
