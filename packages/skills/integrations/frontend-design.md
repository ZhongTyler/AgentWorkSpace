# 为现有 frontend-design 增加可选方法入口

本包不复制或改写第三方frontend-design。按当前任务选择下方交互或字体薄入口，审阅后合并进宿主现有任务路由；保留原正文、许可与本地约束，同义入口已存在则复用。可显式选装对应Skill，也可读取固定版本参考或使用宿主等价规范；不自动安装、开启服务或调用其他Agent。

```text
当前网页/App任务涉及状态反馈、选择焦点、布局切换、拖拽或交互动效时，按需加载可发现的 interaction-design，沿其 references/interaction-method.md 处理连续操作、取消恢复、输入替代与减少运动。视觉方向和排版仍由 frontend-design 负责；普通静态样式不强制调用。无法发现时沿宿主规范或固定版本公开入口，不猜测本机路径。
```

固定版本入口：[interaction-design](https://github.com/ZhongTyler/AgentWorkSpace/blob/v1.17.0/packages/skills/library/interaction-design/SKILL.md)。其相对引用随选装目录完整交付。安装/升级 Skills package 不会修改外部 frontend-design；上述手工接线不属于安装器受管文件。修改前保存宿主恢复点，撤销时只撤本次新增片段，保留后续改动。验证应包含一个实际命中的交互任务和一个无需交互方法的静态任务；文档可达或工程检查不能证明长期触发率、体验改善或节时。

## 可选字体入口

```text
中文字体新增/替换、缺字、数字可读性或字体嵌入交付时，按需读取已选择game-presentation Skill中的references/font-selection.md，或固定版本字体参考。先复用合适的已有字体；猫啃只用于发现，具体版本与作者许可分别核查，再做目标浏览器的实际加载、字形覆盖和回退检查。普通文案或改色不强制找字体；不因此加载整套游戏工作流。
```

[固定版本字体参考](https://github.com/ZhongTyler/AgentWorkSpace/blob/v1.19.0/packages/skills/library/game-presentation/references/font-selection.md)。这份参考不要求启用整个Skill或安装game-presentation包。手工路由与选定Skill、package分别恢复，撤销只移除自己新增的片段，保留原正文与后续修改；安装器不改外部frontend-design，也不安装字体或加入资产下载白名单。

## 可选界面比较入口

当新界面或重要改版的布局、层级或主要操作仍需选择时，可把以下短入口合并到现有任务路由；已有同义入口直接复用。

```text
先明确使用者任务、必须保留的行为与主要取舍，建立视觉方向，再用相同代表内容比较少量有结构差异的可操作原型。明确方案和局部修复直接执行。正式采用须接回真实组件、状态和权限；模拟动作标明，原型可点击不等于正式功能贯通。
```

完整方法优先读宿主等价入口；有 meta 时读 collaboration/interface-design.md，兼容模式读 modules/meta/collaboration/interface-design.md，否则读[固定版本方法](https://github.com/ZhongTyler/AgentWorkSpace/blob/v1.23.0/meta/workspace/collaboration/interface-design.md)。原型可选使用已有 prototype；[prototype 的接线边界](prototype.md)另列。此入口与上面的字体、交互入口可并存，按缺口选择。安装器不修改第三方 Skill；手动接线前保留自己的恢复点，撤销时只移除本次片段，保留正文、许可、字体/交互路由与后续改动。
