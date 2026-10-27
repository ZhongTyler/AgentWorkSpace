# 游戏深度拆解：任务、证据与返回模板

依 [流程](README.md) 按题删减。空值写 unknown，不能填计划值冒充完成。无需为每张图复制一份报告。主交付采用 [游戏主报告模板](game-dossier-template.md)，存放/复用见 [输出合同](output-contract.md)。默认全游戏档案，局部调用是其增量，专题接入暂缓。

## 调用包

```yaml
dossier_id: "<稳定游戏档案ID，恢复沿用>"
case_id: "<本批/情境ID，旧证据沿用原ID>"
study_mode: "game_dossier|focused_extension"
dossier_ref: "<已有主报告；没有则按输出合同建立>"
caller_ref: "<原问题/材料包/专题/用户委托>"
owner: "<本次单一研究owner>"
game:
  title: "<作品与代际>"
  platform: unknown
  build: unknown
  mods: unknown
  mode_difficulty_character: unknown
  seed_visibility: unknown
question: "<主要问题>"
scope: "<整体目标、本批阶段和优先顺序；不排除其他适用域>"
domain_baseline: {ref: "<当时完整领域导航>", version: "<实际版本/哈希>"}
domain_coverage_ref: "<主报告中的全域适用性、实质覆盖、证据与缺口>"
requested_depth: "mechanism_fragment|session_loop|representative_stages|whole_game"
knowledge_check:
  status: "checked|unavailable"
  query: "<实际查询>"
  references: []
  knowledge_version: unknown
  relation: "implementation|extends|boundary|contradicts|new_topic|unknown"
materials: []
evidence_target: "<需观察的关键前态、动作、后态或关键规则>"
stop_condition: "<足以回答/需要收窄/受阻的判据>"
authorization_limits: "<调用方既有时间、费用、来源、游玩与模型边界>"
```

game_dossier默认整体目标为whole_game，其他深度表述本批进展；focused_extension按调用范围回答，但仍保留整作未覆盖状态。

GameHOT 游戏 controller 的材料包仍按原合同包含 `research_route=game-research`、非空 `route_reason` 等；本模板是被调用子研究的输入，不替代 controller.prepare 包，也不修改旧包哈希。

## 来源与媒体索引

| 证据ID | 原URL/文件、作者与日期 | 来源链/版本/条件 | 实读段落或实际媒体时间范围 | 本地文件、SHA-256 | 已核验内容与缺口 |
|---|---|---|---|---|---|

截图记录实际捕获时间与对应媒体时间（前后读取有误差则写误差），保留可复查上下文；原视频不允许下载/不可达时保留原链及具体停点，不绕验证。画面和字幕分列，必要声音另记。动画关键中间阶段不能只用首尾代替。

## 规则账

| 规则ID | 对象、规则与条件 | 来源/画面定位 | 原述/观察/推断 | 数值与单位、升级/叠加/取整 | 冲突与适用版本 |
|---|---|---|---|---|---|

## 事件与状态账

| 记录ID/媒体时间或区间 | 前态与可见/未知信息 | 玩家可选项与实际动作 | 反馈/后态 | 对应证据/规则 | 连续性、剪辑与替代解释 |
|---|---|---|---|---|---|

实际动作没读到则写 unknown；不能只凭两帧状态差认定操作路径。持续状态与瞬时时点分开。未经独立条件控制不能从单段视频认定唯一最优策略或全体玩家体验。

## 覆盖与机制解释

| 当时全部域/额外维度/阶段 | 适用性及依据 | 子系统与实际深度 | 证据ID/机制联系 | 未知、未覆盖及下一必要材料 |
|---|---|---|---|---|

逐项列出当时完整领域，而不是只填本批重点。重点只决定顺序；有内容的域必须有正文分析，不适用须有理由，待核查不等同不存在。

逐条主张：
- 结论ID与直接支持证据：
- 推理：规则/资源/信息怎样改变可选行为和代价：
- 最强替代解释或反例；适用条件：
- 可迁移做法与不宜照搬的部分：
- 已能支持与仍不能支持的判断：

## 内容查证与审计记录

沿[内容查证与审计](verification.md)写回原报告验证节，长了才用原validation附件；没有独立审计时由研究者自行完成。以下为人工记录，不是dossier.py新增JSON字段，不为补表改历史manifest。

- 本批范围、实际执行者与性质（自审/独立审计）、报告版本：
- 原始完整目标及用户批准变更；现有章节之外仍缺哪些必要关系，分别如何核销：
- 必要未完成 / 用户允许延期 / 无法由公开材料裁定 / 有依据不适用，分别列明，不混成一个partial：
- 适用Skill的实际调用/不可用及就地方法；工具输出不等于语义核验：
- 审计输入沿当前`evidence-audit`的研究报告分支：报告及依赖资产的实际身份、原件定位、旧审查基线、本轮变动、未决项；完整目标明确同时查漏和查错：

| 关键事实/结论与正文位置 | 原件/媒体定位和条件 | 查证/保真/论证发现 | 修订及受影响消费者 | 可支持范围、未决与下一证据 |
|---|---|---|---|---|

复用旧审查需说明输入未变及仍适用范围；新改关键主张不能借旧PASS。音频未听、只读字幕或只抽帧如实记录。检查后仍缺必要材料的结论保持partial/未裁定。

返修沿原owner改正文及实际消费者，每项保留修复/有据不同意/未解决及理由。复核记录当前产物身份、实际检查的改动与相邻条件、问题是否关闭；旧回执不回写，局部通过不自动覆盖整份报告。可复用Skill中的交接与复核方法，不另建审核数据库。

分别裁定范围与深度、事实与保真、人读表达、工程与Git，再判断原目标是否达标。独立审核请求同时问遗漏与事实；没有有效全范围审核时，局部修复PASS不能结束完整目标。

## 返回包

```yaml
dossier_id: "<与调用一致>"
case_id: "<与调用一致>"
study_mode: "<与调用一致>"
status: "answered|partial|blocked|deferred"
report_ref: "<原报告与实际版本/哈希>"
supported_claims: []
evidence_refs: []
coverage: "<全域表引用与本批实际覆盖>"
dossier_coverage_status: "<整作覆盖状态，与本次问题answered分开>"
reusable_claims_ref: "<原报告稳定结论ID/章节/证据，不复制整套正文>"
unresolved: []
return_to_caller: "<本次问题对应的案例切片；不要复制整份原证据>"
adoption: "<调用方实际使用/暂缓/unknown>"
knowledge_disposition: "<研究产物直接查阅；目录已登记/未登记及接受版本；不参与消化>"
cost: {human: unknown, tokens: unknown, amount: unknown}
resume: {owner: "<owner>", from: "<报告/证据停点>", next: "<必要动作>", when: "<触发条件>"}
```

只有约定范围回答充分才 answered；focused_extension可以answered而整作仍partial，game_dossier不能将局部章节完成当整作完成。传回与调用方采用是不同状态。报告原验证节随report_ref可读，返回中的supported_claims/unresolved等保留审查后的条件和缺口；此模板不声称脚本自动执行语义审计。
