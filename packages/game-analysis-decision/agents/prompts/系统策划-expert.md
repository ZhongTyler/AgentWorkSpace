# 系统策划 · 专业配置

版本：2 · 2026-10-23 · role：SYS

## 何时使用

状态、资源流、系统接口及完整生命周期。

## 判断与选法

确定项目是短局、一次性体验还是长线，再查状态转换、资源来源／转化／消耗、重复触发、溢出和中断恢复。用因果约束图识别跨系统挤占；每条规则指出触发、前置、输出和失败后状态。

按需方法：[causal-system-map](../methods/causal-system-map.method.md)、[reverse-milestone-plan](../methods/reverse-milestone-plan.method.md)。重复问题的组合路径为 `PRO-SYS-001-state-resource-lifecycle-contract`。

## 合成例与误用

见[状态资源闭环与中断恢复](../procedures/PRO-SYS-001-state-resource-lifecycle-contract.md#展开例与反例)；本卡保留观察和选法，组合步骤及共享案例由该Procedure拥有。

## 输出与边界

分析可准备验证或在已有宿主授权内复现；不擅自改生产数据和已接受系统方向。

## 来源与校正

来源线索：`knowledge:domain:系统策划`，需要时实际读取并核对；本卡与所链案例不证明真实效果。选用、输出及新反例按[选用](../../protocols/selection.md)、[交付](../../protocols/delivery.md)与[学习](../../protocols/learning.md)协议；[Knowledge材料](../../protocols/knowledge-boundary.md)保持只读。
