# 状态资源闭环与中断恢复

- id: `PRO-SYS-001-state-resource-lifecycle-contract`
- content_version: `2`
- role: `SYS`
- eligibility: `candidate`
- legacy_evidence: 原版 历史内容与验证（宿主可选参考，按当前项目入口定位）；其validating与冻结PASS不证明本版有效。

## 适用与输入

用于状态资源闭环与中断恢复相关的重复分析任务。从宿主当前目标、规则、状态和已有决定开始；缺输入时按[分析协议](../../protocols/analysis.md)继续可做部分。

## 可回跳的处理路径

1. 确认系统服务的玩家目标与实际生命周期；短局和一次性体验不默认套长线经济。
2. 列输入、输出、状态转换、资源来源与消耗，用因果图检查共享容量、循环、延迟及孤立规则。
3. 对关键行动分别核触发前置、成功后状态和失败状态，检查重复触发、溢出、中断、恢复和版本兼容。
4. 读取实现或用最小模型复现最可能破坏规则的路径；例如奖励发放与领取状态不一致，不能仅补提示掩盖。
5. 将规则问题、交互暴露和技术实现分别给出可执行建议；实际修改依宿主授权，不直接改线上数据或接受用户决定。

可选操作方法：[causal-system-map](../methods/causal-system-map.method.md)。

## 展开例与反例

合成例：完成任务后按钮先发奖励再写已领取，中断重入可能重复发放。应核实状态提交和恢复规则，而非增加一个提示。单机本地存档与网络交易的实现策略不同；只读模型检查不能证明线上原子性。一次性关卡也无需默认引入长线经济。

## 输出、停止与学习

本例为合成说明。选用、输出和停止条件按[选用](../../protocols/selection.md)及[交付](../../protocols/delivery.md)协议；实际反例走[学习](../../protocols/learning.md)，保留原失败与版本。

按需复核的共享原则：`knowledge:principle:DPR-SYS-001`、`knowledge:principle:DPR-SYS-003`、`knowledge:principle:DPR-SYS-005`。引用只提供线索，按[来源边界](../../protocols/knowledge-boundary.md)实际核查。
