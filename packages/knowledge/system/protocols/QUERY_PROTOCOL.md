# QUERY_PROTOCOL · 按任务查阅与证据使用

版本：2.0。Knowledge 为当前问题提供可用、可核查、带适用条件的知识。Wiki 保存跨来源综合，raw 保存稳定来源证词。查询只读，不产生入库、修复、裁决或学习管道；消化见 [INGEST_PROTOCOL](INGEST_PROTOCOL.md)，健康检查见 [检查入口](../maintenance/checklists/knowledge-health-check.md)。

## 1. 一条主链，先确定要回答什么

`本题需要 → 有界发现 → 核心读透、补充按需 → 决定性来源与反例 → 回答或宿主证据 → 有理由地停止`

Agent 从问题和已有情境判断，不要求用户填写等级或表格：

| 需要 | 核心覆盖 | 决定性补查 |
|---|---|---|
| 定义、事实 `fact` | 完整定义、成立条件；确为独立事实可读完整章节 | 数字、原话及歧义回查对应 raw |
| 机制理解 `understanding` | 最相关综合 Wiki 全文，保留跨节限制和论证 | 缺失的前提、反例或因果证词 |
| 诊断、比较 `diagnosis/comparison` | 当前项目事实＋核心 Wiki 全文；不同解释各找对应依据 | 最可能推翻建议的替代解释、条件或冲突 |
| 专题综述 `survey` | 明确主题范围、主要维度与观点覆盖 | 未覆盖维度和相互冲突来源；不能以篇数宣称全面 |

同一任务复用未变上下文，后续问题改变对象、约束或目标时重判适用性。专业知识并不自动触发专家或 GameAnalysisDecision；仅实际请求分析与决策能力时按 外部分析工作流接口（由宿主提供） 转交。项目已拍板事实与用户决定由宿主拥有。

## 2. 来源权限和预算分别决定

- “不要查知识库”：`KNOWLEDGE_DISABLED_WEB_ALLOWED`，Knowledge 关闭，其他来源分别判断。
- “不要联网”：Web 关闭；时效部分如实标为未核实，仍可查询稳定知识。
- “联网核实／搜索最新”：用当轮实际可用的网络工具查官方或一手资料；本仓 CLI 不执行联网，也不把预训练记忆当最新证据。
- “读原文／深度溯源”：对关键原始命题读对应 raw，保真或媒体存疑再查 Clippings／原来源。不可读媒体返回能力缺口，不算已转录。
- 同一轴冲突按用户最后明确指令；无法判断且会阻断下一步才澄清。

L0、L1、L2、L3 只用于理解历史收据或用户旧称：分别是不查库、核心理解、证据追溯、扩大追溯；新查询不用固定等级控制每条链接。`深查知识库` 意味着加强关键来源追溯，不能无差别读全部 raw。

工具默认软预算按需要给出 4／6／10／10／18 个实际来源（定义／理解／诊断／比较／综述）、18 个候选、24 个正文补查文件、120000 个返回字符。它们保护执行成本，不是知识充分性的门槛，字符也不是 token。Agent 可按明确缺口调整预算并记录原因；普通预算调整不要求用户介入，显式用户上限必须守住。完整单元超预算时返回 `budget_exhausted`，不得静默截断。多次读取由汇总检查总预算，不能靠多次调用绕过。

## 3. 发现：标题不是证据，找不到标题也不是知识不存在

最小工具入口是 [query-evidence.mjs](../query/query-evidence.mjs)。独立原Query继续可用；配置Tools只读版本包后默认BM25，显式hybrid选择混合，legacy走原路；过期或不可用即回原Query，不自动建包、外发或替换全文阅读/审核。见[查询说明](../query/README.md)。

1. 从问题词、已知同义表达、索引、标题和章节发现候选。工具中的小型同义词表只提供发现信号；Agent 可通过 `terms/reformulations` 补本题术语。
2. Domain、已批准 active Wiki Group、相关页和原则 ID 按需要介入。`candidate_members`、未批准或 inactive Group 不可扩展。相关页和 Group 默认一跳，继续展开须有具体未决问题，去重并计入同一预算。
3. 无强候选时换一种表达或定位路径做有界正文补查。CLI 限定 `max_body_files`，提供已查范围和未查数；没有命中返回范围内缺口，不证明全库没有此知识。若限制使关键题无法解答，明确下一种高价值查法。
4. 工具会读取 Wiki 文件以提取标题/章节元数据，记录真实磁盘读取次数及字节；这些不是“Agent 已阅读全文”。候选只返回定位与导航，`content_read:false`。文件名、摘要、Group 和 hash 均不能冒充已用证据。

### Group 选择

Group 是候选来源而不是独立的固定优先级。可以先看最有相关性的 Group peer，再看 direct 或 related 候选；必须说明其补哪一项覆盖，并去重。来自 Group 的关键论断也可以按当前来源权限追溯 raw，原来 L2 禁止 peer raw 的限制退出新运行规则，防止形成无依据的来源盲区。

需要保存选择计划时使用 `validate-wiki-group-query-plan.ps1` 的 schema 2：`need`、`sources`、`budget`、`direct_wiki/related_page_wiki`、`evaluated_groups`、`selected_via_group/skipped_via_group`、`coverage_axes`、`raw_expansion`、实际 `candidate_order` 和 `stop_reason`。`candidate_order` 记录实际先后，不强制旧 direct→related→group 顺序；raw 扩展需有对应的关键判断理由。CLI 检查成员、来源权限和预算，不替代语义选材。旧 schema 1 仅按原规则读取／校验历史选择，不能重释历史批准。

### 原则

按域或 `DPR-*` 查询共享领域原则，保留 `knowledge:principle:DPR-EX-001` 稳定 ID；原 [query-principles](../integrations/query-principles.mjs) 接口继续可用。新入口可 discover `principle_ids`，或 read 稳定 ID，返回实际完整原则及来源版本。原则来源仍属 Knowledge，专业用法属 GameAnalysisDecision。hash 只绑定内容，适用性与真伪继续核查；同源多篇转述不能算独立互证。

## 4. 阅读：核心读透，补充按需

- 核心主题／机制优先完整 Wiki，包含正文、条件、反例、来源指针及相关页面。持久综合应被真正利用，而不是每轮从所有 raw 重新拼答案。
- `read` 默认 `selection.mode: full`。完整章节必须指定准确标题；含其子章节，直到下一个同级或上级标题，保留完整语义单元；同名歧义和旧锚点必须报错，不偷偷选第一个。
- `section` 只适用于补充、明确独立事实或当前上下文已读且未变的内容，需 `reason`。核心理解、诊断、比较或综述不能用 `independent_fact` 绕过全文；只有补充 `role: supplement` 或真正已读上下文才能使用局部。工具检查声明一致性，Agent 必须确保声明真实、前后条件未遗漏；默认不缩减核心阅读。
- 决定性数字、强因果、争议、原话、高影响选型沿命中章节来源回查 raw 全文；完整 raw 通常较短且保存证词上下文。补充只读完整章节时仍要核对前后适用条件。
- 来源权限、路径越界、不存在、过期锚点、权限拒绝和媒体能力缺口分别表达。读取命令不改索引、registry、NOW 或任何正文。

## 5. 版本复用与证据合同

[工具说明与可复制请求](../query/README.md) 提供 `discover/read/reuse/verify/assemble`。所有命令默认 JSON 到 stdout，文件保存由已授权宿主或测试调用者承担，普通 Query 不在 Knowledge 建运行记录。

`read` 返回实际正文、稳定身份／相对路径、源字节 hash、完整页／章节行范围、内容 hash、任务对象与范围、来源链接及 `claim_support:not_verified`。`source_read` 表示工具确实返回正文；Agent 是否理解、材料是否支持判断仍需回答里的利用核对。

`reuse` 重新检查原文件版本、正文范围、当前权限与问题／对象／适用范围。复用标记 `source_reused`，不声称本轮重新阅读全文。正文不变但问题或对象改变时拒绝直接复用，重新读取或审查；禁止把旧结论缓存为新事实。普通Query不创建或更新索引；可选Tools维护阶段显式从已审提交建包，版本漂移回原Query及真实文件，原审核不变。

`verify` 检查收到的正文、范围、源版本及引用原句相符，返回 `evidence_consistent`，**不是语义 PASS**。`assemble` 复用同一事实形成宿主结果：本题需要、实际来源及版本、`source_statement` 与 `agent_inference`、适用条件、关键缺口和停止理由。工具标明 `agent_assessed_not_tool_verified`；CLI 不推断真实用户认可，也不自行生成语义判断。

## 6. 利用、冲突和停止

每个关键判断完成：`判断 → 实际使用的 Wiki／raw／原则与完整章节 → 原文核查情况 → 对本题的条件与限制`。可用自然语言，不必另填大表。关键引用给实际正文中的短句或精确位置；引用存在不说明推导必然成立。

先核对对象、阶段、约束、日期和版本。项目事实决定当前项目是什么；Wiki 提供稳定知识，raw 保存来源证词，Web 核实时效；Agent 推导与用户决定分开。冲突按成立条件表达，保留实质分歧，不能强行多数投票。缺少关键数据时输出假设和验证办法。

可停止的理由：

- `needs_answered`：关键问题已回答、前提／反例已覆盖、实质冲突已说明，下一候选没有明确能改变答案的缺口。
- `bounded_discovery_exhausted`：在已声明的发现范围没有足够相关材料，说明覆盖限制。
- `budget_exhausted`：关键未决仍在，列出未证实部分及继续查阅价值，不声称全面。
- `sources_unavailable`：权限、媒体或工具限制，标出未核实部分。
- `user_scope_reached`：用户明确范围已达到，保留范围外事项。

核心缺口存在时不能用 `needs_answered`；已找到冲突但未解决也是有意义结果，不必追求虚假的完整结论。

设计、诊断、方案或裁决输出简短“来源探索”：`project_facts / knowledge / web / model_reasoning / user_decision` 分别记 `used/not_needed/not_applicable/no_relevant_source/disabled/unavailable/pending` 及必要理由。短定义无需五栏报告。宿主沿用同一结果和证据，不复制另一套检索算法；ContextBrief prepared 不是查询已执行，查询已执行也不是业务决策已批准。

Query 发现旧锚点、疑似内容冲突或陈旧状态时只交接带位置和影响的维护线索；检查、修复、入库各自按对应授权，不能自动把回答写回 Wiki。

## 7. 行为验证与实际限制

入口：`powershell -NoProfile -ExecutionPolicy Bypass -File system/maintenance/checklists/run-query-contract.ps1`；完整机械测试为 `tests/query-evidence.contract.ps1` 和 `tests/wiki-group-query-selection.contract.ps1`。测试在隔离 fixture 中检验发现、全文／章节、禁用来源、越界、陈旧复用与只读。它们不证明语义质量、查阅收益或真人满意；实际同题比较和宿主消费证据另存任务审计。
