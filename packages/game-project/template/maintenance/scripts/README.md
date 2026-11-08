# 维护脚本

脚本默认不修改项目状态。运行前先阅读其用法，修复动作必须与检查分开执行。

## 目录

当前没有下级目录。

## 当前文件

- [check-decision-reception.mjs](check-decision-reception.mjs)：health-check调用的只读来源版本、决定覆盖、处置和引用检查；空表不是接收通过。
- [test-decision-reception.mjs](test-decision-reception.mjs)：运行 `node --test maintenance/scripts/test-decision-reception.mjs` 检查遗漏、漂移、替代证据与无来源边界。

- [check-build-layout.mjs](check-build-layout.mjs)：health-check调用的构建分区、README、唯一入口与当前版本路由检查；允许尚无构建。
- [test-build-layout.mjs](test-build-layout.mjs)：运行 `node --test maintenance/scripts/test-build-layout.mjs`，覆盖空模板、通用项目名及目录/入口反例。

- [health-check.mjs](health-check.mjs)：检查维护目录、README 路由、项目配置和空 Godot 工程状态。

在项目根目录运行：`node maintenance/scripts/health-check.mjs`。

- [check-assets.mjs](check-assets.mjs)：health-check调用的只读清单/证据/快照/legacy收据检查，不修复或发布。

- [check-releases.mjs](check-releases.mjs)：交付版/采用门哈希与实际安装收据差异；回退后提示漂移，不自动改写。
状态来源与消费者复核：health-check调用check-status.mjs；权威hash变动或引用缺失会失败。模板与现有项目保持该检查实现一致，更新须同时复验；检查不能代替人工语义判断。

[asset-atlas.mjs](asset-atlas.mjs)启动固定图册，传项目根和可选--open；--check仅检查。数据读取、版本哈希和原子保存由[asset-atlas-store.mjs](asset-atlas-store.mjs)提供。浏览器与保存回归由[test-asset-atlas.mjs](test-asset-atlas.mjs)执行，参数为项目根、--evidence新目录及--browser路径；全程headless，写入仅发生在隔离夹具，真实项目只读。

[archive-atlas-media.mjs](archive-atlas-media.mjs)预览未归属媒体归档范围，显式--archive才追加索引。保留原件和catalog，按输入版本拒绝并发覆盖。

[audit-asset-atlas.mjs](audit-asset-atlas.mjs)只读核对登记语义、来源、复用、状态和消费者覆盖，支持--output，health-check调用同一函数。[test-atlas-audit.mjs](test-atlas-audit.mjs)使用隔离夹具验证错误能被发现，运行node maintenance/scripts/test-atlas-audit.mjs。
