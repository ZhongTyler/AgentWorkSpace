"""Installed portable packages, selection, recovery and optional dependency contracts."""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
import compatibility as c
NEW=['skills','game-analysis-decision','game-presentation','prototype-assets']

class NewPackages(unittest.TestCase):
 def run_command(self,args,cwd):
  result=subprocess.run(args,cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=180)
  self.assertEqual(0,result.returncode,result.stdout[-2500:]+result.stderr[-2500:]);return result.stdout
 def test_individual_compatible_install_without_meta_or_other_packages(self):
  for name in NEW:
   with self.subTest(name=name),tempfile.TemporaryDirectory(prefix='aws-single-') as temp:
    target=Path(temp)/'host';target.mkdir();rules=target/'AGENTS.md';rules.write_bytes(b'Existing host authority.\n')
    report=w.install(ROOT,target,'init',[name],True,mode='compatible')
    self.assertTrue(report['applied']);self.assertEqual({name},set(w.state(target)['components']));self.assertEqual(b'Existing host authority.\n',rules.read_bytes());self.assertFalse((target/'modules/meta').exists())
    module=target/'modules'/name
    if name=='skills':self.assertIn('systematic-debugging',self.run_command([sys.executable,'-B','scripts/skills.py','list'],module))
    elif name=='game-analysis-decision':self.run_command(['node','scripts/learning-cli.mjs','audit'],module);self.run_command(['node','--test','tests/test-provider-v2.mjs','tests/test-learning-v2.mjs','tests/test-adapter-v2.mjs','tests/test-analysis-math.mjs'],module)
    elif name=='game-presentation':self.run_command(['node','--test','tests/delivery.test.mjs','tests/workbench-delivery.test.mjs','tests/publish-directory.test.mjs'],module)
    else:self.run_command(['node','--test','tests/assets.test.mjs','tests/publish-directory.test.mjs'],module)
 def test_selective_skills_inside_host_conflict_and_rollback(self):
  with tempfile.TemporaryDirectory(prefix='aws-skills-') as temp:
   target=Path(temp)/'host';w.install(ROOT,target,'init',['skills'],True,mode='compatible');module=target/'modules/skills'
   def pick(*args):return json.loads(self.run_command([sys.executable,'-B','scripts/skills.py',*args,'--target',str(target)],module))
   self.assertFalse((target/'.agents').exists())
   preview=pick('install','--names','systematic-debugging');self.assertFalse(preview['applied']);self.assertFalse((target/'.agents').exists())
   applied=pick('install','--names','systematic-debugging','--apply');self.assertTrue(applied['applied'])
   self.assertEqual(['systematic-debugging'],sorted(p.name for p in (target/'.agents/skills').iterdir()))
   self.assertEqual({'skills'},set(w.state(target)['components']))
   pick('install','--names','property-based-testing','--platform','codebuddy','--apply');self.assertTrue((target/'.codebuddy/skills/property-based-testing/references/LICENSE').exists())
   pick('rollback','--transaction',applied['transaction'],'--apply');self.assertFalse((target/'.agents/skills/systematic-debugging/SKILL.md').exists());self.assertTrue((target/'.codebuddy/skills/property-based-testing/SKILL.md').exists())
   conflict=target/'.agents/skills/systematic-debugging/SKILL.md';conflict.parent.mkdir(parents=True,exist_ok=True);conflict.write_text('User skill\n')
   denied=subprocess.run([sys.executable,'-B','scripts/skills.py','install','--target',str(target),'--names','systematic-debugging','--apply'],cwd=module,capture_output=True,text=True)
   self.assertNotEqual(0,denied.returncode);self.assertEqual('User skill\n',conflict.read_text(encoding='utf-8'))
 def test_dependency_recommendations_and_reviewed_substitutes(self):
  with tempfile.TemporaryDirectory(prefix='aws-deps-') as temp:
   target=Path(temp);rules=target/'AGENTS.md';rules.write_bytes(b'Existing audited capabilities.\n');cat=w.catalog(ROOT)
   for name in NEW:self.assertEqual([],c.audit(cat,target,[name])['required'])
   audit=c.audit(cat,target,[],['presentation']);self.assertEqual(['game-presentation'],[r['component'] for r in audit['recommended']])
   checks=cat['compatibility']['capabilities']['game-presentation']['criteria']
   profile={'schema_version':1,'providers':[{'id':'existing-presentation','capabilities':['game-presentation'],'assurance':'reviewed','reason':'Synthetic equivalent-provider contract fixture only','checks':{'game-presentation':checks},'evidence':[{'path':'AGENTS.md','sha256':w.digest(rules.read_bytes())}]}]}
   self.assertEqual([],c.audit(cat,target,[],['presentation'],profile)['recommended'])
   rules.write_bytes(b'Changed');self.assertRaises(w.ContractError,c.audit,cat,target,[],['presentation'],profile)
 def test_real_assets_to_fresh_godot_project_and_recovery(self):
  with tempfile.TemporaryDirectory(prefix='aws-integration-') as temp:
   target=Path(temp)/'host';w.install(ROOT,target,'init',NEW,True,mode='compatible');gp=target/'modules/game-presentation';assets=target/'modules/prototype-assets';project=Path(temp)/'project'
   self.run_command(['node','scripts/init-project.mjs','--target',str(project),'--apply'],gp)
   ids=[json.loads((assets/'catalog/assets.json').read_text(encoding='utf-8'))['assets'][0]['asset_id']]
   opts=['--source',str(assets),'--engine',str(project/'Engine'),'--bundle','sample','--id',ids[0]]
   preview=json.loads(self.run_command(['node','adapters/godot/deliver.mjs','import',*opts],gp));self.assertFalse(preview['applied'])
   self.run_command(['node','adapters/godot/deliver.mjs','import',*opts,'--apply'],gp)
   receipt=json.loads((project/'Engine/assets/vendor/sample/receipt.json').read_text(encoding='utf-8'));self.assertEqual(ids[0],receipt['assets'][0]['asset_id']);self.assertTrue((project/'Engine/assets/vendor/sample'/receipt['assets'][0]['path']).is_file())
   # Recovery/rollback must not need a reachable source repository.
   shutil.rmtree(assets)
   self.run_command(['node','adapters/godot/deliver.mjs','rollback','--engine',str(project/'Engine'),'--bundle','sample','--apply'],gp)
   self.assertEqual([],json.loads((project/'Engine/assets/vendor/sample/receipt.json').read_text(encoding='utf-8'))['assets'])
 def test_curated_skill_licenses_and_local_references(self):
  base=ROOT/'packages/skills/library'
  for name in ['godot-gdscript-patterns','property-based-testing','systematic-debugging','humanizer-zh']:
   self.assertTrue((base/name/'references/LICENSE').is_file())
  self.assertIn('Attribution-ShareAlike',(base/'property-based-testing/references/LICENSE').read_text(encoding='utf-8'))
  listed={row['id'] for row in json.loads((ROOT/'packages/skills/skills.json').read_text(encoding='utf-8'))['skills']}
  actual={path.parent.name for path in base.glob('*/SKILL.md')}
  self.assertEqual(actual,listed)
  self.assertTrue({'godot-gdscript-patterns','property-based-testing','systematic-debugging','humanizer-zh','game-decision-support','interaction-design'}.issubset(listed))

if __name__=='__main__':unittest.main()
