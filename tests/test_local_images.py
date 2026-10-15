"""Portable image workflow: real install, source-only execution and predecessor recovery."""
import hashlib,json,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle
from publish import stage
class LocalImages(unittest.TestCase):
 def test_image_report_whitelist_does_not_allow_arbitrary_tool_notes(self):
  with tempfile.TemporaryDirectory() as tmp:
   root=pathlib.Path(tmp);(root/'release-input').mkdir();out=root/'out';out.mkdir()
   d={'release_schema':1,'component_id':'tools','output_path':'packages/tools','copy_files':[{'source':'release-input/curated/docs/private-trial.md','target':'docs/private-trial.md','sha256':'0'*64}]}
   (root/'release-input/manifest.json').write_text(json.dumps(d))
   with self.assertRaisesRegex(w.ContractError,'explicit portable policy whitelist'):stage(root,out)
 def command(self,*args):
  p=subprocess.run([str(a) for a in args],capture_output=True)
  self.assertEqual(p.returncode,0,(p.stdout+p.stderr).decode('utf-8','replace')[-2000:]);return json.loads(p.stdout)
 def test_fixed_components_and_limits_without_private_runtime(self):
  tools=ROOT/'packages/tools';registry=json.loads((tools/'registry.json').read_text());ids={r['id'] for r in registry['tools']}
  self.assertIn('local-image',ids);self.assertNotIn('gamehot',ids)
  for r in registry['tools']:
   for name in r['required_sources']:self.assertTrue((tools/r['root']/name).is_file(),(r['id'],name))
  suite=json.loads((tools/'integrations/image-extension-suite/source-lock.json').read_text());self.assertEqual({'G','H'},set(suite['verified_components_by_stage']))
  for stage in suite['verified_components_by_stage'].values():
   for r in stage:self.assertNotIn('target',r);self.assertEqual(64,len(r['sha256']))
  text=(tools/'docs/local-image-validation.md').read_text(encoding='utf-8')
  for marker in ['SANA','未评','SDXL','stable-diffusion.cpp','Anima','提交','unknown']:self.assertIn(marker,text)
  self.assertFalse(any(p.is_dir() and p.name=='runtime' for p in tools.rglob('*')))
 def test_fresh_install_actual_png_review_and_selective_skill(self):
  from PIL import Image
  with tempfile.TemporaryDirectory(prefix='aws-local-image-') as tmp:
   host=pathlib.Path(tmp)/'host';host.mkdir();(host/'AGENTS.md').write_bytes(b'OWN AUTHORITY')
   w.install(ROOT,host,'init',['tools','game-presentation','skills'],True,mode='compatible')
   tools=host/'modules/tools';home=host/'external/tools-v1';self.command(sys.executable,tools/'prepare_home.py','--home',home)
   self.assertFalse(any(home.rglob('runtime')))
   source=host/'external/source.png';Image.new('RGBA',(256,256),(12,45,78,255)).save(source);original=source.read_bytes()
   request=host/'external/request.json';request.write_text(json.dumps({'schema_version':1,'assets':[{'id':'owned-png','profile':'flux','prompt':'Existing owned PNG','width':256,'height':256,'seed':1,'source':str(source),'target_size':[32,32]}]}))
   batch=host/'external/batch';result=self.command(sys.executable,home/'integrations/local-image/pipeline.py','run','--request',request,'--output',batch)
   self.assertEqual('awaiting_visual_review',result['status']);self.assertFalse(result['project_adopted'])
   candidate=batch/'candidates/owned-png.png';digest=w.digest(candidate.read_bytes())
   self.command(sys.executable,home/'integrations/local-image/pipeline.py','run','--request',request,'--output',batch,'--resume');self.assertEqual(digest,w.digest(candidate.read_bytes()))
   gp=host/'modules/game-presentation';review=host/'external/review';self.command(sys.executable,gp/'adapters/local-image/prepare.py','--batch',batch/'batch.json','--output',review)
   receipt=json.loads((review/'generation.json').read_text());self.assertFalse(receipt['rights_verified']);self.assertFalse(receipt['project_adopted']);self.assertEqual(original,source.read_bytes())
   selected=self.command(sys.executable,host/'modules/skills/scripts/skills.py','install','--target',host,'--names','game-presentation','--apply');self.assertTrue(selected['applied'])
   self.assertEqual(['game-presentation'],sorted(p.name for p in (host/'.agents/skills').iterdir()));self.assertEqual(b'OWN AUTHORITY',(host/'AGENTS.md').read_bytes())
 def test_real_1131_upgrade_conflict_and_reverse_preserve_external_state(self):
  with tempfile.TemporaryDirectory(prefix='aws-image-upgrade-') as tmp:
   base=pathlib.Path(tmp);old=published_bundle(ROOT,'1.13.1',base/'old')
   for mode in ['full','compatible']:
    host=base/mode;host.mkdir();(host/'private.txt').write_bytes(b'KEEP')
    if mode=='compatible':(host/'AGENTS.md').write_bytes(b'OWN RULES')
    w.install(old,host,'init',['tools','game-presentation','skills'],True,mode=mode)
    selected_script=host/'modules/skills/scripts/skills.py';self.command(sys.executable,selected_script,'install','--target',host,'--names','game-presentation','--apply')
    selected_path=host/'.agents/skills/game-presentation/SKILL.md';selected_before=selected_path.read_bytes()
    authority=(host/'AGENTS.md').read_bytes();external=host/'outside/model.bin';external.parent.mkdir();external.write_bytes(b'EXTERNAL RUNTIME')
    result=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(result['applied'])
    self.assertEqual(selected_before,selected_path.read_bytes())
    selected_path.write_bytes(selected_before+b'\nUSER SKILL EDIT')
    denied=subprocess.run([sys.executable,str(selected_script),'upgrade','--target',str(host),'--names','game-presentation','--apply'],capture_output=True)
    self.assertNotEqual(0,denied.returncode);self.assertTrue(json.loads(denied.stdout)['conflicts']);self.assertEqual(selected_before+b'\nUSER SKILL EDIT',selected_path.read_bytes());selected_path.write_bytes(selected_before)
    updated=self.command(sys.executable,selected_script,'upgrade','--target',host,'--names','game-presentation','--apply');self.assertTrue(updated['applied']);self.assertIn('local-image',selected_path.read_text(encoding='utf-8'))
    self.command(sys.executable,selected_script,'rollback','--target',host,'--transaction',updated['transaction'],'--apply');self.assertEqual(selected_before,selected_path.read_bytes())
    doc=host/'modules/game-presentation/local-image-workflow.md';original=doc.read_bytes();doc.write_bytes(b'USER EDIT')
    self.assertTrue(w.rollback(host,result['transaction'])['conflicts']);self.assertEqual(b'USER EDIT',doc.read_bytes());doc.write_bytes(original)
    self.assertTrue(w.rollback(host,result['transaction'],True)['applied']);self.assertEqual('1.13.1',w.state(host)['version']);self.assertEqual(authority,(host/'AGENTS.md').read_bytes());self.assertEqual(b'KEEP',(host/'private.txt').read_bytes());self.assertEqual(b'EXTERNAL RUNTIME',external.read_bytes());self.assertFalse(doc.exists())
if __name__=='__main__':unittest.main()
