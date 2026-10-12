# Research

将 Markdown、网址或具体问题转成有来源、有适用边界、能支持下一步的判断。

从 [轻量研究协议](RESEARCH_PROTOCOL.md) 开始；执行入口为 [research-study](.agents/skills/research-study/SKILL.md)，输出可裁剪 [报告模板](templates/research-note.md)。主题报告由使用者在本地维护，本初始包不包含维护者的私人研究材料。

本包工具示例以安装包根目录（通常为 `modules/research`）为当前目录；研究报告、采集媒体和队列放使用者指定的包外目录。文档中的维护者历史试跑仅说明已观察范围，不代表接收者已连接或已验收；当前访问、权限和来源覆盖仍须本人核查。

[初始来源目录](sources.json) 包含十一项来源，当前八项正式可选、三项暂停或放弃保留备选；按问题选少量互补来源，跳过停用项。原始文档、论文与源码仍是关键底本。

[游戏设计与拆解](game-research/README.md) 增加十组游戏专门来源、奖项/会议等跨来源筛选维度及视频文字获取路径；有用完整材料可在获得授权后交宿主 Knowledge 自动消化。[每周探索](proactive/README.md) 附带频率、预算和[有用增量/新保留候选简报](proactive/reporting.md)设置模板；安装不自动创建或启用任务。需要使用者在自己的调度器中授权创建，Knowledge 最终精确报告批准规则仍保留。

[MCP 安装和恢复说明](integrations/mcp/README.md) 提供固定依赖、源码/顶层发行包、许可证与配置。账号来源需使用者本人授权，不把维护者凭据带进初始包；普通连接失败时继续文件/网址路径，用户停用的渠道不自动改走网页。

[REA 发行产物研究](integrations/rea/README.md)提供固定 CLI/MCP 接线、可选 `$rea-investigate` skill 和匹配官方参考。需要时明确安装到包外 runtime，再选择注册 MCP/安装 skill；包安装不会自动执行这些动作。完整源码分析仍优先读源码。[工具与证据保存规范](templates/tool-storage.md)区分结论、实验、工具锁、运行依赖、凭据及知识采用，个人内容不随发布或升级迁移。

[浏览器工具](integrations/browser/README.md)附带SingleFile与Obsidian Web Clipper官方固定版本的准备脚本/哈希；扩展为可选辅助，加载不等于保存链路可用。默认采用原生浏览器读取/字幕/截图与[本地公开网页采集、OCR](integrations/media/README.md)，按[媒体路径](game-research/media-capture.md)保留必要图义和视频时间码。正式游戏消化围绕主题优先3–4篇、最多6篇，不足不凑数。包内不含维护者页面快照、媒体、浏览器profile或354MB本机运行时。

目录附带与工具接通是两回事。安装资料仍需联网取得依赖和连接远程服务，不是完整离线镜像。本包通过 AgentWorkSpace 按需安装到 modules/research；正式版本、来源提交和文件清单见发行说明、catalog 与 _release.json。安装不创建周期任务、连接账号或授予自动入库权限。研究报告与采集材料放在使用者指定的包外目录，升级和回滚不会接管它们。
