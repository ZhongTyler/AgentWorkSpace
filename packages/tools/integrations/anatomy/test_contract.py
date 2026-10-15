import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec=importlib.util.spec_from_file_location('anatomy',Path(__file__).with_name('anatomy.py'));a=importlib.util.module_from_spec(spec);spec.loader.exec_module(a)
class Contracts(unittest.TestCase):
    def fixture(self,folder,unsafe=False):
        files={n:b'fixture-not-executed' for n in ['SKILL.md','kit/iso-kit.mjs','scripts/inline-kit.mjs','examples/dial-indicator/build.mjs','LICENSE']}
        if unsafe:files['../escape']=b'no'
        (folder/'vendor').mkdir();archive=folder/'vendor/source.zip'
        with zipfile.ZipFile(archive,'w') as z:
            for n,b in files.items():z.writestr('pinned/'+n,b)
        raw=archive.read_bytes();lock={'revision':'fixture','prefix':'pinned/','archive':'vendor/source.zip','bytes':len(raw),'sha256':a.sha(raw),'files':[{'path':n,'bytes':len(b),'sha256':a.sha(b)} for n,b in files.items()]}
        (folder/'source-lock.json').write_text(json.dumps(lock));return archive
    def test_missing_runtime_never_executes(self):
        with tempfile.TemporaryDirectory() as t,patch.object(a.subprocess,'run') as run:
            p=Path(t);self.fixture(p);self.assertEqual(a.status(p)['status'],'unavailable');run.assert_not_called()
    def test_offline_restore_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);self.fixture(p);self.assertEqual(a.restore(p)['status'],'ready');(p/'runtime/upstream/kit/iso-kit.mjs').write_text('changed');self.assertEqual(a.status(p,True)['status'],'unavailable')
    def test_wrong_archive_does_not_create_runtime(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);archive=self.fixture(p);archive.write_bytes(b'changed')
            with self.assertRaises(ValueError):a.restore(p)
            self.assertFalse((p/'runtime/upstream').exists())
    def test_archive_escape_rejected_before_writes(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);self.fixture(p,True)
            with self.assertRaises(ValueError):a.restore(p)
            self.assertFalse((p/'runtime/upstream').exists());self.assertFalse((p/'runtime/escape').exists())
    def test_existing_runtime_preserved(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t);self.fixture(p);a.restore(p);target=p/'runtime/upstream/SKILL.md';before=target.read_bytes()
            with self.assertRaises(ValueError):a.restore(p)
            self.assertEqual(target.read_bytes(),before)
    def test_existing_output_preserved(self):
        with tempfile.TemporaryDirectory() as t,patch.object(a,'status',return_value={'status':'ready'}),patch.object(a.shutil,'which',return_value='node'),patch.object(a.subprocess,'run') as run:
            out=Path(t)/'owned';out.mkdir();(out/'private.txt').write_text('keep')
            with self.assertRaises(ValueError):a.example(out)
            self.assertEqual((out/'private.txt').read_text(),'keep');run.assert_not_called()
    def test_managed_module_restore_refused_without_writes(self):
        with tempfile.TemporaryDirectory() as t:
            p=Path(t)/'modules/tools/integrations/anatomy';p.mkdir(parents=True);self.fixture(p)
            with self.assertRaises(ValueError):a.restore(p)
            self.assertFalse((p/'runtime').exists())
    def test_managed_example_output_refused_without_execution(self):
        with tempfile.TemporaryDirectory() as t,patch.object(a,'status',return_value={'status':'ready'}),patch.object(a.shutil,'which',return_value='node'),patch.object(a.subprocess,'run') as run:
            out=Path(t)/'modules/project/new-output'
            with self.assertRaises(ValueError):a.example(out)
            self.assertFalse(out.exists());run.assert_not_called()
    def test_other_example_name_cannot_be_a_script(self):
        with contextlib.redirect_stderr(io.StringIO()),patch.object(a.subprocess,'run') as run:
            with self.assertRaises(SystemExit) as e:a.main(['example','--name','../../execute','--output','unused'])
            self.assertEqual(e.exception.code,2);run.assert_not_called()
if __name__=='__main__':unittest.main()
