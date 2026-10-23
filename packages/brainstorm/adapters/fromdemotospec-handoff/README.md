# FromDemoToSpec 制作定义交接 adapter

ready；外部合同 FromDemoToSpec/templates/design-baseline.md，版本 fromdemotospec-design-baseline-v2。机器工件 fromdemotospec-gap.json schema 2，人读工件 fromdemotospec-handoff.md。新建与活跃继续统一该版本，旧关闭工件仅作历史证据，不提供旧运行入口。

## Mapping and ownership

[fields-v2.json](fields-v2.json) 是生成/校验共用字段定义：体验目标、完整核心闭环、范围/排除、验证深度、必要表现反馈、生命周期/环境、规则状态、风险决定及预算权限。

已选概念先有 accepted brief schema 3 与明确 requested 意图。Agent 从 Concept Frame、Experience Fragment、循环/范围/验证等映射；具体情境→行动→可见反馈直接进入交接，避免只交抽象支柱。生成值先 partial/missing，Agent 核对含义、来源和缺口后才能提升状态。

核心三项必须 satisfied，其他 FromDemoToSpec-owned 非阻断未知保留问题、理由及 next_action。assumed 明确是推导，不伪装用户决定；参数可为0，不凑数量。可持续项目正式环境仍须在 FromDemoToSpec 实现前明确，概念阶段可以交接这一责任。

## Readiness and consumption

交接同时路由完整Decision Record；新渲染的接收清单包含全部决定ID，不仅Brief选包引用的少数ID。接收者记录源版本/哈希，并逐项标明继承、暂缓、局部变更、替代或待复核及当前归属。当前原型排除项不能抹掉完整产品已定方向；暂缓不等于未决定，ID覆盖不等于语义已消费。后续讨论先查相关决定与实际变更，来源不可达或冲突只阻断依赖动作。关闭档案只读，旧候选由下游补接收，不重渲染覆盖；本仓不替接收方填写通过。

ready 要求：accepted 概念、requested 意图；既有 user/joint 产品决定；核心有来源且完整；无 blocking；结构 passed；映射语义 passed 且 reviewer 为 agent/user/joint；external_flow_started=false。

依次运行 new-fromdemotospec-gap、validate-fromdemotospec-gap、render-fromdemotospec-handoff、validate-fromdemotospec-handoff。生成与渲染不覆盖既有文件；框架迁移使用本任务一次性转换，不作为日常入口。

接收方实际读取 FromDemoToSpec 当前制作协议和贯通设计底稿，将交接内容接入当前制作定义，列出仍需确认的生命周期、环境、预算与场景。FromDemoToSpec 没有专用 handoff 导入 API；不能把本仓字段导出或 prototype-project 状态校验说成完成接收。接收演练用合成临时材料并记录 Agent 对目标模板的实际映射，不能启动真实项目。

ready 不表示原型已启动、V1达标、用户认可玩法或交付完成。概念采用、映射审核、正式玩法认可分别保留权威来源。

## 来源变化与重审

活跃 Gap 绑定 Brief、组合文件与完整决定表的 SHA-256；新 Handoff 同时携带来源摘要和完整决定接收清单。来源变化即需复核，不能继续以旧 ready 交接；关闭历史按原版本只读解释。

使用 `reset-fromdemotospec-handoff.ps1 -SessionPath <session> -Reason <变化原因>` 保留旧 Gap／Handoff 字节到本会话 handoff-history，再从当前来源重建 gap-review。Agent 重新核对内容、来源和未决项后才能提升 semantic_review 与 ready；重建或重算哈希不等于语义审核，不改变原 DEC 或自动启动下游。
