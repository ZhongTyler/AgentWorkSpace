# 项目初始化与 FromDemoToSpec 原型接收

初始化先建立项目身份、维护入口和可定位基线。若项目从 FromDemoToSpec 进入正式开发，FromDemoToSpec 原型不是零散参考资料，而是待保留的行为与证据单元。

模板包含builds/windows的packages、packs、archive空骨架及maintenance/previews。初始化不复制旧项目的包、启动器或版本名；layout.json的当前版本/可执行文件保持null，也不据Windows目录推定目标平台。首次交付再按delivery流程填写并建立入口。生成产物保持忽略，README路由与布局检查必须保留。

## 先接收有效决定

按 [既有决定接收](decision-reception.md) 盘点原始需求、Brainstorm（如有）与FromDemoToSpec后续修改，逐项记录继承、暂缓、替代和冲突。完整迁移demo不等于已消费其中决定；无FromDemoToSpec也要核对其他真实来源。先建立可查去向，再确定本里程碑范围。

## 有 FromDemoToSpec 产物时

1. 盘点原型的完整可运行单元：入口 README、可运行产物、源码、构建与依赖声明、测试、自动化／试玩证据、迁移数据、设计和验证记录。
2. 将上述内容整体迁入项目根的 `demo/`，保留其内部相对结构和历史事实；本项目的 `README.md`、`NOW.md`、`maintenance/`、`docs/` 与未来引擎目录留在根部。
3. 在 `demo/README.md` 保持原型入口和历史状态，在项目根 README 将 `demo/` 标为历史行为基线。正式文档只链接原型设计、验证和迁移资料，不复制它们为第二套 SSOT。
4. 将 `demo/` 加入项目配置的受维护根；对其生成依赖和生成证据目录写出明确排除项。为 `demo/` 及其非生成子目录补齐 README 路由。
5. 从 `demo/` 的原运行入口执行可用的构建和回归；若环境缺失，记录为未执行，不能写成通过。

## 没有 FromDemoToSpec 产物时

不预设或伪造 `demo/` 内容。待未来出现可保留的验证基线时，按本流程新增；项目根 README 只路由当前实际存在的目录。

## 目录

当前没有下级目录。

项目资源进入 [资源操作](assets.md)：初始化 assets.directory、独立引擎路径、空清单；已有FromDemoToSpec仍整体进入demo。
