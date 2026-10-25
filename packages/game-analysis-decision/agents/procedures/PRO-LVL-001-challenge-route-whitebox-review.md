# 挑战、路线与白盒验证

- id: `PRO-LVL-001-challenge-route-whitebox-review`
- content_version: `2`
- role: `LVL`
- eligibility: `candidate`
- legacy_evidence: 原版 历史内容与验证（宿主可选参考，按当前项目入口定位）；其validating与冻结PASS不证明本版有效。

## 适用与输入

用于挑战、路线与白盒验证相关的重复分析任务。从宿主当前目标、规则、状态和已有决定开始；缺输入时按[分析协议](../../protocols/analysis.md)继续可做部分。

## 可回跳的处理路径

1. 从已有机制和玩家能力确定节点的判断任务，不先填满关卡清单。
2. 检查主路径、探索、恢复、视线和资源关系；移动尺度和提示窗口据实际参数推导。
3. 区分介绍规则、独立应用与迁移重组，按需要使用挑战节奏方法；保留无提示应用的观察，但不移除必要无障碍支持。
4. 先跑白盒可达／触发与边界，再用真实输入核查可辨认与可操作；生成关卡的代表例不能替代可达性检查。
5. 输出决定当前建议的节点变化、灰盒假设和验证结果；缺玩家证据只收窄体验主张，不停止结构计算。

可选操作方法：[challenge-rhythm-theme-plan](../methods/challenge-rhythm-theme-plan.method.md)。

## 展开例与反例

合成例：提示距危险3米，速度4米/秒，表面有0.75秒；转角遮挡到1米才可见，实际只剩0.25秒。先按真实首次可见时刻定位问题，再改遮挡或提示位置。刻意推理的谜题可延后显性提示，但需可获得线索，不能把看不见等同有深度。

## 输出、停止与学习

本例为合成说明。选用、输出和停止条件按[选用](../../protocols/selection.md)及[交付](../../protocols/delivery.md)协议；实际反例走[学习](../../protocols/learning.md)，保留原失败与版本。

按需复核的共享原则：`knowledge:principle:DPR-LVL-001`、`knowledge:principle:DPR-LVL-002`。引用只提供线索，按[来源边界](../../protocols/knowledge-boundary.md)实际核查。
