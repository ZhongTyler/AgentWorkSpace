# Local decision model selection, observations and review

Policy template: `assistant-model-use-v1`. This is an optional host policy. Installation does not enable autonomous selection, download models, register MCP, connect accounts or create scheduled work. The recipient explicitly authorizes the scope once and records that decision in the host. Within that authorized research scope, the assistant may decide whether to call an already configured model and which backend to use without asking for a model name each time.

## Selection and fallback

The responsible Agent considers the real question, representative task evidence, expected benefit, available resources and end-to-end cost. Keep the original Research/Agent path as default; use code for deterministic rules and direct analysis for small or already clear material sets. The local gateway executes the selected backend; it is not an autonomous business router.

- Intern: optional first candidate for validated batch topic classification. Agent review remains required.
- StartLux: select only for clearly noncommercial research when a specific comparison could change the judgment; explicitly pass `purpose=noncommercial_research`. Weights retain CC BY-NC 4.0. If the intended use is commercial or unclear, use another permitted path.
- Laya: experimental until representative host tasks demonstrate adequate quality and net benefit. CPU availability and high probability are insufficient grounds for normal Chinese routing.

These are initial roles, not universal accuracy or speed claims. Normally select one main model. Add a comparison only for concrete unresolved items when useful and within the task budget. Do not routinely run all three, vote, average probabilities or share confidence thresholds. Larger trials need a bounded question, budget and stopping condition.

Read the material, retain complete sources and stable IDs, and declare any slices. Never silently truncate long inputs or treat missing/invalid output as a valid classification. On startup failure, resource pressure, bad quality or insufficient benefit, retain every input and return to the original path; do not repeatedly load models or silently substitute another backend's answer. Model suggestions do not replace source verification, media reading, Knowledge routing/final review or project decisions.

## Observations in existing host records

Use the current topic report for manual research and the original run receipt for scheduled research. Do not create a second knowledge or decision store.

`model_decision` records policy/profile version, `action` (call/skip), selected backend (null when skipped), purpose, reason and expected benefit. A plan is not an actual call. `tool_usage` records only actual calls: tool/action/backend, model revision/profile, input IDs and evidence, whether output was consumed, Agent corrections and omissions, failure/fallback, elapsed time and its scope, human intervention and measured cost evidence. Explicit non-use is an empty list; absent observation is unknown. Do not backfill old receipts as zero.

Measure preparation, cold start/switching, inference, Agent review/correction and handing the result back to the host where feasible. Mark inference-only or other incomplete timing as partial. Claim savings only with a comparable original-path baseline for the same task under similar conditions. Unmeasured money, tokens, electricity or resource peaks remain null/unknown. Shared setup cost must not be counted repeatedly. Engineering health does not establish task quality or adoption.

## Periodic review and adjustment

Use the host's existing review window. Research's two-route default combines four actual completed scheduled runs per route; manual work can supply supporting evidence without increasing scheduled counts. Installation creates no schedule. A host with another workflow defines and authorizes its own review window.

Review each backend and task profile separately: calls and skip reasons, actual consumption, corrections/omissions, failures/fallback, complete time, human effort, maintenance and measured cost. Distinguish an output from adoption. No calls or insufficient samples mean insufficient use evidence, not success or failure; never invoke models merely to fill a comparison table.

Within authorized scope, the assistant may reduce or pause a profile, narrow use or reorder validated candidates based on evidence. Validate new representative tasks, original-path comparisons and net cost before restoring or expanding use. Record a material change's old/new rule, version, reason, evidence window, affected scope, observation and rollback conditions. A serious quality regression returns immediately to the original path without waiting for the window.

Store the result as `model_policy_review` in the original review receipt, with `policy_version`, decision/reason, evidence run keys, manual evidence, changes and next review condition. Deliver the scheduled combined review once; report material policy changes or matters requiring a user decision under the host's reporting rules, without per-call notifications.

New models/dependencies, upgrades, commercial-license changes, new workflow bindings and research frequency changes retain their own authorization and validation gates. Package/skill rollback does not revert separately changed host policy, external runtime, client configuration or records. Keep versioned host policy and recovery points separately. This template does not authorize automatic production decisions or claim long-term savings.
