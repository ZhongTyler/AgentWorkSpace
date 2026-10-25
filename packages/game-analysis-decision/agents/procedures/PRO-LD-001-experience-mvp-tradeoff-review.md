# 体验承诺与可验证范围取舍

- id: `PRO-LD-001-experience-mvp-tradeoff-review`
- content_version: `2`
- role: `LD`
- eligibility: `candidate`
- legacy_evidence: 原版 历史内容与验证（宿主可选参考，按当前项目入口定位）；其validating与冻结PASS不证明本版有效。

## 适用与输入

用于体验承诺与可验证范围取舍相关的重复分析任务。从宿主当前目标、规则、状态和已有决定开始；缺输入时按[分析协议](../../protocols/analysis.md)继续可做部分。

## 可回跳的处理路径

1. 固定用户已定的体验承诺、目标玩家和制作约束；区分想验证的核心判断与交付必要条件。
2. 用体验命题链挑出必须连通的玩家行动、规则和可感知后果。反馈若影响玩家理解规则，就纳入最小完整切片。
3. 将候选范围映射到体验覆盖、关键依赖和执行成本；未知参数先读取或估算，不自动发散所有专业。
4. 比较减少内容广度、降低资源规格和改变核心目标三类不同裁剪；前两者可在既有授权内推进，后者形成具体用户选择。
5. 准备可运行验证、失败与恢复路径及必要体验观察；依证据决定保留、缩小或待定，不把MVP文件完整称为体验通过。

可选操作方法：[experience-hypothesis-chain](../methods/experience-hypothesis-chain.method.md)、[reverse-milestone-plan](../methods/reverse-milestone-plan.method.md)。

## 展开例与反例

合成例：战斗规则已可运行，但受击无反馈，玩家无法区分无敌帧、判定失败和没打中。删掉反馈能缩短开发，却使规则验证难以解释；优先补能归因的最小反馈，减少关卡数量。若用户要的是服务器吞吐测试，则画面不属于该项完成条件。

## 输出、停止与学习

本例为合成说明。选用、输出和停止条件按[选用](../../protocols/selection.md)及[交付](../../protocols/delivery.md)协议；实际反例走[学习](../../protocols/learning.md)，保留原失败与版本。

按需复核的共享原则：`knowledge:principle:DPR-LD-001`、`knowledge:principle:DPR-LD-002`、`knowledge:principle:DPR-LD-005`。引用只提供线索，按[来源边界](../../protocols/knowledge-boundary.md)实际核查。
