# GamePresentation

游戏表现资源从用途规格、样张、生成或选型，到真实引擎接入与恢复的工作流。直接让 Agent 阅读 [workflow](workflow.md)，位图制作读 [generated-art](generated-art.md)，资产管理读 [project-assets](project-assets.md)。仅需局部修改时按实际缺口进入，不强制整套流程。

用户选择本地生图时，读[本地素材流程](local-image-workflow.md)：可选Tools统一生成/加工，再用实际尺寸审图工作台核验候选。安装不下载模型、不启动生成、不授予清理或项目采用；性能停止条件和未采用路线限制保留。

核心不依赖其他发布包。手工或生成 PNG 可以走工作台；外部素材可来自 <asset-source> 或符合相同来源、许可、哈希合同的目录。GameAnalysisDecision、FromDemoToSpec、图像生成工具均为可选能力，缺少时仍可做规格、选型与现有资源交付；生成与引擎验证需要实际相应工具，不能冒充执行。

Node.js 22+；实际引擎验证需要 Godot 4。先建立独立用户项目：

```text
node scripts/init-project.mjs --target <new-project>
node scripts/init-project.mjs --target <new-project> --apply
node --test tests/delivery.test.mjs tests/workbench-delivery.test.mjs tests/publish-directory.test.mjs
```

[Godot 交付](adapters/godot/README.md)适合审核过的外部素材；[两段工作台](adapters/godot/workbench.md)支持 receive/generated → seal → publish。默认预览，显式 apply 才写；用事务收据识别所有权，冲突与人工修改阻断写入。运行资源和许可复制进工程，移走本包或素材仓后仍可使用。

现有源项目曾验证 PNG/WAV/OGG/OTF 及 Godot 打包恢复；TTF 和其他引擎不继承实例证明。公开包工程测试只验证合同、事务及合成样例，不证明美术、听感或跨项目效果。版权和原素材许可不因公开改变。

Windows 目录落盘遇到 EPERM/EACCES/EBUSY 时，最多追加 6 次短暂重试，总等待不超过 1.575 秒；目标在等待中出现、权限持续不足或其他错误仍明确失败，不覆盖另一写入者。
