<!-- knowledge-identity:display-name -->
# Knowledge Base

按需取得可用、可核查的知识，并将来源全面消化为raw与持久综合Wiki；空库可直接初始化，不依赖父工作区或外部分析工作流。

## 开始使用

1. 通过 AgentWorkSpace 的统一 init/add 接入即可使用空库查询。需要 Node.js 22+ 与 PowerShell 7（Windows部分脚本可用5.1）；首次 Ingest 前按实际用途补范围。独立使用或定制名称时可运行 setup-wizard 预览，不要求接入后重复问答。
2. 直接提问或“查询知识库”：核心Wiki读透、补充按缺口。实际入口见[Query工具](system/query/README.md)，空库如实返回缺口。
3. “消化材料”：默认标准，评分/raw/Wiki归属分段审核；“自动消化”：中途留可验证恢复点，最终集中审核。两者同样保真和追溯。见[消化协议](system/protocols/INGEST_PROTOCOL.md)。
4. “健康检查”：执行只读统一[健康入口](system/maintenance/checklists/knowledge-health-check.md)，按完整依赖模块复验；修复需明确范围。

最终报告呈现评分、新增raw、Wiki真实增量与diff、拆分与来源去向、回测范围/结果，以及必要例外和精确批准版本。技术通过不代替用户验收。

Clippings保留原材料身份；raw保留作者完整重要论证；Wiki综合多源条件与冲突；Domain保存导航及共享原则；Group保存已批准的关系。模板不是正文，零内容是合法状态。Query不写库；只有明确消化或维护才写对应范围。

本包不含私人知识、历史运行、专家/Team/Procedure运行时或GameAnalysisDecision私有绑定；需要分析与决策时由宿主接入自身工作流。初始化不会创建定时任务。

本包维护独立便携 framework 2.1，统一发行版本见发布仓 catalog。本版已适配合并 Ingest 控制器、写作者与主审核者路由、Query 证据接口、精确版本收尾及可选研究/复利接线；不包含作者的 SDK/native 在线查询服务、私人写作样本或本机会话。历史运行保留原合同，新运行先核对其执行 profile。

首次 Ingest 前，Agent 按实际目标配置范围，保持模块目录名不变，并检查本模块具有独立本地 Git 基线；新空库可在模块内初始化并提交框架基线，已有库保留原历史。Ingest 依赖这个恢复点，Query 不依赖 Git；不自动创建远端或推送。详见[初始化边界](system/maintenance/SETUP.md)。

可选[Tools检索后端](system/query/README.md)默认BM25、混合按需、原Query回退；同一只读核心可供本地和网站获准视图消费。BM25需要Python 3.10+，不要求模型/GPU。接收者自行绑定包外运行目录；安装Knowledge本身不建索引、不下载模型、不部署网站，也不授予私人知识公开权限。

本版的合并执行、主审核者、精确版本收尾与可选研究/知识复利接线见 [便携执行说明](system/protocols/PORTABLE_EXECUTION.md)。模型、会话、资料绑定和外部发布均由接收方配置与授权；安装不启动这些行为。
