# Skills

这是一份可选择安装的方法库。安装本 package 只把库放进 modules/skills，不会自动启用其中全部 Skill。包含开发方法、研究与决策、中文润色、工作流及游戏支持共 21 项；按实际任务选择，普通任务无需为了展示流程调用 Skill。

Python 3.10+，无第三方依赖。先列出目录，再选择安装到用户工作区（默认 Codex 的 .agents/skills）：

```text
python scripts/skills.py list
python scripts/skills.py install --target <workspace> --names systematic-debugging property-based-testing
python scripts/skills.py install --target <workspace> --names systematic-debugging property-based-testing --apply
python scripts/skills.py status --target <workspace>
```

CodeBuddy 使用同样命令附加 --platform codebuddy，安装到 .codebuddy/skills。两个平台的状态和事务分别保存。WorkBuddy 可手工导入所需 library/<name> 完整目录，本包不猜测其本机安装路径或自动上传。文件所有权不明确、同名内容不同、用户修改与上游同时变化时报告冲突；不会强制覆盖。若 meta 已提供完全相同 Skill，首次安装会按相同字节登记；内容不同则保留并报告差异。

```text
python scripts/skills.py upgrade --target <workspace>
python scripts/skills.py upgrade --target <workspace> --apply
python scripts/skills.py rollback --target <workspace> --transaction <transaction-id>
python scripts/skills.py rollback --target <workspace> --transaction <transaction-id> --apply
```

只升级已选 Skill，未安装的不会顺带启用。全局 package 升级与用户已安装 Skill 升级分两步；不会从发布仓绕过用户本地冲突检查。状态位于 .agent-skills/<platform>，与工作区安装状态分开。预览不写入，应用有备份，回退拒绝覆盖后续修改。

游戏支持 Skill 可复用 GameAnalysisDecision、Knowledge、GamePresentation、Research，也可使用宿主已有能力或独立完成基础任务；缺少工具时明确限制。`game-decision-support` 在问题确实需要发行产物证据时可转 `rea-investigate`，覆盖参考机制、开发工具与源码/发行版差异；完整源码优先直接读。REA由可选Research包单独提供安装说明，不是本方法库的必装依赖，包/Skill升级不安装runtime、不连接MCP、不运行目标。引擎、图像生成器和测试库属于实际任务工具，不由安装器自动下载。workflow-closure 优先遵守宿主合同，没有专用合同也不会虚构固定仪式。

许可按每个 Skill 的原来源保留：Humanizer-zh、systematic-debugging、godot-gdscript-patterns 为其声明的 MIT；property-based-testing 为 CC BY-SA 4.0，含来源与变更说明。其他原创内容原授权不变，不对整个集合施加覆盖原许可的新限制。入口校验与可安装性不代表方法长期效果已经验证。

`feedback-loop`在观察、调节、复现或比较成为当前瓶颈时使用，涵盖数值、AI、输入、生成、性能和表现。正文只引用meta的共用反馈方法；未装meta也可沿Skill中的固定版本公开链接读取，不复制方法或强制安装整套框架。普通修改与现有工具足够时不预建平台，长期触发率/净节时尚无保证。

`interaction-design`只拥有界面状态与操作反馈的共用方法，网页视觉方向仍归frontend-design，游戏资产与引擎交付仍归GamePresentation。可独立选装；[现有frontend的可选接线](integrations/frontend-design.md)不自动改写外部Skill。游戏流程也可按需引用同一入口，不复制方法或互相加载整套流程。

中文字体新增/替换、缺字或嵌入交付时，可单独读取game-presentation所附的[字体选型参考](library/game-presentation/references/font-selection.md)：猫啃发现→作者具体版本与原许可→真实显示与包检查。没有字体二进制、下载服务或新增Skill；[frontend的可选薄入口](integrations/frontend-design.md)仍由用户审阅后手工合并，不改第三方原文。

`dual-layer-explainer`按机制理解缺口触发：算法、协议、检索、推断/信息缺失、资源与交接过程均可按需解释；可操作模型应让操作、画面与读数共用计算，区分合成输入、示教特征、规则与真实模型，并给出条件、反例和恢复。可按问题选择Tools包中的Anatomy交互解释。Tools与客户端Skill各自可选；工具不在本包复制，未配置时继续文字/简图。先准备包外Tools home并显式恢复，再按需制作；学习收益与视频制片另行判断。

`citation-management` 提供学术标识符解析、元数据核对、BibTeX 格式化与去重。8 个脚本、引用、模板与 MIT 许可完整交付；安装器本身仍只需 Python 标准库。离线格式化无需第三方库；联网解析/检索脚本按需需要 requests，Google Scholar 另可选 scholarly，安装本包不会安装这些依赖或保证服务可用。只核对元数据不证明论文支持某项论断，实质结论仍需阅读相关原文。来源快照及本地适配见该 Skill 的 references/UPSTREAM.json；不声称上游最新版或引用质量已获评测。

界面布局与信息主次仍有实质取舍时，可沿 meta 的共用界面比较方法使用代表内容、适量方案和真实接入；未装 meta 可由[可选 frontend 接线](integrations/frontend-design.md)读取固定版本方法。[已有 prototype 的宿主接线](integrations/prototype.md)与第三方原 Skill 分开维护，不随包安装或自动改写。明确设计与局部修复直接执行，不要求每次比较三稿。

`workflow-redesign`补充产品复用的保留/改造/新增范围及多阶段材料状态，`reference-deconstruction`把案例事实、候选方法与未来任务入口连接起来。GamePresentation 可按 UI 缺口引用同一方法。工程可达与升级验证不等于长期效果已测得。

`design-critique`在有稿待评审时使用，`design-handoff`在设计准备进入实现且规格仍有缺口时使用；小修不必额外生成整套文档。两项均保留固定上游原件、Apache-2.0许可、完整连接器参考和薄适配，可脱离meta、Tools和其他Skill使用。截图无法证明隐藏状态或精确尺寸；连接器与外发权限按宿主决定，安装不会连接服务或自动修改设计。私人试验、预览和运行收据不随库分发，当前材料不证明跨项目质量或长期省工。
