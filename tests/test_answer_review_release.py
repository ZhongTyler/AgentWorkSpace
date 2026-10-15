"""Actual installed review and selected-Skill upgrade/reverse, without private evidence."""
import importlib.util,io,json,pathlib,subprocess,sys,tarfile,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'));import workspace as w
class AnswerReviewRelease(unittest.TestCase):
 def test_current_scope_and_private_evidence_exclusion(self):
  current=w.catalog(ROOT);old=json.loads(subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'show','v'+current['previous_version']+':catalog.json']))
  self.assertEqual({'knowledge','research','skills'},{k for k,v in current['components'].items() if v['files']!=old['components'][k]['files']})
  for name in ['knowledge','research','skills']:
   for p in (ROOT/'packages'/name).rglob('*'):
    if not p.is_file():continue
    self.assertNotIn('experiments',p.relative_to(ROOT/'packages'/name).parts)
    if p.suffix in ['.md','.json','.mjs','.py']:
     text=p.read_text(encoding='utf-8')
     for secret in [pathlib.Path.home().as_posix(),str(pathlib.Path.home()),ROOT.as_posix(),str(ROOT),'codex://threads/','PRIVATE-RESEARCH-CANARY','LOCAL_ONLY_RESPONSE_FIXTURE']:self.assertNotIn(secret,text,str(p))
 def test_installed_read_only_review_and_legacy_contracts(self):
  with tempfile.TemporaryDirectory(prefix='answer-review-install-') as tmp:
   host=pathlib.Path(tmp)/'host';self.assertTrue(w.install(ROOT,host,'init',['knowledge','research','skills'],True)['applied'])
   k=host/'modules/knowledge'
   for rel in ['tests/answer-review.contract.mjs','system/query/query-evidence-check.mjs']:
    p=subprocess.run(['node',str(k/rel)],capture_output=True);self.assertEqual(0,p.returncode,p.stderr.decode(errors='replace'));self.assertIn(b'"checks":',p.stdout)
   self.assertTrue((k/'system/query/answer-review.md').is_file())
 def test_selected_skill_upgrade_reverse_and_private_canaries(self):
  with tempfile.TemporaryDirectory(prefix='answer-review-upgrade-') as temp:
   temp=pathlib.Path(temp);old=temp/'old';old.mkdir();raw=subprocess.check_output(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v'+w.catalog(ROOT)['previous_version']])
   with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    for item in archive:
     if item.isfile():p=w.safe(old,item.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(item).read())
   spec=importlib.util.spec_from_file_location('before_answer_review',old/'scripts/workspace.py');prior=importlib.util.module_from_spec(spec);spec.loader.exec_module(prior)
   for platform in ['codex','codebuddy']:
    host=temp/platform;self.assertTrue(prior.install(old,host,'init',['knowledge','research','skills'],True)['applied'])
    def skill(*args):
     p=subprocess.run([sys.executable,'-X','utf8','-B',str(host/'modules/skills/scripts/skills.py'),*map(str,args),'--platform',platform],capture_output=True)
     self.assertEqual(0,p.returncode,p.stderr.decode(errors='replace'));return json.loads(p.stdout)
    skill('install','--target',host,'--names','game-decision-support','--apply')
    selected=host/('.agents' if platform=='codex' else '.codebuddy')/'skills/game-decision-support/SKILL.md';original=selected.read_bytes()
    canaries={host/'modules/knowledge/wiki/private.md':b'PRIVATE RAW\r\n',host/'modules/knowledge/system/query/retrieval.local.json':b'{"private":"binding"}',host/'private-review.json':b'ORIGINAL AUDIT\r\n'}
    for p,data in canaries.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    authority=(host/'AGENTS.md').read_bytes();up=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(up['applied']);self.assertEqual(original,selected.read_bytes())
    chosen=skill('upgrade','--target',host,'--apply');self.assertNotEqual(original,selected.read_bytes())
    self.assertTrue(skill('rollback','--target',host,'--transaction',chosen['transaction'],'--apply')['applied']);self.assertEqual(original,selected.read_bytes())
    self.assertTrue(w.rollback(host,up['transaction'],True)['applied']);self.assertEqual(authority,(host/'AGENTS.md').read_bytes())
    for p,data in canaries.items():self.assertEqual(data,p.read_bytes())
if __name__=='__main__':unittest.main()
