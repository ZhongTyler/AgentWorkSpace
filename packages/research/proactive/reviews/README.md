# 每四次周研究复盘

通用与游戏两条路线各完成四次实际定时研究后，合并做一次复盘；之后沿相同四次窗口继续观察。当前两条路线均每周一、周四运行，正常情况下约两周达到首个窗口，以实际完成为准。手动试跑、只触发未执行、受阻未完成和同路线同一计划日期的重复恢复不增加计数；同周周一、周四分别计次。零有用增量但实际完成发现与判断的一轮可以计数，不为达标凑成果。

运行记录仍在 `../runs/`。每次完成发现与研究记录后，同名保存一份机器可读收据：

```json
{
  "schema_version": 1,
  "kind": "weekly_research_run",
  "trigger": "weekly",
  "route": "research",
  "scheduled_date": "2026-10-12",
  "status": "completed",
  "completed_at": "2026-10-12T10:00:00+08:00",
  "report": "2026-10-12-research.md",
  "metrics": {
    "candidates": 0,
    "duplicate_candidates": 0,
    "independent_new_candidates": 0,
    "independent_new_findings": 0,
    "selected_backlog": 0,
    "knowledge_stage": "not_selected",
    "adoption": "unknown",
    "human_interventions": [],
    "human_minutes": null,
    "cost_evidence": null
  },
  "cadence_assessment": {
    "judgment": "maintain",
    "reason": "Example only; assess actual growth, overlap and processing capacity.",
    "evidence": [],
    "proposal_id": null
  }
}
```

以上是格式示例，不是真实运行。`scheduled_date` 用原计划触发日期作去重身份，延期恢复仍用原日期；`route` 为 research 或 game-research。Knowledge 待批准、已Finish等阶段如实记录；发现阶段完成不冒充已入库。复盘时回查当前项目的采用与效果证据，未采用、未反馈和无法确定分开，不把缺失数据填成0。

每轮先后运行 `python proactive/review.py`（从Research根）；此工具只读实际收据和报告，不写状态、不计日历周，也不创建任务。达到两路各四次时，选中八份未复盘收据，核查：

- 实际增量：去同源后的新机制、反例、结论改变及可复用知识；重复率、捕获缺口和积压也记录。
- 深入验证：核对[统一清单](../../validation/README.md)中实际触发/选中/完成的ID及证据，区分条件未到、已交接、真实阻塞和观察中；合并重复，关闭已无价值项并保留理由。没有新证据不反复提醒，不为清积压自动实施或改变频率。
- 采用情况：建议、已决定、已实施和真实反馈分别统计，指向宿主证据；信息不足标unknown。
- 人工介入：登录/验证码/广告、授权/终审、纠错与实际耗时分别记，必要人工门不算工具故障。
- 成本：发现、内容消化、返修、流程恢复和审批闭合分开；缓存/非缓存输入与输出、可配对执行区间、工具/付费成本各按实测，partial不冒充全量。

复盘报告给出维持、收窄来源或调整频率的条件化建议，仍由用户决定，不自动改正式来源或调度。复盘是用户已请求的决策节点，交付一次合并报告；日常有用增量与新保留候选按[简报规则](../reporting.md)报告一次，纯重复或无价值增量保持静默。

## 从实际阶段边界记录成本

从下一次实际执行开始，用 [cost.py](../cost.py) 在原 `runs/` 留同一计划日期、同一路线的 `.cost.json` 附件；它不是研究完成收据，不增加次数，也不写 Knowledge。开始时立即标记，阶段切换时再标记；无需逐工具或逐思考记录。例如从安装包根执行，运行记录写到包外：

```powershell
python proactive/cost.py --runs <external-runs> mark --route game-research --scheduled-date 2026-10-15 --phase discovery
python proactive/cost.py --runs <external-runs> mark --route game-research --scheduled-date 2026-10-15 --phase review --evidence "原报告中的实际审核停点"
python proactive/cost.py --runs <external-runs> summary --route game-research --scheduled-date 2026-10-15
```

以上为命令示例，不是已完成研究。`scheduled-date` 仍为原计划日期；通用线使用 `research`。可记录 `discovery`（发现/分析）、`ingestion`（消化）、`review`（复核）、`content_repair`（实质返修）、`workflow_recovery`（工具/流程恢复）、`coordination_wait`（交接/owner等待）、`approval_wait`（等待用户决定）、`closure`（交付/Git闭合）、`unallocated`（无法归因）。只记录真正发生的切换，沿现有成本附件恢复，不新增计数器或常驻服务。

明确等待前切到对应 wait；恢复时标记下一实际阶段。宿主中断、关机或遗漏记录后的首次 mark 加 `--resume`，工具将上次标记至恢复的整段保守归为 `unallocated`，不冒充一直在执行。无法区分并行写作与审核的共享墙钟区间也用 `unallocated` 并在原报告说明，不能把两个 Agent 的持续时间相加当总耗时。

只在本轮实际生命周期收尾后执行 `finish --route ... --scheduled-date ...`；发现完成但 Knowledge 排队、待终审或 Git 尚未闭合时，附件可保持 open，不阻止发现完成计数。`summary` 只汇总已观测的相邻边界；打开的尾部和首次标记前保持未测。已关闭附件拒绝改写。后来新授权的扩展任务若已超出关闭窗口，在原报告引用其独立真实证据，不回写历史计时。

这些数值是阶段墙钟窗口，包含阶段内的工具等待，不能称为纯模型活跃时间。等待批准的墙钟不等于用户审阅分钟；人工操作、审核分钟、token和金额仍取真实证据，未知为 null/unknown。旧三批 partial 数据及已审报告保持原样。`review.py` 在四次合并窗口自动读取可用附件；缺附件保留 unknown，附件本身不证明研究或 Knowledge 完成。

报告落在本目录；同时保存 `weekly_research_review` JSON，schema_version为1，status为recorded或awaiting_decision，report指向本目录实际Markdown，run_keys为工具选中八条key。工具核对每路四条、报告存在、没有重复复盘；同一复盘待决定时不反复提醒。

## 每轮分别评估频率

当前基线为两路均每周两次：周一、周四，通用10:00、游戏18:00（北京时间）。错开启动不保证互不重叠，发现已有写入owner或未完批次时先排队/恢复。频率评估与四次合并复盘并行，不必等满四次才提出有依据的调整申请。

每轮在收据的 `cadence_assessment` 与短报告中记录维持、建议提速或建议降速。先按canonical URL及独立证据链去重，再记录候选数、重复数/可计算的重复率、真正的新机制/反例、与上次覆盖间隔、新材料增长速度、值得处理的积压、实际采用、捕获缺口、人工介入与成本。没有实际样本的信号标unknown；同一材料的转载、翻译、媒体修复不算新资料。流量暴涨、工具访问失败、待用户终审均不能单独证明该加速或减速。

- **建议降速**：通常连续两轮大部分候选重复（参考约70%以上）、可用独立增量很少，且没有值得处理的积压；可申请该路线从每周两次改为每周一次。
- **建议提速**：出现一批与当前项目相关、去同源后仍有实质增量的新资料，或连续两轮高价值积压增长，现有消化能力能够承担；可申请该路线临时增加一次，并给出观察窗口及回退条件。
- **维持**：样本不足、增量与负担大致匹配、积压主要来自访问/审批阻塞，或只有热度增加而价值未变。阈值是辅助判断，不是自动触发器；强证据可提前申请并说明例外。

通用和游戏分别判断，可以一条加速、另一条降速。申请统一落在本目录的 `cadence-<route>-<date>.md`，写清当前/建议频率与具体日期时间、证据区间、重复/增量/积压、成本与预期收益、原因和观察/回退条件，并在收据引用稳定proposal_id。存在未决申请且证据没有实质变化时不重复通知。用户明确批准后才通过宿主调度工具修改对应一条任务，并同步模板、执行入口、本机状态与申请结果；未批准保持原计划。频率评估的普通维持结论只落记录，调整申请属于需要用户决定的事项才通知。

## 可选工具的复盘

可选模型遵循[选择、效果记录与复盘模板](../../templates/decision-model-policy.md)。使用者明确授权后，Agent可自行判断是否调用及选择已配置backend，记录model_decision与实际tool_usage、纠正/回退和端到端成本，沿宿主既有窗口复盘调整。安装不启用该授权；未配置、失败或无增量时保留原研究路径，不自动下载模型、登录或新增任务。
