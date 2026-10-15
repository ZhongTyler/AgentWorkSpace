"""Verify the producer-to-consumer handoff, with synthetic disposable fixtures."""
import json,pathlib,tempfile,unittest
from PIL import Image
from prepare import prepare,sha

class ConsumerContracts(unittest.TestCase):
 def setUp(self):
  fixtures=pathlib.Path(__file__).resolve().parent/'runtime/test-fixtures';fixtures.mkdir(parents=True,exist_ok=True)
  self.tmp=tempfile.TemporaryDirectory(dir=fixtures);self.root=pathlib.Path(self.tmp.name).resolve()
  if not self.root.is_relative_to(fixtures.resolve()):raise ValueError('Fixture escaped')
  self.batch=self.root/'batch';self.batch.mkdir()
  source=self.batch/'source.png';candidate=self.batch/'candidate.png';view=self.batch/'preview.png'
  for p,size in [(source,(256,256)),(candidate,(64,64)),(view,(128,64))]:Image.new('RGBA',size,'red').save(p)
  stage={'outputs':[{'path':str(view),'sha256':sha(view)}]};view.with_suffix('.stage.json').write_text(json.dumps(stage))
  self.data={'status':'awaiting_visual_review','project_adopted':False,'request':{'profile_version':'test','assets':[{'id':'key','profile':'flux','prompt':'one key','target_size':[64,64]}]},'assets':{'key':{'source':str(source),'source_sha256':sha(source),'candidate':str(candidate),'candidate_sha256':sha(candidate),'preview':str(view),'stages':[stage]}}}
  self.path=self.batch/'batch.json';self.write();self.output=self.root/'review'
 def tearDown(self):self.tmp.cleanup()
 def write(self):self.path.write_text(json.dumps(self.data),encoding='utf-8')
 def test_actual_files_preserved_and_not_adopted(self):
  record=prepare(self.path,self.output);self.assertFalse(record['engine_modified']);self.assertFalse(record['adopted'])
  g=json.loads((self.output/'generation.json').read_text());self.assertEqual(g['kind'],'generated');self.assertFalse(g['rights_verified']);self.assertFalse(g['project_adopted'])
  item=g['assets'][0];self.assertEqual(sha(self.output/item['file']['path']),self.data['assets']['key']['source_sha256']);self.assertNotEqual(item['file']['sha256'],item['candidate']['sha256'])
  with self.assertRaises(FileExistsError):prepare(self.path,self.output)
 def test_incomplete_refused_before_writing(self):
  self.data['status']='partial';self.write()
  with self.assertRaises(ValueError):prepare(self.path,self.output)
  self.assertFalse(self.output.exists())
 def test_changed_candidate_refused_before_writing(self):
  pathlib.Path(self.data['assets']['key']['candidate']).write_bytes(b'changed')
  with self.assertRaises(ValueError):prepare(self.path,self.output)
  self.assertFalse(self.output.exists())
 def test_preview_drift_refused_before_writing(self):
  pathlib.Path(self.data['assets']['key']['preview']).write_bytes(b'changed')
  with self.assertRaises(ValueError):prepare(self.path,self.output)
  self.assertFalse(self.output.exists())
 def test_escaped_media_refused_before_writing(self):
  p=self.root/'foreign.png';Image.new('RGB',(64,64)).save(p);self.data['assets']['key'].update(candidate=str(p),candidate_sha256=sha(p));self.write()
  with self.assertRaises(ValueError):prepare(self.path,self.output)
  self.assertFalse(self.output.exists())

if __name__=='__main__':unittest.main()
