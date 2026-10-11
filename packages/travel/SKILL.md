---
name: travel-workflow
description: Build and maintain a source-backed trip plan from research through daily decisions, budgets, maps and an offline travel website using this self-contained toolkit. Use for new trips and cross-stage travel work, not isolated travel trivia.
---

# Travel workflow

Read [AGENTS](AGENTS.md). This Travel directory is the workflow root; every trip is separate and commands take explicit --project. For first use read [quick start](运行/快速开始.md). Never read the original author's workspace or scan private profiles.

- New destination: [scope](流程/01-需求与研究范围.md), [data contract](运行/数据合同.md). Create with init, never overwrite. Use only a user-selected [private preference profile](模板/偏好记录.md); this trip's requirements override past tendencies.
- Collect experience: default to [manual intake](运行/人工采集与导入.md) and existing sources. Use [MCP capture](skills/xiaohongshu-capture/SKILL.md) only when chosen; platform login is not a prerequisite for planning.
- Synthesize sources: [digest](skills/xiaohongshu-evidence-digest/SKILL.md).
- Plan/change a day: [day planner](skills/travel-day-planner/SKILL.md).
- In-trip changes, protected experience time, operational deadlines, reviewed map ETA, historical weather, optional assistant coverage and research-channel pause: [operations](运行/旅途中调整与时间约束.md). Structured constraints run in validate/sync/build; channel pause is enforced before MCP connects. No implicit resume or paid assistant dependency.
- Presentation: read the complete bundled [design skill](skills/travel-presentation/SKILL.md), then [website](流程/07-网站与信息呈现.md) and [journal](流程/08-旅行手册与素材.md). Design, implement and inspect actual pages; using the bundled renderer does not waive design or editorial work.
- Reproduce a mature project's quality: [quality reproduction](运行/品质复现与验收.md). Compare reader outcomes and substantive synthesis, not folder completeness or successful builds. Keep engineering, editorial judgement and human acceptance separate.
- Post-trip feedback or an overloaded website: [retrospective and reading priorities](运行/旅后复盘与阅读优先级.md). Preserve observations separately from plans. Update the selected private profile only with permission; generic methods must not inherit an individual's rankings. Audit existing rules before adding new ones.
- Edit travel prose: [editorial workflow](运行/旅行文案审校.md), then read the complete bundled [Humanizer-zh](skills/humanizer-zh/SKILL.md). Protect facts and uncertainty; do not upload prose to an external rewriting service or run upstream scripts.
- Package/share: [privacy](运行/发布与隐私.md). Offline default; server and authority optional.

Scripts handle mechanics, models evidence and meaning, humans personal decisions and commitments. Ask only blocking questions; preserve unknowns. Complete digestion requires actual body/all-image review and recorded outcomes. Return actual counts, artifacts, tests and limitations.
