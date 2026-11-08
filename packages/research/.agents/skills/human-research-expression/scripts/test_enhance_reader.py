"""Control-boundary tests; real report/navigation integration is checked separately."""
from pathlib import Path
import json,tempfile,unittest
from unittest.mock import patch
import enhance_reader as E

class Navigation:
    strip_navigation=staticmethod(lambda s:s)
    build=staticmethod(lambda r:{'fixture':True})
class Workflow:
    structural_check=staticmethod(lambda r:{'fixture':True})

class ReaderEdits(unittest.TestCase):
    def setUp(self):
        self.scratch=Path.cwd()/'.tmp';self.scratch.mkdir(exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(prefix='reader-control-test-',dir=self.scratch);self.root=Path(self.temp.name).resolve();self.report=self.root/'report';self.run=self.root/'run';self.stage=self.root/'candidate'
        (self.report/'reader').mkdir(parents=True);self.run.mkdir()
        (self.report/'reader/index.html').write_text('<html><style></style><main><section data-scene="one" id="one"><div class="flow" aria-label="relations"><span>before</span></div></section><section data-scene="two" id="two">keep</section></main></html>',encoding='utf-8')
        E.write(self.report/'reader/navigation.json',{'report_id':'fixture','base_html_sha256':'old'});E.write(self.report/'study.json',{'sections':[{'id':'one'},{'id':'two'}]});(self.report/'evidence.txt').write_bytes(b'protected\r\n')
        (self.run/'part.html').write_text('<div id="example">after</div>',encoding='utf-8');(self.run/'start.js').write_text('window.example=true;',encoding='utf-8')
        E.write(self.run/'plan.json',{'report_id':'fixture','change_kind':'presentation_only','edits':[],'scripts':['start.js']})
        E.write(self.run/'baseline.json',{'report':str(self.report),'files':E.files(self.report)});self.before=E.files(self.report)
        self.stub=patch.object(E,'runtime',return_value=(self.root,Navigation,Workflow));self.stub.start()
    def tearDown(self):
        self.stub.stop();self.assertTrue(self.root.is_relative_to(self.scratch.resolve()));self.temp.cleanup()
    def build(self): return E.build(self.report,self.run,self.stage)
    def test_stage_preserves_protected_and_handles_implicit_body(self):
        out=self.build();self.assertEqual(E.files(self.report),self.before);self.assertEqual(out['changed_sections'],[]);self.assertEqual((self.stage/'evidence.txt').read_bytes(),b'protected\r\n');text=(self.stage/'reader/index.html').read_text();self.assertIn('id="rx-expression-js"',text);self.assertIn('id="two">keep',text)
        with self.assertRaises(ValueError):self.build()
        plan=E.read(self.run/'plan.json');plan['report_id']='wrong';E.write(self.run/'plan.json',plan)
        with self.assertRaises(ValueError):E.build(self.report,self.run,self.root/'new-stage')
        self.assertEqual(E.files(self.report),self.before)
    def test_drift_rejected_and_failed_publish_restores(self):
        self.build();candidate=self.stage/'reader/index.html';good=candidate.read_bytes();candidate.write_bytes(good+b'changed')
        with self.assertRaises(ValueError):E.publish(self.report,self.run)
        self.assertEqual(E.files(self.report),self.before);candidate.write_bytes(good)
        class Failing:
            @staticmethod
            def structural_check(report):raise RuntimeError('intentional failed check')
        with patch.object(E,'runtime',return_value=(self.root,Navigation,Failing)):
            with self.assertRaises(RuntimeError):E.publish(self.report,self.run)
        self.assertEqual(E.files(self.report),self.before)
    def test_publication_and_double_publish_guard(self):
        self.build();E.publish(self.report,self.run);after=E.files(self.report)
        self.assertEqual([p for p in after if after[p]!=self.before[p]],['reader/index.html','reader/navigation.json'])
        with self.assertRaises(ValueError):E.publish(self.report,self.run)
        self.assertEqual(E.files(self.report),after)
    def test_baseline_and_path_guards(self):
        with self.assertRaises(ValueError):E.local(self.run,'../outside')
        (self.report/'evidence.txt').write_text('new owner',encoding='utf-8')
        with self.assertRaises(ValueError):self.build()
        self.assertFalse(self.stage.exists())

    def test_semantic_fragment_or_undeclared_kind_rejected(self):
        plan=E.read(self.run/'plan.json');plan['edits']=[{'section':'one','kind':'append','fragment':'part.html'}];E.write(self.run/'plan.json',plan)
        with self.assertRaisesRegex(ValueError,'authored in study.json'):self.build()
        self.assertFalse(self.stage.exists());self.assertEqual(E.files(self.report),self.before)
        plan['edits']=[];plan.pop('change_kind');E.write(self.run/'plan.json',plan)
        with self.assertRaisesRegex(ValueError,'authored in study.json'):self.build()

if __name__=='__main__':unittest.main()
