"""Regression for text-master navigation and stable domain chapter identity."""
import copy,unittest
from compile_study import text_report

class TextNavigation(unittest.TestCase):
    def setUp(self):
        self.study={'title':'例','edition':'固定版','sources':{},'sections':[{'id':i,'title':t,'subtitle':'对象与边界','blocks':[{'type':'p','text':'完整规则与例外 '+i}]} for i,t in [('overview','整体'),('rule','规则'),('case','过程')]],'toc_layout':{'type':'grouped','leading':['overview'],'groups':[{'title':'系统','sections':['rule','case']}],'trailing':[]}}
        self.routes={'routes':[{'name':'玩法','steps':[{'target':'rule'},{'target':'case'}]},{'name':'交互','steps':[{'target':'case'}]}]}
    def test_domain_index_and_full_text_share_stable_units(self):
        body=text_report(self.study,self.routes,{})
        self.assertIn('| 玩法 | [规则](units/rule.md) → [过程](units/case.md) |',body)
        self.assertIn('| 交互 | [过程](units/case.md) |',body)
        self.assertEqual(body.count('完整规则与例外 case'),1)
        self.assertLess(body.index('完整规则与例外 overview'),body.index('## 阅读导航'))
        self.assertLess(body.index('## 阅读导航'),body.index('## 规则'))
    def test_missing_or_repeated_text_toc_section_is_rejected(self):
        for ids in (['rule'],['rule','rule','case'],['case','rule']):
            with self.subTest(ids=ids):
                s=copy.deepcopy(self.study);s['toc_layout']['groups'][0]['sections']=ids
                with self.assertRaisesRegex(ValueError,'cover'):text_report(s,self.routes,{})
    def test_domain_unknown_target_is_rejected(self):
        self.routes['routes'][0]['steps'][0]['target']='absent'
        with self.assertRaisesRegex(ValueError,'unknown section'):text_report(self.study,self.routes,{})
    def test_explicit_text_toc_can_keep_existing_html_layout(self):
        s=copy.deepcopy(self.study);s['text_toc']=s.pop('toc_layout')
        self.assertIn('**系统**',text_report(s,self.routes,{}))

if __name__=='__main__':unittest.main()
