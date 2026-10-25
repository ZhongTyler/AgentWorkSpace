# 高影响学习决策中的条件判断与补证

- id: `PRO-UX-003-decision-hold-evidence-reentry`
- content_version: `2`
- role: `UX`
- eligibility: `candidate`
- legacy_evidence: 原版 历史内容与验证（宿主可选参考，按当前项目入口定位）；其validating与冻结PASS不证明本版有效。

## 适用与输入

用于高影响学习决策中的条件判断与补证相关的重复分析任务。从宿主当前目标、规则、状态和已有决定开始；缺输入时按[分析协议](../../protocols/analysis.md)继续可做部分。

## 可回跳的处理路径

1. 明确用户被要求决定的高影响动作、已知学习目标及已锁条件，不把一般分析误判成永久删除决定。
2. 将已有证据逐项对应动作前提：提示跟随、独立完成和迁移是否被混淆，数据是否同口径。
3. 若决定所需证据不足，暂不接受或替用户否决该决定；明确现在能支持的范围，继续可做的检查。
4. 在已有授权内实际验算／读取／复现，准备需要真人参与的具体任务；允许条件性方案和补证据方法，不沿用旧冻结run的禁止建议规则。
5. 返回推荐、取舍、关键未知和重入条件，用户决定由宿主记录。若低成本事实足以支持局部修正就直接消费，无需人工重新批准。

可选操作方法：[experience-hypothesis-chain](../methods/experience-hypothesis-chain.method.md)。

## 展开例与反例

合成例：用户问是否永久删除教学，但唯一证据是高亮引导下完成。当前不足以认定独立学习成立，可先检查引导和输入路径，准备下一次无高亮、同规则任务；若无障碍辅助本身是已定条件则保留。不能替用户永久删除，也不能因拒绝删除而禁止任何补证据行动。

## 输出、停止与学习

本例为合成说明。选用、输出和停止条件按[选用](../../protocols/selection.md)及[交付](../../protocols/delivery.md)协议；实际反例走[学习](../../protocols/learning.md)，保留原失败与版本。

按需复核的共享原则：`knowledge:principle:DPR-LD-002`、`knowledge:principle:DPR-PM-003`。引用只提供线索，按[来源边界](../../protocols/knowledge-boundary.md)实际核查。
