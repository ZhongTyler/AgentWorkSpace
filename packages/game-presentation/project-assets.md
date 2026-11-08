# 项目资源工作台 · v1

本合同拥有资源规划、身份、存放和维护边界；实施方案（沿接收方对应入口） 记录迁移顺序，实际能力见 NOW（沿接收方对应入口）。工作台、两段交付与检查可用，见 [操作合同](adapters/godot/workbench.md)；旧 [Godot 交付器](adapters/godot/README.md) 仅兼容既有安装。

## 目录

无下级目录。

## 进入与职责

宿主 maintenance 识别资源新增/修改/退役 → 项目 resource-plan 与 catalog → 用途规格 → 外取/生成/手工源 → 工作候选与按用途评审 → 不可变 release → 引擎复制/实际收据 → 场景/包验收。项目 roadmap 拥有整体进度，不在资源区再维护一份里程碑。

项目 `assets.directory` 与 `engine.directory` 独立配置，必须是互不包含的项目内目录。根资源工作台与 docs 平级；引擎只使用复制进去的精选及必要许可，不引用工作台或共享库，不链接整个目录。代码插件仍走工程依赖审查。

| 位置 | 权威内容 |
|---|---|
| resource-plan.md、catalog.json | 资源覆盖/优先级与唯一结构化清单，不手抄实际安装状态 |
| specs/ | 用途规格；概念原画、立绘、地图棋子、头像分 ID 与验收 |
| sources/ | 不覆盖的源版本、原始提示/参考、来源许可证据 |
| work/ | 资产/版本的加工、实际尺寸对照和采用记录 |
| releases/ | 按用途通过效果/技术/权利门的不可变引擎交付版本；不是公开发布授权 |
| draft/、archive/ | 整体资源文档草案与历史；正式正文直接在所属目录 |

每个实际目录都有 README，只列直接子目录的路由；不预建所有角色或空来源分类。程序表现也登记需求及代码消费者，不强行生图。项目 docs 只链接资源事实，整场游戏验证仍在 docs/validation。

## 清单 v1

清单 `schema_version:1, assets:[]`。路径统一相对项目根，使用 `/`，拒绝绝对路径、`..`、符号链接。每项包含：

- `id`、`object_id`、`purpose`、`spec`、`owner`、`priority`（P0/P1/P2）。角色身份与用途资产分开。
- `stage`：planned/acquired/working/review/ready/retired。
- `source`：kind（planned/vendor/generated/custom/procedural）、version、files（path/sha256）；可选 upstream_id、receipt。程序表现引用活跃代码而不是伪造不可变图片源。
- `references`：其他资源 ID；`work_path`：本用途工作目录或 null；`desired_release`：期望交付清单路径或 null。ready 才允许绑定交付版；seal生成不可变release，publish复验当前门和源绑定。
- `consumers`：path、kind（runtime-reference/legacy-installed-unused/procedural-runtime）、evidence。描述用途和代码引用，不保存另一份 installed_version。
- `gates`：concept/purpose/technical/rights 各自 status（pending/pass/fail）和 evidence（项目内文件）。pass/fail 必须有证据。ready 四门均 pass；生成成功、概念认可不替代地图用途与权利通过。

`source.receipt` 指向 source-snapshot-v1 清单：origin、files（快照内相对路径→SHA256）。bootstrap 必须注明接收自旧工程收据、旧 receipt 哈希及位置，不宣称重新下载或重新许可审计。来源快照的所有文件保持原字节；不得格式化许可证。每次更新新版本，旧快照不修改。

## 维护与兼容

新增先登记需求，planned 允许无媒体；修改建立新版本，仅重开受影响门，原造型决定不丢失。退役先查引用和实际安装，不默认删除源。迁移保全哈希、引用和历史失败；旧制作卡改为路由，不留两份当前决定。

健康检查只读：目录安全/README、ID/引用/门证据、快照字节、旧安装 receipt 所有权/哈希/清单对应关系。`assets.legacy_receipts` 精确登记旧 receipt 路径、理由和 review_when；不能作为任意新直拷贝豁免。未登记运行素材报错，`.import` 等生成伴随文件不当源媒体。实际用途引用由代码检查证据支持；静态扫描不能代替真实包审计。

离线项目保留本地检查器和轻量操作入口；通用合同路径由配置 workflow_contract 指定。不可达时检查报告警告并停止资源发布，不自动下载或套用猜测协议，普通开发/资源保全可继续。复制本合同作为离线快照时登记版本与哈希，明确它是只读版本副本，不是第二个可编辑 SSOT；模板不内嵌另一份可编辑流程；离线用经核对的合同只读副本，真实探针已经验证该形态。

旧工程/回退日志不自动迁移，候选只进隔离预览；release由seal生成，禁止手写假release绕过门。F2S 仍整体保留在 demo，不受本合同重分目录。

固定资源工作台按[项目全资源图册](project-atlas.md)使用catalog可选atlas字段。用途、加工版本、审阅意见与实际安装的权威分工沿现有合同。
