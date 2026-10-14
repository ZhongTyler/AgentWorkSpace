# 可选的固定版本游戏源码参考库

本目录提供8项推荐源码的固定提交、主题、读取入口、归档/文件清单哈希和19份许可声明；另保留18组备选。它用于补充Research、游戏研究与开发支持中的实现证据。安装包不携带游戏源码、历史、权重、运行依赖或维护者连接记录，也不授权下载、启动游戏或Knowledge消化。

| 参考 | 适合的问题 |
|---|---|
| Athena Crisis | 回合战棋、移动范围与路径校验 |
| Shattered Pixel Dungeon | 地牢、道具、状态与装备组合 |
| Mindustry | 自动化、物流、塔防波次 |
| Server Survival | 预算、容量、压力与教学反馈 |
| Whatajong | 麻将接龙肉鸽、轻量流程与界面 |
| Brogue CE | 程序地牢、地形互动与信息表达 |
| DDNet | 合作平台、钩爪、移动与联机 |
| Slay The Robot | Godot/GDScript卡牌框架、效果队列与预览 |

按当前问题先查项目事实和已有Knowledge，再选最相关1–2项，实际读模块，引用仓库@完整提交:文件/行号。结合作者解释、玩家反馈与反例；不同文件不算独立来源。MD/网址原入口保持；每周研究按题选用，不轮询全库或自动追新。有迁移价值的结论沿宿主Knowledge去重、消化与精确终审；项目决定和试玩结果留在原宿主。源码充分时直接读，发行产物仍有缺口才选REA。

## 准备与按需恢复

在已安装Research包根运行：

```text
python reference-library/library.py list --query 移动
python reference-library/prepare_home.py --home <external-reference-home>
```

第二步只复制登记、维护脚本与许可到全新的包外目录，不联网。目录不能位于modules或事务状态树内。之后在该外部目录执行：

```text
python library.py list --query 效果队列
python library.py restore --id brogue-ce --download
python library.py locate --id brogue-ce --path src/brogue/Architect.c
python library.py verify --id brogue-ce
```

`--download`仅在归档缺失时显式下载所选固定提交，不执行上游代码；有已校验本地归档时不联网。目录或清单已被修改时失败并保留，不刷新原锁。首次归档恢复会重建被锁定的逐文件清单；上游重打包导致原归档哈希变化时拒绝认可。备选只供发现，不能直接restore，新增选用须单独固定版本和许可。

完整8项原归档约201MiB、展开约263MiB，这是固定版本内容规模，非接收者已安装证明；本地磁盘实际占用另含清单和文件系统开销。DDNet的ddnet-libs构建子模块只登记身份，未随快照附带；运行依赖、远程素材及完整Git历史不包含。

## 许可、升级与证据

精确版本和分项许可见[catalog.json](catalog.json)与[许可原文](licenses)。MIT、GPL/AGPL、zlib代码和素材的授权范围分别核查；目录许可不能替代游戏自身许可。实际复制代码、素材或发行前核查相关声明和发行义务。源码存在不代表可运行、效果已验证或项目已经采用。

源码与归档保留在外部home的runtime。研究报告、通用知识和项目结果各归原owner；不写入安装包。升级/回滚Research包只更新模板，保留现有外部home；需要采用新版目录时准备新的版本home，复验后切换，不覆盖旧源码和锁。保存、恢复和读取已在维护环境验证；接收者运行、跨平台游戏构建、真实Play和长期研究增益仍须验证。
