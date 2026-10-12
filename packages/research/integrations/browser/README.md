# 研究时的浏览器工具

默认使用已实测的原生浏览器读取/字幕/截图、公开网页本地采集及OCR辅助；MCP负责跨来源检索和结构化读取。扩展保留为可选辅助，沿原有 Research → Knowledge 路径，不因扩展保存失败阻断研究。

| 工具 | 采用用途 | 边界 |
|---|---|---|
| [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) | 正文、出处、日期、高亮剪藏成Markdown；有字幕时的YouTube文字稿阅读 | 选中页面按需保存；先检查正文完整性。截图/图表/附件不能只留远程链接后视为已消化 |
| [SingleFile](https://github.com/gildas-lormeau/SingleFile-MV3) | 选定网页的原貌、图表和上下文保存为单个本地HTML | 在页面及懒加载图片载入后保存；HTML快照不保证视频流、未展开内容和登录后页面可离线重放 |
| [uBlock Origin Lite](https://github.com/uBlockOrigin/uBOL-home) | 减少一般广告干扰的可选工具 | 未安装/验收；不保证能跳过YouTube广告。正片身份、时长、字幕和画面仍须检查 |
| [Video DownloadHelper](https://help.downloadhelper.net/article/6-what-is-vdh) | 确需保存可访问完整视频时再评估 | 官方明确Chrome版不支持YouTube下载；本机未安装/验收，不将其作为此次GMTK下载失败的解决方案 |
| 视频下载/摘要扩展、SponsorBlock | 暂不作为默认依赖 | 原生字幕导出已成功；额外摘要工具增量有限。SponsorBlock跳创作者赞助段，不等同片头广告，且会影响连续观察 |

Obsidian官方发行说明已包含YouTube文字稿界面；此能力来自官方功能说明。用户确认两个扩展已加载，但手动点击SingleFile后只有加载、未见文件，Web Clipper点保存后也未见结果。当前仅确认加载，保存链路未通过，不再作为默认依赖。

## 本机准备与加载

`extensions.json`锁定官方来源、版本和SHA-256。运行 `python integrations/browser/prepare.py` 只准备两个可加载目录，不修改浏览器配置，不自动启用扩展。目录在本文件相邻的 `runtime/`，原有目录会保留并拒绝覆盖。官方包包含的许可证保留；再分发时按对应许可处理，不将作者商标视为自有素材。

通过宿主支持的“加载扩展”选择 `runtime/singlefile` 和 `runtime/obsidian-web-clipper`（目录内有manifest.json）。若宿主需要商店安装则使用上述官方仓库链接到的商店，不能把源码下载等同安装成功。当前自动操作接口没有宿主扩展管理入口；商店安装尝试未产生可验证成功状态；用户已通过宿主加载目录。自动化仅支持HTTP(S)网页，内部扩展管理页受浏览器策略阻止，不绕行；网页快捷键测试没有可观察的弹窗/下载事件，手动点击亦未观察成功产物。用户已决定改用能达成研究目的的替代路径，不继续反复点击或要求卸载。

诊断实证：本机`obsidian://`协议处理程序已注册、目标程序存在，但点击保存后未启动Obsidian；Downloads未发现该文章HTML/Markdown。Web Clipper官方代码依赖剪贴板与外部Obsidian URI，SingleFile默认保存依赖`browser.downloads`及完成事件。宿主兼容性是候选原因，具体根因未证实；本机回环下载探针也超时，未建立正常下载对照，探针服务已停止。不能据此断言两个扩展在所有内置浏览器都不支持。后续若宿主提供明确兼容文档/修复，再用公开文章保存与实际文件复核验收。

已验证替代：公开正文用[本地采集工具](../media/README.md)，GameRes8,214字符与20/20图片实跑通过；动态/登录页原生浏览器读取，YouTube用已验证的原生英文字幕和必要关键帧，图表/GIF按媒体合同读取。普通研究无需保存每个标签页；需要完整网页原貌时才在兼容浏览器用SingleFile另行验收。

两个官方清单都声明广泛网页访问权限，并非天然只读取点击时的页面；若宿主支持，将站点访问限制为按点击或指定研究站点。保留原版清单，不靠删权限伪造兼容。默认手动保存，不启用全标签自动剪藏、Google Drive上传、AI Interpreter外传或新账号授权；剪藏到已有Knowledge入口前核对目标，不覆盖用户已有Obsidian模板和库设置。

## 与知识路径衔接

日常先阅读和研究；值得长期保留时，正文Markdown + canonical URL/作者/日期/捕获时间 + 必要原图/图表/视频时间码进入宿主既有Clippings/捕获入口。确需复核原貌时附SingleFile HTML；短问答无需每页都存两份。

保存成功仅是捕获，不等于Knowledge消化完成。图片按[媒体读取路径](../../game-research/media-capture.md)核对；视频按[字幕路径](../../game-research/video-text.md)读取；主题去重和3–4篇批次规则、Raw/Wiki及终审沿当前Knowledge合同。公开发行包只带选择、准备脚本和版本锁，不带个人页面、浏览器profile、授权或剪藏。
