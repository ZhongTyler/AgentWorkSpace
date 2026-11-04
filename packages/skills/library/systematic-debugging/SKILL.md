---
name: systematic-debugging
description: Diagnose nontrivial bugs when the cause is uncertain, fixes have failed, behavior is intermittent, or failures cross component boundaries. Use to distinguish hypotheses and verify a repair; ordinary obvious typo fixes do not require a separate debugging workflow.
metadata:
  upstream: obra/superpowers
  upstream_commit: b36e0829c6d0140e93cfef2ca599b1b07d4a7797
  adaptation: tyler-scoped-20260915
---
# Systematic Debugging

Aim for a supported explanation and a verified repair. Scale investigation to uncertainty and impact; no fixed phase count, document set, or approval loop is required.

## Find the failing boundary
- Establish expected versus observed behavior, exact error, and the smallest available reproduction. Reuse valid logs and tests.
- Inspect relevant changes and compare a working case. Trace the bad value backwards through callers, configuration, and initialization; the reported error location may only consume the bad input.
- At a component boundary, compare inputs and outputs, resolved paths, versions, and configuration presence. Log only necessary non-secret information; do not dump environment variables or credentials.
- For intermittent failures, investigate state lifetime, test ordering, concurrent access, and readiness. Record what remains unproven if reproduction is unavailable.

## Distinguish hypotheses
State the candidate cause and an observation that would disprove it. Choose a small experiment that separates plausible causes. Change one causal variable during diagnosis; a final repair may legitimately touch several dependent files.

When an experiment fails, use its evidence to revise the hypothesis rather than stack speculative fixes. Repeated failures justify reconsidering assumptions and architecture, not an automatic rewrite or a mandatory user interruption. Ask only when the next action needs missing information, a material product decision, or new authorization.

## Repair and verify
Repair at the responsible boundary. Add a regression check when it protects meaningful behavior; existing checks or a direct reproduction may suffice for low-impact changes. Validate both the original failure and affected neighboring behavior, and inspect actual exit codes. Do not broaden testing after adequate unchanged coverage without a reason.

For waits, prefer the actual readiness/event condition with a bounded deadline and useful timeout diagnostics. Keep time-based waits when timing itself is the behavior under test.

A temporary mitigation is valid when needed: distinguish it from a confirmed root-cause fix and state its limits. Report observed evidence, inference, and remaining uncertainty separately. Successful automation does not establish user acceptance or gameplay quality.

## Scope
Follow the host repository's ownership, data-preservation, integration, and release rules. This skill does not start Brainstorm, a planning framework, a worktree, or another skill automatically. It does not authorize publishing or unrelated cleanup.

## Source
Adapted from the MIT-licensed upstream commit in metadata; see [LICENSE](references/LICENSE). Upstream workflow mandates and empirical performance claims were not adopted. Update by reviewing upstream changes against this scoped entrypoint, not by overwriting it.

## 本版补充

修复涉及状态、交互或异步行为时，按[行为回归](references/behavioral-regressions.md)验证正常路径、原失败、恢复与必要反例。保留失败签名与输入版本，避免同输入重复重试。
