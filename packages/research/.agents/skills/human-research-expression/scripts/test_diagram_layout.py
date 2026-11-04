"""Seeded invariants and semantic layout cases; no optional test dependency."""
import random,re,unittest
from render_visual import diagram,wrap

class DiagramLayout(unittest.TestCase):
 def test_wrap_preserves_characters_and_width(self):
  rng=random.Random(20261027);alphabet='战斗界面状态条件例外ABCxyz018_-./ ，。'
  for _ in range(300):
   text=''.join(rng.choice(alphabet+'\n') for _ in range(rng.randrange(140)));width=rng.randint(2,30);lines=wrap(text,width)
   self.assertEqual(''.join(lines),text.replace('\n',''))
   self.assertTrue(all(sum(1 if ord(c)>255 else .55 for c in line)<=width+1e-8 for line in lines))
 def test_fitting_english_terms_are_not_split(self):
  lines=wrap('接口Board、Pawn与SpaceDamage、扩展DLL',10)
  for word in ['Board','Pawn','SpaceDamage','DLL']:self.assertTrue(any(word in line for line in lines),word)
 def test_parallel_comparison_has_no_arrows(self):
  data={'lanes':[['来源',['实际操作','作者说明','社区代码']],['未知',['实际听音','内部实现']]],'label':'类别彼此并列'}
  for width in [340,780]:
   visual=diagram({'kind':'compare','data':data},width)
   self.assertFalse(any(op[0]=='line' for op in visual.ops))
   self.assertEqual(sum(op[0]=='circle' for op in visual.ops),5)
 def test_ordered_comparison_is_explicit(self):
  visual=diagram({'kind':'compare','data':{'lanes':[['阶段',['先发生','后发生']]],'ordered':True,'label':''}},340)
  self.assertTrue(any(op[0]=='line' and op[-2] for op in visual.ops))
 def test_three_and_more_comparison_groups_remain_inside_canvas(self):
  for count in [3,4]:
   for width in [340,780]:
    visual=diagram({'kind':'compare','data':{'lanes':[[f'工具{i}',['条件与代价','与其他工具的关系']] for i in range(count)]}},width)
    cards=[op for op in visual.ops if op[0]=='rect']
    self.assertEqual(len(cards),count)
    for card in cards:self.assertGreaterEqual(card[1],0);self.assertLessEqual(card[1]+card[3],width)
    ordered=sorted(cards,key=lambda x:x[2])
    self.assertTrue(all(a[2]+a[4]<b[2] for a,b in zip(ordered,ordered[1:])))
 def test_mobile_flow_arrows_clear_step_numbers(self):
  visual=diagram({'kind':'flow','data':[dict(label='阶段',value='位置与条件改变')]*3},340)
  numbers=[op for op in visual.ops if op[0]=='text' and op[1]==16]
  lines=[op for op in visual.ops if op[0]=='line']
  self.assertEqual(len(numbers),3);self.assertEqual(len(lines),2)
  for line,previous,current in zip(lines,numbers,numbers[1:]):
   self.assertGreater(line[2],previous[2]+8);self.assertLess(line[4],current[2]-16)

if __name__=='__main__':unittest.main()
