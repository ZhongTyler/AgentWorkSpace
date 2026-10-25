# GameAnalysisDecision

直接提出游戏设计、系统、体验或交付问题。Agent 从 [分析协议](protocols/analysis.md) 开始，核对项目事实、选择相关方法、实际查证，再给出条件建议。没有其他包也能分析，不要求填写表格或启动专家团队。

- [专业目录](agents/catalogue.json)：完整的现行专家、视角、6 个 Method 与 13 个 Procedure；按需读取，未正常启用的候选不默认装配；default_use条目按题直接选用。
- [问题与操作](agents/BUILD_GUIDE.md)、[统一选用规则](protocols/selection.md)、[交付](protocols/delivery.md)、[学习与撤回](protocols/learning.md)。公开包的学习状态从空白开始，不继承私人验收。
- [Provider](providers/README.md)：Knowledge 可选；缺少材料只收窄相关结论。
- [v2 交接](adapters/v2/README.md)：Brainstorm、FromDemoToSpec 或自定义宿主使用同一权限边界。

在包目录运行（Node.js 22+；学习基线验证另需 Git）：

```text
node scripts/learning-cli.mjs audit
node scripts/learning-cli.mjs resolve examples/query.json
node scripts/learning-cli.mjs lookup examples/query.json
node --test tests/test-provider-v2.mjs tests/test-learning-v2.mjs tests/test-adapter-v2.mjs tests/test-analysis-math.mjs
```

示例是明确存在分析缺口时选择候选；结果是方法正文，不是已完成分析。来源列表不是已读材料，工具通过不是方法收益或真实体验通过。普通结论由宿主消费；正式决定、真实 Play 和新增授权由用户拥有。版权与原来源授权不因公开改变。
