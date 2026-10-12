# AgentWorkSpace

**简体中文** | [English](README.en.md)

**为 AI Agent 搭建可持续使用的工作区，也能接入你已有的项目：保留现有规则，按需补上协作方法、Skills 和业务模块。**

当一个项目要持续推进，你可能需要反复交代规则、整理上下文、选择方法，再把产物留给下一次任务。AgentWorkSpace 把这些做法整理成可安装、可升级的文件和工具，由 Agent 按当前任务读取和使用。

- **已有工作区**：先审计当前需要，复用经过审阅的现有能力，只安装所选模块和缺失的依赖。
- **新建工作区**：安装完整协作框架，再选择脑暴、知识管理、旅行规划或游戏开发模块。
- **只想用几项 Skill**：单独接入 Skills 包，再按名字安装，不必采用整套框架。

目前已发布可试用版本，正在积累公开案例；**还没有可展示的完整端到端案例或演示视频**。下文列的是可用能力与操作示例，工程检查不能证明长期收益、创意质量或游戏体验。游戏开发是目前模块覆盖较多的应用方向，基础协作与 Skills 也可用于其他任务。

[新建工作区](#从这里开始) · [接入已有工作区](#已有工作区先审计再按需接入) · [选择模块](#接入后怎样使用) · [复用许可](#许可与内容边界)

把本仓路径和目标工作区路径交给有文件读写与命令执行能力的 Agent，例如：

> 阅读发布仓的 README 和相关包说明。我的目标工作区是……，这次需要脑暴和原型开发。若已有规则就先审计并复用，否则搭建新工作区；给出安装计划，再应用没有冲突的变更。

meta 只有一个完整版，无需选择功能组合。新建工作区默认安装它；已有工作区可以使用兼容模式，复用现有框架，只补当前需要的包与缺失能力。规则和方法随任务读取，不代表每次任务都要跑完整套流程。

## 从这里开始

把本仓克隆或下载到一个独立目录，用户工作区放在另一个目录。统一工具和 Skills 选择安装器需要 Python 3.10+；GameAnalysisDecision、GamePresentation、PrototypeAssets、Travel 的工具需要 Node.js 22+。Brainstorm、FromDemoToSpec 及部分 Knowledge 工具另需 PowerShell 7，Knowledge 首次 Ingest 还需 Git。本次运行验证在 Windows 完成，其他平台按包内说明检查环境。

在发布仓目录运行，先预览，再应用：

```text
python scripts/workspace.py doctor
python scripts/workspace.py init --target <workspace-path> --packages brainstorm fromdemotospec knowledge
python scripts/workspace.py init --target <workspace-path> --packages brainstorm fromdemotospec knowledge --apply
python scripts/workspace.py status --target <workspace-path>
```

上述默认 full 模式中，`--packages` 可以为空，也可以只写需要的包；meta 始终安装。以后加包用 `add`，升级用 `upgrade`。命令默认只预览，加 `--apply` 才写入；出现 `conflicts` 时先解决具体差异。

## 已有工作区：先审计，再按需接入

如果已有协作规则、知识库或其他模块，先告诉 Agent 当前需要，例如“我现在只需要脑暴，审计现有框架并推荐接入方案”。兼容模式会列出已有能力、推荐的可选项，以及所选包确实缺少的依赖。现有模块经过审阅能够替代依赖时直接复用，不要求安装 meta；候选文件的名称本身不能证明兼容。

审计也覆盖 package 与现有同类模块、工作流的重叠和接入边界。按需安装、后续加包或实际接线时，Agent 根据 `package_review` 检查职责、输入输出、调用入口、权威和数据归属，说明是否需要兼容，再结合实际工作区提出方案。复用现有模块而不安装、并存或适配均可考虑，具体方式不预先定死；依赖满足和文件无冲突不代表业务兼容已通过。未定方案不触发自动合并或迁移。

```text
python scripts/workspace.py audit --target <workspace-path> --needs brainstorm
python scripts/workspace.py audit --target <workspace-path> --packages brainstorm --profile <reviewed-profile.json>
python scripts/workspace.py init --target <workspace-path> --mode compatible --packages brainstorm --profile <reviewed-profile.json>
python scripts/workspace.py init --target <workspace-path> --mode compatible --packages brainstorm --profile <reviewed-profile.json> --apply
```

Agent 按审计返回的 criteria 审阅现有规则与接口，记录理由、证据路径和哈希，生成 profile；证据变化时重新审阅。缺少必需能力时，可以选择完整 meta，或确认现有替代模块。兼容模式不自动增加包：业务包放 `modules/<id>`，选装 meta 放 `modules/meta`，根规则与首页保持原样。首次使用让 Agent 读取新建的 `agent-workspace-compatibility.md`；自动导航与 Skill 发现仍按实际平台核对。详见[兼容模式说明](docs/compatible-workspace.md)。

## 接入后怎样使用

本仓由 **meta 底座和 9 个并列的 package** 组成。meta 提供协作规则与工作区框架；full 模式安装在根目录，兼容模式选装到 `modules/meta`，可直接交代目标、约束和完成标准。其余 package 都按需要选择，表中顺序不表示层级或安装优先级。Brainstorm、FromDemoToSpec、Knowledge 所需的宿主治理能力，可由 meta 或经过审阅的现有框架提供。已有工作区可以复用审阅过的能力，无需为了可选集成安装其他包。

[meta 使用说明](meta/README.md) · [各包依赖与工具环境](docs/package-dependencies.md)

| package | 用途与任务示例 | 安装位置 | 独立使用与可选集成 |
|---|---|---|---|
| [Brainstorm](packages/brainstorm/README.md) | “一起脑暴这个问题……”；会话随任务创建 | `modules/brainstorm` | 无需其他业务包；Knowledge、GameAnalysisDecision 可选 |
| [FromDemoToSpec](packages/fromdemotospec/README.md) | “制作一个可玩原型……”；在独立项目目录开发 | `modules/fromdemotospec` | 无需其他业务包；知识、分析、表现与素材包按需接入 |
| [Knowledge](packages/knowledge/README.md) | “查询知识库”或“消化这些材料”；空库也可查询 | `modules/knowledge` | 无需其他业务包；首次 Ingest 前配置知识范围与本地 Git |
| [Skills](packages/skills/README.md) | 16 项开发、研究、表达与工作流方法，按名字选择安装 | `modules/skills` | 不需要其他模块；安装库不会自动启用全部 Skill |
| [GameAnalysisDecision](packages/game-analysis-decision/README.md) | 有事实依据的游戏问题分析、条件建议与方法校正 | `modules/game-analysis-decision` | 可单独使用；Knowledge 与其他宿主包可选 |
| [GamePresentation](packages/game-presentation/README.md) | 表现规格、资源制作与 Godot 交付、恢复 | `modules/game-presentation` | 可使用手工或生成来源；PrototypeAssets 可选 |
| [Travel](packages/travel/README.md) | “帮我研究并规划这趟旅行……”；生成私人离线网站 | `modules/travel` | 可单独使用；无必装包，采集服务、浏览器验收和服务器可选 |
| [PrototypeAssets](packages/prototype-assets/README.md) | 119 项有来源和许可记录的精选，以及校验导出工具 | `modules/prototype-assets` | 素材和许可复制后，游戏不依赖来源包 |
| [Research](packages/research/README.md) | MD/网址/问题研究、游戏设计研究和可选主动探索 | `modules/research` | 可单独使用；Knowledge、MCP、媒体工具和宿主调度按需授权 |

点击表中的包名，查看该包的快速开始、任务流程、环境要求与使用边界。安装统一使用上文的 `init`；已有安装通过 `add --packages <package-id>` 预览，加 `--apply` 应用。

框架接入后即可开始任务，业务内容按实际需要产生。FromDemoToSpec 的包内文档是开发工作流，游戏工程在具体任务中创建。Knowledge 首次 Ingest 前，Agent 要根据真实用途补充知识范围，并在模块内建立独立本地 Git 基线；已有库保留历史，不借用外层仓库，不自动创建远端或推送。原向导保留供独立定制，安装后无需重复问答，也不要改动已登记的模块目录名。

项目可以放在 `projects/` 或你指定的目录。会话、知识正文和用户配置留在目标工作区，不写回本发布仓。`.agent-workspace/state.json` 只记录已装版本和框架文件基线，不拥有业务事实。

meta 还包含 [Humanizer-zh](meta/workspace/.agents/skills/humanizer-zh/SKILL.md)。需要润色中文时，可让 Agent 使用它减少空话、重复和模板化表达，同时保留事实、确定程度和作者声音。它是编辑指导，不是作者身份检测工具；英文说明也应保持同样的准确性。

## 按需选择 Skill

Skills 也是上表中的一个 package。安装它之后，再选择要启用的方法；其他 package 同样通过 `add --packages` 按需增加。以下命令只是示例，请替换为当前需要的包和 Skill。

```text
python scripts/workspace.py audit --target <workspace-path> --needs skills
python scripts/workspace.py add --target <workspace-path> --packages skills
python scripts/workspace.py add --target <workspace-path> --packages skills --apply
python <workspace-path>/modules/skills/scripts/skills.py list
python <workspace-path>/modules/skills/scripts/skills.py install --target <workspace-path> --names systematic-debugging property-based-testing
python <workspace-path>/modules/skills/scripts/skills.py install --target <workspace-path> --names systematic-debugging property-based-testing --apply
```

CodeBuddy 选择安装时加 --platform codebuddy。Skill 的更新和回退单独管理，不会覆盖同名的用户改动；游戏路由方法在没有可选包时仍可按项目事实与可用工具工作。当前工程检查不代表方法长期收益或表现效果已通过用户验收。

## 兼容、升级与恢复

当前版本和组件库存见 [catalog.json](catalog.json)。每版声明直接前一版，并在 `upgrades/` 提供兼容范围、操作步骤和恢复方法。不要改写已发布 tag，也不要跳过未声明的版本。

```text
python scripts/workspace.py upgrade --target <workspace-path>
python scripts/workspace.py upgrade --target <workspace-path> --apply
python scripts/workspace.py rollback --target <workspace-path> --transaction <transaction-id>
python scripts/workspace.py rollback --target <workspace-path> --transaction <transaction-id> --apply
```

升级比较原基线、本地文件和新版内容。双方都改过的文件会报告冲突；上游未变的文件保留本地编辑或删除。用户数据保留，每次应用都有事务备份；回滚也会检查事务后的改动。

目前尚无用户使用，本次统一全称不保留旧名称别名，也不自动迁移旧会话字段、工件或用户数据。通用版本升级、冲突检查与回退继续保留；历史 tag 不改写。新接入使用当前全称入口，详见 [1.4.0 说明](upgrades/1.4.0.md)。

异常终止若留下 `install.lock`，先核对 PID 和实际进程；确认没有安装操作后，保全证据并移除锁，再预览事务恢复。不要自动清除另一进程的锁。

## 维护与发布

正文和业务行为在来源仓维护，再直接发布到本仓所属的 `meta/` 或 `packages/<id>/`。各来源不再为这些公开包生成另一份 released 副本。来源提交后运行 `scripts/publish.py --source <source-path> --apply`；默认只预览，未提交的来源不能正式发布。

发布前验证受影响的来源合同、包内运行和上一版升级，运行 `python -B -m unittest discover -s tests -v`。写好升级说明后，用 `scripts/build_catalog.py --version <version> --previous <previous-version>` 固定库存，再运行 `workspace.py verify`。tag 对应已验证提交，公开后从远端新克隆复核。

中文首页和 [English](README.en.md) 用相对链接切换。更新时同时核对两页的功能、命令、版本、限制和许可；不要只翻译开头，也不要让两种语言描述不同的行为。包内详细文档目前以中文为主。

## 许可与内容边界

作者原创代码与文档采用 [MIT 许可](LICENSE)，可以按该许可使用、修改和再分发，包括商业使用，并保留版权与许可声明。**这不表示整个仓库只有一种许可**：第三方 Skill、素材、字体及受来源限制的内容保留各自条款，详见[第三方许可与例外](THIRD_PARTY_NOTICES.md)。其中 property-based-testing 为 CC BY-SA 4.0；Brainstorm 的 How Might We 方法来源登记有非商业限制，相关卡片不纳入根 MIT 授权。复制或再分发时，请同时携带适用的许可和来源记录。

Knowledge 公开包维护独立便携 framework 2.0 实现，不等同于私有宿主最新 consolidated 控制器。仓库不含私人知识、会话、画像、运行收据或凭据。工程检查不能代替创意质量、真实游戏体验、用户内容审核或长期效果验证。

## 试用与反馈

可以先在一个可丢弃的目录试装，或从已有工作区的一项具体需要开始。欢迎通过 [Issues](https://github.com/ZhongTyler/AgentWorkSpace/issues) 告诉我：你想完成什么、选了哪些模块、卡在哪一步，以及预期与实际结果。提交日志前请移除私人内容和凭据。

如果这个方向对你有用，欢迎 Star 收藏。当前最需要的是实际试用、接入问题和改进建议；完整案例会在有可公开、可复核的结果后补充。
