"""Portable abstract explanation routing and actual predecessor upgrade/recovery."""
import hashlib,json,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class AbstractExplanationRelease(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.cache=tempfile.TemporaryDirectory(prefix='abstract-explanation-frozen-')
  cls.bundle=ROOT if w.catalog(ROOT)['version']=='1.20.1' else published_bundle(ROOT,'1.20.1',pathlib.Path(cls.cache.name)/'bundle')
 @classmethod
 def tearDownClass(cls):cls.cache.cleanup()
 def skill(self,host,platform,*args,ok=True):
  r=subprocess.run([sys.executable,'-X','utf8','-B',str(host/'modules/skills/scripts/skills.py'),*args,'--target',str(host),'--platform',platform],capture_output=True)
  self.assertEqual(r.returncode==0,ok,(r.stdout+r.stderr).decode('utf8','replace'));return json.loads(r.stdout)
 def test_scope_routes_and_truth_boundaries(self):
  current=w.catalog(self.bundle);old=json.loads(subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'show','v1.20.0:catalog.json']))
  self.assertEqual({'meta','skills'},{k for k,v in current['components'].items() if v['files']!=old['components'][k]['files']})
  portable=(self.bundle/'packages/skills/library/dual-layer-explainer/SKILL.md').read_text('utf8')
  self.assertEqual(portable,(self.bundle/'meta/workspace/.agents/skills/dual-layer-explainer/SKILL.md').read_text('utf8'))
  for phrase in ['算法与协议','合成输入','示教向量','规则重排','真实模型','同一模型','条件、反例','恢复','不要求安装','interaction-design']:
   self.assertIn(phrase,portable)
  self.assertIn('dual-layer-explainer',(self.bundle/'meta/workspace/AI_INDEX.md').read_text('utf8'))
  self.assertIn('dual-layer-explainer',(self.bundle/'meta/workspace/collaboration/support-and-learning.md').read_text('utf8'))
  listing=json.loads((self.bundle/'packages/skills/skills.json').read_text('utf8'));row=next(x for x in listing['skills'] if x['id']=='dual-layer-explainer')
  self.assertEqual([],row['install_requires']);self.assertEqual(18,len(listing['skills']))
  for component in ['meta/workspace','packages/skills']:
   for p in (self.bundle/component).rglob('*'):
    if not p.is_file():continue
    self.assertFalse(set(p.relative_to(self.bundle).parts)&{'experiments','runtime','runs','raw'})
    if p.suffix.lower() in {'.md','.json','.py'}:
     text=p.read_text('utf8');self.assertNotIn('codex://threads/',text);self.assertNotRegex(text,r'127\.0\.0\.1:\d+')
     self.assertNotRegex(text,r'(?:experiment|explainer)-\d{8}');self.assertNotIn(ROOT.as_posix(),text)
  self.assertFalse((self.bundle/'packages/research/experiments').exists())
 def test_real_1200_package_selected_skill_conflicts_and_reverse(self):
  with tempfile.TemporaryDirectory(prefix='abstract-explanation-upgrade-') as tmp:
   base=pathlib.Path(tmp);old=published_bundle(ROOT,'1.20.0',base/'old')
   for mode in ['full','compatible']:
    host=base/mode;host.mkdir();canaries={host/'private.md':b'PRIVATE ORIGINAL',host/'Wiki/reviewed.md':b'APPROVED KNOWLEDGE',host/'external-tools/runtime/data.bin':b'EXTERNAL RUNTIME'}
    if mode=='compatible':canaries[host/'AGENTS.md']=b'HOST AUTHORITY'
    for p,data in canaries.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    self.assertTrue(w.install(old,host,'init',['skills']+(['meta'] if mode=='compatible' else []),True,mode=mode)['applied'])
    canaries[host/'AGENTS.md']=(host/'AGENTS.md').read_bytes()
    selected={}
    # Full meta already owns its Codex entry; independent selection must refuse that collision.
    platforms=['codebuddy'] if mode=='full' else ['codex','codebuddy']
    if mode=='full':self.assertTrue(self.skill(host,'codex','install','--names','dual-layer-explainer','--apply',ok=False)['conflicts'])
    for platform in platforms:
     self.assertTrue(self.skill(host,platform,'install','--names','dual-layer-explainer','--apply')['applied'])
     folder='.agents' if platform=='codex' else '.codebuddy';selected[platform]=(host/folder/'skills/dual-layer-explainer/SKILL.md').read_bytes()
    changed=host/'modules/skills/library/dual-layer-explainer/SKILL.md';original=changed.read_bytes();changed.write_bytes(original+b'\nUSER PACKAGE EDIT')
    refused=w.install(self.bundle,host,'upgrade',[],True);self.assertTrue(refused['conflicts']);self.assertEqual(original+b'\nUSER PACKAGE EDIT',changed.read_bytes());changed.write_bytes(original)
    tx=w.install(self.bundle,host,'upgrade',[],True);self.assertTrue(tx['applied'])
    method=host/('collaboration/support-and-learning.md' if mode=='full' else 'modules/meta/collaboration/support-and-learning.md')
    self.assertIn('## 机制理解',method.read_text('utf8'))
    if mode=='full':self.assertIn('示教向量',(host/'.agents/skills/dual-layer-explainer/SKILL.md').read_text('utf8'))
    for platform in platforms:
     folder='.agents' if platform=='codex' else '.codebuddy';entry=host/folder/'skills/dual-layer-explainer/SKILL.md'
     self.assertEqual(selected[platform],entry.read_bytes())
     before=entry.read_bytes();entry.write_bytes(before+b'\nUSER SKILL EDIT')
     self.assertTrue(self.skill(host,platform,'upgrade','--apply',ok=False)['conflicts']);self.assertEqual(before+b'\nUSER SKILL EDIT',entry.read_bytes());entry.write_bytes(before)
     update=self.skill(host,platform,'upgrade','--apply');self.assertTrue(update['applied']);self.assertIn('示教向量',entry.read_text('utf8'))
     self.assertFalse((entry.parent.parent/'interaction-design').exists())
     after=entry.read_bytes();entry.write_bytes(after+b'\nUSER LATER EDIT')
     self.assertTrue(self.skill(host,platform,'rollback','--transaction',update['transaction'],'--apply',ok=False)['conflicts']);self.assertEqual(after+b'\nUSER LATER EDIT',entry.read_bytes());entry.write_bytes(after)
     self.assertTrue(self.skill(host,platform,'rollback','--transaction',update['transaction'],'--apply')['applied']);self.assertEqual(before,entry.read_bytes())
    changed=host/'modules/skills/README.md';original=changed.read_bytes();changed.write_bytes(original+b'\nLOCAL EDIT')
    self.assertTrue(w.rollback(host,tx['transaction'],True)['conflicts']);self.assertEqual(original+b'\nLOCAL EDIT',changed.read_bytes());changed.write_bytes(original)
    self.assertTrue(w.rollback(host,tx['transaction'],True)['applied']);self.assertEqual('1.20.0',w.state(host)['version'])
    for p,data in canaries.items():self.assertEqual(data,p.read_bytes())

if __name__=='__main__':unittest.main()
