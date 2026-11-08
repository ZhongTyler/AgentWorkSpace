# 项目资源工作台

与 docs 和引擎平级，规划/制作/评审集中；引擎只接收精选。从 [维护流程](../maintenance/workflows/assets.md) 进入。

[资源规划](resource-plan.md) · [唯一结构化清单](catalog.json)

资源制作批次在work中保存审阅图册，覆盖独立资源、尺寸/底色、状态实际组合和本次检查。具体要求取GamePresentation的resource-review.md。

## 目录

- [specs/](specs/README.md)：按用途管理规格，正文直接在本层。
- [sources/](sources/README.md)：不可变来源版本，不由运行时读取。
- [work/](work/README.md)：加工、预览与按用途评审。
- [releases/](releases/README.md)：通过门后的引擎交付版本。目前为空；发布器待下一切片。
- [draft/](draft/README.md)：整体资源规划草案。
- [archive/](archive/README.md)：整体资源文档历史，不重写过去的验证结论。

## 固定图册

通过[open-asset-atlas.cmd](../maintenance/previews/open-asset-atlas.cmd)打开[index.html](index.html)，统一查看类型、用途、需求、候选/采用/安装版本及审阅。字段和操作见[图册合同](specs/project-atlas.md)，功能更新见[变更记录](atlas-changelog.md)。历史制作批次保留源和证据，当前审阅从固定入口进入。

[页面需求](atlas-pages.json)按系统和页面登记状态条件、控件组合及资源关系。

[媒体归档索引](atlas-media-archive.json)保留历史媒体路径、哈希和时间，在图册变更记录中按需搜索查阅。
