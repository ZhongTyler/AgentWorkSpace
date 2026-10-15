"""Font documentation delivery, real predecessor and separate selected-Skill ownership."""
import json,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class FontRelease(unittest.TestCase):
 def skill(self,host,platform,*args,ok=True):
  p=subprocess.run([sys.executable,'-X','utf8','-B',str(host/'modules/skills/scripts/skills.py'),*args,'--target',str(host),'--platform',platform],capture_output=True)
  self.assertEqual(p.returncode==0,ok,(p.stdout+p.stderr).decode('utf8','replace'));return json.loads(p.stdout)
 def test_scope_and_fresh_selected_reference(self):
  current=w.catalog(ROOT)
  old=json.loads(subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'show','v1.18.0:catalog.json']))
  self.assertEqual({'skills','game-presentation'},{k for k,v in current['components'].items() if v['files']!=old['components'][k]['files']})
  reference=ROOT/'packages/skills/library/game-presentation/references/font-selection.md'
  self.assertIn('https://www.maoken.com/',reference.read_text('utf8'))
  self.assertIn('/blob/v1.19.0/packages/skills/library/game-presentation/references/font-selection.md',(ROOT/'packages/game-presentation/workflow.md').read_text('utf8'))
  for component in ['skills','game-presentation']:
   for p in (ROOT/'packages'/component).rglob('*'):
    if not p.is_file():continue
    self.assertNotIn(p.suffix.lower(),['.ttf','.otf','.woff','.woff2'])
    if p.suffix in ['.md','.json']:
     text=p.read_text('utf8')
     for private in [pathlib.Path.home().as_posix(),str(pathlib.Path.home()),ROOT.as_posix(),str(ROOT),'codex://threads/','frontend-before.md','tyler-font-selection:v1']:
      self.assertNotIn(private,text,str(p))
  with tempfile.TemporaryDirectory(prefix='font-fresh-') as tmp:
   host=pathlib.Path(tmp)/'host'
   self.assertTrue(w.install(ROOT,host,'init',['skills','game-presentation'],True)['applied'])
   for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
    self.assertFalse((host/folder/'skills/game-presentation').exists())
    self.assertTrue(self.skill(host,platform,'install','--names','game-presentation','--apply')['applied'])
    self.assertEqual(reference.read_bytes(),(host/folder/'skills/game-presentation/references/font-selection.md').read_bytes())
 def test_real_predecessor_upgrade_conflict_and_reverse(self):
  with tempfile.TemporaryDirectory(prefix='font-upgrade-') as tmp:
   tmp=pathlib.Path(tmp);old=published_bundle(ROOT,'1.18.0',tmp/'old')
   for mode in ['full','compatible']:
    host=tmp/mode;host.mkdir()
    canaries={host/'private.md':b'PRIVATE FONT DECISIONS\r\n',host/'.agents/skills/frontend-design/SKILL.md':b'ORIGINAL THIRD PARTY\nLICENSE\nLOCAL EDITS\n'}
    if mode=='compatible':canaries[host/'AGENTS.md']=b'HOST AUTHORITY\n'
    for p,data in canaries.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    self.assertTrue(w.install(old,host,'init',['skills','game-presentation']+(['meta'] if mode=='compatible' else []),True,mode=mode)['applied'])
    selected={}
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     self.assertTrue(self.skill(host,platform,'install','--names','game-presentation','--apply')['applied'])
     selected[platform]=(host/folder/'skills/game-presentation/SKILL.md').read_bytes()
    package=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(package['applied'])
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     entry=host/folder/'skills/game-presentation/SKILL.md'
     self.assertEqual(selected[platform],entry.read_bytes())
     update=self.skill(host,platform,'upgrade','--apply');self.assertTrue(update['applied'])
     reference=entry.parent/'references/font-selection.md';original=reference.read_bytes()
     reference.write_bytes(original+b'\nUSER EDIT')
     self.assertTrue(self.skill(host,platform,'rollback','--transaction',update['transaction'],'--apply',ok=False)['conflicts'])
     self.assertEqual(original+b'\nUSER EDIT',reference.read_bytes());reference.write_bytes(original)
     self.assertTrue(self.skill(host,platform,'rollback','--transaction',update['transaction'],'--apply')['applied'])
     self.assertEqual(selected[platform],entry.read_bytes());self.assertFalse(reference.exists())
    self.assertTrue(w.rollback(host,package['transaction'],True)['applied']);self.assertEqual('1.18.0',w.state(host)['version'])
    for p,data in canaries.items():self.assertEqual(data,p.read_bytes())
if __name__=='__main__':unittest.main()
