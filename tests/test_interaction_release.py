"""Portable UI method ownership, selected installs and real predecessor recovery."""
import json,pathlib,re,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class InteractionRelease(unittest.TestCase):
 def skill(self,host,*args,ok=True):
  r=subprocess.run([sys.executable,'-X','utf8','-B',str(host/'modules/skills/scripts/skills.py'),*args,'--target',str(host)],capture_output=True)
  self.assertEqual(r.returncode==0,ok,(r.stdout+r.stderr).decode('utf-8','replace'));return json.loads(r.stdout)
 def test_ownership_portability_and_optional_routes(self):
  skill=ROOT/'packages/skills/library/interaction-design';self.assertTrue((skill/'references/interaction-method.md').is_file())
  for p in skill.rglob('*.md'):
   text=p.read_text(encoding='utf-8')
   for bad in ['E:/TylerWorkSpace','C:\\Users\\Admin','codex://threads/','interface-interaction.md']:self.assertNotIn(bad,text)
   for link in re.findall(r'\]\(([^)]+)\)',text):
    if '://' not in link:self.assertTrue((p.parent/link.split('#')[0]).is_file(),link)
  hook=(ROOT/'packages/skills/integrations/frontend-design.md').read_text(encoding='utf-8')
  self.assertIn('不属于安装器受管文件',hook)
  for name in ['packages/skills/library/game-presentation/SKILL.md','packages/game-presentation/workflow.md']:
   self.assertIn('/blob/v1.17.0/packages/skills/library/interaction-design/SKILL.md',(ROOT/name).read_text(encoding='utf-8'))
  contract=w.catalog(ROOT)['components'];self.assertNotIn('skills',contract['game-presentation']['required'])
  old=json.loads(subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'show','v1.16.0:catalog.json']))
  self.assertEqual(['game-presentation','skills'],sorted(k for k,v in contract.items() if v['files']!=old['components'][k]['files']))
 def test_predecessor_upgrade_selected_conflict_and_recovery(self):
  with tempfile.TemporaryDirectory(prefix='aws-interaction-') as tmp:
   base=pathlib.Path(tmp);old=published_bundle(ROOT,'1.16.0',base/'old')
   for mode in ['full','compatible']:
    host=base/mode;host.mkdir();private=host/'private.md';private.write_bytes(b'PRIVATE CANARY')
    if mode=='compatible':(host/'AGENTS.md').write_bytes(b'EXISTING AUTHORITY')
    self.assertTrue(w.install(old,host,'init',['skills','game-presentation']+(['meta'] if mode=='compatible' else []),True,mode=mode)['applied'])
    authority=(host/'AGENTS.md').read_bytes()
    for platform in ['codex','codebuddy']:self.skill(host,'install','--names','game-presentation','--platform',platform,'--apply')
    upgrade=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(upgrade['applied'])
    frontend=host/'.agents/skills/frontend-design/SKILL.md';frontend.parent.mkdir(parents=True,exist_ok=True);frontend.write_bytes(b'ORIGINAL BODY\nLICENSE retained\n')
    original=frontend.read_bytes()
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     self.assertFalse((host/folder/'skills/interaction-design').exists())
     selected_upgrade=self.skill(host,'upgrade','--platform',platform,'--apply');self.assertTrue(selected_upgrade['applied'])
     self.assertIn('interaction-design',(host/folder/'skills/game-presentation/SKILL.md').read_text(encoding='utf-8'))
     selected=self.skill(host,'install','--names','interaction-design','--platform',platform,'--apply');self.assertTrue(selected['applied'])
     installed=host/folder/'skills/interaction-design/SKILL.md';before=installed.read_bytes();self.assertTrue((installed.parent/'references/interaction-method.md').is_file())
     installed.write_bytes(before+b'\nUSER EDIT')
     self.assertTrue(self.skill(host,'rollback','--transaction',selected['transaction'],'--platform',platform,'--apply',ok=False)['conflicts'])
     self.assertEqual(before+b'\nUSER EDIT',installed.read_bytes());installed.write_bytes(before)
     self.skill(host,'rollback','--transaction',selected['transaction'],'--platform',platform,'--apply');self.assertFalse(installed.exists())
     self.skill(host,'rollback','--transaction',selected_upgrade['transaction'],'--platform',platform,'--apply')
    self.assertEqual(original,frontend.read_bytes())
    self.assertTrue(w.rollback(host,upgrade['transaction'],True)['applied']);self.assertEqual('1.16.0',w.state(host)['version'])
    self.assertEqual(b'PRIVATE CANARY',private.read_bytes());self.assertEqual(authority,(host/'AGENTS.md').read_bytes());self.assertEqual(original,frontend.read_bytes())
if __name__=='__main__':unittest.main()
