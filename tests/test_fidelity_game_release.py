"""Frozen1.26.0 recipient upgrades and independent selection without optional hosts."""
import json,subprocess,sys,tempfile,unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
import workspace as w
from release_history import published_bundle

class FidelityGameRelease(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.cache=tempfile.TemporaryDirectory();cls.bundle=ROOT if w.catalog(ROOT)['version']=='1.26.0' else published_bundle(ROOT,'1.26.0',Path(cls.cache.name)/'frozen')
 @classmethod
 def tearDownClass(cls):cls.cache.cleanup()
 def pick(self,h,*args,ok=True):
  p=subprocess.run([sys.executable,'-X','utf8','-B',h/'modules/skills/scripts/skills.py',*args,'--target',h],capture_output=True)
  self.assertEqual(p.returncode==0,ok,(p.stdout+p.stderr).decode('utf-8','replace'));return json.loads(p.stdout)
 def test_actual_predecessor_upgrade_clients_optional_runtime_and_reverse(self):
  with tempfile.TemporaryDirectory() as tmp:
   base=Path(tmp);old=published_bundle(ROOT,'1.25.1',base/'old')
   for mode in ['full','compatible']:
    h=base/mode;h.mkdir();private=h/'reports/private.md';private.parent.mkdir();private.write_bytes(b'PRIVATE CANARY')
    if mode=='compatible':(h/'AGENTS.md').write_bytes(b'EXISTING AUTHORITY')
    self.assertTrue(w.install(old,h,'init',['skills','research','game-analysis-decision'],True,mode=mode)['applied'])
    authority=(h/'AGENTS.md').read_bytes();custom=h/'.agents/skills/user-owned/SKILL.md';custom.parent.mkdir(parents=True);custom.write_bytes(b'USER METHOD')
    for platform in ['codex','codebuddy']:self.pick(h,'install','--names','agent-blind-eval','--platform',platform,'--apply')
    rules=h/'modules/game-analysis-decision/AGENTS.md';before=rules.read_bytes();rules.write_bytes(before+b'\nUSER EDIT')
    self.assertTrue(w.install(self.bundle,h,'upgrade',[],True)['conflicts']);self.assertEqual(before+b'\nUSER EDIT',rules.read_bytes());rules.write_bytes(before)
    package=w.install(self.bundle,h,'upgrade',[],True);self.assertTrue(package['applied'])
    self.assertTrue((h/'modules/research/game-research/deep-game-analysis/templates.md').is_file())
    for platform,folder in [('codex','.agents'),('codebuddy','.codebuddy')]:
     chosen=h/folder/'skills';repeat=chosen/'agent-blind-eval/references/repeated-trials.md';self.assertFalse(repeat.exists());self.assertFalse((chosen/'source-fidelity').exists())
     upgrade=self.pick(h,'upgrade','--platform',platform,'--apply');self.assertTrue(upgrade['applied']);self.assertTrue(repeat.is_file())
     install=self.pick(h,'install','--names','source-fidelity','--platform',platform,'--apply');self.assertTrue(install['applied'])
     skill=chosen/'source-fidelity/SKILL.md';data=skill.read_bytes();self.assertEqual((self.bundle/'packages/skills/library/source-fidelity/SKILL.md').read_bytes(),data)
     skill.write_bytes(data+b'\nUSER EDIT');self.assertTrue(self.pick(h,'rollback','--transaction',install['transaction'],'--platform',platform,'--apply',ok=False)['conflicts']);self.assertEqual(data+b'\nUSER EDIT',skill.read_bytes());skill.write_bytes(data)
     self.pick(h,'rollback','--transaction',install['transaction'],'--platform',platform,'--apply');self.assertFalse(skill.exists())
     self.pick(h,'rollback','--transaction',upgrade['transaction'],'--platform',platform,'--apply');self.assertFalse(repeat.exists())
    gad=h/'modules/game-analysis-decision'
    script="import assert from 'node:assert/strict';import {selectProfessional} from "+json.dumps((gad/'scripts/provider-v2.mjs').as_uri())+";const r=selectProfessional({problem:'mechanic-value'});assert.equal(r.problem,'mechanic-value');assert.ok(r.assets.every(a=>a.use_status==='normal'));const x=selectProfessional({problem:'growth-pacing',ids:['expert-GP'],includeCandidates:true},undefined,{maxAssets:1});assert.equal(x.assets[0].id,'expert-GP');assert.throws(()=>selectProfessional({problem:'missing'}));"
    result=subprocess.run(['node','--input-type=module','-e',script],capture_output=True);self.assertEqual(0,result.returncode,(result.stdout+result.stderr).decode('utf-8','replace'))
    self.assertTrue(w.rollback(h,package['transaction'],True)['applied']);self.assertEqual('1.25.1',w.state(h)['version']);self.assertEqual(before,rules.read_bytes())
    self.assertEqual(authority,(h/'AGENTS.md').read_bytes());self.assertEqual(b'PRIVATE CANARY',private.read_bytes());self.assertEqual(b'USER METHOD',custom.read_bytes())
    for name in ['tools','knowledge']:self.assertFalse((h/'modules'/name).exists())
    if mode=='compatible':self.assertFalse((h/'modules/meta').exists())
