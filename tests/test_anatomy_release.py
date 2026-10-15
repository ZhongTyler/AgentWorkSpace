"""Anatomy fixed source, real recipient use, separate Skill ownership and recovery."""
import hashlib,json,pathlib,shutil,subprocess,sys,tempfile,unittest,zipfile
ROOT=pathlib.Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle
from publish import stage

class AnatomyRelease(unittest.TestCase):
 def cli(self,script,*args,ok=True):
  r=subprocess.run([sys.executable,'-X','utf8','-B',str(script),*map(str,args)],capture_output=True,timeout=180)
  self.assertEqual(r.returncode==0,ok,(r.stdout+r.stderr).decode('utf8','replace'));return json.loads(r.stdout) if r.stdout else None
 def skill(self,host,platform,*args,ok=True):return self.cli(host/'modules/skills/scripts/skills.py',*args,'--target',host,'--platform',platform,ok=ok)
 def test_public_scope_and_pinned_archive(self):
  current=w.catalog(ROOT);old=json.loads(subprocess.check_output(['git','-C',str(ROOT),'show','v1.19.0:catalog.json']))
  self.assertEqual({'tools','skills'},{k for k,v in current['components'].items() if v['files']!=old['components'][k]['files']})
  source=ROOT/'packages/tools/integrations/anatomy';lock=json.loads((source/'source-lock.json').read_text('utf8'));archive=source/lock['archive']
  self.assertEqual(lock['sha256'],hashlib.sha256(archive.read_bytes()).hexdigest());self.assertEqual(lock['bytes'],archive.stat().st_size)
  with zipfile.ZipFile(archive) as z:
   actual={n[len(lock['prefix']):]:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist() if not n.endswith('/')}
   self.assertEqual({r['path']:r['sha256'] for r in lock['files']},actual);self.assertEqual(147,len(actual));self.assertEqual((source/'vendor/LICENSE.txt').read_bytes(),z.read(lock['prefix']+'LICENSE'))
  for package in ['tools','skills']:
   for p in (ROOT/'packages'/package).rglob('*'):
    if not p.is_file():continue
    self.assertFalse(set(p.relative_to(ROOT).parts)&{'runtime','experiments','project-snapshot','validation.json','browser-receipt.json'})
    if p.suffix.lower() not in ['.zip','.tgz','.gz','.png','.jpg']:
     text=p.read_text('utf8')
     self.assertNotRegex(text,r'\bV-\d{3}\b');self.assertNotRegex(text,r'(?:anatomy|experiment)-\d{8}')
     for value in ['codex://threads/',str(pathlib.Path.home()),ROOT.as_posix(),str(ROOT)]:
      self.assertNotIn(value,text,str(p))
 def test_fresh_external_restore_actual_build_and_boundaries(self):
  with tempfile.TemporaryDirectory(prefix='anatomy-recipient-') as tmp:
   base=pathlib.Path(tmp);host=base/'host';host.mkdir();(host/'AGENTS.md').write_bytes(b'HOST AUTHORITY')
   self.assertTrue(w.install(ROOT,host,'init',['tools'],True,mode='compatible')['applied']);package=host/'modules/tools'
   self.assertFalse((host/'.agents').exists());self.assertFalse(any(package.rglob('runtime')))
   self.cli(package/'integrations/anatomy/anatomy.py','restore',ok=False);self.assertFalse(any(package.rglob('runtime')))
   home=base/'tools-v120';self.assertTrue(self.cli(package/'prepare_home.py','--home',home)['prepared'])
   self.assertFalse(any(home.rglob('runtime')));self.assertEqual('unavailable',self.cli(home/'integrations/anatomy/anatomy.py','status',ok=False)['status'])
   restored=self.cli(home/'integrations/anatomy/anatomy.py','restore');self.assertEqual('ready',restored['status']);self.assertEqual(147,restored['files_checked'])
   self.cli(home/'integrations/anatomy/anatomy.py','restore',ok=False)
   self.cli(package/'prepare_home.py','--home',home,ok=False)
   self.assertIsNotNone(shutil.which('node'),'Node needed for actual sample build')
   output=base/'example';built=self.cli(home/'toolbox.py','run','--workflow','explanation','--tool','anatomy','--action','example','--','--output',output)
   self.assertEqual('built',built['status']);page=output/'examples/dial-indicator/dial-indicator-light.html';text=page.read_text('utf8');self.assertIn('<svg',text);self.assertIn('Dial indicator',text)
   before=page.read_bytes();self.cli(home/'integrations/anatomy/anatomy.py','example','--output',output,ok=False);self.assertEqual(before,page.read_bytes())
   self.cli(home/'integrations/anatomy/anatomy.py','example','--output',host/'modules/new-output',ok=False);self.assertFalse((host/'modules/new-output').exists())
   self.assertEqual(b'HOST AUTHORITY',(host/'AGENTS.md').read_bytes());self.assertFalse(any(package.rglob('runtime')))
 def test_real_predecessor_and_separate_skill_recovery(self):
  with tempfile.TemporaryDirectory(prefix='anatomy-upgrade-') as tmp:
   base=pathlib.Path(tmp);old=published_bundle(ROOT,'1.19.0',base/'old')
   for mode in ['full','compatible']:
    host=base/mode;host.mkdir();canaries={host/'private.md':b'PRIVATE RESEARCH',host/'Wiki/approved.md':b'APPROVED ORIGINAL',host/'external-tools/runtime/user.bin':b'EXISTING RUNTIME'}
    if mode=='compatible':canaries[host/'AGENTS.md']=b'OWN HOST RULES'
    for p,data in canaries.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
    self.assertTrue(w.install(old,host,'init',['tools','skills']+(['meta'] if mode=='compatible' else []),True,mode=mode)['applied'])
    canaries[host/'AGENTS.md']=(host/'AGENTS.md').read_bytes();selected={}
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     self.assertTrue(self.skill(host,platform,'install','--names','dual-layer-explainer','--apply')['applied']);selected[platform]=(host/folder/'skills/dual-layer-explainer/SKILL.md').read_bytes()
    package=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(package['applied']);self.assertFalse(any((host/'modules/tools').rglob('runtime')))
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     entry=host/folder/'skills/dual-layer-explainer/SKILL.md';self.assertEqual(selected[platform],entry.read_bytes())
     updated=self.skill(host,platform,'upgrade','--apply');self.assertTrue(updated['applied']);self.assertIn('integrations/anatomy/README.md',entry.read_text('utf8'));self.assertFalse((entry.parent.parent/'interaction-design').exists())
     after=entry.read_bytes();entry.write_bytes(after+b'\nUSER EDIT');self.assertTrue(self.skill(host,platform,'rollback','--transaction',updated['transaction'],'--apply',ok=False)['conflicts']);self.assertEqual(after+b'\nUSER EDIT',entry.read_bytes());entry.write_bytes(after)
     self.assertTrue(self.skill(host,platform,'rollback','--transaction',updated['transaction'],'--apply')['applied']);self.assertEqual(selected[platform],entry.read_bytes())
    readme=host/'modules/tools/integrations/anatomy/README.md';original=readme.read_bytes();readme.write_bytes(original+b'\nLOCAL EDIT')
    self.assertTrue(w.rollback(host,package['transaction'],True)['conflicts']);self.assertEqual(original+b'\nLOCAL EDIT',readme.read_bytes());readme.write_bytes(original)
    self.assertTrue(w.rollback(host,package['transaction'],True)['applied']);self.assertEqual('1.19.0',w.state(host)['version']);self.assertFalse(readme.exists())
    for p,data in canaries.items():self.assertEqual(data,p.read_bytes())
 def test_publisher_still_rejects_private_evidence(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=pathlib.Path(tmp);(p/'release-input').mkdir();(p/'out').mkdir()
   for target in ['integrations/anatomy/validation.json','integrations/other/vendor/unreviewed.zip']:
    manifest={'release_schema':1,'component_id':'tools','output_path':'packages/tools','copy_files':[{'source':'release-input/curated/'+target,'target':target,'sha256':'0'*64}]};(p/'release-input/manifest.json').write_text(json.dumps(manifest))
    with self.assertRaises(w.ContractError):stage(p,p/'out')
if __name__=='__main__':unittest.main()
