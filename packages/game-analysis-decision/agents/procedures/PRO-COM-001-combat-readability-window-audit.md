# 战斗可辨认与实际行动窗口

- id: `PRO-COM-001-combat-readability-window-audit`
- content_version: `2`
- role: `COM`
- eligibility: `candidate`
- legacy_evidence: 原版 历史内容与验证（宿主可选参考，按当前项目入口定位）；其validating与冻结PASS不证明本版有效。

## 适用与输入

用于战斗可辨认与实际行动窗口相关的重复分析任务。从宿主当前目标、规则、状态和已有决定开始；缺输入时按[分析协议](../../protocols/analysis.md)继续可做部分。

## 可回跳的处理路径

1. 从一个具体失败交互固定玩家可选行动、敌我规则、实际时序和输入设备；不以“手感不好”作为根因。
2. 建立首次可辨认提示、输入、动作启动、判定和反馈时间线；用window计算剩余判断空间，不预设统一的人类反应阈值。
3. 在并发敌群、遮挡和音画叠加下复查实际信息窗口；单张截图和单敌测试不能支持群战可读性。
4. 比较信息迟到、输入排队、动作成本、优势解和伤害模型解释；先修已核实断点，必要时用平衡矩阵检查局部对局。
5. 给出授权内最小修正与回归场景，标明还需真实操作验证的部分；若本来依靠预判，检查可学习先兆而非一律延长预警。

可选操作方法：[balance-matrix-review](../methods/balance-matrix-review.method.md)、[experience-hypothesis-chain](../methods/experience-hypothesis-chain.method.md)。

## 展开例与反例

合成例：敌招提示400ms后命中，玩家技能启动需250ms，只剩150ms观察与决定。先测提示何时实际被遮挡解除及输入何时入队，再改预警或启动成本；静态截图中能看清敌人不能证明战斗时来得及。若目标是不可反应、靠预判的招式，重点转为可学习先兆而非保证反应。

## 输出、停止与学习

本例为合成说明。选用、输出和停止条件按[选用](../../protocols/selection.md)及[交付](../../protocols/delivery.md)协议；实际反例走[学习](../../protocols/learning.md)，保留原失败与版本。

按需复核的共享原则：`knowledge:principle:DPR-COM-002`、`knowledge:principle:DPR-COM-005`。引用只提供线索，按[来源边界](../../protocols/knowledge-boundary.md)实际核查。
