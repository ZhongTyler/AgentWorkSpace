# 研究报告关联：交接、审核、派生导航

正式存放与查阅见[研究入口](../../../research-reports/README.md)。唯一关系SSOT为catalog的`discovery_links`；Research发起提案，Knowledge主控核对真实双边正文并拥有目录、Wiki、Group维护。报告作者不自行批准自己的关系，不把报告全文再次消化。

## 输入与职责

Research在原研究批次保存一个交接包，给Knowledge其确切路径：

```json
{"schema_version":1,"kind":"research_report_relation_handoff","reports":[{"id":"已接受报告ID","manifest":"research-reports/game/manifest.json","manifest_sha256":"真实hash","proposed_links":[{"from":{"kind":"wiki","path":"wiki/现有综合.md"},"unit":"E12","relation":"mechanism_example","terms":["启动费"],"questions":["为什么净费用为零仍需启动资源？"],"purpose":"补什么缺口","conditions":["样本/版本与前提"],"exclusions":["不支持哪些推广"],"evidence":[{"path":"manifest已声明的相对文档.md","heading":"精确标题"}]}]}]}
```

`from`也可为`{"kind":"group","id":"roguelike"}`，复用现有active/approved定义；不新建报告专用Group。`relation`只支持`mechanism_example/counterexample/comparison`，`unit`为原完整单元；evidence.path相对manifest，非相对Wiki。交接不得含review，提案不是审核，也不是新增查阅权限。

Knowledge核对所选完整报告单元及必要上下文、目标Wiki问题与Group边界；关注数字、条件、原观察性质和反例。主控可收窄术语、拒绝关系或只采部分，不按每份必须挂满所有入口的机械规则。只处理有真实用途的关系，普通综合已够不扩读；新Wiki实质论断/结构/Group成员变化仍走原权限与审核。

首次完整关联梳理须核销全部已声明领域、文档、结论、案例及系统分节，不以少量接线示例代替覆盖完成。一个条目含多个独立机制时分别说明接受、拒绝或材料缺口；其中一个机制获批不能替整个条目结案。已审未变关系复用原记录，重复内容可引用同一关系；不适合关联的内容应说明理由，不为凑数挂页。完整梳理与每次查阅的候选/正文预算分开，目录不设每报告一条或固定总条数上限。

覆盖检查应从原库存与机制计划重建预期集合，核对每项机制、完整提案ID及接受/拒绝结果；删除整个机制仍标全覆盖必须失败。每条关系ID须区分报告、目标入口与完整单元，同一单元可对应多个Wiki/Group。脚本对账不能代替主控的双边语义判断。

主控审核文件位于本仓维护证据：schema_version1、kind=`knowledge_research_relation_review`、status=`approved`、实际reviewer_id及reports。每report声明id、manifest_sha256、discovery_links。每link有唯一id、status=`active`、from/unit/类型及原提案的用途/条件/证据，另有review：status、实际reviewer_id、reviewed_at、rationale、manifest_sha256和anchor_sha256。入口hash由`relationAnchor`计算，忽略本工具派生导航；主控填语义判断，脚本不能推断它。历史review文件保全，catalog保存当前采用关系。

## 命令

在Knowledge根目录运行：

```powershell
node system/maintenance/checklists/research-report-links.mjs inspect-handoff --handoff <交接包绝对路径>
node system/maintenance/checklists/research-report-links.mjs apply --review docs/audits/本批/review.json
node system/maintenance/checklists/research-report-links.mjs sync
node system/maintenance/checklists/research-report-links.mjs check
```

- `inspect-handoff`只校验版本、锚点和证据标题，明确semantic_approval=false，不改目录。
- `apply`仅接受当前主控ID匹配的审核文件，先验证本批所有报告/关系再原子更新目录；不运行消化或修改报告。只替换审核中列出的report关系，其他条目保持。
- `sync`从当前有效关系生成Wiki/Group块，覆盖全部有效/待移除派生入口；先校验计划再写，遇到错误恢复本次已写且字节仍为自身版本的路径。主控应先查看check的issues，命令返回非零不作为成功；陈旧关系不会写入导航，但旧标记可被移除。写入外的正文与frontmatter不变。
- `check`只读核关系与投影漂移，返回issues/changed_paths。查阅从不自动调用这些维护写入动作。

命令退出码0才表示该动作完成；2代表校验失败、关系问题或派生漂移，不能只看文件已出现。保持本任务修改前字节/Git恢复点；无关dirty不纳入，重叠owner先协调。

## 有效性与故障

运行发现校验关系active、主控审核、精确接受manifest、入口正文hash、Group active/approved及收据身份/定义版本；目标unit必须存在。词匹配只是候选信号，条件/排除完整交给选材Agent。不递归读取Group或报告；同ref合并多条发现路径，限原候选上限。需要正文才沿原完整read/reuse/verify/review/assemble，字节变动、媒体/版本权限及正文预算由原取证模块负责，不能把候选当本次已读。

已审`questions`的完整问句也参与匹配（忽略末尾问号等标点），命中理由为`question:`；这不是任意自然语言语义召回。改写问题可由查阅Agent提供真实terms/reformulations，不把测试内部隐藏术语注入用户问题。相同ref仍去重，候选上限为0且存在研究候选时明确返回`budget_exhausted`，不误报无相关来源。改变问题上下文后，旧收据可能为`reuse_invalid`，应按当前request重读核验，不放宽原上下文绑定。

读取与锚点缓存仅在一次操作内复用，下一次重新核当前版本；先匹配问题线索再读相关入口，避免无关关系遍历造成重复读盘。导航块置于Wiki的“相关页面/来源”之前，保留原页尾结构。Group旧阈值审核的Wiki输入仅在去掉已知派生块并重建原换行后精确命中旧hash时复用；实质文字变化仍触发复评，不改签旧收据。

报告接受新版不会自动刷新旧review；仅复核受影响关系，原Group定义与成员不重审。入口的实质变化同理；只同步派生导航不会自我失效。显式退役关系可在下一主控审核中置status=`retired`，sync去除旧导航；历史审核保留Git。旧关系失效只关闭该发现边，不撤销有效报告稳定引用或原Wiki查询。

关闭/缺失/坏配置保持原Query；已接受报告不可用时返回具体缺口。共同宿主的可选`research:true`决定是否补研究导航，不根据链接存在猜用户需要；lookup沿原复利出口归并，有增量才交原owner，无增量轻量结束。

## 验证与收尾

每批用实际问题覆盖游戏名、无游戏名Wiki机制、Group类别三路，至少读到目标完整单元并verify，再核相关条件/反例；混合答案复用原review/assemble。反例覆盖同类无关、错作品、预算、停用/候选Group、过期关系、重复候选及模块关闭。导航变化核原正文/frontmatter/成员保全，跑Group与受影响合同，不重复审未变研究全文。

关系导航不授予公开/媒体许可。当前实施仅本机；线上Adapter与包发布按各自原合同。最后提交本轮精确scope，再由直接父仓闭合gitlink；并行交付时明确统一收尾owner。
