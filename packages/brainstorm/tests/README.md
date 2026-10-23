# 独立包验证

运行 [run-release-contract.ps1](run-release-contract.ps1)。验证范围与证据限制见 [VALIDATION](../VALIDATION.md)。发布构建、Git 集成和私人效果审计不属于本包。

便携边界回归：`tests/workflow-health.contract.ps1 -Portable` 检查来源、关闭写入、继续位置、路径及恢复；`tests/adapter-system.contract.ps1 -Portable` 检查来源快照、接收清单和映射重建。它们仅创建合成临时数据，不改变用户会话或启动下游。
