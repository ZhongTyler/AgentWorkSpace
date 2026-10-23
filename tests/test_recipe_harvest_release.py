"""Current predecessor/client conflict and recovery for the new recipe resource."""
import json,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class RecipeHarvestRelease(unittest.TestCase):
 def skill(self,host,*args,ok=True):
  p=subprocess.run([sys.executable,'-X','utf8','-B',host/'modules/skills/scripts/skills.py',*args,'--target',host],capture_output=True)
  self.assertEqual(p.returncode==0,ok,(p.stdout+p.stderr).decode('utf-8','replace'));return json.loads(p.stdout)
 def test_real_previous_package_and_selected_skill_recovery(self):
  with tempfile.TemporaryDirectory() as t:
   b=Path(t);old=published_bundle(ROOT,'1.24.0',b/'old')
   for mode in ['full','compatible']:
    h=b/mode;h.mkdir();private=h/'private.md';private.write_bytes(b'PRIVATE USER DATA')
    if mode=='compatible':(h/'AGENTS.md').write_bytes(b'EXISTING HOST AUTHORITY')
    self.assertTrue(w.install(old,h,'init',['skills','research'],True,mode=mode)['applied'])
    authority=(h/'AGENTS.md').read_bytes() if mode=='full' else b'EXISTING HOST AUTHORITY'
    for platform in ['codex','codebuddy']:self.skill(h,'install','--names','interaction-design','--platform',platform,'--apply')
    protocol=h/'modules/research/RESEARCH_PROTOCOL.md';original=protocol.read_bytes();protocol.write_bytes(original+b'\nUSER EDIT')
    self.assertTrue(w.install(ROOT,h,'upgrade',[],True)['conflicts']);self.assertEqual(original+b'\nUSER EDIT',protocol.read_bytes());protocol.write_bytes(original)
    upgrade=w.install(ROOT,h,'upgrade',[],True);self.assertTrue(upgrade['applied'])
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     recipe=h/folder/'skills/interaction-design/references/interaction-patterns.md';self.assertFalse(recipe.exists())
     selected=self.skill(h,'upgrade','--platform',platform,'--apply');self.assertTrue(selected['applied']);self.assertTrue(recipe.is_file())
     content=recipe.read_bytes();recipe.write_bytes(content+b'\nUSER EDIT')
     self.assertTrue(self.skill(h,'rollback','--transaction',selected['transaction'],'--platform',platform,'--apply',ok=False)['conflicts'])
     self.assertEqual(content+b'\nUSER EDIT',recipe.read_bytes());recipe.write_bytes(content)
     self.assertTrue(self.skill(h,'rollback','--transaction',selected['transaction'],'--platform',platform,'--apply')['applied']);self.assertFalse(recipe.exists())
    self.assertTrue(w.rollback(h,upgrade['transaction'],True)['applied']);self.assertEqual(original,protocol.read_bytes());self.assertEqual('1.24.0',w.state(h)['version'])
    self.assertEqual(b'PRIVATE USER DATA',private.read_bytes());self.assertEqual(authority,(h/'AGENTS.md').read_bytes())
    self.assertFalse((h/'modules/tools').exists());self.assertFalse((h/'modules/knowledge').exists())
