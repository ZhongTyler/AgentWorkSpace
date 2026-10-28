# 知识库指令手册

| 表达 | 实际行为 |
|---|---|
| 查询知识库 / 直接提问 | 按问题需要发现、读取、核对与交付来源；核心Wiki读透，补充按需。system/query/query-evidence.mjs提供真实工具。 |
| 深查 / 不查库 / 联网 / 不联网 | 分别覆盖阅读范围和来源权限，互不代替。 |
| 消化材料 / 标准消化 | 默认interactive，评分、raw、Wiki归属分段审核。 |
| 自动消化 | 显式deferred，同一质量核心，中途checkpoint，最终精确审核。 |
| 快速消化 | 标准质量与介入方式，仅精简展示，不转成自动。 |
| 健康检查 / Lint | run-knowledge-health.ps1默认只读；-Scope full明确全检，-PreviousReport复用未失效模块。 |
| 修复 / 同步派生状态 | 先明确owner、范围与恢复点，再修复并复验；正文/原则/Group/历史审批不因检查可写。 |
| 初始化知识库 | setup-wizard.ps1展示dry-run后按明确参数Apply。 |

完整协议：system/protocols/QUERY_PROTOCOL.md、INGEST_PROTOCOL.md、system/maintenance/checklists/knowledge-health-check.md。普通提问不启动Ingest或状态维护。

本版的合并执行、主审核者、精确版本收尾与可选研究/知识复利接线见 [便携执行说明](system/protocols/PORTABLE_EXECUTION.md)。模型、会话、资料绑定和外部发布均由接收方配置与授权；安装不启动这些行为。
