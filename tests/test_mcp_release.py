"""Frozen 1.21.0 scope, inert installation and immediate-predecessor recovery."""
import hashlib,json,pathlib,subprocess,sys,tempfile,unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from publish import stage
from release_history import published_bundle
class MCPRelease(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.temp=tempfile.TemporaryDirectory(prefix='mcp-public-')
  cls.bundle=ROOT if w.catalog(ROOT)['version']=='1.21.0' else published_bundle(ROOT,'1.21.0',pathlib.Path(cls.temp.name)/'frozen')
 @classmethod
 def tearDownClass(cls):cls.temp.cleanup()
 def test_only_tools_inventory_changes_and_no_private_runtime(self):
  current=w.catalog(self.bundle)
  old=json.loads(subprocess.check_output(['git','-C',str(ROOT),'show','v1.20.1:catalog.json']))
  self.assertEqual({'tools'},{k for k,v in current['components'].items() if v['files']!=old['components'][k]['files']})
  p=self.bundle/'packages/tools/integrations/mcp/demand'
  wanted={'README.md','demand_fixture.py','test_portable.py','demand_portable_install.py','demand_common.py','demand_admin.py','demand_broker.py','demand_plugin.py','demand_http.py','demand_http_headers.py','demand_http_spawn.ps1'}
  self.assertEqual(wanted,{f.name for f in p.iterdir()})
  for f in p.iterdir():
   text=f.read_text('utf8')
   for private in ['codex://threads/',str(pathlib.Path.home()),'E:/TylerWorkSpace']:
    self.assertNotIn(private,text)
 def test_publisher_rejects_real_state_before_reading_content(self):
  for name in ['profiles.dpapi','token.dpapi','http.dpapi','changes.dpapi','events.jsonl','catalogs/real.json','plugin-review.json']:
   with self.subTest(name=name),tempfile.TemporaryDirectory() as t:
    base=pathlib.Path(t);(base/'release-input').mkdir();out=base/'out';out.mkdir()
    target='integrations/mcp/demand/'+name
    manifest={'release_schema':1,'component_id':'tools','output_path':'packages/tools','copy_files':[{'source':'release-input/curated/'+target,'target':target,'sha256':'0'*64}]}
    (base/'release-input/manifest.json').write_text(json.dumps(manifest))
    with self.assertRaisesRegex(w.ContractError,'reviewed source only'):stage(base,out)
 def test_fresh_compatible_install_and_readonly_plan(self):
  with tempfile.TemporaryDirectory() as t:
   base=pathlib.Path(t);host=base/'host';host.mkdir();(host/'AGENTS.md').write_bytes(b'HOST AUTHORITY')
   self.assertTrue(w.install(self.bundle,host,'init',['tools'],True,mode='compatible')['applied'])
   p=host/'modules/tools'
   self.assertFalse((host/'.codex').exists());self.assertEqual(b'HOST AUTHORITY',(host/'AGENTS.md').read_bytes())
   home=base/'tools-source-v121'
   r=subprocess.run([sys.executable,'-X','utf8','-B',str(p/'prepare_home.py'),'--home',str(home)],capture_output=True)
   self.assertEqual(0,r.returncode,r.stderr)
   self.assertFalse(any(home.rglob('*.dpapi')));self.assertFalse(any(home.rglob('runtime')))
   self.assertTrue((home/'integrations/mcp/demand/demand_portable_install.py').is_file())
 def test_actual_predecessor_upgrade_conflict_and_reverse_preserve_runtime(self):
  with tempfile.TemporaryDirectory() as t:
   base=pathlib.Path(t);old=published_bundle(ROOT,'1.20.1',base/'old')
   for mode in ['full','compatible']:
    host=base/mode;host.mkdir()
    if mode=='compatible':(host/'AGENTS.md').write_bytes(b'OWN HOST')
    self.assertTrue(w.install(old,host,'init',['tools'],True,mode=mode)['applied'])
    protected={host/'AGENTS.md':(host/'AGENTS.md').read_bytes(),host/'private/notes.md':b'PRIVATE',host/'.codex/config.toml':b'OWN CLIENT',host/'external/runtime/value.bin':b'EXISTING'}
    for path,data in protected.items():path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(data)
    guide=host/'modules/tools/README.md';original=guide.read_bytes();guide.write_bytes(original+b'\nUSER EDIT')
    denied=w.install(self.bundle,host,'upgrade',[],True);self.assertTrue(denied['conflicts']);self.assertEqual(original+b'\nUSER EDIT',guide.read_bytes())
    guide.write_bytes(original)
    up=w.install(self.bundle,host,'upgrade',[],True);self.assertTrue(up['applied'])
    self.assertEqual('1.21.0',w.state(host)['version'])
    self.assertFalse(any((host/'modules/tools').rglob('*.dpapi')))
    after=guide.read_bytes();guide.write_bytes(after+b'\nNEW EDIT')
    self.assertTrue(w.rollback(host,up['transaction'],True)['conflicts']);guide.write_bytes(after)
    self.assertTrue(w.rollback(host,up['transaction'],True)['applied']);self.assertEqual('1.20.1',w.state(host)['version'])
    for path,data in protected.items():self.assertEqual(data,path.read_bytes())

if __name__=='__main__':unittest.main()
