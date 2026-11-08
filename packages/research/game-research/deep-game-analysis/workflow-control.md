# 脚本执行入口

`workflow.py`负责机械制作和阶段控制；研究者、审计者和读者负责语义与实际观察。沿原研究协议和逐层拆解方法执行，不增加一套研究范围、审核标准或调度。

## 分工

| 大模型／实际审核者提供 | 脚本执行与拦截 |
|---|---|
| 游戏与版本身份、来源实读、规则、对象、条件、反例与缺口 | 路径、必填字段、证据引用及已登记哈希校验 |
| 按总—分—总写解释、画图，使用humanizer润色；确定领域路线与正文对应 | 同稿生成README、分节投影、单HTML和导航；复用现有渲染器及档案／导航检查 |
| 判断研究深度、事实保真、解释质量及领域是否漏项 | 没有当前版本内容审核回执，不能冻结 |
| 实际浏览器／用户验收；声明检查范围与限制 | 没有当前版本页面回执，不能冻结；机械通过不会生成页面通过 |
| Research整理关系提案，Knowledge owner审核、维护并验证三路查阅 | 冻结后才输出绑定manifest的交接包；接受和查阅回执不匹配当前身份则拒绝 |

脚本只验证回执及其证据文件的完整性、版本与先后关系，不证明审核者身份或实读过程真实，不从PASS文字推断语义质量。原独立审核、人工验收、授权和owner边界继续有效。

## 输入与顺序

当前编译适配器支持已有`study.json`分节图解格式，配同包`manifest.json`和`reader/navigation.json`。讲解块沿表达技能现有渲染约定，分节必须有`reader_goals`。来源链接用HTTPS，原始本地存档仍在manifest维护；媒体路径必须在本包，引用现有已核验资产及哈希。视频由分节`videos`引用manifest中的video_segment ID；可用`video_captions`提供对应图注，来源、实读方式和限制由研究者写在本节。可用`unit_context`提供随检索分节返回的版本与条件提示。

编译器读取原领域路线的target、source.heading、focus等人工判断，只生成MD／HTML锚点及哈希绑定。没有覆盖字段时不猜内容。旧报告及其他表达载体沿原制作路径；本轮不批量迁移、重建或替换旧报告。

需要轻分组目录时，可在`study.json`显式提供`toc_layout`：`type=grouped`、`leading`、`groups[{id,title,sections}]`和`trailing`。共用build会生成正文目录和侧栏共用的分组；各节必须按原阅读顺序恰好出现一次，遗漏、重复或调序会失败。层级仍由内容复杂度决定，未提供时保留原目录，既有专用presentation适配器继续拥有自己的排版。

统一入口使用明确的报告目录和报告外的本批运行目录：

```text
python -X utf8 -B workflow.py preflight --report <报告目录> --run <本批运行目录>
python -X utf8 -B workflow.py build     --report <报告目录> --run <本批运行目录>
python -X utf8 -B workflow.py status    --report <报告目录> --run <本批运行目录>
```

### 运行时与定向读取

先沿原批次已成功的命令检查将用的依赖，再制作整批。当前Windows宿主已验证下列离线入口含`lxml`，可将`<脚本及参数>`替换为当前workflow、导航或检查命令；其他宿主采用其已核环境。环境改变或缓存缺失时只处理当前依赖，不逐报告重试相同失败。

```text
& 'C:/Users/Admin/.taptap-maker/bin/uv.exe' run --offline --no-project --with lxml --python 'C:/Users/Admin/.local/bin/python3.12.exe' python -X utf8 -B <脚本及参数>
```

定向读取先定位候选、标题和相关区间，再实读所需原文或完整单元。终端只返回本次判断需要的片段与结果，完整证据沿原文件保存。既有有效结果能覆盖当前输入时直接复用；发生截断先缩小读取范围。导读中的具体承诺对照其target正文，跨域同节分别核关注点。

目录与领域辅助／路线复用[共用导航](reader-navigation/README.md)，三态、两级退出和导读归属由同一实现控制。共用代码变化先跑构建及控制器几何回归，在代表报告核静止边界后批量制作；逐篇核同源文字、路线数据及原正文／媒体保全。状态方法、模拟DOM和实际浏览器结果分别保存，不以局部测试冒充页面通过。

### 制作与实际发布

`preflight`先查输入；`build`在隔离副本中生成并检查，失败保留副本和错误，原报告不因生成失败改变。检查通过后只替换编译器拥有的文件；发布中失败恢复原文件。`build`已包含`check`，无需惯性再跑一次。只改文件后需核查现稿时用`check`，它还核同源稿、README和分节投影是否一致。

声明了`study.explanation_bindings`的档案，其绑定文件与README、manifest等派生产物一并事务发布。发布后实际报告的完整snapshot须等于已检查副本，差异会触发回滚。保留旧动态表达的适配器也沿此合同，审核同时核实际manifest资产／文档声明与绑定中的当前主本身份。

build现在同时在原run目录生成`reader-review-input.json`，终端直接返回位置：绑定当前snapshot，列出真实完整units路径／SHA、读者目标及三项自审问题。送独立内容审计前，用它定位正文与图注，调用humanizer-zh及anti-defensive-writing做一次读者价值编辑；删移过程自述、重复免责和无增量段落，保留事实／条件。自审输入不生成PASS，也不新增人工门。只需刷新该入口时用`prepare-review`，它要求当前机械检查有效，不重建报告。

`status`输出当前snapshot、机械检查、三类外部回执和冻结是否有效。输入与工具均未改变时，重复build/check复用本批通过结果。同一失败输入和工具组合不会默认重跑；输入或工具已修正后正常继续，确有依据再次执行时用`--retry-reason`留下原因。运行目录和报告级锁分别防止同一批及不同批同时写同一报告；残留锁先核PID和实际进程，不凭日期删除。

## 接回真实审核

维护已有报告先按[文字主本与阅读层维护](../../.agents/skills/human-research-expression/references/reader-maintenance.md)分类。新增／改进解释、案例、比较和边界先进入study并同源生成README／units，再核人读HTML；不能只因没有新事实而选reader-only。纯控件、导航和样式才用enhance_reader.py，必须声明presentation_only且不带语义edits。当前study声明的explanation_targets及绑定文件由原同源检查核版本／分节／组件；文本版本过期或误用普通build丢组件会失败。之后沿check→实际审核record→freeze→Knowledge换版交接；语义或制作成功都不代签外部门。旧HTML独有解释回写时，图／正文／操作其余字节不变可用精确等价证据复用原页面反馈。

完成研究和表达后，把`current-snapshot.json`及本轮材料交实际审核者；回执由调用方按真实结论填写。例如内容审核回执：

```json
{
  "schema_version": 1,
  "gate": "content",
  "report_snapshot": "当前snapshot的id",
  "verdict": "pass_with_limits",
  "actor": "实际审核者或原审核聊天ID",
  "scope": "实际检查范围",
  "limits": ["仍保留的批准延期或证据边界"],
  "evidence": [{"path": "相对本回执的审核原件.md", "sha256": "原件SHA-256"}]
}
```

页面回执用`gate=page`，如实引用用户／浏览器原始验收记录；不把内容审计冒充页面操作。用以下顺序登记和冻结：

HTML访问方式按[localhost主验收与本地文件简查](../../.agents/skills/human-research-expression/references/reader-maintenance.md#localhost主验收与本地文件简查)选择。工具允许时静态提供正式文件，先核响应与文件字节身份，再做主要检查和file差异简查；原页面回执分别记录两种方式的实际范围，localhost通过仅覆盖实际已验行为，原权限及页面门继续有效。

```text
python -X utf8 -B workflow.py record --gate content --receipt <内容回执.json> --report <报告目录> --run <本批运行目录>
python -X utf8 -B workflow.py record --gate page    --receipt <页面回执.json> --report <报告目录> --run <本批运行目录>
python -X utf8 -B workflow.py freeze --report <报告目录> --run <本批运行目录>
python -X utf8 -B workflow.py handoff --relations <关系提案.json> --report <报告目录> --run <本批运行目录>
```

关系提案沿原Knowledge交接合同，由研究者确定用途和去向，并带当前`manifest_sha256`；控制器不自动判断“值得关联”，也不直接发送聊天消息或改Wiki／Group。

接回Knowledge结果时，同样用`record --gate knowledge`登记外部回执。其evidence必须包含原owner的`accepted_local`精确manifest接受及`passed`查阅记录；查阅记录可直接带manifest_sha256，或沿现有version_rebind.current_manifest_sha256。缺失、旧版或审核原件被改写，均保留为未通过。

冻结只写运行目录，不为报告声明“自己已被接受”改正文／manifest。报告任一文件变化、审核回执或原件变化，旧绑定会失效；实际只改了措辞时，由原审核者决定复用范围并提供当前版本的定向确认，脚本不自动推断语义等价。必要修订继续沿原版保全与owner流程，不要求重审未变的全库。

Git仍走工作区已有`workflow-closure`和`execution-check.py`，基于本批frozen.json核实际暂存／提交字节及父gitlink；不在这里再实现Git引擎或扩张推送授权。

新报告交接前，用接受方当前只读读取器核实际完整单元的路径、来源依赖及内嵌媒体闭包；元数据形式合法不代表接受方能读取。claim使用`chapter`，case使用`path`，关联类型沿Knowledge当前维护合同，不猜枚举。原报告只修元数据时，保存前版并核正文、图、HTML和导航逐字节是否未变，再由原审核者决定复用范围；不为修接线重写研究。SB02的真实消费者预检见本批`check_unit_metadata.mjs`，它是接缝实例，不替代Knowledge owner的正式接受与三路查阅。

新批次在准备集成位置时先执行下列只读Git预检；已有等价校验仍覆盖当前输入时可复用依据。及时发现运行工具与拟集成版本的差异，避免最后推送前才查。它不fetch、不改HEAD/index、不接收语义审核：

```text
python -X utf8 -B workflow.py delivery-preflight --revision <Research精确40位commit> --cost-boundary <原批次边界.json> --report <报告目录> --run <原run目录>
```

边界文件为schema_version1，给非空`measurement_end`（计量终点）、`bookkeeping_tail`（最后记账尾段）、`token_scope`及`parallel_accounting`。只是事前声明，真实mark/finish仍走cost.py。工具未计划差异返回失败并留`delivery-preflight-inputs.json`，保留其他owner改动，由原职责处理或用实际提交工具隔离验证。基线比较时，本批自有且将提交的工具可逐项传`--planned-tool <仓内路径>`；此时`committed_tools_verified=false`，不算提交依赖已验证。最终结果commit应无差异且该字段为true。旧完成批次不因此批量重建；恢复或新批次按实际变化执行。

## 运行记录与边界

每次实际动作自动记UTC起止、耗时、失败和重试理由，状态与详细结果写在原运行目录，终端只返回摘要。未变结果直接复用，不制造第二次审核。这里的计时仅覆盖控制器实际执行，不包含模型研究、外部审核或等待；宿主token继续沿现有成本口径，脚本不能读取时保持unknown。完整投入与效果登记到[成本评估模块](../cost-evaluation/README.md)，可用通用脚本只读导入原cost事件、去除重复区间并核证据身份；语义评价沿原执行／审计owner。

本轮验证见运行核验（沿接收方维护入口）：合成正反例与真实FOOTSIES副本编译／检查通过，正式报告未改。副本的新页面没有被自动授予语义、浏览器或Knowledge通过；该测试不证明长期成本收益。

2026-11-04新增入口的核验（沿接收方维护入口）：17项流程测试、2项有界读取测试，以及2048隔离副本实际制作／自审入口和未计划检查器差异拦截通过。原报告46文件未变，自审材料没有创建审核门；端到端时间／token收益留待下一次真实任务。
