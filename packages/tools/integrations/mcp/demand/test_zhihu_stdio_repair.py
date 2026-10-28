import sys,unittest,tomllib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from zhihu_stdio_repair import native_section,replace_section

class ZhihuRepairTests(unittest.TestCase):
    def test_only_transport_changes_and_policy_remains(self):
        source={'enabled':True,'required':False,'enabled_tools':['zhihu_search','hot_list'],'tool_timeout_sec':45,'url':'http://127.0.0.1:18089/mcp/research-zhihu','http_headers_helper':'private-helper'}
        old=native_section(source,Path('python'),Path('proxy'),Path('home'))
        actual=tomllib.loads(old)['mcp_servers']['research-zhihu']
        self.assertEqual(actual['enabled_tools'],source['enabled_tools']);self.assertEqual(actual['tool_timeout_sec'],45)
        self.assertNotIn('url',actual);self.assertNotIn('http_headers_helper',actual)
    def test_preserves_other_sections_and_guard_rejects_drift(self):
        first='[mcp_servers.research-zhihu]\nurl = "old"\n\n';tail='[mcp_servers.other]\nurl = "unchanged"\n'
        raw=('prefix = "untouched"\n'+first+tail).encode()
        actual=replace_section(raw,first,'[mcp_servers.research-zhihu]\ncommand = "new"\n\n')
        self.assertTrue(actual.endswith(tail.encode()));self.assertTrue(actual.startswith(b'prefix = "untouched"'))
        with self.assertRaises(ValueError):replace_section(raw,first+'changed','replacement')
    def test_unknown_nested_policy_is_not_silently_dropped(self):
        with self.assertRaises(ValueError):native_section({'policy':{'nested':True}},Path('python'),Path('proxy'),Path('home'))

if __name__=='__main__':unittest.main()
