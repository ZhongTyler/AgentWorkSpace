"""Synthetic portable contract tests; no maintainer game, asset or private path."""
import copy,json,tempfile,unittest
from pathlib import Path
import dossier
from example_dossier import create

class PortableContract(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.base=Path(self.temp.name)/'input';self.m=create(self.base)
  self.request=json.loads((self.base/'request.json').read_text(encoding='utf-8'))
 def tearDown(self):self.temp.cleanup()
 def check(self):return dossier.checks(self.m,self.base)
 def test_conditional_return_binds_report_and_keeps_whole_scope(self):
  self.assertEqual(self.check()['status'],'pass');r=dossier.return_packet(self.m,self.base,self.request)
  self.assertEqual(r['status'],'answered');self.assertEqual(r['dossier_coverage_status'],'partial')
  self.assertEqual(r['report_sha256'],dossier.sha(self.base/'report/README.md'));self.assertTrue(r['unresolved']);self.assertTrue(r['claims'][0]['limits'])
 def test_wrong_game_version_unknown_claim_refused(self):
  for field,value in [('game_id','different-game'),('allowed_version_groups',['different-version']),('claim_ids',['UNKNOWN'])]:
   r=copy.deepcopy(self.request);r[field]=value
   with self.subTest(field=field),self.assertRaises(ValueError):dossier.return_packet(self.m,self.base,r)
 def test_unread_or_rejected_dependency_is_refused(self):
  original=copy.deepcopy(self.m)
  for kind in ['unread','rejected','cycle']:
   self.m=copy.deepcopy(original)
   if kind=='unread':self.m['sources'][0]['read_status']='unread'
   elif kind=='rejected':self.m['assets'][0]['accepted']=False
   else:self.m['cases'][0]['evidence']=['C01']
   with self.subTest(kind=kind):
    self.assertEqual(self.check()['status'],'fail')
    with self.assertRaises(ValueError):dossier.return_packet(self.m,self.base,self.request)
 def test_removing_domain_and_baseline_does_not_hide_drift(self):
  self.m['domain_baseline']['names']=[];self.m['domains']=[];self.assertEqual(self.check()['status'],'fail')
 def test_changed_document_and_asset_detected(self):
  for rel in ['report/README.md','evidence/source.txt']:
   p=self.base/rel;before=p.read_bytes();p.write_bytes(before+b'changed');self.assertEqual(self.check()['status'],'fail');p.write_bytes(before)
 def test_scope_escape_rejected(self):
  self.m['assets'][0]['path']='../outside.txt';self.assertEqual(self.check()['status'],'fail')
 def test_partial_case_propagates(self):
  self.m['cases'][0]['status']='partial';self.assertEqual(dossier.return_packet(self.m,self.base,self.request)['status'],'partial')
 def test_handoff_files_and_tampering(self):
  (self.base/'private-canary.txt').write_bytes(b'HOST PRIVATE')
  out=self.base.parent/'handoff';self.assertEqual(dossier.export(self.base/'manifest.json',out)['status'],'exported')
  mp=out/'portable-manifest.json';self.assertEqual(dossier.check_bundle(mp)['status'],'pass');self.assertFalse((out/'private-canary.txt').exists())
  view=out/'evidence/manifest.portable.json';loaded=dossier.load(view);self.assertEqual(dossier.checks(loaded,view.parent)['status'],'pass')
  self.assertEqual(dossier.return_packet(loaded,view.parent,self.request,view)['status'],'answered')
  p=out/'evidence/source.txt';p.write_bytes(b'TAMPER');self.assertEqual(dossier.check_bundle(mp)['status'],'fail')
  with self.assertRaises(ValueError):dossier.export(self.base/'manifest.json',out)
if __name__=='__main__':unittest.main()
