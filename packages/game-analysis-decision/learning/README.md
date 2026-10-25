# 本地学习

初始 state.json 为空。使用 scripts/learning-cli.mjs 对实际方法增量登记证据、范围和撤回；只在本地包副本维护，发布模板不是用户的学习存储。登记效果支持需要真实基线、内容哈希、适用范围与相应验证，Git 需在此模块建立独立本地基线，不借用外层仓库。周期检查不表示已启用自动化。参见 [协议](../protocols/learning.md)。


目录与读取脚本应一起升级；旧读取器会拒绝default_use新字段。新版仍读取没有该字段的旧目录与旧学习状态。

专业内容的正常选用、按题试用与停用见[统一选用规则](../protocols/selection.md)。本入口维护证据和撤回，不增加第二套选用条件。

真实反馈如何引用、归因与进入leads统一见[结果回看](../protocols/learning.md#从真实结果回看)。plan返回trigger、deferred_leads及requires_source_reading；未到期反例可进入检查，普通未到期线索保持deferred，不能据此写成本期完成。
