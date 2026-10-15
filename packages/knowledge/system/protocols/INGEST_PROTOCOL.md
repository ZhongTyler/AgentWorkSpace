# INGEST_PROTOCOL · 内容消化与入库协议

> **用途**：定义外部材料从评分、raw 审核、Wiki 归属到写入维护的完整行为。
> **边界**：`system/protocols/QUERY_PROTOCOL.md` 管只读查询；本文只在用户存在消化/入库意图时加载。
> **SSOT 分工**：评分细则见 `system/protocols/SCORING_SYSTEM.md`；输出闸门见 `system/maintenance/checklists/ingest-stage-gates.md`；本文负责流程顺序和状态转换。

---
## IMA 知识库集成

> 当消化来源为 IMA 知识库时，先读 `system/integrations/IMA-GUIDE.md` 获取凭据配置和调用链路，再进入下方 Ingest 流程。本文不重复 IMA 工具配置内容。

## 能力、材料风险与执行消耗

本节是 Ingest 的能力选择依据；不预设固定型号胜任某阶段。保留当前可用且已被该类材料验证的配置；只在已有同类保真证据支持时降低投入，记录实际模型/推理配置、工具能力和未测范围。不可识别写“当前模型不可识别”，不得声称切换成功。具体型号在运行记录中记录，不将可能过时的型号写为流程前置。

| 任务 | 所需能力 | 增强复核的具体条件 |
|---|---|---|
| 解析、计数、hash、链接 | 确定性脚本 | 解析缺页、非法路径或媒体丢失时处理原输入，脚本不判语义 |
| 评分与重叠判断 | 读清来源论证、比较既有知识和评分锚点 | 边界分数、相互冲突、历史漂移；未读正文不判“完全重复” |
| raw 生成与语义审核 | 跨章节整合、准确保留定义/条件/数据/来源身份 | 长论证、单位换算、因果叙事、未转录媒体、译文歧义；先补证据，再决定提高配置或独立复核 |
| Wiki 综合 | 区分新知识、条件、反例和同源转述 | 多源冲突、拆分、跨页重组；保留原有较稳复核，不用平均分掩盖关键遗漏 |

批次按最终 raw 数、来源完整性、跨 Wiki 数和恢复成本拆分；建议标准 3～4、自动 2～3、复杂材料 1～2，仅为安排起点，不是硬门或模型能力证明。并行或子 Agent 需要当前任务对应授权；普通语义回读不伪装成独立模型评测。

同阶段只加载当前规则、实际来源及已失效证据。样板和上下文在同一任务内已完整读过且 hash 未变时可引用此前读证，不重复读全套；关键语义风险未解决时仍须回源。参见[生成与融合实作](../examples/ingest-content/README.md)。

### 成本控制（不降闸门）

- 来源身份、评分、媒体边界、Wiki 归属与冲突、状态和 Git 由主会话统一处理；子 agent 只接收有界文件包，负责 Raw/Wiki 正文或语义复核。
- schema 8 的 `execution_control.child_session_cap=12` 按实际启动会话计数；启动前 reserve、启动后 bind、结束时主动 close。遗漏时 Stage3 Seal 从已完成宿主日志自动结算耗时/token，未完成或未绑定会话阻断维护。
- 六篇常规批次默认复用一个内容 writer 完成 Raw 与 Wiki 正文，并复用一个固定主复核者完成全文审核与 targeted 验证；只有已证实的 owner 冲突、容量不足、会话失败或语义升级才增加会话并记录原因。
- `prepare-raw-review` 生成报告骨架，`preflight-raw-review` 一次返回机械错误和会导致 media_limited 的媒体边界 advisory；advisory 返回同一复核会话确认，不新增 agent 或复核轮次。明确小修可由 finding 提供 `replacement_text`，经 `apply-review-repairs` 机械应用，广泛改写才返回 writer。
- Stage3 统一使用 `finalize-ingest-stage3.ps1`：`Prepare` 同步账本，人工审阅并一次暂存后，`Seal` 自动结算会话并完成 writer 绑定、集中机械门禁、Stage3 包、维护收据与 gate-audit 包；已封存部分只复验、不重复生成，脚本不自动提交。

## 消化模式与控制面

只有标准与自动两条现行模式，评分、raw 深度、Wiki 增量、审计、维护和追溯质量线完全相同。普通“消化 / Ingest”默认标准；只有显式自动才后置人工审核。旧称“快速消化”按标准模式执行、精简展示，不省略运行单、收据或审批，也不转为自动。

| 模式 | 触发 | 用户审核 | 持久证据与恢复 |
|---|---|---|---|
| 标准消化 | 普通“消化 / Ingest”；默认 | 评分→raw→归属规划→写入闭合分段审核；未变内容不重复批准 | `interactive` 运行清单、阶段包、收据与反查索引；精确版本批准 |
| 自动消化 | 显式“自动模式消化” | 中间 Agent 执行相同检查，最后集中人工审核；真实权限/证据阻断即时报告 | `deferred` 同一质量核心；Stage 1 checkpoint、Wiki 前恢复边界、Stage 3 内容结果与最终批准分开 |

- `start` 默认 `interactive`；显式自动传 `-ReviewPolicy deferred`。不设置篇数硬上限。超出批次建议时，AI 必须在启动前说明拆分理由或继续的风险，但控制器不得拒绝。
- 从 `temp-review` 批次启动时，必须用 `prepare-clippings-batch.ps1 -Topic <主题> -BatchNumber <N>` 按主题区段→批次区段生成 `ItemsPath`；脚本跨空行提取全部项目符号、核对声明篇数并解析到唯一、非空且非待补采的物理文件，禁止手抄列表。随后运行 `normalize-clippings.ps1`；硬格式为 `Clippings/YYYYMMDD-*.md`，日期取 Clipping frontmatter `created`。控制器同时校验输入文件存在，`record-artifact raw` 再校验全部 `source_clipping` 均为规范路径且可解析，避免先生成旧路径再补改引用。
- 标准和自动模式中，每份来源终态确定后用 `record-artifact -InputItem <start 时对应原文>` 登记一个 `input`（Clipping/输入及其 `ingested|skipped` 结果）；写成 raw 的文件另登记为 `raw / ingested`。所有输入映射必须在阶段一 checkpoint 前完成；存在 `ingested` 输入时至少登记一份 raw。`check-stage1`、标准闭合和自动 `finish` 都会拒绝缺失或错配映射，不能把登记拖到最终退出。
- 标准和自动模式的 §5.1～5.4 包都先 `record-package` 锁定路径与哈希。标准模式评分、Stage1、Stage2 分包随闸门批准，Stage3 经最终报告精确版本审核；自动模式保留相同包，最后由 `render-final-review` 生成可直接审阅内容的报告及版本索引。现行确定性包将模型语义封存在 `package-data.json`，由 renderer 生成固定 Markdown；`record-package` 会复渲染并做字节比较。历史 schema 继续按现有包验证。
- 标准和自动模式批次完成时控制器更新 `system/maintenance/ingest-runs/index.json`。从任意已登记 Clipping 或 raw 反查审核证据，使用 `find-review -ArtifactPath <路径>`；正文 frontmatter 不增加维护路径。

## Ingest 流程（核心工作流）

> **阶段硬停点**：旧称快速按标准处理；标准消化使用 `review_policy=interactive`，每个审核闸门以已记录包的精确 SHA-256 批准。执行前读 `system/maintenance/checklists/ingest-stage-gates.md`；“按推荐执行/按你推荐方式”只确认当前闸门，不默认授权后续阶段。仅当用户显式触发下文“自动消化”时使用 `review_policy=deferred`，审核闸门才改为 AI 内部决策、最终一次性交用户审核；质量检查和审核项不减少。

**阶段一·消化稿审核**：
```
用户提供 URL/材料
  → LLM 判断来源类型与粒度：
      ├─ IMA 来源（用户说"从 IMA"/"ima 知识库"等）
      │    → 先 `connect_cloud_service()` 鉴权
      │    → 按 `system/integrations/IMA-GUIDE.md` 调用链路执行：获取知识库列表 → 搜索 → 获取内容
      │    → 拿到原文后进入正常消化流程
      ├─ Clippings 来源（用户说"从 Clippings"/"消化 clippings 里的XX"，或直接指 Clippings/ 下的文件路径）
      │    → **入口统一重命名**：若本轮仅评分且用户未授权写入，只报告 `❌ 待重命名`；进入标准/自动运行单前，先执行 `normalize-clippings.ps1`，将本批 Clippings 统一为 `YYYYMMDD-标题.md`。
      │         日期取 Clippings YAML 的 `created` 字段，不用原文发布日期；日期前缀是硬约束，标题缩写与去冗余是可选整理，不得因此改变来源身份。
      │         🔴 跳过项也不得豁免：登记理由末尾须追加 `剪藏：[[Clippings/重命名后的文件名]]`，使命名与溯源可检查。
      │         ⛔ **强制检查**：`ingest-control start` 拒绝非日期路径；写 raw 时再次校验 `source_clipping`。历史包路径仅通过 `clipping-path-migrations.json` 解析，禁止改写包正文和批准哈希。
      │    → read_file 读取本地 md
      │    → 做「剪藏质量快检」并显式输出简表：标题完整性 / 段落数是否异常少 / 是否有明显截断标记（末尾"阅读全文"/"点击展开"等）/ 图片数
      │    → **不可消化内容检测**：统计 `<iframe>` / `<video>` / `<embed>` 标签数，
      │         ≥3 个时提示"原文含 N 个不可直接消化的嵌入内容（交互 demo/视频等），消化稿可能缺失核心演示"
      │    → 若质量存疑 → 提示用户"这篇剪藏可能不完整，需要对比原文吗？"
      │    → 批量 Clippings 时，评分前显式输出「批内决策」：逐篇独立 / 合并 raw 候选 / 跳过候选。
      │      若 AI 依据同一系列/课程、连续章节、互相引用或共同问题链判断可合并，**必须提出合并候选并写明依据**；
      │      即使用户未主动标注"合并"，也不得省略该提议。未获用户确认前只可逐篇独立评分，不自动合并。
      │    → 扫描 md 中的图片引用（![]() 或 <img>），逐张判断信息含量：
      │         🟢 有信息：图表 / 截图 / 数据可视化 / 示意图 / 代码示例 → 保留
      │         🔴 无信息：装饰图 / 广告 banner / 纯分隔线 / 与内容无关配图 → 删除引用行
      │         （保底机制：Phase 1 用户手动删 + Phase 2 AI 补删，确保无信息图片不进入消化流程）
      │    → 对保留的有信息图片：
      │         ├─ 本地路径（相对路径指向 Clippings 附件目录）→ 直接 read_file（图片，vision 读取内容融入消化稿）
      │         └─ 远程 URL → web_fetch 下载到临时目录 → read_file（图片）→ 删除临时文件
      │    → 拿到原文后进入正常消化流程（评分闸门 → 写消化稿 → 审核）
      │    → raw frontmatter 新增 `source_clipping` 字段指向 clipping 文件：
      │         source: "来源描述"（保持纯文本不变）
      │         source_url: 保留原文 URL（如有）不变
      │         source_clipping: "[[Clippings/重命名后的文件名]]"（无 .md 后缀的 wiki-link）
      │         多 clipping 合并消化时使用 YAML 列表，与多 `source_url` 同格式
      │         clipping 原文 URL 已记录在 clipping 文件自身的 YAML frontmatter 中
      ├─ 多 URL 同主题（≥2 个 URL，用户**明确标注**"同一主题"/"合并消化"，或 AI 根据同一系列/课程、连续章节、互相引用或共同问题链判为**合并候选**并经用户确认后）
      │    ⚠️ **硬规则**：用户提交多 URL 但未标注"同一主题/合并消化" → 默认逐篇独立评分；但 AI 判断存在合并可能时必须提出候选、依据与确认问题，不得静默按独立消化结束。未获确认不自动合并。仅凭"同一作者"不构成合并理由（同一作者可能涉及完全不同的主题域） | 触发原因（2026-07-01）：随机选4篇落日间文章被 AI 默认判为 4 合辑，被用户纠正
      │    → 合并消化为单 raw，`source_url` 使用 YAML 列表
      │    → 标题含日期范围（如 `2016-10-04 ~ 2016-11-03`）
      │    → 正文按多篇原文自然章节分 `##` 模块
      │    → 消化稿标题加 `（N 合辑）` 后缀
      └─ 其他来源（URL/文件）
           → LLM 读取原文（web_fetch/文件读取）
  ── 🚧 消化价值自检闸门 🚧 ──
  → LLM 读 `system/protocols/SCORING_SYSTEM.md`（完整评分规则：A/B 类维度 + 自检清单 + 校准陷阱 + 置信度标注）
      判定条件、优先级、阈值和记录规则仅由 `system/protocols/SCORING_SYSTEM.md §综合判定规则` 定义；本协议不复制评分实现。
  → LLM 读 `raw-sources/README.md`（了解编写规则，含 `ingest_score` frontmatter 字段模板）
  → LLM 输出「消化价值自检」评分表（A 类文章固有质量 0-10 + B 类知识库相对价值 0-10，总分 0-20）
      ⚠️ B1（增量价值）评分前强制读 `system/registry/quick-reference.md` + 相关 wiki 标题做轻量交叉检查
      ⚠️ **历史评分对账硬前置**：以标题、`source_url`、`source_clipping` 与用户当前会话已给出的旧分为键，检索 raw frontmatter、`system/registry/skipped-sources.md`、待审清单和当前会话；命中时先列出旧分与旧判定，再按 `system/protocols/SCORING_SYSTEM.md` 的重评分规则处理。不得只因本轮重新阅读原文就静默改分。
      ⚠️ **分项证据硬前置**：A1 只按独立、可操作的概念/框架计分；图片数、章节数、案例数量和感官/功能要素罗列不得作为加分依据。B1 必须逐项对照现有知识覆盖，不能以"有案例"替代增量判断。
  → 按 `system/protocols/SCORING_SYSTEM.md §综合判定规则` 的优先级执行判定
  → 用户确认判定结果
      ├─ 🟢 直接消化 → 继续写消化稿
      ├─ 🟡 条件消化 → 用户确认消费方式后继续
      └─ 🔴 建议跳过 → 写入 `system/registry/skipped-sources.md`，不写消化稿
      ⚠️ 本确认仅授权写 raw/skipped；不授权 wiki 写入或维护链
      ⚠️ 用户确认通过前：不写消化稿、不碰 wiki、不碰 index、不碰 raw-list
  → **写作标准硬前置**：完整读取 `raw-standard-v2.md`、`raw-writing-v2.md` 及可用文风样本并记录版本（现行 core-semantic-20260910）；先生成全文 manifest，再识别核心观点及必要推理、例子、相关数据与限制。精简铺场、重复与无助于论证的故事枝节；自然段、列表、表格按信息结构选用。骨架仍以 `WRITING_SKELETON_V1` 留证，不是正文提纲模板。
  → **全文 manifest 硬前置**：对每份待写 raw 的全部 `source_clipping` 运行 `source-content-audit.ps1 -Action manifest`。manifest 必须先于正文写作生成，且其范围不可由写作者手选；多来源使用 `;` 连接路径。未生成 manifest，不得开始 raw 正文。
  → 确认通过后：LLM 按已列骨架写消化稿（raw-sources/<标题>-<来源>-<日期>.md）
      ⚠️ 含 YAML frontmatter（sources, date, domains）
      ⚠️ 每个 ## 模块须标注原文位置（📍 原文：...），降低幻觉风险
  → AI 质量意见写入本批阶段包辅助记录，不写 Raw 尾部；原作者的疑问/限定仍是正文。
  → **RAW_STANDARD_V2 独立复核**：调用 `raw-quality.mjs prepare` 冻结全文请求；fresh-context 审核者按 `raw-writing-v2.md` 完整回读 source→raw 与 raw→source，逐单元展开信息要素及原文定位；不得读取写作者自评。
      - 宿主保留实际调用记录，绑定请求、报告、上下文 ID、模型/配置与输入版本；没有真实独立调用证据只能 needs_review。
      - 调用 `raw-quality.mjs validate --mode stage1`；报告必须列 core_claims，并检查必要支撑。required 的必要要素须 complete；混合段落中的上下文省略及整段 omit_context 均须按写作合同关联观点并具体说明，不允许 optional_supporting 空泛豁免。必要信息遗漏、失真、无来源新增或确认的文风问题阻断。
      - Raw 不嵌图；必要图义写为文字/表格，无法可靠转录则对应位置标记未转录。必要信息媒体缺口为 media_limited；仅非必要视觉细节可经独立论证后通过，但收据须明确披露，不宣称全部转录。
      - `check-raw-style.ps1` 不再惩罚自然段字数或要求列表比例；格式通过不替代全文语义审核。
      - 使用 record-content-audit 绑定收据；schema 8 拒绝旧版或测试替身收据。最多两轮定点返修，仍失败报告阻断。
      - 历史批次仅按原版本复验；新历史回测与新生成使用相同 v2 检查核心。
  → 全部逐单元审核通过并由 `record-content-audit` 登记后，运行 `ingest-control.ps1 -Action render-stage1-audit-summary`，把控制器输出原样写入阶段一包；不得手填或改写。现行确定性包正常通过仅保存 `manifest + decisions + receipt`，review 只在失败、显式人读或调试时落盘；`record-package stage1` 会按收据重新生成并做精确比较
  ── 🚧 编写规则自检闸门 🚧 ──
  → LLM 对照 `raw-sources/README.md` 的编写规则逐条自检，显式输出自检结果：
      【格式完整性】
        ✅ / ❌ YAML frontmatter 字段是否齐全（source / source_url / source_clipping / date / domains / type / tags / ingest_score）
        ✅ / ❌ 每个 `##` 二级标题模块是否标注了 `> 📍 原文：...` 位置标注
        ✅ / ❌ 标题层级、引用格式、分隔线是否按模板统一
      【内容完整性·消化深度】（对照 §编写规则 #7 六维度）
        ✅ / ❌ source manifest 是否覆盖全部 clipping、全部内容单元是否恰好裁决一次、failed_unit_count 是否为 0
        ✅ / ❌ 论证链：前提→推理→结论是否完整，有无跳步
        ✅ / ❌ 定义补全：核心概念的定义及其推导过程是否保留
        ✅ / ❌ 推导过程：因果关系、步骤分解、分叉路径是否保留
        ✅ / ❌ 举例还原：原文用以说明概念的具体案例是否保留
        ✅ / ❌ 学术引用：论文/著作/理论名称和数据是否标注来源
        ✅ / ❌ 数据/阈值：具体的数值、比例、边界条件是否保留
      【完整消化复核】
        ✅ / ❌ v2 收据全篇双向审查，保留独立案例、数值、理由及限定；不比较压缩区间，不要求逐篇 N/M/P 表。

      【其他规则】
        ✅ / ❌ 来源三件套（source + source_url + date）是否完整
        ✅ / ❌ domains 字段是否列出所有覆盖的策划职能域
        ✅ / ❌ 是否为"消化"而非"翻译/摘要"（不逐字翻译，但以全文映射为基准保留原文完整含义，不添加 LLM 个人评价）
      【写作风格】
        ✅ / ❌ v2 写作正反例及实际提供的文风参考是否已完整预读，且阶段一包是否以 `WRITING_SKELETON_V1` 逐篇记录“原文模块→核心命题→载体→原文推导→例证/数据”骨架
        ✅ / ❌ 每个主要章节是否先给作者的核心命题；步骤/维度/分类/对比/参数是否优先使用列表或表格
        ✅ / ❌ 原文的前提、推理过程、效果/风险及限定是否完整连贯保留；自然段不因长度被拒绝，枚举按原意保留
        ✅ / ❌ raw 正文是否无 AI 自行归纳、设计建议或扩展适用边界
        ✅ / ❌ `check-raw-style.ps1` 是否通过，且人工样板对照是否通过
      → 任一 ❌ → 立即重写不合格模块并重新自检，直到全部 ✅ 才进入审核闸门；结构检查、深度检查或静态脚本通过均不得替代写作风格检查
      → 自检结果必须**显式输出**在对话中（不省略、不跳过）
  ── 🚧 审核闸门 🚧 ──
  → 按 `system/maintenance/checklists/ingest-stage-gates.md §1` 输出阶段一审核包，交用户审核内容准确性（辅助意见在阶段包内审阅，不附于 Raw）
      ⚠️ 阶段包内 raw/Clipping 链接必须按“从当前阶段包文件所在目录计算”的相对路径生成（例如 `../../../../raw-sources/<file>.md`）；禁止直接写仓库根相对路径 `raw-sources/<file>.md`，生成后必须逐条 `Test-Path` 解析校验。
      ⚠️ 审核通过前：不碰 wiki、不碰 index、不碰维护链、不碰 raw-list
```

**阶段二·wiki写入审核**（用户确认阶段一审核通过后执行）：
```
阶段一审核通过
  → LLM 统一格式（确保 frontmatter、标题层级、引用格式一致）
  → **领域覆盖反思**（LLM 显式回答两个问题后，再继续）：
      Q1: 本文是否有值得吸收的内容未被现有域覆盖？
          - 是 → 建议新增域，待用户拍板后创建
          - 否 → 继续
      Q2: 现有域列表是否需要调整（合并/拆分/重命名）？
          - 是 → 提出方案，待用户拍板后执行
          - 否 → 继续
      ⚠️ 反思结果须写入输出消息，不可跳过
  → **Wiki 归属判定**（SSOT，本文不委托——`wiki/README.md` 已精简为纯指针）：
      ⚠️ **硬偏好：补充优先于新建**——只要存在 ≥1 个候选现有 wiki 且主题方向相符，默认走「补充 §X」路径，不走「新建」路径。新建需满足两个额外条件：①本 raw 主题与全部候选 wiki 的主轴均偏离 50% 以上 ②扩面搜索发现可凑齐 ≥2 篇支撑（含本篇）。设计意图：提升 raw 复用率，落地"来源深度 > 来源广度"哲学（见 `wiki/README.md §Wiki 结构演化与重组`）
      查阅 system/registry/index.md Wiki 页面段 + 各 wiki frontmatter
      → 判断是否可归入现有 wiki
        ├─ 是（≥1 候选）→ 默认走"补充 §X"路径；仅当主题严重偏离才考虑新建
        └─ 否 → 查 system/registry/raw-list.md 孤立文件（引用次数=0）
                  ├─ ≥2 篇可凑 wiki → 建议新建
                  └─ 不可凑 → （可选）扩面搜索非孤立 raw（基于 system/registry/raw-list.md「标签」「简介」列，对全部非孤立 raw 做主题关键词匹配）
                                ├─ 发现候选 → 输出候选 + 拆 wiki 提示
                                └─ 无 → 标记为孤立
  → **Wiki Group 评估**（不替代 Domain 或 Wiki 归属）：
      先根据 active Group 定义评估目标 Wiki 是否属于既有 Group；再判断是否出现 new Group Candidate。
      → 记录 direct match / existing group candidate / new group candidate / no group，以及命中的语义标准、连接价值、共同阅读用例和需回扫范围。
      → 标准 Ingest：成员增删随既有 Stage 2 审核展示；新建、合并、拆分、重命名或退役 Group 必须附完整 Proposal 并取得制作人批准，但不新增流程熔断。
      → 自动 Ingest：只记录非运行时 Candidate 和 `review_when`，继续原批次；不得自行创建 Group、改写成员关系或扩大 raw / Query 权限。
      → Wiki 拆分时逐子页重新裁决 Group，不机械继承给全部子页。
  → **批注消费路径规划**：
      打开本批阶段包的辅助意见记录 → 逐条读全部三类条目；旧 Raw 批注只按历史消费授权读取
      → 逐条规划消费方式：
        ├─ 🔗 可延伸（已有规则）：
        │    ├─ ⚠️ **判定前先读 `system/protocols/WIKI-LINK-STANDARD.md §一` 的 v2.1 反问式判据**：①目标页能回答当前页论证链中哪个具体命题？②删掉此链后读者会错过什么？两问都答"是"才算值得引用
        │    ├─ ✅ 值得引用 → 标注「目标 wiki + 引用方向」→ 阶段三在 wiki `## 相关页面` 追加引用行（`[页面名](./path.md#锚点)` md链接）
        │    └─ ❌ 不值得引用 → 标注「跳过」→ 阶段三在辅助记录标明处置，不写回 Raw
        ├─ ✅ 亮点（新增）：
        │    ├─ 目标 wiki §X + 加重方式（三选一，不可自由发挥）：
        │    │    ① 作为本节首句引用（`> 💡 "原句关键句"`）
        │    │    ② 在本节末加一句话总结该洞察（+1~2 行）
        │    │    ③ 对已有段落做一次扩写（+2~3 行）
        │    └─ 加重后在该段标注 `> ⭐ 核心洞察`（与加重方式同步写入）
        │    → 阶段三在 wiki 对应位置写入加重内容 + `> ⭐ 核心洞察` 标注，完成后在辅助记录标明消费去向
        └─ ⚠️ 存疑（新增）：
             ├─ 目标 wiki §X + 限定方式（二选一，不可自由发挥）：
             │    ① 在关键段落标注 `> [!存疑]` + 一句话说明存疑点
             │    ② 对确定性强的表述降级加限定语（如"作者推测/原文未提供数据验证/时效注意"）
             └─ → 阶段三在 wiki 对应位置写入限定标注，完成后在辅助记录标明消费去向
  ── 🚧 审核闸门 🚧 ──
  → 按 `system/maintenance/checklists/ingest-stage-gates.md §2` **一次性输出四项**（不可跳过，等待用户确认）：
      ① 领域覆盖反思结果
      ② Wiki 归属建议（含操作：更新/新建/标记孤立）
      ③ Group 评估（既有成员变化 / Candidate / 不适用，以及批准与回扫状态）
      ④ 批注消费路径（逐条：可延伸/亮点/存疑 → 目标 wiki → 具体操作）
      ⚠️ 用户确认前：不碰 wiki、不碰 raw、不碰 raw-list
```

**阶段三·wiki写入和维护**（用户确认阶段二审核闸门后执行）：
```
用户确认后
  → 执行 wiki 写入（新增/更新/新建）
  → 只执行已在 Stage 2 获批准的 Group 成员变更；运行 `sync-wiki-groups.ps1 -Mode Sync`。自动 Ingest 的 Candidate 保持非运行时，不在阶段三静默提升为 Group。
  → 按确认的消费路径执行批注消费：
      ├─ 🔗 可延伸：先按 `WIKI-LINK-STANDARD.md` 的双问复核并同步目标 Wiki 的既有 `## 相关页面`；仅保留不可替代的条目，再追加带锚点与关联方式说明的引用行（`[页面名](./path.md#锚点)` md链接）
      ├─ ✅ 亮点：目标 wiki 对应 § 写入加重内容 + `> ⭐ 核心洞察` 标注
      └─ ⚠️ 存疑：目标 wiki 对应 § 写入限定标注（`> [!存疑]` 或限定语降级）
  → 在阶段包辅助记录逐条标明已消费/跳过及目标；新 Raw 不生成批注附录
  → 旧 Raw 批注只按原批准消费范围清理，不保留已验证占位
      ⚠️ 已删除条目保留在 git 历史中可追溯，不在 raw 文件内另行标注
  → **未消费内容检查**：对比 raw 原文与 wiki 写入内容，检查是否有因主题不对口而未吸收的内容：
      ├─ 先查 `system/registry/raw-list.md`「未消费」列（已有标记的跳过、无标记的才做检查）
      ├─ 判据：以下类型通常无法被当前目标 wiki 吸收
      │    ├─ 系统耦合效应：该机制对外部系统/设计的连锁影响（如"改了A→B也必须改"）
      │    ├─ 元分析框架：raw 展示了设计空间的两端，但 wiki 只取了单侧结论
      │    ├─ 专项案例补充：内容涉及某主题但目标 wiki 论证链上无插入点
      │    └─ 跨域比较：raw 对比了不同品类的设计选择，wiki 只取相关品类
      └─ 如有未消费 → 仅更新 raw-list 对应行「未消费」列（X条 + 具体标签/定位）；详细去向写阶段包，不向 Raw 尾部追加清单。合理省略的 Clippings 枝节不属于 Raw→Wiki 未消费知识。
          ⚠️ 如无则跳过（不生成空白段）
  → 更新 system/registry/raw-list.md（追加新文件行，引用次数初始=0 或按实际）
  → **执行维护流程**（见 `AGENTS.md §维护流程`）
  → 阶段三完成后，只增量更新 `system/registry/KNOWLEDGE_STATUS.md` 中受影响领域、数量、健康挂账和吸收建议；不得全量重写无关领域。
  → **回测独立硬闸门**：记录本轮 before / after 计数，用 `ingest-control.ps1 plan-backtests` 找出全部跨越锚点；每跨 30 篇触发一次，每个锚点固定用同一 6 篇同时完成 A 类评分回测与 `content-backtest.ps1` 全文内容回测，schema v4 评分收据必须引用并逐篇对齐通过的内容收据，再用 `verify-backtest-set` 验证；标准与自动模式还须把收据登记进运行清单。历史旧锚点按原 5 篇规则解释，新 schema 8 锚点按 6 篇规则执行。
  → **维护收据硬闸门**：Prepare 同步来源账本与容量风险；Seal 在维护前自动结算宿主日志，并集中检查所有会话终态、Raw 审核终态与逐篇审计覆盖、Raw 注册表唯一性、物理/分类/状态计数、来源账本、Wiki 健康和 staged diff。标准与自动都保存维护收据，以本批已验证 Stage 1 checkpoint 作为 Wiki 写入前恢复边界；任一失败不得提交。
  ── 🚧 阶段三完成确认 🚧 ──
  → **显式输出以下四项**（不可跳过，与收尾同步输出，等待用户确认或直接 commit）：
      ① Wiki 写入确认：哪个 wiki、新增/更新了什么段
      ② 批注消费确认：消费了几条（亮点 N/可延伸 N/存疑 N）、是否已全部从 raw 删除、覆盖自检矩阵是否已随批注删除、`## 批注` 段是否已删除
      ③ 未消费内容检查结果：有/无；如有 → 标记在哪（raw 文件 + raw-list 列）
      ④ 维护同步确认：raw-list / index / CHANGELOG 是否已更新
      ⚠️ 四项必须在同一输出块中显式列出，不可省略其中任一项
```

## 自动消化（显式；direct 或 managed-isolated）

> **定位**：把评分、阶段一、阶段二的用户审核后置到阶段三完成后，不减少任何评分证据、raw 深度、Wiki 归属判断、批注消费或维护验证。它不是普通 Ingest 的默认加速，也不是 WorkspaceOrchestration 的 `-Mode auto`。

> **新 Raw 的生产者身份**：schema 8 启动使用 `-ProducerContextId <实际宿主上下文ID>`，与每份 Raw 审核请求一致；即使整阶段语义审核 disabled 也保留此身份。没有实际生产者身份，Raw 审核不得登记。

> **控制面 v8**：标准和自动共用 schema 8 运行清单、package-data v2、renderer v2、回测、维护和反向索引。默认 interactive，显式自动 deferred；precision 在同一格式启用 enforced，不回退新建 schema 5。shadow 保留观察、enforced 才把整阶段语义 pass 变为硬门；Raw v2 的全文双向独立审核在所有新运行中都是必需门禁；UseLegacyPackages 仅限历史诊断/测试，不用于新业务批次。

### 语义审核子代理（显式精确模式或兼容策略启用时）

- **默认路径**：未指定语义模式时使用 `system/registry/ingest-semantic-review-policy.json` 的 `default_mode=disabled`，不创建 schema v5 语义收据，不启动评分/Stage 1/2/3 子代理；机械检查、内容收据和四阶段包仍完整执行。
- **精确路径**：启动参数传 `-SemanticReviewMode precision`（用户侧可说“精确自动消化”）时映射为 `enforced`；必须传入独立 `ProducerContextId`，四道语义审核均通过后才能继续。该选择只对当前批次生效，不改变默认策略。
- **现行格式边界**：新 run 使用 schema 8，语义包 package-data v2 / renderer v2；标准/自动/precision 共用现行格式，不因精确审核回退创建 schema 5。历史 schema 5/6/7 按原格式只读解释和有界恢复，已批准包不重渲染。

- 主执行者只负责写入和状态协调；每次审核须由与 `producer_context_id` 不同、未在本批复用的 reviewer context 完成。收据记录 host 提供的上下文 ID、模型、`fresh_context=true`，但该字段不是密码学身份证明。
- Stage 1 的语义 request 必须形成可独立回读的证据闭包：除阶段包、raw、内容收据和写作规则外，还要逐项绑定本批 `Clippings`、对应 `manifest`、`review`、`decision` 文件及其哈希，并绑定 `system/maintenance/checklists/ingest-semantic-review.md` 与 schema；不能只让 receipt 以字段引用这些文件。
- `prepare-semantic-review -SemanticReviewStage <scoring|stage1|stage2|stage3>` 生成含路径和 SHA-256 的只读 request；Stage 2 另须传 run-local `-SemanticReviewCandidatesPath`，其 JSON `candidate_paths` 列出待比对的 wiki/domain 全文，控制器验证路径、去重和哈希而不解析阶段包表格。子代理只能读取该包和 `ingest-semantic-review.md` rubric，不得写文件、调用控制器、提交或复用写作者结论。完成后把 receipt 写入同批 `semantic-reviews/<stage>/`，再由 `record-semantic-review` 验证并登记。
- 若 Stage 1 收据在晚期审核中因 raw 修复而失效，自动/影子模式允许在 `stage3_completed` 或 `awaiting_final_review` 且 Stage 1 非 `valid_pass` 时重新登记同批 `content-audit` receipt；控制器会先验证当前收据与 source/raw/manifest/review/decision 链，再由新的 Stage 1 request 重新绑定。Stage 1 已为 `valid_pass` 时不得借此改写内容审核证据。
- 审核职责固定：评分独立打分；阶段一以 clipping/manifest/raw 复核章节、因果链和遗漏；阶段二独立判断 Wiki 归属与批注消费；阶段三以计划、实际 diff 与 raw 边界复核落地。机械格式、哈希、链接和计数仍由既有脚本负责。
- `shadow` 的 `revise`/`escalate` 只作为前向试运行发现，不改变既有状态门；若证据发生漂移，允许重新生成 request 覆盖旧的 shadow 发现，同一证据不得无限重审；`enforced` 时才要求 `pass`、返修必须有证据哈希变化且最多一次，第二次 `revise` 或任一 `escalate` 自动熔断。任一 request/receipt/证据漂移都会使受强制的 pass 失效。阶段三语义审核在内容提交后进行；修复则产生新的内容提交、diff 和收据。
- 评分 request 在存在内容审核收据时必须闭合 `Clipping → raw → manifest/review/decision → receipt`，并绑定 prepare 前生成的不可变 run snapshot（不能直接绑定会因 pending/active 指针变化的 run.json）；不能只列 Clipping 和评分相关 Wiki。阶段一仍保留同一链路，评分 reviewer 也必须能独立重走来源到 raw 的证据。
- 若后续阶段的证据修复（例如重建 raw 内容审核收据、修正 raw-list/Wiki 导航或容量快照）导致 shadow 的评分、Stage 1 或 Stage 2 receipt 失效，控制器可在确认对应 `active=stale` 后刷新 request；若上一轮已登记 `revise` 且 active 已移入 history，也可在不回退主阶段状态的前提下生成修复轮 request。Stage 1/3 在 `stage3_completed` 或 `awaiting_final_review` 的晚期漂移同样只允许 shadow 刷新。以上不放宽既有 package、artifact、content-audit 或候选清单检查。`enforced` 仍必须通过正式阶段回滚/恢复路径处理，禁止直接重开已关闭阶段。刷新后的最终审核包必须重新渲染，旧 receipt 保留在 history，不得继续作为当前通过依据。

### 1. 显式触发与启动前置

只有用户明确说“自动消化 / 自动模式消化 / 以自动审核模式消化 / 开始自动审核模式”才可进入；若再明确说“精确自动消化”，才选择精确子代理审核。普通“消化 / Ingest / 按推荐执行 / 继续”一律保持标准消化，不得推断或沿用自动模式。

启动时先明确选择一条且仅一条路径，再由 `ingest-control.ps1 -Action start -ReviewPolicy deferred` 创建运行清单；语义模式未指定时默认为 `disabled`，精确模式通过 `-SemanticReviewMode precision` 显式传入；任一项不满足都**拒绝执行且不改状态**：

1. 本批边界和标题可唯一定位。建议 2～3 个最终 raw、常规不超过 4 个；超过建议时先说明拆分理由或继续风险，不构成脚本拒绝条件。多个命名批次因篇数过小可合并为一个运行单；仅限阶段一回滚点前、尚未登记证据或创建提交时执行，合并后总输入不得超过 6 篇，并在运行清单与最终包保留每个原批次标签。
2. **direct 路径**：`../WorkspaceOrchestration/config/mode.json` 精确为 `direct`。普通 W0–W2 direct 任务不登记、不运行 `task-tool status`，`direct_start_allowed` 只作 W3 存量诊断；只有 Gate A 命中或用户显式要求受管/隔离时才进入 WorkspaceOrchestration W3。自动消化仍须满足本批 Knowledge 状态为 `inactive`、无同批外未提交改动以及控制器的其他前置。
3. **managed 路径**：先由 task-tool 以 isolated + managed worktree 登记 Knowledge task；启动时传 `-ManagedTaskId <task-id>`，控制器逐项验证 task active、repository=knowledge、mode=isolated、worktree 所有权 active、execution_path=当前工作树且 HEAD=task base。全局开关可为 managed，也可在 direct 下显式 `-Managed`；不得用外部 worktree 或 normal task 冒充。
4. `system/registry/ingest-auto-review-state.json` 的 `status=inactive`，且该状态文件无未提交漂移；`running`、`awaiting_final_review`、`fused` 都表示上一轮未结束。
5. 当前 Knowledge 工作树没有与本批 write scope 无关的未提交改动；相关用户改动无法安全隔离时拒绝。managed 路径只修改隔离工作树中的状态副本，canonical Knowledge 的 tracked guard 继续保持 `inactive`。

前置通过后，只有控制脚本可将状态写为 `running / scoring` 并记录 `batch_id`、标题清单、before 计数、基线 revision 和开始时间。自动模式只覆盖这一批；不得顺带进入下一批。

### 2. 生命周期与提交边界

| 时点 | 状态 | 动作 |
|---|---|---|
| 启动 | `running / scoring` | 读取评分、来源、raw 与闸门规则；AI 逐项作出门禁决定并记录依据 |
| 合并小批 | `running / scoring` | 仅在尚无证据包、artifact、回测或 Stage 1 提交时，可由 `merge-pending` 合并命名批次；总输入≤6，之后回到同一评分流程 |
| 阶段一全部通过 | `running / stage1_committed` | 先登记每份输入终态与 raw 映射，再只提交本批 raw / skipped / Clippings 终态命名与自动模式状态，形成回滚 checkpoint；不碰 wiki、index、raw-list 或维护链 |
| 阶段二规划通过 | `running / stage2_planned` | 只形成 Wiki 归属、批注消费与未消费规划，不写目标文件 |
| 阶段三闭合 | `awaiting_final_review / stage3_completed` | 完成 Wiki、批注消费、索引和维护链，创建内容闭合 commit；一次性输出最终审核包 |
| 用户最终审核通过 | `inactive / none` | 清空 active batch并保留最近完成摘要；direct 创建退出提交，managed 继续准备单结果 close |

- 用户驳回或要求修改时，状态保持 `awaiting_final_review`；修复、重验并重新输出差异审核包后再等最终审核。`render-final-review` 必须允许在该状态重生成最终包，以替换失效哈希；重生成前仍需重新锁定所有发生变化的分包。
- 用户明确放弃时，先按阶段一 checkpoint 回滚或清理本批产物并验证工作树，再以退出提交恢复 `inactive`；不得只改状态掩盖残留。
- 阶段一 checkpoint 是根收尾"一次性提交"规则的窄例外，只服务本批回滚。阶段三内容提交和最终退出提交仍各自按维护/验证边界闭合。
- direct 路径在 `status != inactive` 时不得切换 WorkspaceOrchestration 模式。managed 路径必须始终保持原 task active/isolated/owned；身份或所有权漂移立即熔断。
- managed 最终批准后先执行 `finish -ApprovedHash <hash>`，再执行 `prepare-managed-close -Apply`。后者把 Stage 1 与 Stage 3 的 binary patch、revision、tree 与 SHA-256 写入本批证据目录，以 mixed reset 让 HEAD 回到 task base，同时保留最终文件结果；随后只能由 task-tool close 创建唯一结果提交与收据。
- managed 在 close 前驳回/放弃时，从最近 checkpoint 修复或回滚后用 task-tool abandon，不产生收据；结果已经 released 后不得改写旧收据，另建 `-CompensatesTaskId <released-task>` 的 isolated 补偿任务。
- Stage 1、Stage 2、回测和 Stage 3 分别使用 `check-stage1 / check-stage2 / check-backtests / check-stage3` 推进；不得手改运行清单伪造状态。确认熔断后使用 `fuse -Reason <事实>` 同步运行清单与全局状态；熔断会使尚未批准的最终审核包失效，恢复后必须重新生成并审核。
- **深度覆盖回读补审**：因阶段一深度证据不足而熔断，或对历史批次补审时，在该批运行目录写 `depth-remediation.md`。它按主要章节记录“原文位置→raw 锚点→覆盖判定”，并给每份 raw 写“正文充分 / 需局部扩写 / 存疑待人工判断”；该表只定位高风险内容，不能替代 source manifest 逐单元重审。`record-depth-remediation` 锁定其哈希；若发现遗漏或存疑，`recover-fused` 必须清除阶段一及后续包、退回评分/阶段一，不能凭补审表直接进入阶段二；正文充分且全文审核通过时才可保留已有 checkpoint 继续复验。
- **深度补写后的 Stage 1 重建**：若 `recover-fused` 因“需扩写/存疑”退回阶段一，补写完成后用 `rebase-stage1-baseline -BaselineRevision <补写前提交>` 重建 diff 基线。该动作仅接受 raw 数量不变、未创建阶段提交、未记录后续包且补审哈希未漂移的 `running_scoring` 运行；会保留旧基线审计、清除旧 Stage 1 包，随后必须重新锁包并执行 `check-stage1`。禁止手改 `run.json` 的基线。

### 3. 熔断条件

自动模式允许 AI 修复确定性的格式或校验问题；同一断言最多自修复 1 次，第二次仍失败即熔断。以下任一条件命中时立即停止，不继续后续阶段，将状态置为 `fused`（启动前置失败除外），并即时向用户报告已完成范围、失败证据和安全恢复选项：

| 类别 | 明确熔断条件 |
|---|---|
| 来源与批次 | 来源核心正文不可访问、明显截断且无法核对；不可消化嵌入承载核心论证；批内身份/标题映射冲突；合并与独立会改变证词边界且现有证据不能唯一决定 |
| 评分 | 历史评分触发 `SCORING_SYSTEM.md` 的分差熔断；重复来源身份冲突；🟡 条件消化存在两个以上会实质改变 raw 内容的消费方案，且无法按既有规则唯一选择 |
| 阶段一 | 任一 raw 的结构、深度覆盖、样板风格或事实追溯在一次修复后仍不通过；原文内部矛盾会改变核心结论且无法用限定语安全保留；实际写入越出本批 Stage 1 scope |
| 阶段二 | 需要新增/删除/重命名/合并/拆分 domain；需要删除或重命名既有 Wiki；两个以上归属方案会改变知识结构且没有单一规则优先级；批注或未消费内容找不到安全落点 |
| 阶段三 | 任一维护/链接/计数/diff 校验在一次修复后仍失败；出现未声明文件改动或无关用户改动；阶段一 checkpoint 缺失或 Git ancestry 无法证明；消费数量与阶段二规划不一致 |
| 权限与安全 | 需要删除本批外文件、覆盖既有 config/lockfile、写工作区外、联网鉴权、push、force/reset 或其他尚未授权的外部状态变化 |
| 编排状态 | direct 路径执行中不再满足 direct/空闲；managed 路径 task 不再 active isolated、execution_path/所有权/base 身份漂移，或出现同仓第二任务 |

熔断不是普通审核包：必须立即可见，不等待最终统一输出。除下述“回测修复自动恢复例外”外，解除熔断需要用户确认恢复方案；恢复后从最近可证明的 checkpoint 继续，不静默跳过失败门禁。

#### 回测修复自动恢复例外

- `SCORING_SYSTEM.md §回测修复持续授权` 是自动模式中的显式常设授权。内容回测确认历史 raw 存在可确定、Knowledge 内可最小修复的问题时，仍先 `fuse` 留下失败证据，但无需逐篇等待用户确认。
- AI 直接最小修复 raw，重新完成全文 source audit、样例风格与相关维护验证；raw 发生修改后，必须同步检查引用或吸收该 raw 的既有 Wiki，缺失的知识在既有页面原章节或相邻章节补充。
- Wiki 默认不拆分，也不因回测顺势新建、删除、重命名或合并页面。若没有安全既有落点、需要结构变化、来源不可核对、修复方案不唯一，或命中权限与安全类熔断，则本例外不适用，继续保持 `fused` 并请求用户决策。
- 修复与复验通过后，使用控制器从最近可证明的 checkpoint 自动恢复；不得手改状态，不得省略熔断证据、raw/Wiki 处置记录或失效包重生成。

### 4. 最终一次性审核包

阶段三完成后先将 §5.1～5.4 与门禁审计分别 `record-package`，再由 `render-final-review` 按 `system/maintenance/checklists/ingest-stage-gates.md §6` 一次性生成内容审核包：

1. 评分包；
2. 阶段一闭合包；
3. 阶段二 Wiki 归属和批注消费规划；
4. 阶段三闭合包；
5. 自动门禁决策日志、两次内容提交边界、熔断检查和当前 `awaiting_final_review` 状态。

五份分包仍是证据入口，但最终报告必须直接呈现逐来源评分与取舍、新 raw 的关键内容与保真边界、Wiki 具体增量或精确 diff、实际拆分结果及回测状态；不得只剩五个链接。异常、未吸收项、当前恢复点与批准版本一并可审。全文、逐单元矩阵和详细日志可链接展开，不全文重复。标准最终汇总复用已审结果，突出其后变化；自动最终报告覆盖同样内容。

用户只需在此时审核。发送前必须执行 `verify-final-review` 并同时给出最终包 SHA-256。最终审核通过只授权以该精确哈希执行 `finish -ApprovedHash`、提交状态解锁；不自动授权 push、切换 managed 或开始下一批。任一来源包、最终包或其引用的来源/raw/Wiki 内容版本在审核后变化，都必须使对应审核失效、重验依赖并重新批准；只更新 hash 不能继承旧语义通过。

`finish` 同时把本批 `record-artifact` 映射写入审核索引。direct 的最终退出提交、managed 的最终 task close 结果都必须包含更新后的 `system/maintenance/ingest-runs/index.json`；旧批次证据可保留原目录形态，但新批次一律使用 `<batch_id>/run.json`。

**审核证据保留契约**：自动审核最终包经精确哈希批准后不删除、不改写；与运行清单、阶段包、维护收据和回滚提交共同保留在 `system/maintenance/ingest-runs/` 维护证据区，不进入普通 Query 索引。新批次默认冻结原路径；只有用户明确要求归档规范化时才可迁移，迁移时必须同步运行清单与反向索引，包正文和批准哈希不得变化。

## 消化价值自检闸门

> **评分规则** → 详见 `system/protocols/SCORING_SYSTEM.md`（A 类固有质量 + B 类相对价值 + 综合判定 + 自检清单 + 校准陷阱 + 置信度标注 + 回测机制）。
> 判定条件、优先级、阈值和记录规则仅由 `system/protocols/SCORING_SYSTEM.md §综合判定规则` 定义；本协议不复制评分实现。
> 执行闸门时先读取并完整执行该 SSOT，再回到本协议继续用户确认和阶段状态转换。

---

## 质量批注规范

每次 Stage 1 完成后，将 AI 质量意见写入本批阶段包辅助记录，随阶段包审阅，不放 Raw 底部；Stage 2/3 按相同记录规划和消费。

#### 四个触发维度

| 标签 | 触发条件 | 输出要求 |
|------|----------|----------|
| `⚠️ 存疑` | 逻辑跳跃、论据不足、数据存疑、结论与前提不一致 | 引用原文位置 + 一句话说明存疑点 + 证据/依据 |
| `✅ 亮点` | 洞察精辟、框架清晰、方法论可复用、表述精准 | 引用原文位置 + 一句话说明价值 + 可复用方向 |
| `🔗 可延伸` | 可与知识库已有内容交叉/对比/深化，**且该延伸若落地为链接能通过 v2.1 反问式判据**（两个问题都答"是"——见 `system/protocols/WIKI-LINK-STANDARD.md`） | 标注可关联的 wiki 页面名称 + 延伸方向（对比/互补/深化）——**禁止在 raw 中使用 `[[wikilink]]` 双链语法**。不再输出「链接类型建议」：v2.1 下判据通过的延伸必定是「值得链」（md链接），不通过则不出此标签 |
| `🔄 冗余` | 知识库已有同类内容且本文无显著增量 | 标注已有 wiki 页面 + 本文与已有的重叠/差异判断 |

**硬规则**：
- 每条必须有「原文位置」引用（`§章节/第×段`）和「一句话理由」，无原文引用的不输出
- 不硬凑——某维度无触发则不输出该标签
- 批注始终以「AI 辅助意见」身份呈现，区分"事实性存疑"（有证据）和"判断性存疑"（AI 觉得但无硬证据）
- 输出上限：总条数 ≤ 8 条（避免噪音）
- **`🔗 可延伸` 禁止 `[[wikilink]]`**：wiki 页面名用纯文本提及，双链语法仅在 wiki 撰写阶段使用（此时参考阶段包中的辅助记录）
- **`🔗 可延伸` 预检**：每条建议输出前须过 v2.1 反问式判据——①目标页能回答当前页论证链中哪个具体命题？②这个回答在当前页中是否不可替代？两问都答"是"才输出，否则跳过（避免阶段三消费后又被 Lint 删掉）

#### 数据库查阅规则

输出批注前做**轻量交叉检查**（默认执行，不跳过）：
- 查 `system/registry/quick-reference.md` 标题集 → 判断 `🔗 可延伸` 和 `🔄 冗余` 的候选
- 发现信号后按 QUERY_PROTOCOL 实际读取相关完整章节；核心机制比较须读透核心 Wiki。标题只用于发现候选，不能确认重叠或引用价值
- 仅扩读会改变冗余、归属或条件判断的缺口；无信号只能标记“未发现候选”，不能当作全库不存在相关知识

#### 输出模板

```
📝 阶段包辅助记录：AI 质量意见

⚠️ 存疑（N 条）
- [§X.X 段名/第Y段] 一句话存疑点描述
  依据：...（1~2 句）
  影响：对结论/判断的影响

✅ 亮点（N 条）
- [§X.X 段名/关键标注] 一句话价值描述
  价值：...（1~2 句）

🔗 可延伸（N 条）
- [§X.X 段名] 可关联「wiki/页面名」
  方向：对比/互补/深化，具体建议（1 句）
  v2.1 判据：落地后读者从目标页跟过来有不可替代的信息增益（两问都答"是"）

🔄 冗余（N 条）
- [§X.X 段名] 已有 [[wiki/页面名]] 覆盖
  判断：本文增量有限/无增量，建议处理方式
```

---

## 审核提交后的派生索引维护

接收者明确启用本机绑定maintenance并安装post-commit事件后，用户批准当前精确终审、Finish及退出提交完成时，事件核对已提交completed run、精确报告/清单与Wiki字节，按已审范围自动更新Tools派生索引。日常Query保持只读。旧批或手工已审维护按system/query/README.md同一维护入口或真实审核消息尾注接入；不把任意Git提交当作已审核，不能修改旧批准hash来通过。索引失败回原Query，实际维护结果写包外收据；不撤销已批准内容、不自动发布或同步网站。包安装不启用该维护、模型或hook。
