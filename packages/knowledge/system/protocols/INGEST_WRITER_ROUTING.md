# Ingest 写作与复核路由

先看运行记录中的 `execution_control.execution_profile`，再选择对应执行路径。接收方的规则、模型可用性和任务授权始终有效；本包不继承作者的模型选择批准，也不自动创建、启动或联系其他会话。

## consolidated-v1

适用于本包控制器支持的 core + deferred 运行。Raw 与 Wiki 可复用同一内容写作者，由主审核者对冻结输入、内容覆盖和精确版本审核负责。实际生产者与审核者的上下文身份必须满足控制器约束；写作者不能通过自报把自己的修改判为审核通过。具体请求、输出路径、允许修改范围和下一操作以 `ingest-advance.mjs` 的真实结果为准。

写作者与可选回读配置见 [ingest-agent-policy.json](../maintenance/checklists/ingest-agent-policy.json)。其中模型是上游默认配置示例，接收方先核对可用性与授权，再显式维护实际配置并记录修改；配置变更和升级冲突都要审阅，不能声称切换到了未实际调用的模型。可选会话绑定属于本地 ingest-agent-bindings.local.json，绑定存在也不授予发送消息的权限。

受管理任务、precision 复核等不受该 profile 支持的路径，应在创建运行前选择已有支持路径，不能在运行中静默关闭闸门。Stage3 经准备、精确审核与 finalizer 收尾；失败保留当前运行、原始输入身份和有效证据，修复后继续同一运行。时间与费用按真实记录结算，未知不写成零。

## existing 与历史运行

interactive、明确选择 existing 的 deferred 及历史记录沿其原阶段与独立审核合同解释。历史模型名、会话身份和审核格式是当时记录，不构成新接收方的默认授权。不能把新版主审核者收据混入旧独立复核格式，也不能用升级跳过必要迁移、审核或精确批准。

## 共同质量边界

Raw 写作读取冻结材料、完整 manifest、现行 Raw 标准与 [raw-writing-v2.md](../maintenance/checklists/raw-writing-v2.md)。本包使用该写作合同提供便携文风边界，不要求作者的私人范文。Wiki 写作以已接受 Raw、规划与目标正文为准；摘要不能替代必要全文。语义复核、机械修正和正文改写分别保留实际 owner 与证据，未变证据仅在控制器证明内容身份一致时复用。

最终批准绑定真实审核文件及内容 manifest 的精确哈希。工具通过不等于用户批准，也不证明真实模型、阅读或采用效果。完整入口见 [便携执行说明](PORTABLE_EXECUTION.md) 和 [Ingest 协议](INGEST_PROTOCOL.md)。
