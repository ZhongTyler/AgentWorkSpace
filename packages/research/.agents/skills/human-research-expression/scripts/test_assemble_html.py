"""Identity and byte-preservation regressions for the HTML-only assembler."""
import unittest
from html.parser import HTMLParser
from assemble_html import bind_zoom_targets

class Elements(HTMLParser):
 def __init__(self,source):
  super().__init__();self.items=[];self.feed(source)
 def handle_starttag(self,tag,attrs):self.items.append((tag,attrs))

class ZoomIdentity(unittest.TestCase):
 def test_existing_image_id_and_encoded_bytes_survive(self):
  image='<img id="scene-photo" src="data:image/jpeg;base64,/9j/ABC=" alt="证据">'
  original='<a href="../evidence.jpg" class="zoom crop">'+image+'</a>'
  result=bind_zoom_targets(original)
  self.assertIn(image,result)
  self.assertIn('href="#scene-photo"',result)
  self.assertEqual(Elements(result).items[1][1],Elements(original).items[1][1])

 def test_generated_id_skips_existing_ids_and_links_resolve(self):
  source='<section id="report-image-1"></section><a class="zoom" href="a.jpg"><img src="data:image/jpeg;base64,AAA="></a><a class="zoom" href="b.jpg"><img src="data:image/jpeg;base64,BBB="></a>'
  result=Elements(bind_zoom_targets(source)).items
  ids=[v for _,attrs in result for k,v in attrs if k=='id']
  self.assertEqual(ids,['report-image-1','report-image-2','report-image-3'])
  targets=[v[1:] for tag,attrs in result if tag=='a' for k,v in attrs if k=='href']
  self.assertEqual(targets,['report-image-2','report-image-3'])
  self.assertTrue(set(targets)<=set(ids))

 def test_reject_ambiguous_identity_before_assembly(self):
  for source in ['<img id="a" id="b" src="data:,x">','<p id="a"></p><img id="a" src="data:,x">']:
   with self.subTest(source=source),self.assertRaises(ValueError):bind_zoom_targets(source)

if __name__=='__main__':unittest.main()
