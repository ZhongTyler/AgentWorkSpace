# 按问题选择专业内容

自然语言问题直接进入[分析协议](../protocols/analysis.md)。已有材料足够时直接分析，不先打VOI分、选模式或填装配收据。来源权限和方法选择相互独立。

## 读取匹配正文

先读[统一选用规则](../protocols/selection.md)，再由[能力目录](catalogue.json)定位具体配置、Method或Procedure。使用状态、证据解释、顺序与阅读预算均由该规则拥有。专业卡不是独立Agent，也不自带查证完成或质量证明。

Agent按已有上下文准备query／ids／roles；需要候选时明确本题缺口并选择includeCandidates:true。lookup用于看可用项，Provider用于读取正文；检查实际正文、usage与not_loaded，不能用命中代替分析。Knowledge原则按稳定来源读取，缺少材料只收窄依赖结论。

## 从具体问题开始

[问题路线](problem-routes.json)连接具体问题、操作和正文。例如“成长慢”对应growth-pacing，“机制没价值”对应mechanic-value，“交互易误解”对应interaction-recovery；还覆盖战斗窗口、系统牵连、局部失衡、交付风险及叙事选择。

Agent根据当前缺口准备如`{"problem":"growth-pacing","includeCandidates":true}`的请求；这是本题试用选择，用户不用填表。`node scripts/learning-cli.mjs resolve question.json`可查看正常／试用／停用及证据原因，lookup沿用原数组。读取正文后按返回的operation建模和查证，给出实际比较；不能把路线命中当成专家意见。

## 独立分工的条件



先选本题缺口，再选实际执行方式：

| 本题需要 | 方式与实际证据 |
|---|---|
| 已有事实足够，只需推理或验算 | 当前Agent直接分析，保留依据与限制 |
| 容易遗漏某领域约束或缺少具体操作 | 读取匹配配置／Method／Procedure，写明实际影响 |
| 可分离的证据调查、替代解释或反方审查值得协调成本 | 仅在用户或适用指令授权分工时使用独立Agent，给具体子问题与停止条件 |

角色名不创建独立Agent，切换提示词也不产生独立证据。宽泛角色查询不保证覆盖完整问题。

只有真正可分离的证据、假设或反方任务可能带来增量，且授权允许时另开独立上下文。给最小材料、写范围和停止条件；不因角色存在凑团队。相同模型有相关偏差，人数不能证明质量。

缺输入只阻断依赖结论，仍可完成查证、计算、条件性建议及验证准备；缺权限停止对应动作。重要取舍与真人体验由用户决定，宿主保存正式状态。独立分工不产生额外权限。

## 旧版与历史

memory/assets的旧Procedure、INDEX、framework及旧Provider字面状态保留历史／v1兼容解释；新版Procedure正文在procedures/，同一稳定ID显式标content_version=2。旧PASS不能给新版背书，PM-002维持retired。使用旧客户端时仍按其合同校验，不能伪造新版为v1。

Group provenance仅消费Knowledge已给收据，不重实现Group算法，不由Group命中扩张角色、预算或授权；缺失就标未提供。具体学习与撤回见[学习协议](../protocols/learning.md)，不要逐次生成无消费者的试运行收据。

兼容机器收据保持 `evaluated_groups`、`selected_via_group`、`skipped_via_group` 和原覆盖信息；`group_provenance_mode: consume_only`、`group_algorithm: not_reimplemented`、`role_effect: none`。这些字段不改变 role / Team 选择、查询等级、预算或来源授权，不把v1未声明字段静默塞入Provider。
