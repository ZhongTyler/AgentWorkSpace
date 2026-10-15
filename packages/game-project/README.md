# GameProject · Godot 项目工作区模板

给正式游戏开发建立一个可维护的项目工作区：项目事实、产品与工程文档、既有决定、资源和构建各有入口，健康检查帮助发现断链、状态漂移与接收遗漏。当前提供 Godot 模板 0.2.5；这是工作区骨架，不含可玩游戏、场景或预装系统，Godot 工程由使用者选定版本后另行创建。

## 安装与新建项目

需要 Python 3.10+ 运行创建器、Node.js 22+ 运行维护检查。真正创建、构建和运行引擎时才需要项目选定的 Godot 4。meta、FromDemoToSpec、GamePresentation、Knowledge 和其他 package 都不是必装依赖。

在 AgentWorkSpace 发布仓先运行 `python scripts/workspace.py audit --target <workspace-path> --needs game-project`，审阅已有同类项目模板与流程；用 `init --mode compatible --packages game-project` 预览，加 `--apply` 安装到 modules/game-project。已有 AWS 安装用 `add --packages game-project`。

在目标工作区运行：

```text
python modules/game-project/scripts/create-project.py --target ./projects/my-game --name "My Game" --id my-game
python modules/game-project/scripts/create-project.py --target ./projects/my-game --name "My Game" --id my-game --apply
node projects/my-game/maintenance/scripts/health-check.mjs projects/my-game
```

可用 `--engine-directory Engine` 改默认 Game 目录。创建器核对模板清单和哈希，替换项目身份、更新工程目录与路由；预览不写入，现有目录、链接路径、模板包内与受管 modules/state 路径拒绝创建。发生部分写入失败时只恢复本次已写且字节未变的文件，其他写入者内容保留。报告成功后再按项目维护入口配置真实用途。

创建后 engine.state 仍为 not_initialized，Godot 版本与目标平台未定，资产和旧决定接收表为空，不生成 demo、启动器、Git 远端或周期任务。空决定接收警告说明尚无来源登记，不表示已经接收完毕。生成的项目不依赖模板包运行，移走或回滚模板包后仍可检查和维护副本。

## 已有项目与可选协作

已有项目不使用新建器覆盖。Agent 先核对项目现有维护方式、目录与引擎位置、决定来源、资源和交付流程；可以复用同等能力、选择性吸收模板，或保留原结构。实际改变范围、映射与回退点确定后才执行，不只按文件名判断兼容。

| 可选支持 | 怎样使用 | 缺少时 |
|---|---|---|
| FromDemoToSpec / Brainstorm | 整体保留已有原型及证据，再逐项接收已有决定；迁入 demo 与确定里程碑是另行审阅的项目动作 | 从真实需求与其他决定来源初始化，不制造原型或历史 |
| GamePresentation / PrototypeAssets | 在用户项目中定位资源合同，审核用途、来源、许可、工作版与引擎交付 | 可用已审阅的本地流程、手工或生成来源；合同缺失不冒称资源发布通过 |
| Knowledge / GameAnalysisDecision / Research | 针对实际判断缺口取得材料或分析，结果回到所属项目 | 使用项目事实和可用方法，明确相关证据限制 |
| Skills / Tools / meta 或现有框架 | 按需要使用方法、配置过的工具及宿主协作规则 | 不自动安装、启用、连接或替换宿主权威 |

既有项目或原型中的事实和决定由原文及当前领域文档拥有。模板不替项目做产品决定，不能把暂未实现的内容当作尚未决定，也不能把历史试玩认可移到新版本。

## 模板里有什么

| 目录 | 作用 |
|---|---|
| template/maintenance | 任务路由、状态、决定接收、资源、交付与升级；只读维护检查 |
| template/docs | 产品、工程、验证、交付与决定；草案、权威与历史分开 |
| template/assets | 空清单、规格、来源、工作版与交付版 |
| template/builds | Windows 构建分区与布局检查；尚无构建或启动器，不据此推定目标平台 |
| template/Game | 默认引擎位置说明；没有 project.godot |

模板入口见 [项目说明](template/README.md)、[维护入口](template/maintenance/README.md)、[初始化与原型接收](template/maintenance/workflows/initialization.md)及[工程指导](template/docs/engineering/godot-practices.md)。创建器只复制 [封存清单](template-inventory.json) 中的文件；新增通用内容先审阅，再更新来源清单和发行库存。

## 验证、升级与许可

```text
python -B -m unittest discover -s tests -v
node --test template/maintenance/scripts/test-build-layout.mjs template/maintenance/scripts/test-decision-reception.mjs
node template/maintenance/scripts/health-check.mjs template
```

AWS 升级更新模板库，回滚恢复安装器拥有的库文件；包外项目与其定制不被接管。已创建项目按 [选择性升级](template/maintenance/workflows/upgrade.md) 比较源/目标模板版本、实际 diff、项目定制与恢复点，选择必要变化后验证，不能直接重拷覆盖 SSOT。外部引擎、资源流程和工具配置另行管理。

本次 Windows 工程检查覆盖空模板结构、创建边界、决定接收、构建布局与安装恢复，不证明游戏可玩、跨项目收益、资源效果或其他系统已经验收。模板仅引用 Godot 官方说明，不附带 Godot 引擎或第三方游戏源码。作者原创代码与文档采用 [MIT](LICENSE)；未来导入素材和引擎的许可按各自来源保留。
