"""Feedback method routing, selective installation and real predecessor recovery."""
import json,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle
class FeedbackRelease(unittest.TestCase):
 def skill(self,host,*args,ok=True):
  p=subprocess.run([sys.executable,'-X','utf8','-B',str(host/'modules/skills/scripts/skills.py'),*args,'--target',str(host)],capture_output=True)
  if ok:self.assertEqual(0,p.returncode,(p.stdout+p.stderr).decode('utf-8','replace'))
  else:self.assertNotEqual(0,p.returncode)
  return json.loads(p.stdout)
 def test_public_scope_and_single_method(self):
  method=(ROOT/'meta/workspace/collaboration/support-and-learning.md').read_text(encoding='utf-8')
  self.assertIn('## 运行反馈：按需观察、调参与复现',method)
  self.assertIn('分开恢复状态和配置',method)
  skill=(ROOT/'packages/skills/library/feedback-loop/SKILL.md').read_text(encoding='utf-8')
  self.assertIn('/blob/v1.14.1/meta/workspace/collaboration/support-and-learning.md#',skill)
  self.assertNotIn('**分开恢复状态和配置**',skill)
  self.assertIn('modules/meta/collaboration/support-and-learning.md',skill)
  listing=json.loads((ROOT/'packages/skills/skills.json').read_text(encoding='utf-8'))
  row=next(x for x in listing['skills'] if x['id']=='feedback-loop');self.assertEqual([],row['install_requires'])
  for name in ['packages/fromdemotospec/protocols/prototype-workflow.md','packages/game-presentation/workflow.md','packages/research/RESEARCH_PROTOCOL.md','packages/game-project/template/maintenance/workflows/change.md']:
   self.assertIn('feedback-loop',(ROOT/name).read_text(encoding='utf-8'))
  self.assertFalse((ROOT/'packages/research/experiments').exists());self.assertFalse((ROOT/'packages/research/docs').exists())
 def test_1140_upgrade_selection_conflict_and_reverse(self):
  with tempfile.TemporaryDirectory(prefix='aws-feedback-recovery-') as tmp:
   base=pathlib.Path(tmp);old=published_bundle(ROOT,'1.14.0',base/'old');feedback=published_bundle(ROOT,'1.14.1',base/'feedback')
   for mode in ['full','compatible']:
    host=base/mode;host.mkdir();notes=host/'private-research.md';notes.write_bytes(b'PRIVATE CANARY')
    if mode=='compatible':(host/'AGENTS.md').write_bytes(b'EXISTING AUTHORITY')
    packages=['skills','fromdemotospec','game-presentation','research','game-project']+(['meta'] if mode=='compatible' else [])
    self.assertTrue(w.install(old,host,'init',packages,True,mode=mode)['applied'])
    authority=(host/'AGENTS.md').read_bytes();self.assertFalse((host/'.agents/skills/feedback-loop').exists())
    self.assertFalse(w.install(feedback,host,'upgrade',[])['applied'])
    upgraded=w.install(feedback,host,'upgrade',[],True);self.assertTrue(upgraded['applied'])
    self.assertFalse((host/'.agents/skills/feedback-loop').exists())
    self.assertEqual(authority,(host/'AGENTS.md').read_bytes())
    method=host/('collaboration/support-and-learning.md' if mode=='full' else 'modules/meta/collaboration/support-and-learning.md')
    self.assertIn('## 运行反馈',method.read_text(encoding='utf-8'))
    for platform in ['codex','codebuddy']:
     selected=self.skill(host,'install','--names','feedback-loop','--platform',platform,'--apply');self.assertTrue(selected['applied'])
     target=host/('.agents' if platform=='codex' else '.codebuddy')/'skills/feedback-loop/SKILL.md';before=target.read_bytes()
     target.write_bytes(before+b'\nUSER EDIT')
     denied=self.skill(host,'rollback','--transaction',selected['transaction'],'--platform',platform,'--apply',ok=False);self.assertTrue(denied['conflicts']);self.assertEqual(before+b'\nUSER EDIT',target.read_bytes())
     target.write_bytes(before);self.assertTrue(self.skill(host,'rollback','--transaction',selected['transaction'],'--platform',platform,'--apply')['applied']);self.assertFalse(target.exists())
    self.assertTrue(w.rollback(host,upgraded['transaction'],True)['applied']);self.assertEqual('1.14.0',w.state(host)['version']);self.assertEqual(b'PRIVATE CANARY',notes.read_bytes());self.assertEqual(authority,(host/'AGENTS.md').read_bytes())
if __name__=='__main__':unittest.main()
