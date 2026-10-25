# 数值锚点、可达供给和分布校准

- id: `PRO-NUM-001-anchor-distribution-calibration`
- content_version: `2`
- role: `NUM`
- eligibility: `candidate`
- legacy_evidence: 原版 历史内容与验证（宿主可选参考，按当前项目入口定位）；其validating与冻结PASS不证明本版有效。

## 适用与输入

用于数值锚点、可达供给和分布校准相关的重复分析任务。从宿主当前目标、规则、状态和已有决定开始；缺输入时按[分析协议](../../protocols/analysis.md)继续可做部分。

## 可回跳的处理路径

1. 列目标指标、规则版本、样本单位和可确认锚点；没有体验目标时不要编精确推荐值。
2. 先复算公式、库存／流量、共享容量和时间窗，区分独立上界与可同时达到量；数值缺口先以可复现输入给出。
3. 保留分层样本、权重、尾部与连续失败；独立二项区间不能修正重复玩家和自选择偏差。
4. 围绕最敏感且可改变推荐的参数给出条件范围，比较替代解释并验证受影响旧能力。
5. 确定性错误可在授权内修正；体验或公平目标需真实证据和用户重要取舍。仿真只支持给定模型，不伪造实战表现。

可选操作方法：[balance-matrix-review](../methods/balance-matrix-review.method.md)、[causal-system-map](../methods/causal-system-map.method.md)。

## 展开例与反例

合成例：12格土地、两配方分别需8格和6格。各自单独够用不等于能同时满足；共享时缺2格，独立地块时不适用此判断。可用analysis-math capacity核算；离散格、库存调峰和随机产出需要进一步模型，不能由平均稳态直接推荐精确参数。

## 输出、停止与学习

本例为合成说明。选用、输出和停止条件按[选用](../../protocols/selection.md)及[交付](../../protocols/delivery.md)协议；实际反例走[学习](../../protocols/learning.md)，保留原失败与版本。

按需复核的共享原则：`knowledge:principle:DPR-NUM-001`、`knowledge:principle:DPR-NUM-003`、`knowledge:principle:DPR-NUM-005`。引用只提供线索，按[来源边界](../../protocols/knowledge-boundary.md)实际核查。
