# 游戏深度拆解：任务、证据与返回模板

依 [流程](README.md) 按题删减。空值写 unknown，不能填计划值冒充完成。无需为每张图复制一份报告。

## 调用包

```yaml
case_id: "<稳定游戏案例ID，恢复沿用>"
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
scope: "<阶段、场景与重点域>"
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

| 域/阶段 | 覆盖状态与实际深度 | 证据ID | 机制与系统耦合 | 未知/反例与下一必要证据 |
|---|---|---|---|---|

逐条主张：
- 结论ID与直接支持证据：
- 推理：规则/资源/信息怎样改变可选行为和代价：
- 最强替代解释或反例；适用条件：
- 可迁移做法与不宜照搬的部分：
- 已能支持与仍不能支持的判断：

## 返回包

```yaml
case_id: "<与调用一致>"
status: "answered|partial|blocked|deferred"
report_ref: "<原报告与实际版本/哈希>"
supported_claims: []
evidence_refs: []
coverage: "<实际域与阶段>"
unresolved: []
return_to_caller: "<本次问题对应的案例切片；不要复制整份原证据>"
adoption: "<调用方实际使用/暂缓/unknown>"
knowledge_disposition: "<已有覆盖/原报告待消化/实际批次；暂停不启动入库>"
cost: {human: unknown, tokens: unknown, amount: unknown}
resume: {owner: "<owner>", from: "<报告/证据停点>", next: "<必要动作>", when: "<触发条件>"}
```

只有约定范围回答充分才 answered；可将已回答子问题返回，整体仍 partial。传回与调用方采用是不同状态。
