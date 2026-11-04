"""Synthetic provenance failures; no author archives or real game evidence are read."""
import copy
import importlib.util
import json
from pathlib import Path
import unittest
import tempfile

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('dossier',HERE/'dossier.py')
dossier=importlib.util.module_from_spec(spec);spec.loader.exec_module(dossier)
MP=None

class Contract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        global MP
        from synthetic_dossier_fixture import create
        cls.temporary=tempfile.TemporaryDirectory(prefix='synthetic-dossier-')
        MP=create(Path(cls.temporary.name)/'fixture')
    @classmethod
    def tearDownClass(cls):cls.temporary.cleanup()
    def setUp(self):self.m=dossier.load(MP);self.base=MP.parent
    def test_actual_dossier(self):self.assertEqual(dossier.checks(self.m,self.base)['status'],'pass')
    def test_missing_domain_is_failure(self):
        self.m['domains'].pop();self.assertIn('domain baseline mismatch',dossier.checks(self.m,self.base)['errors'])
    def test_hash_mismatch_is_failure(self):
        self.m['assets'][0]['sha256']='0'*64
        self.assertTrue(any('hash mismatch' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_document_drift_is_failure(self):
        self.m['document_hashes'][self.m['dossier_ref']]='0'*64
        self.assertTrue(any('document hash mismatch' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_unknown_evidence_is_failure(self):
        self.m['claims'][0]['evidence']=['S-does-not-exist']
        self.assertTrue(any('S-does-not-exist' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_unavailable_source_cannot_support_claim(self):
        self.m['claims'][0]['evidence']=['S10']
        self.assertTrue(any('unavailable source' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_rejected_asset_direct_claim(self):
        self.m['claims'][0]['evidence']=['M10-rejected-thumbnail']
        self.assertTrue(any('rejected asset used' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_unread_source_via_case(self):
        next(x for x in self.m['sources'] if x['id']=='S15').update(role='unavailable',read_scope='')
        self.assertEqual(dossier.checks(self.m,self.base)['status'],'fail')
        r=self.request();r['claim_ids']=['C01'];r.pop('allowed_version_groups')
        with self.assertRaises(ValueError):dossier.return_packet(self.m,self.base,r)
    def test_implicit_read_status_cannot_prove_reading(self):
        next(x for x in self.m['sources'] if x['id']=='S15').pop('read_status')
        self.assertEqual(dossier.checks(self.m,self.base)['status'],'fail')
    def test_unresolved_claim_dependency_stays_partial(self):
        next(x for x in self.m['claims'] if x['id']=='C03')['evidence']=['C10']
        r=self.request();r['claim_ids']=['C03'];r.pop('allowed_version_groups')
        self.assertEqual(dossier.return_packet(self.m,self.base,r)['status'],'partial')
    def test_domain_unknown_reference(self):
        self.m['domains'][0]['evidence']=['DOES-NOT-EXIST']
        self.assertTrue(any('DOES-NOT-EXIST' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_baseline_and_coverage_removed_together(self):
        self.m['domain_baseline']['names'].pop();self.m['domains'].pop()
        self.assertTrue(any('frozen snapshot' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_case_required_frames_cannot_disappear(self):
        self.m['cases'][0]['frames']=[]
        self.assertTrue(any('required frames' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_evidence_cycle(self):
        self.m['cases'][0]['evidence']=['E01']
        self.assertTrue(any('dependency cycle' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_read_archived_source_survives_online_failure(self):
        next(x for x in self.m['sources'] if x['id']=='S15').update(availability='online_unavailable',archive_refs=['transcript-S15'])
        self.assertEqual(dossier.checks(self.m,self.base)['status'],'pass')
    def test_unrelated_rejected_unknown_archives_refused(self):
        for archive in ('file-S13-CommunicationMod-LICENSE','M10-rejected-thumbnail','UNKNOWN-ARCHIVE'):
            with self.subTest(archive=archive):
                next(x for x in self.m['sources'] if x['id']=='S15').update(availability='online_unavailable',archive_refs=[archive])
                self.assertTrue(any('offline source lacks preserved archive: S15' in x for x in dossier.checks(self.m,self.base)['errors']))
                with self.assertRaises(ValueError):dossier.return_packet(self.m,self.base,self.request())
    def test_unread_archive_is_not_read(self):
        next(x for x in self.m['sources'] if x['id']=='S15').update(availability='online_unavailable',archive_refs=['transcript-S15'],read_status='unread')
        self.assertEqual(dossier.checks(self.m,self.base)['status'],'fail')
    def test_partial_documentary_case_without_frames_is_valid(self):
        case=next(x for x in self.m['cases'] if x['id']=='E02')
        self.assertEqual(case['frames'],[])
        self.assertEqual(dossier.checks(self.m,self.base)['status'],'pass')
    def test_partial_case_does_not_return_answered(self):
        r=self.request();r['claim_ids']=['C01'];r.pop('allowed_version_groups')
        self.assertEqual(dossier.return_packet(self.m,self.base,r)['status'],'partial')
    def test_thumbnail_cannot_be_promoted(self):
        next(x for x in self.m['assets'] if x['id']=='M10-rejected-thumbnail')['accepted']=True
        self.assertTrue(any('thumbnail frame' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_sparse_is_not_continuous(self):
        self.m['cases'][0]['continuity']='continuous'
        self.assertTrue(any('continuous case' in x for x in dossier.checks(self.m,self.base)['errors']))
    def test_scope_escape_is_failure(self):
        self.m['assets'][0]['path']='../../../../../../outside.png'
        self.assertTrue(any('escapes' in x for x in dossier.checks(self.m,self.base)['errors']))
    def request(self):return {'game_id':'slay-the-spire-1','caller_ref':'test-only','question':'reward context','claim_ids':['C03'],'allowed_version_groups':['historical-v1.0','conditional-math','v2.2-five-mods-unknown']}
    def test_wrong_game_refused(self):
        r=self.request();r['game_id']='slay-the-spire-2'
        with self.assertRaisesRegex(ValueError,'identity'):dossier.return_packet(self.m,self.base,r)
    def test_wrong_version_refused(self):
        r=self.request();r['allowed_version_groups']=['current-20261025']
        with self.assertRaisesRegex(ValueError,'version'):dossier.return_packet(self.m,self.base,r)
    def test_unresolved_returns_partial(self):
        r=self.request();r['claim_ids']=['C10'];r['allowed_version_groups']=['knowledge-current-read']
        self.assertEqual(dossier.return_packet(self.m,self.base,r)['status'],'partial')
    def test_return_preserves_limits(self):
        p=dossier.return_packet(self.m,self.base,self.request())
        self.assertEqual(p['status'],'answered');self.assertIn('小',p['claims'][0]['limits']);self.assertTrue(p['unresolved'])
    def test_return_binds_actual_report(self):
        p=dossier.return_packet(self.m,self.base,self.request())
        self.assertEqual(p['report_sha256'],dossier.sha(self.base/self.m['dossier_ref']))
    def test_portable_bytes_tamper_detected(self):
        runtime=MP.parent/'runtime';runtime.mkdir(exist_ok=True)
        self.assertTrue(runtime.resolve().is_relative_to(MP.parent.resolve()))
        with tempfile.TemporaryDirectory(prefix='sts-dossier-contract-',dir=runtime) as temp:
            self.assertTrue(Path(temp).resolve().is_relative_to(runtime.resolve()))
            root=Path(temp);file=root/'evidence.txt';file.write_bytes(b'original evidence')
            mp=root/'portable-manifest.json';mp.write_text(json.dumps({'files':[{'path':'evidence.txt','sha256':dossier.sha(file)}]}),encoding='utf8')
            self.assertEqual(dossier.check_bundle(mp)['status'],'pass')
            file.write_bytes(b'changed evidence')
            self.assertEqual(dossier.check_bundle(mp)['status'],'fail')

class EvidenceExport(unittest.TestCase):
    def test_registered_markdown_keeps_bytes_outside_special_source_folder(self):
        with tempfile.TemporaryDirectory(prefix='sts-export-bytes-',dir=HERE) as temp:
            root=Path(temp);self.assertTrue(root.resolve().is_relative_to(HERE.resolve()))
            src=root/'input';src.mkdir();out=root/'output'
            note=src/'reading.md';note.write_bytes(b'\xef\xbb\xbf# Derived reading note\n\nhttps://example.org/original\n')
            report=src/'README.md';report.write_text('# Synthetic report\n',encoding='utf8')
            snapshot=src/'baseline.json';snapshot.write_text(json.dumps(dict(names=[],source_sha256='synthetic')),encoding='utf8')
            m=dict(game_id='synthetic-export',game_title='Synthetic export regression',allowed_root='.',domain_baseline=dict(names=[],sha256='synthetic',snapshot_ref='baseline.json',snapshot_sha256=dossier.sha(snapshot)),domains=[],sources=[dict(id='S1',read_status='partial_read',read_scope='test fixture')],assets=[dict(id='N1',source_id='S1',path='reading.md',role='derived_reading_note',accepted=True,sha256=dossier.sha(note))],cases=[],claims=[],documents=['README.md'],dossier_ref='README.md',document_hashes={'README.md':dossier.sha(report)},export_roots=[dict(source='reading.md',destination='continuation/sources/reading.md'),dict(source='baseline.json',destination='context/baseline.json'),dict(source='README.md',destination='dossier/README.md'),dict(source='manifest.json',destination='evidence/manifest.json')])
            manifest=src/'manifest.json';manifest.write_text(json.dumps(m),encoding='utf8')
            dossier.export(manifest,out)
            self.assertEqual((out/'continuation/sources/reading.md').read_bytes(),note.read_bytes())
            self.assertEqual(dossier.checks(dossier.load(out/'evidence/manifest.portable.json'),out/'evidence')['status'],'pass')

if __name__=='__main__':unittest.main()
