# GitHub Release 发布与命名

2.x 各模块在独立公开仓维护与发布，AWS 聚合仓固定其 gitlink、库存和兼容信息。本流程统一独立模块与 AWS 的版本、附件及发布核验。历史 1.x 仍按原来源导出合同解释。

## 固定命名

| 对象 | 规则 | 示例 |
|---|---|---|
| Git tag | `vMAJOR.MINOR.PATCH`，与库存版本一致 | `v1.20.0` |
| Release 显示标题 | `<tag> — <简短英文更新主题>` | `v1.18.0 — Answer qualifier review` |
| 发布 ZIP | `AgentWorkSpace-<version>.zip`，版本不加 `v` | `AgentWorkSpace-1.20.0.zip` |
| 校验文件 | `SHA256SUMS.txt` | `SHA256SUMS.txt` |

标题以版本开头，分隔符固定为两侧各一个空格的长破折号 ` — `；不添加仓库名前缀，不混用 `·` 或短横线。主题用 3–72 个 ASCII 字符的简短英文短语，首字母大写，说明本版主要变化，不重复仓库名或版本。保留 Skill、包和工具的正式名称；不把工程通过写成体验提升。详细变化、可选条件和验证限制写在正文。此工具只覆盖当前稳定正式版，预发布需先扩展规则。

## 创建和核验

1. 在对应独立模块仓维护。审阅新增文件并显式暂存，生成和检查局部全景，使用随仓 .module/module_manager.py seal 预览库存，确认后加 --apply，再运行 verify 与受影响业务测试。提交并发布模块的独立版本后，AWS 更新对应 gitlink，生成 catalog 和全景，验证组合、上一版升级、冲突与恢复。每一级直接父仓提交实际 gitlink。
2. 确认 tag 与已验证提交一致；公开后不可移动或改写 tag。由该提交生成发布 ZIP 与校验文件，按上表命名。
3. **必须通过同一个入口生成标题或创建请求**，不在各次临时发布脚本里手写另一种名称：

   ```text
   python scripts/release_metadata.py title --tag v1.20.0 --summary "Optional interactive explanations"
   python scripts/release_metadata.py create-payload --tag v1.20.0 --summary "Optional interactive explanations" --notes-file <release-notes.md>
   ```

   `create-payload` 输出可供 GitHub REST API 创建 Release 的 JSON，保留 UTF-8 正文；它不联网、不发布、不创建 tag，也不替代发布授权或前置验证。将输出作为请求体交给现有已授权的发布方式。使用网页或 `gh release create` 时，也复制 `title` 的结果作为显示标题。
4. 上传受验证的 ZIP 和校验文件。通过 GitHub API 重新读取本次 Release，保存完整 JSON 后执行：

   ```text
   python scripts/release_metadata.py check --file <github-release.json>
   ```

   标题与 `tag_name` 不一致、旧格式、空主题或不合法版本均非零退出，必须停止后续完成声明。另核对 tag 对应提交、附件名称与哈希、升级入口、实际 draft/prerelease/latest 状态；从公开远端新克隆并校验安装。标题通过只证明命名，不证明上述发布验收。检查历史列表时传入汇总了所有分页的非空 JSON 数组。

## 整理历史显示标题

历史标题允许在明确授权范围内整理；先保存原始 Release 对象、原标题、拟用标题及 tag/附件基线。逐项按 Release ID 更新，PATCH 请求体仅为 `{"name": "新标题"}`。不要顺带改正文、tag、附件、发布时间、draft/prerelease 或 Latest 指定；有并行编辑时先重新审阅。

更新后重新读取所有分页并运行同一命名检查，核对 tag/提交、原正文、附件 ID/名称/大小/摘要和下载地址及 Latest 未改变。保留原标题和实际结果以便按 ID 恢复。此类纯元数据整理不重打包、不移动旧 tag，也不为显示名称创建新版本。


## 2.x 分发与维护权威

每个独立模块的正式附件命名为 AWS-<DisplayName>-<version>.zip，校验文件为 SHA256SUMS.txt。AWS 轻量附件为 AgentWorkSpace-<version>.zip。若另提供完整离线附件，使用 AgentWorkSpace-<version>-full.zip，发布说明清楚区分。所有附件由固定 Git 提交派生，公开 tag 保持不可变。

AWS 的 build_catalog.py 读取当前模块合同和干净的独立 Git 提交，固定仓库、版本、提交及库存。module_docs.py 从同一关系声明生成局部图和全景。元数据校验和已获取模块文件校验分开报告。普通历史克隆可能仍下载旧 1.x 大文件，推荐浅克隆或轻量正式附件。

旧 scripts/publish.py 在 schema 2 聚合仓拒绝副本导出。旧来源 release-input、curated 与 released 不作为 2.x 当前维护权威，保留历史迁移与来源用途。后续修复直接进入对应公开模块，再更新 AWS 引用。来源私有项目、账号、运行环境和真实业务材料继续留在原 owner。

独立模块需要分别通过陌生目录使用检查。聚合版本还需验证按需获取、明确全部获取、已有独立实例复用、真实上一版升级和恢复。正式发布后匿名读取 tag、附件摘要与下载，分别用新独立模块和新聚合副本验收。只有实际验证的范围才能写为通过。
