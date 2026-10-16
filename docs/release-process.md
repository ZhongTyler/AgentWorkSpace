# GitHub Release 发布与命名

此流程维护本仓 GitHub Release 的显示信息；包正文仍从来源仓提交后导出，库存、升级和运行验证沿原有合同完成。

## 固定命名

| 对象 | 规则 | 示例 |
|---|---|---|
| Git tag | `vMAJOR.MINOR.PATCH`，与库存版本一致 | `v1.20.0` |
| Release 显示标题 | `<tag> — <简短英文更新主题>` | `v1.18.0 — Answer qualifier review` |
| 发布 ZIP | `AgentWorkSpace-<version>.zip`，版本不加 `v` | `AgentWorkSpace-1.20.0.zip` |
| 校验文件 | `SHA256SUMS.txt` | `SHA256SUMS.txt` |

标题以版本开头，分隔符固定为两侧各一个空格的长破折号 ` — `；不添加仓库名前缀，不混用 `·` 或短横线。主题用 3–72 个 ASCII 字符的简短英文短语，首字母大写，说明本版主要变化，不重复仓库名或版本。保留 Skill、包和工具的正式名称；不把工程通过写成体验提升。详细变化、可选条件和验证限制写在正文。此工具只覆盖当前稳定正式版，预发布需先扩展规则。

## 创建和核验

1. 在来源仓维护并提交，导出受影响包，完成来源合同、包运行、上一版升级、冲突与恢复验证。按根 README 运行回归、固定 `catalog.json`、检查库存，再提交及闭合父仓 gitlink。
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
