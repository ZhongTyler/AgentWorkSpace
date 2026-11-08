"""Regression for a real preflight pass / Knowledge-reader failure."""
import unittest
import dossier

class ClaimConsumerContract(unittest.TestCase):
    def errors(self, claim):
        source={'id':'S1','role':'official','read_status':'read','read_scope':'fixed rules'}
        manifest={'sources':[source],'assets':[],'cases':[],
                  'claims':[{'id':'C1','evidence':['S1'],**claim}], 'domains':[]}
        errors=[]
        dossier.evidence_graph(manifest,errors)
        return errors
    def test_path_only_cannot_pass_preflight(self):
        self.assertIn('claim requires chapter for Knowledge reader: C1',
                      self.errors({'path':'units/rules.md','statement':'A claim'}))
    def test_whitespace_chapter_is_not_a_location(self):
        self.assertTrue(self.errors({'chapter':'  ','path':'units/rules.md'}))
    def test_canonical_chapter_works_for_both_existing_prose_fields(self):
        for field in ('statement','text'):
            with self.subTest(field=field):
                self.assertEqual(self.errors({'chapter':'units/rules.md',field:'A claim'}),[])

if __name__=='__main__':unittest.main()
