# 可选知识来源

GameAnalysisDecision 核心只依赖当前 Agent 与项目事实。可用本地材料、公开原始资料、计算和复现；没有 Knowledge 仍可直接分析。需要知识库时，显式提供实际目录，不假定相邻私有仓存在：

```text
node scripts/learning-cli.mjs source knowledge:domain:示例 <knowledge-root>
```

解析器只读，保留来源、哈希与状态。私有 v2 稳定引用和公开 Knowledge 便携框架的接口可能不同；公开库优先按其 README/QUERY_PROTOCOL 查询，Agent 实际读取材料后再消费。不存在的引用、缺少原则 Provider 返回 unavailable，不能当成事实缺乏或成功读取。替代知识库可按自身协议读取，不必为了 GameAnalysisDecision 安装 Knowledge。具体来源消费见 [只读边界](../protocols/knowledge-boundary.md)。

专业内容的状态、查询顺序与阅读限制只按[统一选用规则](../protocols/selection.md)；Provider返回实际加载正文及来源计划，不执行分析或自动证明来源支持。
