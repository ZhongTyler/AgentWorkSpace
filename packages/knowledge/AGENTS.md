<!-- knowledge-identity:display-name -->
# Knowledge Base · 运行规则

这是纯知识查询与消化框架。运行职责只有 Query、Ingest、Lint、初始化和发布包维护；不包含本地专家、Team、Procedure、Method、评测或记忆系统。

- Query：读取 `system/protocols/QUERY_PROTOCOL.md`，按证据需要选择检索深度。
- Ingest：读取 `system/protocols/INGEST_PROTOCOL.md`，只在明确写入意图时修改库。
- Lint：读取 `system/maintenance/checklists/knowledge-health-check.md`，默认只报告。
- 仅在本次变更使其失真且具有明确维护范围时同步 registry、NOW 和 CHANGELOG；发布包只能由源输入确定性生成。

- 标准interactive默认；显式自动deferred。两者同等质量，未经当前精确批准不得finish。
- 新建运行使用schema8与RAW_STANDARD_V2全文双向独立审核；历史运行按原版本解释，迁移须按raw-v2-migration.md显式授权与保全。
- 只读健康使用统一run-knowledge-health.ps1；按输入与规则版本复用，过期/变更/失败必须重验。

本版的合并执行、主审核者、精确版本收尾与可选研究/知识复利接线见 [便携执行说明](system/protocols/PORTABLE_EXECUTION.md)。模型、会话、资料绑定和外部发布均由接收方配置与授权；安装不启动这些行为。
