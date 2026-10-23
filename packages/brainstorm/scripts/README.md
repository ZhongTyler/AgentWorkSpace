# Brainstorm 工具入口

从 Brainstorm 仓库根执行。工具负责保存与校验，具体创意、语义判断和真实用户决定由会话承担。

## 新建与恢复

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/new-session.ps1 -Title "机制方向" -Goal "找到值得继续探索的方向" -Mode standard
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/resume-session.ps1 -SessionPath <session-path>
```

默认 `RunMode=cocreate`；明确要求 Agent 自主发散时可用 `autonomous`，它不等于淘汰授权。`resume-session` 只读返回当前焦点、下一动作、暂停边界、当前与历史决定及交接信息，不自行开始实验或改状态。有宿主时传 `HostProject`、`HostProjectRoot`；明确路径用 `OutputRoot`。索引在实际会话根维护。

## 保存与继续

| 动作 | 工具与关键参数 |
|---|---|
| 校验当前会话 | validate-session.ps1 -SessionPath |
| 暂停、恢复或关闭 | set-session-state.ps1 -SessionPath -ToState paused/open/closed |
| 更新继续位置 | set-session-continuation.ps1 -SessionPath；按需填写 CurrentFocus / NextAction / PauseBoundary / DecisionRefs；不追加 NAV |
| 记录实际阶段变化 | set-session-phase.ps1 -SessionPath -Phase -AiResponsibility -UserAction -NextStep；MethodId 可选；追加 NAV |
| 修改想法 | revise-session-idea.ps1；创建新 ID 并回链原想法，不覆盖历史正文 |
| 创建扩展工件 | new-session-artifact.ps1；随后填写正文并维护来源 |
| 重建索引 | build-session-index.ps1 -SessionRoot |
| 读取关闭摘要 | get-close-summary.ps1 -SessionPath；摘要不改变关闭状态 |

`Current Continuation` 必须写当前焦点、下一动作、暂停边界、决定引用。没有边界或决定时明确写 `none`；有决定须引用真实 DEC。阶段日志只记录实际发生的工作。新建与继续只接受新版 state schema 2、record schema 2；关闭档案只读检索。

`PruningAction delegate` 仅在已有真实授权时使用，范围限当前 session 和目标；目标变化或关闭后到期。没有授权不能靠命令参数创造授权。运行模式切换不改变淘汰权限。

## 内容与外部接线

| 需要 | 实际入口 |
|---|---|
| 选择认知操作 | [METHOD_ROUTER](../methods/METHOD_ROUTER.md)、list-methods.ps1、validate-method.ps1 |
| 游戏组合与 brief | new/validate-game-concept-combinations.ps1、new/validate-game-concept-brief.ps1；先比较完整方向，未选可保存 |
| 非游戏机会 | [Opportunity Thesis](../playbooks/opportunity-thesis/README.md)、validate-playbook.ps1 |
| Knowledge | new/validate-knowledge-context-brief.ps1；准备材料与实际 Query 证据分开 |
| GameAnalysisDecision | brainstorm-analysis-adapter.mjs prepare-request / consume-delivery / prepare-host-decision；请求与消费统一 v2 |
| FromDemoToSpec | new/validate-fromdemotospec-gap.ps1、render/validate-fromdemotospec-handoff.ps1；来源改变后用 reset-fromdemotospec-handoff.ps1 -Reason 保存旧版并重建 gap-review，再逐项语义复核；不启动下游 |
| 项目学习反馈 | new/validate-learning-feedback-candidate.ps1、import-fromdemotospec-learning-feedback.ps1；状态采用遵守原人工门 |
| 有界方法学习 | [method-learning](../docs/method-learning.md)、method-learning.mjs validate / record --input；不改全局偏好 |

## 调用与验证

用 `Get-Help <script> -Detailed` 或脚本开头的参数声明核对选项，不猜参数。PowerShell 字面量 `-MethodId "-"` 可通过同进程 `& ./scripts/...` 调用，避免嵌套 `-File` 把它当选项。读取中文采用 UTF-8；外层必须检查实际退出码及工具返回的结果字段，不把部分输出当成功。

相关行为合同见 [tests](../tests/README.md)。本独立包运行 tests/run-release-contract.ps1；只在 Temp 中测试，不创建真实业务会话。
