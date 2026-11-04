import copy
import unittest
from dossier import reader_domains

class ReaderDomains(unittest.TestCase):
    def setUp(self):
        self.m={'reader_selection_version':1,'domains':[{'name':'战斗','reader_visible':True},{'name':'开发AI','reader_visible':False,'reader_reason':'没有可用于本报告的开发AI研究增量'}]}
    def test_reader_subset_keeps_background_inventory(self):
        self.assertEqual([d['name'] for d in reader_domains(self.m)],['战斗'])
        self.assertEqual(len(self.m['domains']),2)
    def test_old_reports_keep_their_original_routes(self):
        self.assertEqual(reader_domains({'domains':[{'name':'旧领域'}]}),[{'name':'旧领域'}])
    def test_missing_selection_or_exclusion_reason_is_not_silent(self):
        for key in ['reader_visible','reader_reason']:
            m=copy.deepcopy(self.m);m['domains'][1].pop(key)
            with self.assertRaises(ValueError):reader_domains(m)
    def test_string_boolean_cannot_silently_hide_a_domain(self):
        self.m['domains'][0]['reader_visible']='false'
        with self.assertRaises(ValueError):reader_domains(self.m)

if __name__=='__main__':unittest.main()
