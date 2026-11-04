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

统一入口使用明确的报告目录和报告外的本批运行目录：

```text
python -X utf8 -B workflow.py preflight --report <报告目录> --run <本批运行目录>
python -X utf8 -B workflow.py build     --report <报告目录> --run <本批运行目录>
python -X utf8 -B workflow.py status    --report <报告目录> --run <本批运行目录>
```

`preflight`先查输入；`build`在隔离副本中生成并检查，失败保留副本和错误，原报告不因生成失败改变。检查通过后只替换编译器拥有的文件；发布中失败恢复原文件。`build`已包含`check`，无需惯性再跑一次。只改文件后需核查现稿时用`check`，它还核同源稿、README和分节投影是否一致。

`status`输出当前snapshot、机械检查、三类外部回执和冻结是否有效。输入与工具均未改变时，重复build/check复用本批通过结果。同一失败输入和工具组合不会默认重跑；输入或工具已修正后正常继续，确有依据再次执行时用`--retry-reason`留下原因。运行目录和报告级锁分别防止同一批及不同批同时写同一报告；残留锁先核PID和实际进程，不凭日期删除。

## 接回真实审核

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

## 运行记录与边界

每次实际动作自动记UTC起止、耗时、失败和重试理由，状态与详细结果写在原运行目录，终端只返回摘要。未变结果直接复用，不制造第二次审核。这里的计时仅覆盖控制器实际执行，不包含模型研究、外部审核或等待；宿主token继续沿现有成本口径，脚本不能读取时保持unknown，不冒充总成本监控。

本轮验证见运行核验（由接收方提供）：合成正反例与真实FOOTSIES副本编译／检查通过，正式报告未改。副本的新页面没有被自动授予语义、浏览器或Knowledge通过；该测试不证明长期成本收益。
