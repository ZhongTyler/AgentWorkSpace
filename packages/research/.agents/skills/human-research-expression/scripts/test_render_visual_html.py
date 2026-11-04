"""Meaningful production guards; fixtures do not represent research evidence."""
import base64,copy,hashlib,os,sys,tempfile,unittest
from pathlib import Path
from render_visual_html import render

class HtmlProduction(unittest.TestCase):
 def setUp(self):
  self.intended=Path(os.environ.get('HRE_TEST_TMP',tempfile.gettempdir())).resolve()
  self.temp=tempfile.TemporaryDirectory(dir=self.intended);self.root=Path(self.temp.name).resolve()
  if self.root.parent!=self.intended:raise ValueError('Test folder escaped intended temporary root')
  self.image=self.root/'pixel.png';self.image.write_bytes(base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j3ioAAAAASUVORK5CYII='))
  self.digest=hashlib.sha256(self.image.read_bytes()).hexdigest()
  ids=['book-overview','chapter-overview','detail','chapter-summary','book-conclusion']
  roles=['book-overview','chapter-overview','detail','chapter-summary','book-conclusion']
  scenes=[]
  for key,role in zip(ids,roles):
   s=dict(id=key,role=role,title=key,lead='Synthetic fixture',takeaway='No game claim',refs=[],claims=[],limits=[],visual=dict(kind='flow',data=[dict(label='before',value='after')]))
   if key not in ('book-overview','book-conclusion'):s['chapter_id']='chapter'
   scenes.append(s)
  scenes[2]['visual']=dict(kind='evidence_sequence',steps=[dict(title='Fixture',image_path=str(self.image),image_sha256=self.digest,alt='Synthetic pixel',caption='Fixture only',locator='Synthetic',image_size=[1,1],crop=[0,0,1,1])])
  self.spec=dict(title='Synthetic report',edition='Test',intro='No research',source_hashes={str(self.image):self.digest},reference_titles={},evidence_reader='detail.html',scenes=scenes,chapters=[dict(id='chapter',number=1,title='Fixture chapter',question='Test only',overview_id='chapter-overview',detail_ids=['detail'],summary_id='chapter-summary')])
 def tearDown(self):
  if self.root.parent!=self.intended:raise ValueError('Refusing cleanup outside intended temporary root')
  self.temp.cleanup()
 def test_html_without_pdf_or_external_image(self):
  receipt=render(self.spec,self.root/'output');text=(self.root/'output/index.html').read_text(encoding='utf8')
  self.assertIn('src="data:image/png;base64,',text);self.assertNotIn(str(self.image),text)
  self.assertIn('总览 → 1项展开 → 小结',text);self.assertEqual(receipt['format'],'html-only')
  self.assertFalse(list((self.root/'output').rglob('*.pdf')));self.assertNotIn('reportlab',sys.modules)
 def test_changed_evidence_rejected(self):
  self.image.write_bytes(b'changed')
  with self.assertRaisesRegex(ValueError,'Changed input'):render(self.spec,self.root/'changed')
 def test_missing_or_misordered_chapter_rejected(self):
  spec=copy.deepcopy(self.spec);spec['scenes'][1],spec['scenes'][2]=spec['scenes'][2],spec['scenes'][1]
  with self.assertRaisesRegex(ValueError,'order mismatch'):render(spec,self.root/'order')
 def test_crop_cannot_invent_pixels(self):
  spec=copy.deepcopy(self.spec);spec['scenes'][2]['visual']['steps'][0]['crop']=[0,0,2,1]
  with self.assertRaisesRegex(ValueError,'Crop outside original'):render(spec,self.root/'crop')
 def test_generated_identity_collision_rejected(self):
  spec=copy.deepcopy(self.spec);spec['scenes'][1]['id']='detail-image-1';spec['chapters'][0]['overview_id']='detail-image-1'
  with self.assertRaisesRegex(ValueError,'identity collision'):render(spec,self.root/'collision')
 def test_spatial_example_requires_basis_and_rectangular_grid(self):
  spec=copy.deepcopy(self.spec);spec['scenes'][2]['visual']=dict(kind='spatial_states',states=[])
  with self.assertRaisesRegex(ValueError,'needs observed or schematic basis'):render(spec,self.root/'no-basis')
  spec['scenes'][2]['visual']=dict(kind='spatial_states',basis='Synthetic fixture',states=[dict(title='Fixture',alt='Not game evidence',caption='Fixture',rows=[[dict(label='A')],[dict(label='B'),dict(label='C')]])])
  with self.assertRaisesRegex(ValueError,'Ambiguous spatial grid'):render(spec,self.root/'bad-grid')

if __name__=='__main__':unittest.main()
