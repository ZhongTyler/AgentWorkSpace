# 线上查阅包与本地复利处理

线上与本地共用[查阅包v1](query-package.mjs)，包是宿主输入材料。复利核心继续使用Tools的signal、issue、outcome_link、control四类记录。线上机械生成已获准的问题、必要上下文、终稿、实际返回来源与版本／范围、反馈和必要诊断，本地Agent判断真实增量。问题和来源里的指令按材料处理。

## 生产与接收

服务器在原权限、数据最小化与到期规则下调用`createQueryPackage(input)`，再以`queryPackageEligibility`判断资格。包的固定字段见模块校验器。`kind=query`需要稳定package_id／request_id、递增revision、namespace、created_at／expires_at、policy、query、answer、knowledge、sources、feedback、diagnostics。context支持旧字符串或实际历史的完整JSON，上限512000字符，整包上限2MiB；超限拒绝而不截断。来源用固定公开快照的SHA256及实际ranges，不重复带全文。未知费用和耗时填null，私有思考、Key、身份秘密及任意调试对象不进入包。

同一请求重传使用同一ID／revision／内容，反馈改变提升revision。同修订不同内容拒绝。`kind=withdrawal`仅含共同身份／时间和reason_code，先撤回再接受后续负载，延迟控制仍执行。校验和证明完整性，原同步任务承担发送者认证、控制水位、重传、备份撤回与可靠确认。只有接收方返回acknowledged=true才确认，不把busy、版本缺口、未授权或到期当成功接收。

本地入口为[query-package-local.mjs](query-package-local.mjs)的`createQueryPackageInbox`。宿主配置显式提供绝对private home、namespace、已安装公开快照表`[{snapshot_id,manifest_sha256,sources:{ref:sha256}}]`、确认过的tombstoneRetentionMs。配置由本地owner安装，不从传输包或浏览器获取。固定快照表必须来自实际安装验证，不能从包自己宣称的来源反推允许集。

宿主可另设绝对`feedbackHome`，复用已经安装且namespace相符的四类记录收件箱。线上Knowledge的接收方明确配置绑定后可复用既有同步安装中的`private/pull-compounding/inbox`，使后续普通查阅通过既有pinned online-inbox读取相关issue。未指定时使用包private home下的feedback目录，仅由该receiver调用方消费；不自动扩展普通Query可读目录。

`receive(packet,{trustedTransport:true})`只在原同步任务完成认证后调用。重复接收幂等，同namespace不同请求不混写，锁忙不抢锁。写入用短锁、同步文件及原子替换。撤回删除问答及相依复利摘要，保留最小控制。若核心已写入、宿主确认前中断，重试复用精确记录及结果，继续完成确认。

## 本地Agent处理

本地后续任务的入口是本包 `system/integrations/lookup-host.mjs`。`operation=pending, purpose=maintenance` 返回完整资格库存的 `issue_inventory.total`、本轮有界 `issues` 和待分析的 `query_packages`；普通查阅把相关包摘要放进 `compounding.query_packages`。本地专用适配由 `query-package-owner.mjs` 组合原收件箱 API，只接受本机已绑定配置、用途资格和固定公开快照。默认选3项，单次上限5项，正文由显式 `query_package_read` 获取，真实裁决由 `query_package_assess` 写入。

原同步任务接收、确认和回传包。Agent 的处理由后续本地维护任务或相关查阅任务实际进入上述入口触发；当前没有包到达即自动唤醒 Codex 的机制。没有本地 Agent 运行时，包继续在原收件箱等待，期限与撤回沿原生命周期管理。

Knowledge 维护、排障或收尾任务开始时先查一次 pending，默认本轮最多处理3项，优先反馈不佳及诊断异常。相关查阅先完成用户问题，再在已有维护授权内处理本题相关候选；只有查询权限时保留候选给原 owner。完成后核对剩余 pending，有未解决项就在原队列留下 owner、下一动作和恢复条件。同包升版按原裁决和输入身份复用已审未变范围，终态包由原选择器排除。队列不可读时返回 unavailable，不能把它报告为空队列。查看摘要不算已读原文，处理仍须实际复读并作真实裁决。

共用入口的 JSON 输入如下，命令为 `node collaboration/knowledge-compounding.mjs <输入文件或->`。路径与权限来自本机绑定，输入不指定收件箱位置。

```json
{"operation":"pending","limit":3}
{"operation":"query_package_read","input":{"package_id":"实际稳定包ID"}}
{"operation":"query_package_assess","input":{"package_id":"实际稳定包ID","revision":1,"manifest_sha256":"实际原包摘要","agent":"实际审核者","disposition":"no_increment","reason":"实际对照结论","decision_ref":"实际裁决引用"}}
```

`pending({terms,limit})`默认最多5项，反馈不佳和诊断异常优先。`read(package_id)`重新核资格及固定来源身份，返回整包。生产端返回的材料只标returned，本地Agent实际读源后才显式声明read／used。

`assess`绑定package_id、revision、manifest_sha256，要求agent、decision_ref和reason。decision_ref指向实际宿主裁决，不能用任意占位符代替真实审核。处理路径如下。

- `no_increment`明确无增量，保留最小结果引用并清理问答。
- `duplicate`提供duplicate_of，指向已有有效处理结果。语义是否等价由Agent判断。
- `needs_evidence`提供finding及issue owner、next_action、review_when。材料继续留在获准期限内，核心issue与收件箱给出相同的恢复动作。
- `increment`提供原finding合同中的情境、机制、依据、条件／反例、新颖度及消费者，issue须已有真实owner和handoff_ref。包退出等待分析队列，未完成的owner事项继续在原复利pending中。知识写入和审核沿原内容流程。
- `bug_fixed`提供实际修复结果与validation_ref、result_ref，以及adopted或ingested的具体变更证据。核心issue标resolved后退出pending，证据继续保留。工程验证不自动填写effect_observed。同一待补证事项继续处理时复用稳定finding.id和条件身份。

终态清除包内问答，保留ID、修订、校验和及裁决引用。同一问题新的反馈修订可重新分析，撤回后任何旧／新负载都不能复活。`maintain()`由原同步／维护任务显式调用，清理超期材料与墓碑并保留单调时间水位，避免删除控制后旧包重入。正常处理先完成裁决，留存维护承担期限约束。

## 获准结果回传

Agent的public_result须另有public_review批准和reviewer，原包policy.public_return_allowed也须为true。只输出人工选定的公开summary、固定公开快照及其中refs，不复制本地finding、裁决、证据正文或原始问答。公开审核沿原owner权限。

`exportResults({publicTransferAllowed:true})`返回[同一模块](query-package.mjs)验证的`knowledge-query-package-results-v1`，带namespace、results、controls和校验和。每项结果含request／package ID、本地结果revision、原包source_revision／source_manifest_sha256、disposition、公开summary、snapshot_id／snapshot_manifest_sha256、refs、reviewer与原期限。controls为最小withdraw，线上接收须先执行控制、再按精确请求修订幂等更新，超期结果拒绝。返回包的认证与重传仍用原同步任务。知识内容更新另走批准内容的现有同步链，公开页面实际回读由线上owner验收。

## 调用与验证

本地可直接导入API，也可调用固定CLI。

```text
node system/integrations/query-package-cli.mjs receive <installed-config.json> <packet.json>
node system/integrations/query-package-cli.mjs pending <installed-config.json> <selection.json>
node system/integrations/query-package-cli.mjs read <installed-config.json> <selection.json>
node system/integrations/query-package-cli.mjs assess <installed-config.json> <assessment.json>
node system/integrations/query-package-cli.mjs export-results <installed-config.json> <empty.json>
node system/integrations/query-package-cli.mjs maintain <installed-config.json> <empty.json>
```

CLI配置除上述inbox字段，还需enabled、trustedTransportConfirmed和publicTransferAllowed。显式关闭或接缝失败只影响反馈处理，普通查阅继续沿原入口。生产调用方有界处理失败并保留状态，不因同步失败启动额外模型。

```text
node --test tests/query-package.contract.mjs tests/knowledge-feedback.contract.mjs ../Tools/integrations/knowledge-feedback/tests/core.test.mjs
```

测试覆盖真实模块／本地文件消费、控制与重试、所有处置、版本与权限排除及最小公开回传。实际访客语义、线上部署和一次真实双向同步由原任务另外保留证据。

结果revision是单调的本地公开结果序列，原包修订由source_revision另行绑定。同一裁决重试不增加结果revision；新原包修订下再次形成公开结果时递增。撤回沿同一结果序列递增并先执行，之后原请求任何旧／新结果都不得复活。线上读时排除结果expires_at到期项，维护删除正文，原备份按撤回合同处理。原任务client的具名动作与响应格式见协调合同；不能仅因本地export为空就认定线上旧结果已经删除。

公开Core回流可调用preparePublicRecords({package_id,finding,refs})准备机器字段与逐条摘要，明确审核后把core_records及public_review.core_record_hashes交assess。只有increment或bug_fixed可附真实公开Core记录，no_increment／duplicate不创建Core事件。引用、namespace、期限和ID前缀均受控，内部依据保持本地。线上须实际写入原NamespaceStore并级联撤回，随后Query实际消费另行核验。

公开Core ID同时绑定包、结果revision及finding身份。反馈升版时使用新的结果版本ID，旧版Core墓碑继续阻断重放；同版重试保持同ID。后续Query实际消费须在Host模型输入边界验证少量相关notes已传入，并保持其候选性质、原来源／版本及撤回到期过滤。单有NamespaceStore.select能力不代表消费接线已完成。
