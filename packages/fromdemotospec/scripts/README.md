# 包内工具

Node.js运行prototype-project.mjs（init／check-state）和fromdemotospec-analysis-adapter.mjs。Windows PowerShell运行校准、资源导入／内联和本地反馈工具。实际用法与状态字段见[项目工具](../docs/project-tools.md)。

- new-presentation-calibration.ps1：-ProjectPath、-PrototypeId，默认预览，加-Apply生成presentation/calibration.md，拒绝覆盖。
- import-presentation-assets.ps1：-SelectionPath、-AssetRepositoryPath、-ProjectPath，默认只核查，加-Apply导入；-VerifyOffline检查项目副本和来源证据，single-file另核对内联索引的ID、完整性与解码字节哈希；输出单列inline_index_verified和final_html_verified，不读取最终HTML；-PublicRelease额外检查许可标记，不能代替发布授权。
- inline-presentation-assets.ps1：-HtmlPath、-InlineAssetsPath，默认读取索引旁的asset-manifest.json，也可传-AssetManifestPath。核对全部ID及解码字节哈希后才原位封装，失败不改HTML。旧索引缺少schema_version:1或可信清单时先恢复有效导入记录，不跳过核验。最终HTML仍需实际运行并记录构建哈希；可持续工程直接用文件。
- new-learning-feedback-candidate.ps1：-ProjectPath、-PrototypeId、-PrototypeVersion、-UpstreamSession、-DecisionId，生成本地draft，拒绝覆盖；旧DemoRoot方式仍兼容。
- validate-learning-feedback-candidate.ps1：-FeedbackPath，只读核对格式，不写Knowledge。
- fromdemotospec-analysis-adapter.mjs：status、prepare-request --input、prepare-unavailable --input、consume-delivery --input --consumer、prepare-host-decision --input；v2通过包内game-analysis-decision-v2-binding.mjs接入可选的相邻GameAnalysisDecision，缺少GameAnalysisDecision时明确返回unavailable并继续普通制作。重要产品决定仍需真实用户来源；旧决定回执保持v1。详见[分析接入](../adapters/game-analysis-decision/README.md)。

status 展示当前 GameAnalysisDecision v2 请求/正文消费及 HostDecisionReceipt v1 回执，历史请求合同放在 legacy 内，仅显式 schema_version=1 使用。binding_ready 表示转换接口，不代表分析已执行。

使用[schema2资源示例](../examples/presentation-selection-v2.json)，按[表现协议](../protocols/presentation.md)处理非资产库来源。反馈与跨仓责任见[反馈合同](../04-agent-learning-feedback.md)。

包内tests目录提供合成合同检查。测试结果只覆盖工具行为，不代表游戏、引擎或真人验收完成。维护发布生成器不属于使用方运行依赖。
