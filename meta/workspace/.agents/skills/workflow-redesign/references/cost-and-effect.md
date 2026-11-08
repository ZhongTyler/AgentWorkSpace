# 成本与效果评价

用于研究、开发、制作、维护、审核及协作流程的投入选择、运行检查和复盘。评价沿宿主记录，专业质量由原流程定义。小任务几句话即可；重复运行或多阶段任务再采用结构化记录。

## 先确定用途和比较条件

开始时说明用途、交付范围、难度来源、质量底线、当前推荐投入、可选加强项与投入边界。难度包括对象异质性、证据可得性、依赖、环境、风险及可逆性；只采用相关维度。新发现可以修订预期，并保留原判断。标准与预算分别决定，成本压力需要改变已承诺范围时回到原决定边界。

效果按本次用途观察，分别判断交付合格、实际使用、实际改善。探索中的重要排除、决策得到支持和维护中的恢复／风险控制也可以是有效结果。没有实际使用反馈就保留效果未知；本次技术通过、写入技能和获取审核回执各自只证明其覆盖部分。

只比较范围、质量、难度、环境、模型及计量边界相称的任务。差异显著时解释驱动因素，不计算节省率。结果单位由宿主选择，例如同类且大小相近的合格任务、验收需求、恢复事件或可用作品。批次成本包含失败、重试、返修与审核投入，避免只选成功样本。没有结果单位可比性时保留分项分析。

## 记录能观察的投入

- 时间分别说明总经过时间、阶段墙钟、等待、中断、未测起点及尾段。并行交付时间按实际区间，资源消耗按来源归并；阶段内工具等待仍属于阶段墙钟。脚本时间不代替整个任务。
- token注明模型／计数器、窗口和执行者覆盖。缓存属于输入子集、推理属于输出子集时保留包含关系，不重复相加。宿主目标计数、原始请求用量、额度和账单分别记录。
- 实付费用、估算费用和订阅分摊分别呈现，记录币种、价格版本和分摊依据；无可靠依据保留未知。本机运行也有资源和维护投入。
- 人工操作、判断、审核及返修时间沿实测或明确估算，等待用户反馈的墙钟不等于人工工时。必要人工决定按用途判断。
- 建设、正常运行、必要探索、验证、返工和维护按真实用途归类。建设和优化投入单列，预测复用收益与已实现收益分开。
- 每项关键数据或判断保留证据定位、版本／日期、范围与可信度。缺失用null／unknown，已知局部量不能升级成整体总量。

## 运行中怎样调整

沿自然工作单元比较本段预期和实际新增的证据、排除、产物、质量或风险变化。复用宿主停止合同；反复失败、低增量、返工或收尾迟滞时及时判断前提和路线。提醒阈值服务于检查，不自动授予预算，也不把未完成任务写成完成。

| 证据 | 有限决定 |
|---|---|
| 同口径下效果相当，投入减少 | 限定采用，继续观察质量与稳定性 |
| 效果提升且投入增加 | 说明新增效果是否值得代价，按优先级决定 |
| 成本下降但突破底线 | 修复或回退，必要时重新决定范围 |
| 投入增加而有效进展持续不足 | 核前提、合批、换路径或停该路线 |
| 缺乏可比基线或可靠效果证据 | 记录局部事实，补最小必要测量 |
| 质量与效果满足用途，继续投入难以改变判断 | 收口并保全可恢复材料 |

优化也走“原问题→改动→实际调用→效果→新增成本／回归→保留或撤回”。每项建议交代优先级、落点、预期改变、验证证据和停止／回退条件。已发生投入单独报告，下一步按未来增量决定。回本分析只有在单位和效果可比且节省有依据时采用，并把建设及维护成本纳入区间，预测保持预测。

## 脚本入口

`../scripts/workflow_cost.py`使用标准库，支持任意workflow与阶段，不自动调用模型、联网或采集聊天。profile是下列最小JSON，具体标准由宿主填写。

```json
{
  "task": {
    "id": "task-id",
    "workflow": "development",
    "purpose": "本次结果服务的用途",
    "scope": "约定范围",
    "complexity": "本次主要难度和不确定性",
    "quality_floor": "宿主验收条件",
    "result_unit": "一项范围相近的验收需求"
  }
}
```

```text
python -B workflow_cost.py init --record <run.json> --profile <profile.json> --phase <首阶段>
python -B workflow_cost.py mark --record <run.json> --phase <阶段>
python -B workflow_cost.py mark --record <run.json> --phase <恢复后阶段> --resumed
python -B workflow_cost.py observe --record <run.json> --observation <observation.json>
python -B workflow_cost.py finish --record <run.json>
python -B workflow_cost.py check --record <run.json> --evidence-root <工作区根>
python -B workflow_cost.py summary --record <run.json>
python -B workflow_cost.py render --record <run.json>
```

现场任务用`init --phase`在一次写入中建档并留下首个事件，核对返回的`timeline_started=true`、`first_event`与实际记录一致，再开始批量工作。单独`init`只建档，返回`timeline_started=false`；随后用`mark`才开始计时。已经漏测的阅读、撰写或尾段明确标unknown，保留原事件，不倒填成现场计时。

现有宿主已记阶段时继续用原工具，可通过`import-research --record <run.json> --trace <原cost.json>`只读导入Research v1事件。不同历史trace分别保留，脚本不把重叠区间相加。其他宿主用同一observation接口；本包携带合成测试检查计量、范围与恢复接口，实际成本和效果沿接收方任务记录评价。

observation字段为`id,metric,value,unit,scope,window,group,confidence,coverage,evidence`。value为非负有限数或null，confidence取measured／estimated／unknown，coverage取complete／partial／unknown。evidence回指sources，sources含path、locator、sha256。`group`定义可比计数口径，`window`定义同一窗口；累积快照采用不同window，费用按不同币种unit保留。

同口径观察含父子关系时用includes列出已覆盖的观察ID。多个独立范围需要双方disjoint_with显式声明才可汇总；重叠未解、共有子项或估算／实测混合则不生成总量。脚本不会从聊天名、相近日期或数值猜测包含关系。

已决定的阈值可写limits，字段为metric、unit、group、window及soft_limit／hard_limit。summary按同口径观测返回复看或触达边界提醒，未测和局部观测不签发预算余量。达到边界后执行原宿主停止合同，脚本不自动增加预算、修改目标或声明完成。

语义评价放在同一record的assessment，包含quality、use、effect、cost_judgment、comparability、next_actions、evidence。脚本校验结构和原件哈希、处理计量与生成文本，质量结论由实际审查者填写。退出0只代表其执行范围通过。历史导入用mode=retrospective，不能补写成当时的现场计时。

并发写同一record由独占lock拒绝，原子替换保护已存数据。中断遗留锁先核原writer和现场，再沿恢复权限处理。计量结束点与末次记账尾段预先说明，评估记录与产物冻结分离，避免为了补最后几秒反复冻结／提交。

## 评价输出和落地位置

沿宿主已有报告呈现总判断、成本边界、质量、使用／效果、可信度、比较限制、旧优化回验及少量后续决定。效果延迟发生时留下具体观察条件，不为填满指标新增定时任务。评价与记录本身的负担也参与取舍。

全局方法由本参考维护，宿主只维护专业适配和本次记录。游戏报告评价入口为`Research/game-research/cost-evaluation/README.md`，评价不修改报告正文、不触发重新消化或重开暂停研究。

## 方法依据

- FinOps将资源效率与业务结果单位区分，按目标连接投入、使用与价值。[Unit Economics](https://www.finops.org/framework/capabilities/unit-economics/)
- SPACE强调生产率的多个维度。[原论文入口](https://www.microsoft.com/en-us/research/publication/the-space-of-developer-productivity-theres-more-to-it-than-you-think/)
- DORA强调情境、多个指标及可比范围。[指标指南](https://dora.dev/guides/dora-metrics/)
- Agent评价研究同时考虑效果、成本、固定建设和每次运行投入。[AI Agents That Matter](https://arxiv.org/abs/2407.01502)
- 评价强度及其成本应与方案规模和风险相称。[Green Book](https://www.gov.uk/government/publications/the-green-book--2/the-green-book-2026)
