# Research

将 Markdown、网址或具体问题转成有来源、有适用边界、能支持下一步的判断。

从 [轻量研究协议](RESEARCH_PROTOCOL.md) 开始；执行入口为 [research-study](.agents/skills/research-study/SKILL.md)，输出可裁剪 [报告模板](templates/research-note.md)。主题报告由使用者在本地维护，本初始包不包含维护者的私人研究材料。

[深入验证指南](validation/README.md)与[候选模板](templates/validation-candidate.md)将后续试验接入开题、收尾和原复盘窗口。使用者在包外维护自己的清单：按真实缺口、触发条件和owner选题，结果先回原报告再同步状态。安装不携带维护者私人候选，不自动启动试验或新增调度。

本包工具示例以安装包根目录（通常为 `modules/research`）为当前目录；研究报告、采集媒体和队列放使用者指定的包外目录。文档中的维护者历史试跑仅说明已观察范围，不代表接收者已连接或已验收；当前访问、权限和来源覆盖仍须本人核查。

[初始来源目录](sources.json) 包含十一项来源，当前八项正式可选、三项暂停或放弃保留备选；按问题选少量互补来源，跳过停用项。原始文档、论文与源码仍是关键底本。

[游戏设计与拆解](game-research/README.md) 增加十组游戏专门来源、奖项/会议等跨来源筛选维度及视频文字获取路径；有用完整材料可在获得授权后交宿主 Knowledge 自动消化。[每周探索](proactive/README.md) 附带频率、预算和[有用增量/新保留候选简报](proactive/reporting.md)设置模板；安装不自动创建或启用任务。需要使用者在自己的调度器中授权创建，Knowledge 最终精确报告批准规则仍保留。

[MCP 安装和恢复说明](integrations/mcp/README.md) 提供固定依赖、源码/顶层发行包、许可证与配置。账号来源需使用者本人授权，不把维护者凭据带进初始包；普通连接失败时继续文件/网址路径，用户停用的渠道不自动改走网页。

[REA 发行产物研究](integrations/rea/README.md)提供固定 CLI/MCP 接线、可选 `$rea-investigate` skill 和匹配官方参考。需要时明确安装到包外 runtime，再选择注册 MCP/安装 skill；包安装不会自动执行这些动作。完整源码分析仍优先读源码。[工具与证据保存规范](templates/tool-storage.md)区分结论、实验、工具锁、运行依赖、凭据及知识采用，个人内容不随发布或升级迁移。

[游戏开发支持](game-research/development-support.md)说明如何在参考机制调查、开发工具评估与发行版差异排查中按需组合Research、Knowledge、GameAnalysisDecision和REA；Skills包可选提供 `game-decision-support` 入口。缺少模块时沿宿主已有能力继续，不自动补装依赖；证据回项目，体验收益仍需原型与真实Play验证。

[浏览器工具](integrations/browser/README.md)附带SingleFile与Obsidian Web Clipper官方固定版本的准备脚本/哈希；扩展为可选辅助，加载不等于保存链路可用。默认采用原生浏览器读取/字幕/截图与[本地公开网页采集、OCR](integrations/media/README.md)，按[媒体路径](game-research/media-capture.md)保留必要图义和视频时间码。正式游戏消化围绕主题优先3–4篇、最多6篇，不足不凑数。包内不含维护者页面快照、媒体、浏览器profile或354MB本机运行时。

目录附带与工具接通是两回事。安装资料仍需联网取得依赖和连接远程服务，不是完整离线镜像。本包通过 AgentWorkSpace 按需安装到 modules/research；正式版本、来源提交和文件清单见发行说明、catalog 与 _release.json。安装不创建周期任务、连接账号或授予自动入库权限。研究报告与采集材料放在使用者指定的包外目录，升级和回滚不会接管它们。

## 可选通用 Tools

独立 Tools 包集中维护三模型决策网关、REA、媒体和来源工具。Research 保留问题、材料、实测与采用依据；Knowledge 保留知识，项目保留决定。新配置优先使用 Tools 包外版本化 home；本包既有 integrations helper 保留兼容，不迁移历史试验，不自动重写现有 MCP 路径。缺少 Tools 时原 Markdown/网址/Agent 研究路径继续可用。

每轮可按需运行工具轻量检查；只在代码/依赖变更时做相关回归、握手与小输入，效果复盘记录使用、纠正、回退、耗时和 unknown 成本。新调用方必须验证业务适配和原路径回退；登记不等于接入，连接不等于收益。包安装不自动下载模型或开启调度。

[模型自主选择与复盘模板](templates/decision-model-policy.md)补齐手动研究和周期研究的使用约定。接收者一次明确授权后，Agent可自行选择调用/跳过及已配置backend；保留原路径和全部材料，通常一个主模型，必要时有界对照。记录实际消费、纠正/漏项、失败回退、端到端时间和成本，未知不回填0；既有两路线各四次合并窗口逐模型/profile复盘，依证据调整已验证用途和优先级。严重退化及时回退；调度变化、安装升级、许可和新流程按原门。Tools为可选能力，缺失时直接研究不受阻，安装本包不继承维护者的授权或连接状态。

## 可选源码参考

[固定版本游戏源码参考库](reference-library/README.md)提供8项推荐、18组备选、固定提交/哈希/许可与包外恢复入口。日常MD/网址、游戏研究和开发支持按问题选1–2项实际读取；安装不下载源码、启动游戏、启用调度或授权Knowledge消化。
