"""Portable authorized selection, observation fidelity and real 1.9 recovery."""
import io,json,subprocess,sys,tarfile,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from publish import stage
from test_tools import module
from release_history import advance_to_predecessor, rollback_history, published_bundle

class ModelPolicyRelease(unittest.TestCase):
 def test_shared_policy_and_recipient_authority(self):
  tools=ROOT/'packages/tools/docs/decision-model-policy.md';research=ROOT/'packages/research/templates/decision-model-policy.md'
  self.assertEqual(tools.read_bytes(),research.read_bytes())
  text=tools.read_text(encoding='utf-8')
  for key in ('model_decision','tool_usage','model_policy_review','purpose=noncommercial_research','end-to-end','unknown','four actual'):
   self.assertIn(key,text)
  self.assertIn('Installation does not enable autonomous selection',text)
  self.assertNotIn('用户已授权本工作区',text)
  settings=json.loads((ROOT/'packages/research/proactive/schedule-template.json').read_text(encoding='utf-8'))
  self.assertIn('explicit recipient authorization',settings['model_selection']['activation'])
  for name in ('RESEARCH_PROTOCOL.md','proactive/README.md','proactive/reviews/README.md','game-research/README.md','.agents/skills/research-study/SKILL.md'):
   self.assertIn('decision-model-policy.md',(ROOT/'packages/research'/name).read_text(encoding='utf-8'))
 def test_private_tools_docs_refused_before_reading(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'release-input').mkdir();(p/'out').mkdir()
   (p/'release-input/manifest.json').write_text(json.dumps({'release_schema':1,'component_id':'tools','output_path':'packages/tools','copy_files':[{'source':'release-input/curated/docs/private-state.md','target':'docs/private-state.md','sha256':'0'*64}]}))
   with self.assertRaisesRegex(w.ContractError,'explicit portable policy whitelist'):stage(p,p/'out')
 def test_published_counter_preserves_skip_and_unknown(self):
  review=module('public_model_review',ROOT/'packages/research/proactive/review.py')
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);runs=p/'runs';reviews=p/'reviews';runs.mkdir();reviews.mkdir()
   for route in review.ROUTES:
    for i,stamp in enumerate(('2026-10-12','2026-10-15','2026-10-19','2026-10-22')):
     name=route+stamp;(runs/(name+'.md')).write_text('Synthetic test fixture, not a real research result.')
     row={'schema_version':1,'kind':'weekly_research_run','trigger':'weekly','route':route,'scheduled_date':stamp,'status':'completed','completed_at':stamp+'T20:00:00+08:00','report':name+'.md'}
     if i==0:row.update(model_decision={'action':'skip','backend':None,'reason':'Direct analysis sufficient'},tool_usage=[])
     (runs/(name+'.json')).write_text(json.dumps(row))
   result=review.status(runs,reviews);self.assertEqual('review_due',result['status'])
   first=next(r for r in result['selected_runs'] if r['key']=='research:2026-10-12');missing=next(r for r in result['selected_runs'] if r['key']=='research:2026-10-15')
   self.assertEqual('skip',first['model_decision']['action']);self.assertEqual([],first['tool_usage']);self.assertEqual('unknown',missing['model_decision']);self.assertEqual('unknown',missing['tool_usage'])
 def test_actual_190_policy_upgrade_conflict_and_rollback(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);old=base/'old';old.mkdir()
   raw=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v1.9.0'],capture_output=True,check=True).stdout
   with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    for entry in archive:
     if entry.isfile():
      p=w.safe(old,entry.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(entry).read())
   destination=published_bundle(ROOT,'1.12.0',base/'policy-release')
   for mode in ('full','compatible'):
    host=base/mode
    if mode=='compatible':host.mkdir();(host/'AGENTS.md').write_bytes(b'HOST AUTHORITY')
    args=[sys.executable,'-X','utf8','-B',str(old/'scripts/workspace.py'),'init','--target',str(host),'--packages','research','tools','--apply']
    if mode=='compatible':args+=['--mode',mode]
    r=subprocess.run(args,capture_output=True);self.assertEqual(0,r.returncode,r.stderr)
    keep={host/'research-settings/model-policy.json':b'{"host_owned":true}',host/'research-notes/private.md':b'PRIVATE',host/'client/config.toml':b'OWN CLIENT',host/'AGENTS.md':(host/'AGENTS.md').read_bytes()}
    prepare=module('old_home_'+mode,host/'modules/tools/prepare_home.py');home=host/'tools/existing-v190';prepare.prepare(home,host/'modules/tools')
    keep[home/'runtime/model.bin']=b'USER WEIGHT CANARY';keep[home/'.tools-home.json']=(home/'.tools-home.json').read_bytes()
    for p,data in keep.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    steps=advance_to_predecessor(destination,host,base/('policy-history-'+mode),history_repository=ROOT)
    readme=host/'modules/research/README.md';before=readme.read_bytes()
    self.assertNotEqual(w.digest(before),w.catalog(destination)['components']['research']['files']['README.md'],'Conflict fixture must select an actually changed upstream file')
    readme.write_bytes(before+b'\nLocal conflicting change\n')
    blocked=w.install(destination,host,'upgrade',[],True);self.assertFalse(blocked['applied']);self.assertTrue(blocked['conflicts']);self.assertEqual(w.catalog(destination)['previous_version'],w.state(host)['version'])
    readme.write_bytes(before);result=w.install(destination,host,'upgrade',[],True);self.assertTrue(result['applied'])
    self.assertTrue((host/'modules/tools/docs/decision-model-policy.md').is_file());self.assertTrue((host/'modules/research/templates/decision-model-policy.md').is_file())
    self.assertFalse((host/'.codex').exists())
    for p,data in keep.items():self.assertEqual(data,p.read_bytes())
    self.assertTrue(w.rollback(host,result['transaction'],True)['applied']);self.assertEqual(w.catalog(destination)['previous_version'],w.state(host)['version'])
    rollback_history(host,steps)
    self.assertEqual('1.9.0',w.state(host)['version'])
    self.assertFalse((host/'modules/tools/docs/decision-model-policy.md').exists())
    for p,data in keep.items():self.assertEqual(data,p.read_bytes())

if __name__=='__main__':unittest.main()
