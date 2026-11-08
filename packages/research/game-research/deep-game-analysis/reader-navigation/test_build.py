"""Provenance guards and reversible compilation; no graphical-browser claims."""
import copy
import json
import tempfile
import unittest
from pathlib import Path
from build import build,sha,strip_navigation,validate_routes
from check import AttributeCheck

class NavigationBuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.report=Path(self.tmp.name)
        (self.report/'reader').mkdir();(self.report/'systems').mkdir()
        self.original='<!doctype html><html><header id="book-cover"></header><main><section id="contents">目录</section><section id="diagram" data-scene>原图解</section><h2 id="detail">原分节</h2></main><script>/*原代码*/</script></html>'
        (self.report/'reader/index.html').write_bytes(self.original.encode())
        source='# 原章\n\n## 原分节\n\n前提与反例。\n'
        (self.report/'systems/01.md').write_bytes(source.encode())
        manifest={'domains':[{'name':'原领域','chapter':'systems/01.md'}],'documents':['systems/01.md'],'sources':[]}
        (self.report/'manifest.json').write_text(json.dumps(manifest),encoding='utf-8')
        self.config={'title':'测试','report_id':'fixture','base_html_sha256':sha(self.original.encode()),'common_links':[{'target':'detail','title':'原分节'}],'routes':[{'id':'one','name':'原领域','intro':'定位','steps':[{'target':'diagram','title':'原图解','focus':'核对前提与反例。','source':{'file':'systems/01.md','heading':'原分节','document_sha256':sha(source.encode()),'section_sha256':sha('## 原分节\n\n前提与反例。'.encode()),'detail_target':'detail','role':'primary'}}]}]}
        self.save()
    def save(self):
        (self.report/'reader/navigation.json').write_text(json.dumps(self.config),encoding='utf-8')
    def test_roundtrip_and_repeat_are_byte_exact(self):
        first=build(self.report)
        self.assertEqual(strip_navigation((self.report/'reader/index.html').read_text(encoding='utf-8')),self.original)
        self.assertEqual(first['html_sha256'],build(self.report)['html_sha256'])
    def test_changed_source_or_report_is_rejected_without_write(self):
        for field,value in [('base_html_sha256','0'*64),('source',None)]:
            config=copy.deepcopy(self.config)
            if field=='source':config['routes'][0]['steps'][0]['source']['document_sha256']='0'*64
            else:config[field]=value
            with self.assertRaises(ValueError):validate_routes(self.report,config,self.original)
        self.assertEqual((self.report/'reader/index.html').read_bytes(),self.original.encode())
    def test_domain_source_roles_and_section_identity_are_checked(self):
        for key,value in [('name','别的领域'),('role','related_section'),('section_sha256','0'*64),('file','reader/navigation.json')]:
            config=copy.deepcopy(self.config)
            if key=='name':config['routes'][0]['name']=value
            else:config['routes'][0]['steps'][0]['source'][key]=value
            with self.assertRaises(ValueError):validate_routes(self.report,config,self.original)
    def test_missing_target_and_empty_focus_are_rejected(self):
        for key,value in [('target','absent'),('focus','')]:
            config=copy.deepcopy(self.config);config['routes'][0]['steps'][0][key]=value
            with self.assertRaises(ValueError):validate_routes(self.report,config,self.original)
    def test_broken_layer_is_not_silently_stripped(self):
        with self.assertRaises(ValueError):strip_navigation('<!--rn:controls:start-->broken')
    def test_guides_are_bound_and_reversible(self):
        build(self.report)
        text=(self.report/'reader/index.html').read_text(encoding='utf-8')
        self.assertIn('data-reader-action="exit"',text)
        self.assertIn('id="rn-guide-diagram"',text)
        self.assertIn('data-route="one" data-step="0" data-target="diagram"',text)
        self.assertEqual(strip_navigation(text),self.original)
    def test_raw_duplicate_id_attributes_are_not_hidden_by_tree_parsing(self):
        invalid='<a href="#generated"><img id="generated" id="scene-photo" src="data:,x"></a>'
        self.assertEqual(AttributeCheck(invalid).repeated,['img'])
        self.assertEqual(AttributeCheck('<img id="scene-photo" src="data:,x"/>').repeated,[])

if __name__=='__main__':unittest.main()
