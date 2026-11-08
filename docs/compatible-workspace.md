# 接入已有工作区 / Integrate an existing workspace

兼容模式先理解当前需求与现有框架，按所选包真正缺少的能力补齐，不把“采用这个仓库”等同于“替换根工作区”。新建工作区可选择 full 模式，接入完整 meta；兼容模式可以只接入独立业务模块。meta 保持一个完整版。

Compatible mode adds selected capabilities to an existing workspace. It keeps the host's rules and structure. Full mode supplies complete meta for a new workspace. Compatible mode can install standalone business modules only. Meta retains one complete edition.

## 审计和选择 / Audit and select

可以直接交代 Agent：“审计这个现有工作区，我现在需要脑暴。说明已有能力、可复用模块、推荐的可选项，以及选定包缺少的必需依赖；先给计划，再应用。”Agent 先读本页，使用只读审计定位材料，再审阅真正影响所需能力的文档与接口，不全盘扫描私人内容。

Ask the agent to audit your current workspace for a specific need, identify reusable capabilities, recommend options and identify missing dependencies of selected packages. The agent reviews relevant host documents and interfaces; discovery alone is not proof of equivalence.

```text
python scripts/workspace.py audit --target <existing-workspace> --needs brainstorm
python scripts/workspace.py audit --target <existing-workspace> --packages brainstorm --profile <reviewed-profile.json>
python scripts/workspace.py init --target <existing-workspace> --mode compatible --packages brainstorm --profile <reviewed-profile.json>
python scripts/workspace.py init --target <existing-workspace> --mode compatible --packages brainstorm --profile <reviewed-profile.json> --apply
```

`--needs` 接受 `collaboration`、`brainstorm`、`prototype`、`knowledge`、`skills`、`game-analysis`、`presentation`、`assets`。它们表达当前需要，不自动安装任何包。`--packages` 是实际选择，可包含 `meta`。没有选择时不创建安装记录。两种模式都默认预览，加 `--apply` 才写入；audit 永远只读，不能与 `--apply` 合用。

`--needs` accepts `collaboration`, `brainstorm`, `prototype`, `knowledge`, `skills`, `game-analysis`, `presentation` and `assets`. Needs drive recommendations, not automatic installation. `--packages` is the actual selection and may include `meta`. Selecting nothing creates no installation state. Audit never writes; other commands preview unless `--apply` is present.

| 审计字段 / Field | 含义 / Meaning |
|---|---|
| `candidates` | 发现的路径与摘要，尚未确认可替代 / Discovered documents and hashes; equivalence is unconfirmed |
| `reuse` | 已审阅的替代模块，或仍与基线一致的已安装组件 / Reviewed substitutes or installed components matching their baseline |
| `recommended` | 根据当前需求推荐的可选组件；`missing_if_selected` 列出选择后需补的能力 / Optional recommendations, including conditional gaps |
| `required` | 已选包真正缺少的能力及可安装选项；可通过现有替代模块消除 / Missing dependencies of selected packages, satisfiable by reviewed existing substitutes |
| `optional` | 选定包的可选跨包接线，不成为必选 / Optional cross-package integrations, never mandatory |

2.x 模块提供自身的领域规则。`host-governance` 是可选的增强协作能力，由 meta 或经过审阅的既有框架提供。1.x 的安装和迁移记录继续按原合同解释。Knowledge 与 FromDemoToSpec 都不是 Brainstorm 的默认必需依赖；只有实际启用对应接线时才核对协议、工具和授权。安装器不执行现有模块，也不把相同名称视为接口兼容。

In 2.x, each module supplies its domain rules. Host governance is an optional enhancement supplied by meta or a reviewed existing framework. Existing 1.x installation and migration records keep their original contract. Cross-package links remain optional. The installer never executes existing modules or treats a matching name as interface compatibility.

审计材料以 [能力合同](../compatibility.json) 为依据，并随版本封入 catalog。Agent 对照每项 criteria 审阅，记录理由和实际证据路径、SHA-256，形成 profile。摘要可以取自审计结果，但 `assurance`、理由和 checks 只能在审阅后填写；不为消除必选项虚构符合性。

The versioned [capability contract](../compatibility.json) is sealed into the catalog. The agent must review every criterion and record its reason and evidence hashes. A profile is a semantic review record, not a machine certification or grant of authority. Hash checks detect stale evidence; they do not prove the review's reasoning.

示例结构如下；替换真实证据和理由后才能使用：

```json
{
  "schema_version": 1,
  "providers": [{
    "id": "existing-host-rules",
    "capabilities": ["host-governance"],
    "assurance": "reviewed",
    "reason": "Describe how the existing rules cover all four criteria, including any interface limits.",
    "checks": {"host-governance": ["goals-and-authority", "scope-and-data", "facts-and-verification", "delivery-and-recovery"]},
    "evidence": [{"path": "AGENTS.md", "sha256": "REPLACE_WITH_ACTUAL_64_CHARACTER_SHA256"}]
  }]
}
```

也可以登记现有的 brainstorming、prototyping 或 knowledge 能力，满足当前需求时审计会优先列出复用，不推荐重复安装。多个文档共同证明时全部登记；脚本、协议或配置影响判断时也作为证据。证据只能指向工作区内普通文件，拒绝越界、链接、缺失、摘要变化或未覆盖全部 criteria 的记录。未知能力保留为未知，不能默认为等价。

You can also review existing brainstorming, prototyping or knowledge providers to avoid duplicate recommendations. Include every document, protocol or configuration needed for the judgment. Evidence must be ordinary files inside the workspace. Missing, stale, linked, escaping or incompletely reviewed evidence is rejected. Unknown capability remains unknown.

## Package 与现有工作流的兼容审查 / Package and workflow review

兼容审查有两层：一层确认宿主约束与必需依赖，另一层确认所需 package 与现有业务模块、工作流如何相处。即使不安装 meta，也要进行第二层审查；现有模块可能已满足需求，也可能只覆盖一部分。

There are two review layers: host governance/dependencies, and how a selected package fits existing domain modules and workflows. The second layer also applies without meta. Existing modules may fully or partially cover the requested need.

`audit` 以及兼容模式 `init`、`add`、`upgrade` 的计划自动列出 `package_review` 与 `package_review_criteria`，提醒 Agent 对已选包和待推荐包开展语义审阅。`candidates` 只定位根入口、最多 100 个根目录下子目录及 modules 子目录的 README/AGENTS，以及 .agents/skills、.claude/skills 各最多 100 项 Skill 入口；它不递归扫描业务正文，也不执行现有模块。工作流可能位于其他位置，Agent 应按当前需要沿宿主导航补充定位，未发现不能写成不存在。

Audit and compatible-mode init/add/upgrade plans automatically include `package_review` and `package_review_criteria` for selected and recommended packages. Candidate discovery covers root entry documents, README/AGENTS in up to 100 immediate directories at each of the root and modules locations, and up to 100 skill entrypoints in each supported skill directory. It does not recursively scan business content or execute modules. Follow relevant host navigation to find workflows elsewhere; absence from discovery is not proof of absence.

Agent 先说明当前任务，再检查：

| 审查面 / Review area | 要回答的问题 / Question |
|---|---|
| 职责与覆盖 / Responsibility | 已有模块解决了哪些需要？新包补什么，是否重复？ / What already exists, what is missing, and what would duplicate it? |
| 接口与调用 / Interfaces | 输入、产物、协议、启动入口与导航是否匹配？ / Do inputs, outputs, protocols and invocation paths fit? |
| 权威与数据 / Authority and data | 谁拥有决定、状态、目录和用户内容？是否产生两个事实源？ / Who owns decisions, state and user data; would integration create competing authorities? |
| 接入与恢复 / Integration and recovery | 是否需要兼容、理由是什么、下一步怎样验证和撤回？ / Is compatibility work needed, why, and how can the next step be checked and reversed? |

审查输出写入宿主接入计划或已有记录：现有材料与证据、覆盖/差异、是否需要兼容、建议边界、尚未决定的问题和下一步。可能直接复用现有模块而不安装，也可能保留两者、补调用入口或另做适配；这些只是可选思路，具体方式结合实际工作区再定。没有必要兼容时，说明依据后按默认隔离位置安装。存在重叠但方案未定时，不自动合并、替换、双写状态或迁移数据；不依赖该方案的独立安装可以继续。

Record evidence, coverage/gaps, whether compatibility work is needed, proposed boundaries, unresolved questions and the next step in the host integration plan or an existing record. Reusing an existing module without installation, keeping both, adding an entrypoint or building an adapter are possible approaches, not preset decisions. If no integration is needed, explain why and use the isolated default location. Unresolved overlap does not authorize merging, replacing, dual-writing state or migrating data; independent installation can proceed when it does not depend on that decision.

`ready` 只表示已选包的必需能力已满足，不代表业务兼容已经审阅或通过。`package_review` 是 Agent 审阅入口，不是安装器自动判定的兼容认证，也不增加统一人工审批。已有 provider 只有对照 capability criteria 完成审阅后才写入 profile；package 兼容方案不塞进 provider 字段，也不伪造审阅状态。后续加包、相关流程变化或实际启用接线时重审受影响部分。

`ready` means required capabilities are satisfied, not that package interoperability has been reviewed or approved. `package_review` prompts agent review; it is not automatic compatibility certification or a new blanket human-approval gate. Only reviewed capability substitutes belong in the provider profile. Keep integration decisions in host records and revisit affected boundaries when adding packages, changing relevant workflows or enabling links.

## 安装位置与使用 / Placement and use

业务包仍放 `modules/<id>`；选装 meta 完整放在 `modules/meta`，其中相对链接以该目录为准。根 AGENTS、README、现有规则和模块不被替换。工具生成根目录下的 `agent-workspace-compatibility.md`，列出已装入口与复用证据；如已有同名文件则报告冲突。

发布仓可以位于现有工作区内的独立工具目录，但不能位于所选组件的安装目录或安装记录目录内。不能把用户目标放进发布仓。审计只读，不要求搬动现有仓库。

Packages remain under `modules/<id>`. Selected meta is installed complete under `modules/meta`; its relative links are local to that directory. Root rules and home documents remain intact. The generated `agent-workspace-compatibility.md` links installed components and reused evidence, reporting a conflict if an unrelated file already exists there.

The distribution may live in a separate tools directory inside the existing host, but not inside a selected component or installation metadata. Installation targets cannot be inside the distribution. Read-only audit does not require moving existing repositories.

首次使用时让 Agent 读取这个接入入口与实际所用包的 AGENTS/README。meta 作为当前任务的补充指导，不能取代用户指令与宿主权威。meta 中的 Skill 显式按需读取，不宣称已注册到所有平台。若要自动发现接入入口，Agent 应核对当前平台的读取方式，再按用户授权把引用加入现有导航；安装器不猜测或改写宿主接线。

Ask the agent to read the integration entry and the selected package's AGENTS/README. Meta supplements the host; it does not replace its authority. Skills in scoped meta are loaded explicitly as needed. Automatic discovery depends on the host platform and must be checked before adding an authorized navigation link.

运行工具按所选内容核对：统一安装器需要 Python 3.10+，Brainstorm 需要 PowerShell 7，FromDemoToSpec 需要 Node.js 22+ 与 PowerShell 7，Knowledge 需要二者且首次 Ingest 前需要 Git。本仓 `doctor` 检查完整工具箱；兼容接入不因未选择的包缺工具而要求安装它们。

Check tools for selected components: Python 3.10+ for installation, PowerShell 7 for Brainstorm, Node.js 22+ and PowerShell 7 for FromDemoToSpec and Knowledge, and Git before Knowledge Ingest. `doctor` checks the whole toolbox; an unselected package's tools are not a compatibility dependency.

## 后续与恢复 / Maintenance and recovery

兼容模式和已审阅 provider 保存在同一个 state 中。后续 add/upgrade 自动沿用模式并重新校验证据；可传新版 profile 重新审阅。框架冲突、事务备份、失败恢复与回滚沿用统一工具。无关用户内容不进入基线。两种模式不能就地互换；已有 full 安装不搬家、不重新安装 meta。更早独立 released 包仍走其原迁移链，不冒充兼容安装。

Mode and reviewed providers are persisted in state. Add and upgrade retain the mode and recheck evidence; supply a new profile after re-review when needed. Existing transaction, conflict and rollback protections still apply. Unrelated host data is not owned. Modes cannot be switched in place; existing full installations retain their layout. Legacy standalone releases follow their original migration chain.


## 2.x 独立模块与获取 / Independent modules and retrieval

catalog schema 2 固定每个模块的公开仓、独立版本、实际提交、module.json 与库存摘要。审计读取这些元数据，选中模块才需要取得并校验正文。fetch --packages <ids> --apply 获取选定模块，fetch --all --apply 明确获取全部。轻量 ZIP 和浅克隆适合按需开始。

Catalog schema 2 fixes repository, independent version, commit, module.json and inventory digests. Audit uses this metadata. Selected payloads are retrieved and verified separately. fetch --packages <ids> --apply retrieves selected modules; fetch --all --apply is the explicit all-module path. Use the lightweight ZIP or shallow clone for selective access.

已有独立模块通过 module.json 发现。相同公开身份、版本和完整库存可以登记为 external_modules，并记录实际位置。安装器保留其 Git 与文件所有权。用户修改、多实例和版本差异进入独立审阅。外部实例的升级沿该模块仓库，AWS 注册回退只撤回注册与本轮受管文件。普通同类模块仍使用上面的工作流兼容审查，不凭文件名视为等价。

Existing module.json files identify candidates. Matching publication identity, version and full inventory allow external_modules registration at the actual location, preserving Git and file ownership. Edits, duplicate instances and version differences need separate review. Upgrade external instances through their own repository. Reversing AWS registration preserves the instance. Similar workflows still require the semantic compatibility review above.
