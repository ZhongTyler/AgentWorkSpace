import io,json,subprocess,sys,tarfile,tempfile,unittest,shutil,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from publish import inventory

class ActualReleaseUpgrade(unittest.TestCase):
 def command(self,*args,cwd=None,ok=True):
  r=subprocess.run([str(a) for a in args],cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
  if ok:self.assertEqual(0,r.returncode,r.stdout[-2000:]+r.stderr[-2000:])
  return r
 def test_direct_predecessor_file_upgrade_and_rollback(self):
  with tempfile.TemporaryDirectory(prefix='aws-real-upgrade-') as t:
   base=Path(t);previous=base/'previous';previous.mkdir();target=base/'host'
   git=shutil.which('git');self.assertIsNotNone(git)
   r=subprocess.run([git,'-c','safe.directory='+ROOT.as_posix(),'-C',str(ROOT),'archive','v'+json.loads((ROOT/'catalog.json').read_text(encoding='utf-8'))['previous_version']],capture_output=True,check=True)
   with tarfile.open(fileobj=io.BytesIO(r.stdout)) as archive:
    for member in archive:
     if member.isdir():continue
     self.assertTrue(member.isfile());p=w.safe(previous,member.name);p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(archive.extractfile(member).read())
   for mode in ('full','compatible'):
    host=target/mode
    packages=['brainstorm','fromdemotospec','knowledge','skills','game-analysis-decision','game-presentation','prototype-assets']
    args=[sys.executable,'-X','utf8','-B',previous/'scripts/workspace.py','init','--target',host,'--packages',*packages,'--apply']
    if mode=='compatible':
     host.mkdir(parents=True);(host/'AGENTS.md').write_bytes(b'Existing authoritative host rules.\n');args.insert(args.index('--apply'),'meta');args.extend(['--mode','compatible'])
    self.command(*args)
    user=host/'modules/brainstorm/sessions/my-note.md';user.parent.mkdir(parents=True,exist_ok=True);user.write_bytes(b'User data must remain.\n')
    original=(host/'AGENTS.md').read_bytes();self.assertEqual(w.catalog(ROOT)['previous_version'],w.state(host)['version'])
    preview=w.install(ROOT,host,'upgrade',[]);self.assertFalse(preview['applied']);self.assertFalse(preview['conflicts'])
    if mode=='compatible':self.assertTrue(preview['audit']['package_review'])
    upgraded=w.install(ROOT,host,'upgrade',[],True);self.assertTrue(upgraded['applied']);self.assertEqual(w.catalog(ROOT)['version'],w.state(host)['version']);self.assertEqual(original,(host/'AGENTS.md').read_bytes())
    self.assertTrue(w.rollback(host,upgraded['transaction'],True)['applied']);self.assertEqual(w.catalog(ROOT)['previous_version'],w.state(host)['version']);self.assertEqual(original,(host/'AGENTS.md').read_bytes());self.assertEqual(b'User data must remain.\n',user.read_bytes())
 def test_skill_upgrade_only_selected_and_local_changes(self):
  with tempfile.TemporaryDirectory(prefix='aws-skill-upgrade-') as t:
   base=Path(t);old=ROOT/'packages/skills';new=base/'next';shutil.copytree(old,new);target=base/'host'
   def pick(bundle,*args,ok=True):
    r=self.command(sys.executable,'-X','utf8','-B',bundle/'scripts/skills.py',*args,'--target',target,ok=ok)
    return r,json.loads(r.stdout) if r.stdout else None
   pick(old,'install','--names','systematic-debugging','property-based-testing','--apply')
   debug=target/'.agents/skills/systematic-debugging/SKILL.md';original=debug.read_bytes();debug.write_bytes(original+b'\nUser edit\n')
   upstream=new/'library/systematic-debugging/SKILL.md';upstream.write_bytes(upstream.read_bytes()+b'\nSynthetic next-version test annotation.\n')
   cat=json.loads((new/'catalog.json').read_text(encoding='utf-8'));prior=cat['version'];major,minor,_=map(int,prior.split('.'));next_version=f'{major}.{minor+1}.0';cat.update(version=next_version,previous_version=prior)
   for item in cat['components'].values():item.update(version=next_version,files=inventory(new/item['source']))
   (new/'catalog.json').write_bytes(w.encoded(cat));(new/f'upgrades/{next_version}.md').write_text('Synthetic upgrade fixture only.\n')
   denied,report=pick(new,'upgrade','--apply',ok=False);self.assertNotEqual(0,denied.returncode);self.assertTrue(report['conflicts']);self.assertEqual(original+b'\nUser edit\n',debug.read_bytes())
   debug.write_bytes(original)
   property_file=target/'.agents/skills/property-based-testing/SKILL.md';local=property_file.read_bytes()+b'\nLocal unrelated annotation.\n';property_file.write_bytes(local)
   _,report=pick(new,'upgrade','--apply');self.assertTrue(report['applied']);self.assertEqual(2,len(json.loads((target/'.agent-skills/codex/state.json').read_text(encoding='utf-8'))['components']));self.assertEqual(local,property_file.read_bytes());self.assertEqual(upstream.read_bytes(),debug.read_bytes())
   pick(new,'rollback','--transaction',report['transaction'],'--apply');self.assertEqual(original,debug.read_bytes());self.assertEqual(local,property_file.read_bytes())

if __name__=='__main__':unittest.main()
