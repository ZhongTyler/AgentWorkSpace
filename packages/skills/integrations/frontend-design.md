# 为现有 frontend-design 增加可选交互入口

本包不复制或改写第三方 frontend-design。先显式安装所选 interaction-design；再审阅下列片段，将其合并进宿主现有 frontend-design 的任务路由段。保留原正文、许可及本地约束；同义入口已存在则复用，不重复添加。没有该 Skill 时可沿固定版本公开入口读取或使用宿主等价规范，不自动安装、开启服务或调用其他 Agent。

```text
当前网页/App任务涉及状态反馈、选择焦点、布局切换、拖拽或交互动效时，按需加载可发现的 interaction-design，沿其 references/interaction-method.md 处理连续操作、取消恢复、输入替代与减少运动。视觉方向和排版仍由 frontend-design 负责；普通静态样式不强制调用。无法发现时沿宿主规范或固定版本公开入口，不猜测本机路径。
```

固定版本入口：[interaction-design](https://github.com/ZhongTyler/AgentWorkSpace/blob/v1.17.0/packages/skills/library/interaction-design/SKILL.md)。其相对引用随选装目录完整交付。安装/升级 Skills package 不会修改外部 frontend-design；上述手工接线不属于安装器受管文件。修改前保存宿主恢复点，撤销时只撤本次新增片段，保留后续改动。验证应包含一个实际命中的交互任务和一个无需交互方法的静态任务；文档可达或工程检查不能证明长期触发率、体验改善或节时。
