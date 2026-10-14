# FromDemoToSpec → GameAnalysisDecision

GameAnalysisDecision 提供分析、条件建议和待制作人决定的方案；FromDemoToSpec 拥有项目事实、工程、真实试玩与正式产品决定。现有项目授权和预算内可按需调用，无需用户逐次发命令。普通实现和已有明确决定不重复分析。

## 当前入口：v2

`status` 展示当前 GameAnalysisDecision v2 请求及正文消费命令、独立保留的 HostDecisionReceipt v1，以及明确标为 legacy 的旧请求合同。`binding_ready` 仅说明适配接口，不证明外部分析已执行；实际可用性仍以对应请求/消费结果为准。

直接提出问题即可，Agent 按需读 GameAnalysisDecision 的 `protocols/analysis.md`。只有跨程序传递才使用 [request-v2.json](../../examples/game-analysis-decision/request-v2.json) 的最小请求；`schema_version: 2` 显式选择新版。目标、来源范围、约束、预算和宿主引用保持原样传递，不再把请求转换成一条强制文档生产链。

```powershell
node scripts/fromdemotospec-analysis-adapter.mjs prepare-request --input examples/game-analysis-decision/request-v2.json
node scripts/fromdemotospec-analysis-adapter.mjs consume-delivery --input delivery.json --consumer consumer.json
```

consumer.json 指定 `hostType: "fromdemotospec"`、实际 `hostRef` 和保存报告的绝对 `artifactRoot`；如需在已有授权内验证，再给出从真实宿主授权记录核实的 `authorizedRefs`。这些参数是调用方声明，不能用虚构引用获取授权。

[GameAnalysisDecision v2 binding](../../scripts/game-analysis-decision-v2-binding.mjs) 调用相邻 GameAnalysisDecision 的 `scripts/adapter-v2.mjs`，以其 v2 schema 和语义校验为权威。独立安装缺少该模块则明确 unavailable，继续正常制作，不加载旧 Knowledge 专家；模块存在但损坏必须报告错误。

## 一份正文，按动作承接

- 普通分析：核验正文 SHA256 后直接消费同一正文，不增加人工签字或第二份审阅简报。
- 已授权的查证：只读验证可继续；其他宿主已有授权的验证须匹配真实授权引用。返回行动建议不等于工具已执行验证。
- 重要取舍：同一正文应说清推荐、依据、代价、替代选择和最大未知；用户在宿主决定。既有“核心玩法获用户本人认可才可 90+”不变。
- 新增授权：先完成可独立完成的分析和可审阅方案，再向用户提出具体行动。
- 证据不足／终止结果：保留真实范围，继续有价值的补证或记录终止，不把所有不足都转成人工门。

GameAnalysisDecision 不写项目、不接受决策、不运行实验。宿主必须读正文并检查语义是否与 action_class 一致；字段和哈希检查不能证明建议正确或授权真实。正文可以挂到项目已有记录，不必重新改写。

用户正式决定先在项目记录，再沿用 `prepare-host-decision` 生成只读 v1 HostDecisionReceipt。producer_confirmed 与 host_record_confirmed 必须来自真实会话和宿主记录，不能靠填 true 伪造。

## 明确保留的 v1

[contract.json](contract.json) 固定历史 v1；现有 `fromdemotospec-request.json`、旧别名、告警和 2026-09-30 兼容期限继续按 v1 解释。v1 全部 human_review 的原义没有改写。新请求使用 v2，不把旧结果偷偷重标版本。主策划别名不授予制作人权限。

两个版本的脚本均只返回数据，不写游戏或发布物。示例和合同测试不是实际项目认可。
