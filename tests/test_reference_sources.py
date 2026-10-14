import importlib.util,io,json,subprocess,tarfile,tempfile,types,unittest
from pathlib import Path
from unittest.mock import patch
import sys
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from publish import stage
def module(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class ReferenceSources(unittest.TestCase):
    def test_actual_1110_upgrade_conflict_and_rollback_preserve_external_homes(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);old=base/'previous';old.mkdir()
            raw=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v1.11.0'],capture_output=True,check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                for m in archive:
                    if m.isfile():
                        p=w.safe(old,m.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(m).read())
            # This historical test covers reference-library introduction in 1.12.0.
            # The generic predecessor test separately covers the current release.
            destination=ROOT
            if w.catalog(ROOT)['version']!='1.12.0':
                destination=base/'reference-release';destination.mkdir()
                raw=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v1.12.0'],capture_output=True,check=True).stdout
                with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                    for m in archive:
                        if m.isfile():
                            p=w.safe(destination,m.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(m).read())
            for mode in ('full','compatible'):
                host=base/mode
                if mode=='compatible':host.mkdir();(host/'AGENTS.md').write_bytes(b'EXISTING HOST AUTHORITY')
                args=[sys.executable,'-X','utf8','-B',str(old/'scripts/workspace.py'),'init','--target',str(host),'--packages','research','tools','--apply']
                if mode=='compatible':args+=['--mode',mode]
                result=subprocess.run(args,capture_output=True);self.assertEqual(0,result.returncode,result.stderr)
                keep={host/'AGENTS.md':(host/'AGENTS.md').read_bytes(),host/'notes/private.md':b'PRIVATE',host/'references-old/runtime/archive.bin':b'OLD PINNED ARCHIVE',host/'tools-old/runtime/model.bin':b'USER WEIGHTS',host/'client/config.toml':b'CLIENT CONFIG',host/'research-runs/old.json':b'OLD TRACE'}
                for p,content in keep.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(content)
                changed=host/'modules/research/README.md';original=changed.read_bytes();changed.write_bytes(original+b'\nLOCAL CHANGE')
                blocked=w.install(destination,host,'upgrade',[],True);self.assertFalse(blocked['applied']);self.assertTrue(blocked['conflicts']);self.assertEqual('1.11.0',w.state(host)['version'])
                changed.write_bytes(original)
                upgraded=w.install(destination,host,'upgrade',[],True);self.assertTrue(upgraded['applied']);self.assertEqual('1.12.0',w.state(host)['version'])
                refs=host/'modules/research/reference-library';self.assertFalse((refs/'runtime').exists())
                home=host/'references-new';module('upgraded_ref_prepare_'+mode,refs/'prepare_home.py').prepare(home,refs)
                (home/'my-note.txt').write_bytes(b'KEEP NEW HOME')
                self.assertTrue(w.rollback(host,upgraded['transaction'],True)['applied']);self.assertEqual('1.11.0',w.state(host)['version'])
                self.assertEqual(b'KEEP NEW HOME',(home/'my-note.txt').read_bytes())
                self.assertFalse((host/'modules/research/reference-library/README.md').exists())
                for p,content in keep.items():self.assertEqual(content,p.read_bytes())
    def test_reference_install_is_metadata_only_and_external_home_survives_rollback(self):
        with tempfile.TemporaryDirectory() as t:
            host=Path(t)/'host';host.mkdir();(host/'AGENTS.md').write_bytes(b'HOST AUTHORITY')
            installed=w.install(ROOT,host,'init',['research','tools'],True,mode='compatible')
            base=host/'modules/research/reference-library';prepare=module('installed_ref_prepare',base/'prepare_home.py')
            home=host/'references-v1';self.assertTrue(prepare.prepare(home,base)['prepared'])
            (home/'user-note.md').write_bytes(b'PRIVATE NOTE')
            self.assertFalse((base/'runtime').exists());self.assertFalse((home/'runtime').exists());self.assertFalse((host/'.codex').exists())
            self.assertTrue(w.rollback(host,installed['transaction'],True)['applied'])
            self.assertEqual(b'PRIVATE NOTE',(home/'user-note.md').read_bytes());self.assertEqual(b'HOST AUTHORITY',(host/'AGENTS.md').read_bytes())
    def test_flux_maintenance_is_complete_but_does_not_start_or_download(self):
        base=ROOT/'packages/tools';tool=module('new_toolbox',base/'toolbox.py')
        with patch.object(tool.subprocess,'run') as run:
            self.assertEqual('pass',tool.health(integrity=True,base=base)['status']);run.assert_not_called()
        flux=base/'integrations/flux-klein';generate=module('new_flux_generate',flux/'generate.py')
        with patch.object(generate,'api') as api:
            with self.assertRaisesRegex(ValueError,'external Tools home'):generate.generate(None)
            api.assert_not_called()
        self.assertFalse((flux/'runtime').exists());self.assertEqual(3,len(json.loads((flux/'source-lock.json').read_text())['models']))
        cutout=base/'integrations/cutout';pil=types.ModuleType('PIL');pil.Image=object()
        with patch.dict(sys.modules,{'cv2':types.ModuleType('cv2'),'numpy':types.ModuleType('numpy'),'onnxruntime':types.ModuleType('onnxruntime'),'PIL':pil}):
            segment=module('new_cutout_guard',cutout/'cutout.py')
            with self.assertRaisesRegex(ValueError,'external Tools home'):segment.Cutout()
        self.assertFalse((cutout/'runtime').exists());self.assertNotIn('download_seconds',json.loads((cutout/'source-lock.json').read_text()))
    def test_selected_closure_skill_upgrade_conflict_and_reverse(self):
        with tempfile.TemporaryDirectory() as t:
            base=Path(t);old=base/'old';old.mkdir();host=base/'host'
            raw=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v1.11.0','packages/skills'],capture_output=True,check=True).stdout
            with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
                for m in archive:
                    if m.isfile():
                        p=w.safe(old,m.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(m).read())
            prior=old/'packages/skills';current=ROOT/'packages/skills'
            def run(bundle,*args):
                r=subprocess.run([sys.executable,'-X','utf8','-B',str(bundle/'scripts/skills.py'),*args,'--target',str(host)],capture_output=True)
                return r,json.loads(r.stdout)
            r,_=run(prior,'install','--names','workflow-closure','--apply');self.assertEqual(0,r.returncode)
            skill=host/'.agents/skills/workflow-closure/SKILL.md';before=skill.read_bytes();skill.write_bytes(before+b'\nLOCAL EDIT')
            r,blocked=run(current,'upgrade','--apply');self.assertNotEqual(0,r.returncode);self.assertTrue(blocked['conflicts'])
            skill.write_bytes(before);r,upgraded=run(current,'upgrade','--apply');self.assertEqual(0,r.returncode);self.assertTrue(upgraded['applied']);self.assertNotEqual(before,skill.read_bytes())
            self.assertIn('异步',skill.read_text(encoding='utf-8'))
            r,back=run(current,'rollback','--transaction',upgraded['transaction'],'--apply');self.assertEqual(0,r.returncode);self.assertTrue(back['applied']);self.assertEqual(before,skill.read_bytes())
    def test_publisher_rejects_reference_private_receipt_and_runtime_before_read(self):
        for target in ('reference-library/capture-20261014.json','reference-library/runtime/source/a','reference-library/integration-check-20261014.json'):
            with tempfile.TemporaryDirectory() as t:
                base=Path(t);(base/'release-input').mkdir();(base/'out').mkdir()
                (base/'release-input/manifest.json').write_text(json.dumps({'release_schema':1,'component_id':'research','output_path':'packages/research','copy_files':[{'source':'release-input/curated/'+target,'target':target,'sha256':'0'*64}]}))
                with self.assertRaises(w.ContractError):stage(base,base/'out')

if __name__=='__main__':unittest.main()
