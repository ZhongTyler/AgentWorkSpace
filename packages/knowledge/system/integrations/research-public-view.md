# 研究报告的共享查询视图

Research 维护研究正文、原始证据、版本及逐文件发布分类。Knowledge 沿原 catalog 接受记录生成 `research-reports/public-view.json`，将研究单元接入原 Query、查阅包和统一复利出口。消化流程保持自己的内容批准合同。

## 内容与身份

`buildResearchPublicView` 接收原 catalog、可信 bindings、Research 的逐文件计划与授权引用，核对源字节后返回 profile 和文件描述表。`exportResearchPublicView` 只向新目标写入相同内容。正文、manifest、catalog 和必要私有证据保留原字节及哈希，工作文件的排除随原分类保留理由。

profile 的 `reports` 为已接受档案，`draft_reports` 单列未接受材料。草稿返回 `accepted=false`、`draft_partial`、原材料范围及来源身份，原 catalog 和历史接受记录保全。

每个 `units` 条目包含 `ref`、`report_id`、`unit`、`title`、`source_sha256`、`manifest_sha256` 与完整 `documents`。引用为 `knowledge:research:<报告ID>/<编码后的单元ID>`。组合版本使用原 manifest 哈希和有序的文档路径、原字节数及哈希，文档对象的 JSON 键序由 `researchSourceVersion` 归一。

`researchSnapshotSources({manifest, readObject})` 是线上目录、查阅包和本地目录的共用身份解析器。它仅读取 profile，核对快照中的 catalog、manifest 和全部单元文档身份及访问字段，再返回完整单元元数据和物理文档路径。正文复读继续由原研究 provider 执行。

## 访问与复利

快照条目的 `access=query` 允许 Query 正文消费，`access=private_evidence` 保存在同站主的私有证据库。原 HTML、来源归档及受限媒体沿私有范围同步。媒体公开展示另随来源许可和具体发布决定处理。

服务端使用 `publicResearchOptions(root, {privateEvidence:true})`，可核验私有证据哈希，返回的仍是原观察、材料身份、可见性和研究限制。默认 `privateEvidence=false` 时显式保留材料受限状态。

typed Group关系还读取对应Group的 `last_review_receipt`。这些原批准JSON保持原路径与哈希，按Group审结文件模式显式列入 `private_evidence`，为在线关系核验提供同一批准依据。其余审计文件沿各自范围维护。

共同宿主和 Query CLI 使用相同研究 host。共同宿主可用 `research=false` 关闭本轮研究候选补充，已有研究引用仍由原解析器核验。直接文件阅读用共同宿主 `confirm_read`，研究正文映射到已声明完整单元；缓存继续记录实际旧版本。实际返回、复读、使用和增量由原统一复利出口归并。

## 同步与验收

沿原 accepted manifest、内容发布、激活及回读链路发布。客户端按需读取并重验单个对象，保留当前上传批。`chunkedStage=true` 逐批发送 `finalize=false`，最后空对象 `finalize=true` 验证完整快照。`gzipObjects=true` 可对大文本使用 `encoding=gzip`；原 manifest 的尺寸与哈希仍指原字节。

总快照、单对象、单批解码量和编码请求量分别受配置约束。新协议采用后才开启相应开关，旧客户端缺省继续原行为。本地与线上按同一 profile、完整文件表、哈希、引用及实际查阅核对，首次对齐后再执行全库健康检查。

已退出当前 Git 树的受管衍生媒体使用 `approval.artifact_inputs` 显式进入原发布流程。每项绑定批准路径、哈希及提交内 `.git-artifacts/research-media.json` 的路径与哈希，访问范围为 `private_evidence`。发布器核对恢复清单中的原提交、路径、blob、尺寸、角色及哈希后读取冻结字节；工作区中的后来改动继续保全。
