# 可验收出口、依赖与风险计划

- id: `PRO-PM-001-exit-dependency-risk-plan`
- content_version: `2`
- role: `PM`
- eligibility: `candidate`
- legacy_evidence: 原版 历史内容与验证（宿主可选参考，按当前项目入口定位）；其validating与冻结PASS不证明本版有效。

## 适用与输入

用于可验收出口、依赖与风险计划相关的重复分析任务。从宿主当前目标、规则、状态和已有决定开始；缺输入时按[分析协议](../../protocols/analysis.md)继续可做部分。

## 可回跳的处理路径

1. 从实际交付行为定义工程、体验和用户决定的不同出口；不用文件数量替代完成。
2. 反推必要依赖、实际责任与资源，分离工作量、关键路径和外部等待；未承诺的owner只可写建议。
3. 优先安排能消除重要未知的有界验证，检验任务真能并行；同一资源重复分配时修正排程。
4. 给出维持验证深度的范围裁剪、缓冲与回退；自动化只是执行手段，不能从“可跑”推出质量可靠。
5. 执行可自主的工程任务，集中重要范围／费用决定；报告真实验证和剩余外部条件，不靠隐藏未完成项闭合。

可选操作方法：[reverse-milestone-plan](../methods/reverse-milestone-plan.method.md)。

## 展开例与反例

合成例：两项工作各2天且同一人执行，不能因图上并行就承诺2天；增加1天验证，至少5工作日，外部等待另算。若缩小范围，不应删关键反馈和恢复再声称原完成标准达成。流程自动化能运行不等于质量提高。

## 输出、停止与学习

本例为合成说明。选用、输出和停止条件按[选用](../../protocols/selection.md)及[交付](../../protocols/delivery.md)协议；实际反例走[学习](../../protocols/learning.md)，保留原失败与版本。

按需复核的共享原则：`knowledge:principle:DPR-PM-001`、`knowledge:principle:DPR-PM-002`、`knowledge:principle:DPR-PM-003`。引用只提供线索，按[来源边界](../../protocols/knowledge-boundary.md)实际核查。
