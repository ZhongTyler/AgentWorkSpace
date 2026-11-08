"""Version/coverage regressions for text-primary explanation bindings."""
from pathlib import Path
import tempfile,unittest,json,hashlib
import compile_study as C

class Bindings(unittest.TestCase):
    def setUp(self):
        self.scratch=Path.cwd()/'.tmp';self.scratch.mkdir(exist_ok=True);self.temp=tempfile.TemporaryDirectory(prefix='text-binding-test-',dir=self.scratch);self.report=Path(self.temp.name).resolve();(self.report/'evidence').mkdir();(self.report/'reader').mkdir()
        self.study={'sections':[{'id':'one','explanation_targets':['rx-one']}],'explanation_bindings':'evidence/map.json'};self.bodies={'one':'text master\n'}
        self.write('study.json',self.study);(self.report/'README.md').write_text('text master\n',encoding='utf-8');(self.report/'reader/index.html').write_text('<section data-scene="one" id="one"><div id="rx-one">view</div></section>',encoding='utf-8')
        self.map={'source_study_sha256':C.digest(self.report/'study.json'),'source_readme_sha256':C.digest(self.report/'README.md'),'sections':[{'section_id':'one','source_section_sha256':hashlib.sha256(self.bodies['one'].encode()).hexdigest(),'reader_targets':['rx-one']}]};self.write('evidence/map.json',self.map)
    def write(self,name,value):(self.report/name).write_text(json.dumps(value),encoding='utf-8',newline='\n')
    def check(self):C.verify_explanation_bindings(self.report,self.study,self.bodies)
    def tearDown(self):self.assertTrue(self.report.is_relative_to(self.scratch.resolve()));self.temp.cleanup()
    def test_exact_binding_passes(self):self.check()
    def test_stale_text_identity_rejected(self):
        (self.report/'README.md').write_text('changed',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'stale'):self.check()
    def test_missing_section_or_changed_body_rejected(self):
        self.map['sections']=[];self.write('evidence/map.json',self.map)
        with self.assertRaisesRegex(ValueError,'cover'):self.check()
    def test_source_section_hash_rejected(self):
        self.map['sections'][0]['source_section_sha256']='0'*64;self.write('evidence/map.json',self.map)
        with self.assertRaisesRegex(ValueError,'mapping changed'):self.check()
    def test_lost_reader_component_rejected(self):
        (self.report/'reader/index.html').write_text('<section data-scene="one" id="one">flat text only</section>',encoding='utf-8')
        with self.assertRaisesRegex(ValueError,'missing'):self.check()
    def test_old_master_cannot_drop_existing_bindings(self):
        self.write('evidence/explanation-bindings.json',self.map);self.study={'sections':[{'id':'one'}]}
        with self.assertRaisesRegex(ValueError,'cannot be dropped'):self.check()

if __name__=='__main__':unittest.main()
