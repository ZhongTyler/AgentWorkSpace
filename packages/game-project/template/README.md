# __PROJECT_NAME__

状态：正式开发初始化完成；Godot 工程尚未创建。

这是项目总入口。开始任何工作前，先进入 [maintenance/](maintenance/README.md) 完成操作路由。

## 目录

- [builds/](builds/README.md)：独立包、候选包与历史构建骨架；未生成游戏产物。

- [assets/](assets/README.md)：项目资源规划、唯一清单、来源、制作与交付版。

- [maintenance/](maintenance/README.md)：操作流程、健康检查、配置与变更记录。
- [docs/](docs/README.md)：产品、工程、交付、验证和决定的权威文档。
- [Game/](Game/README.md)：可配置的 Godot 工程位置。

## 关键文件

- [NOW.md](NOW.md)：当前里程碑和下一步。
- [AGENTS.md](AGENTS.md)：项目协作边界。

`Game/` 是模板默认名；创建项目时可以替换为项目指定的工程目录，实际值由 `maintenance/project-config.json` 拥有。

## 初始化

1. 复制本目录为新项目工作空间，并替换 `__PROJECT_NAME__` 与 `__PROJECT_ID__`。
2. 若存在 FromDemoToSpec 原型产物，先按 [初始化流程](maintenance/workflows/initialization.md) 将该原型的完整可运行单元整体迁入 `demo/`；不得只挑选代码、丢失证据，或复制出第二套设计／验证 SSOT。
3. 重命名 `Game/` 为项目决定的工程目录，同时更新 `maintenance/project-config.json`、根 README 与 `.gitignore`。
4. 配置 assets.workflow_contract 为可达合同或已验证离线快照；不可达只保全/检查，不发布资源。
5. 按需建立当前领域的 SSOT；不要把空白占位说明误当作产品或技术规格。
6. 在项目根运行 `node maintenance/scripts/health-check.mjs`，通过后再开始首个功能切片。
