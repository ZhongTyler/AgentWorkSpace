# Packages and optional integrations

meta 是工作区底座，下列十个 package 是并列选项。并列不表示依赖相同：Brainstorm、FromDemoToSpec、Knowledge 需要宿主治理能力，可由完整 meta 或经过审阅的现有框架提供；其余七包没有必装模块依赖。新建工作区的 full 模式安装完整 meta，已有工作区的 compatible 模式只补选择的包与缺失能力。

Meta is the foundation; these ten packages are peers. Their capability requirements differ: Brainstorm, FromDemoToSpec and Knowledge need host governance from meta or a reviewed existing framework. The other seven have no mandatory module dependency. Full mode installs meta; compatible mode supplies only selected packages and missing capabilities.

| Package | Core environment and required capability | Optional integration | Missing integration |
|---|---|---|---|
| Brainstorm | Agent; PowerShell 7 for tools; host-governance capability | Knowledge, GameAnalysisDecision, FromDemoToSpec | Brainstorming and session tools work without optional packages |
| FromDemoToSpec | Agent; Node.js 22+ and PowerShell 7 for tools; host-governance capability | Knowledge, GameAnalysisDecision, GamePresentation, PrototypeAssets | Build from project facts and available tools; use reviewed manual/generated assets |
| Knowledge | Agent; PowerShell 7 and Node.js for tools; Git for first Ingest baseline; host-governance capability | Query consumers such as Brainstorm and GameAnalysisDecision | Query and Ingest work without consumer packages; empty-library queries remain valid |
| Skills | Python 3.10+ to install; Agent to use methods | GameAnalysisDecision, Knowledge, GamePresentation for domain routes | Use project facts and available methods; disclose unavailable tools |
| GameAnalysisDecision | Agent; Node.js 22+ for tools; Git for local learning baselines | Knowledge, Brainstorm, FromDemoToSpec | Direct analysis and project evidence still work; source resolution reports unavailable |
| GamePresentation | Agent; Node.js 22+ for transactions; actual Godot for engine verification | PrototypeAssets or reviewed equivalent asset source; GameAnalysisDecision; FromDemoToSpec; image generator | Generated/manual sources and workflow remain available; no invented engine/image execution |
| Travel | Agent; Node.js 22+; core CLI uses built-in modules | Optional account-based research service, Playwright/browser checks, deployment adapter | Manual/official-source research and private offline websites work without meta, Knowledge, Skills or game packages |
| PrototypeAssets | Node.js 22+ for verify/export | GamePresentation for project update/recovery; FromDemoToSpec for base 2D consumption | List, verify and export remain standalone; copies have no source runtime dependency |

These are capability relationships, not a mandatory package chain. No package automatically installs, downloads, enables or executes another. Root audit recommends only for declared needs, and requires only genuinely missing dependencies. An existing equivalent provider needs actual criteria review and unchanged evidence hashes, not a matching folder name.

安装后：先读 modules/<id>/README.md。自定义宿主入口由宿主维护，不在公开模板中写项目事实。GameAnalysisDecision 与 Knowledge 的私有 v2 稳定引用、公开便携 Query 不是同一接口：按实际 Provider 返回状态，或由 Agent 按已安装 Knowledge 当前协议查询并读取材料。缺少原则 Provider 不阻断无关分析。

Godot source flow: approved asset catalog OR generated/manual project sources → project workbench → explicit purpose/rights/technical gates → sealed local release → engine-owned runtime copy. Source catalogs, private prompts and workbench records are not game runtime dependencies. Audit webpage captures are not shipped; original license text and review records remain.

Skills package installation only installs the library. The second, explicit selection step installs named skills into .agents/skills or .codebuddy/skills. Skill state and transactions live in .agent-skills/<platform>, independently of .agent-workspace. A root package upgrade updates the library only; run its skill upgrade command to update already selected skills. If meta and the picker manage the same path, differing changes remain conflicts; do not force either owner's edits over the other.

工程验证不等于专业方法收益、美术/听感认可或真实玩家验收。平台与工具缺失时报告具体限制，继续不依赖它的工作。

Research uses an Agent and Python 3.10+ for local review/capture helpers. MCP uses separately installed Node/Python dependencies and recipient accounts; media OCR lock targets Windows Python 3.12. Knowledge, GAD and scheduling are optional. Direct Markdown/URL research remains available without them. Installation does not enable services, schedule work or authorize ingestion. Keep research outputs outside modules/research.

## Tools (1.9.0)

Tools is the tenth independent business package; seven business packages have no required capability provider. It provides workspace-tools and optionally consumes Research, Knowledge and Skills. Research optionally discovers workspace-tools; no mandatory cycle or automatic installation is introduced. The private maintenance repo is distinct from this curated public package. Runtime and account ownership stay outside managed modules.
