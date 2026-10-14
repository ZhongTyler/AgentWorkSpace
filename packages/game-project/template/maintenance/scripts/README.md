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
