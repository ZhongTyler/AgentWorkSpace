"""Optional Tools public source, external ownership and actual predecessor recovery."""
import hashlib,importlib.util,io,json,subprocess,sys,tarfile,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from publish import stage
from release_history import advance_to_predecessor,rollback_history

def module(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class ToolsRelease(unittest.TestCase):
 def test_standalone_compatible_install_requires_no_other_package(self):
  with tempfile.TemporaryDirectory() as tmp:
   host=Path(tmp)/'host';host.mkdir();(host/'AGENTS.md').write_bytes(b'EXISTING AUTHORITY')
   result=w.install(ROOT,host,'init',['tools'],True,mode='compatible');self.assertTrue(result['applied'])
   self.assertEqual({'tools'},set(w.state(host)['components']))
   self.assertEqual(b'EXISTING AUTHORITY',(host/'AGENTS.md').read_bytes())
   self.assertFalse((host/'.codex').exists());self.assertFalse((host/'modules/research').exists())
   tool=module('standalone_toolbox',host/'modules/tools/toolbox.py')
   self.assertEqual('pass',tool.health(integrity=True,base=host/'modules/tools')['status'])
 def test_public_inventory_pins_and_no_local_evidence(self):
  p=ROOT/'packages/tools';profile=json.loads((p/'portable-profile.json').read_text(encoding='utf-8'))
  for name,sha in profile['files'].items():
   self.assertEqual(sha,hashlib.sha256((p/name).read_bytes()).hexdigest(),name)
   self.assertFalse(set(Path(name).parts)&{'runtime','checks','connection-status.json','validation.json','migrations','.tools-home.json'})
  for name in ('source-lock.json','laya-source-lock.json','startlux-source-lock.json'):
   lock=json.loads((p/'integrations/decision-models'/name).read_text(encoding='utf-8'))
   self.assertEqual(lock['archive_sha256'],w.digest((p/'integrations/decision-models'/lock['archive']).read_bytes()))
  self.assertIn('CC BY-NC',(p/'integrations/decision-models/README.md').read_text(encoding='utf-8'))
  lock=json.loads((p/'integrations/decision-models/vendor/model-metadata-lock.json').read_text(encoding='utf-8'))
  for row in lock['files']:self.assertEqual(row['sha256'],w.digest((p/'integrations/decision-models'/row['file']).read_bytes()))
 def test_health_does_not_start_runtime_and_prepare_preserves_existing(self):
  p=ROOT/'packages/tools';tool=module('public_toolbox',p/'toolbox.py');prepare=module('public_prepare',p/'prepare_home.py')
  with patch.object(tool.subprocess,'run') as run:
   result=tool.health(integrity=True,base=p);self.assertEqual('pass',result['status']);self.assertFalse(result['model_loaded_by_check']);run.assert_not_called()
   with self.assertRaises(ValueError):tool.launch('research','decisions','status',[],base=p)
   run.assert_not_called()
  with tempfile.TemporaryDirectory() as tmp:
   home=Path(tmp)/'user-tools-v1';self.assertTrue(prepare.prepare(home,p)['prepared'])
   self.assertFalse(any(home.rglob('runtime')));self.assertFalse((home/'.codex').exists())
   (home/'private.txt').write_bytes(b'KEEP')
   with self.assertRaises(ValueError):prepare.prepare(home,p)
   self.assertEqual(b'KEEP',(home/'private.txt').read_bytes())
   with self.assertRaises(ValueError):prepare.prepare(Path(tmp)/'modules/tools-copy',p)
   (home/'toolbox.py').write_bytes(b'changed')
   self.assertEqual('error',tool.health(integrity=True,base=home)['status'])
 def test_publisher_rejects_private_path_before_reading(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);(p/'release-input').mkdir();(p/'out').mkdir()
   manifest={'release_schema':1,'component_id':'tools','output_path':'packages/tools','copy_files':[{'source':'release-input/curated/integrations/rea/connection-status.json','target':'integrations/rea/connection-status.json','sha256':'0'*64}]}
   (p/'release-input/manifest.json').write_text(json.dumps(manifest))
   with self.assertRaises(w.ContractError):stage(p,p/'out')
 def test_actual_180_upgrade_add_and_reverse_preserve_user_data(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);old=base/'old';old.mkdir()
   raw=subprocess.run(['git','-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v1.8.0'],capture_output=True,check=True).stdout
   with tarfile.open(fileobj=io.BytesIO(raw)) as archive:
    for m in archive:
     if m.isfile():
      path=w.safe(old,m.name);path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(archive.extractfile(m).read())
   for mode in ('full','compatible'):
    host=base/mode
    if mode=='compatible':host.mkdir();(host/'AGENTS.md').write_bytes(b'HOST RULES')
    cmd=[sys.executable,'-X','utf8','-B',str(old/'scripts/workspace.py'),'init','--target',str(host),'--packages','research','--apply']
    if mode=='compatible':cmd+=['--mode',mode]
    r=subprocess.run(cmd,capture_output=True);self.assertEqual(0,r.returncode,r.stderr)
    protected={host/'notes/private.md':b'PRIVATE',host/'tools/existing/runtime/model.bin':b'WEIGHTS',host/'client/config.toml':b'OWN CONFIG'}
    for path,data in protected.items():path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    protected[host/'AGENTS.md']=(host/'AGENTS.md').read_bytes()
    history=advance_to_predecessor(ROOT,host,base/'history'/mode)
    up=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(up['applied'])
    self.assertFalse((host/'modules/tools').exists())
    add=w.install(ROOT,host,'add',['tools'],True);self.assertTrue(add['applied'])
    self.assertTrue((host/'modules/tools/toolbox.py').is_file());self.assertFalse((host/'.codex').exists())
    external=host/'tools/versioned-home'
    prepare=module('prep_'+mode,host/'modules/tools/prepare_home.py');prepare.prepare(external,host/'modules/tools')
    (external/'runtime-marker').write_bytes(b'INDEPENDENT')
    self.assertTrue(w.rollback(host,add['transaction'],True)['applied'])
    self.assertTrue(w.rollback(host,up['transaction'],True)['applied'])
    self.assertEqual(w.catalog(ROOT)['previous_version'],w.state(host)['version'])
    rollback_history(host,history)
    self.assertEqual('1.8.0',w.state(host)['version'])
    self.assertEqual(b'INDEPENDENT',(external/'runtime-marker').read_bytes())
    for path,data in protected.items():self.assertEqual(data,path.read_bytes())

if __name__=='__main__':unittest.main()
