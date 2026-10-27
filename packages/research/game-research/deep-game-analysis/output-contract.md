# 游戏研究档案：输出与条件返回

[研究流程](README.md) · [任务与证据模板](templates.md) · [主报告模板](game-dossier-template.md)

## 原档案与覆盖

一款游戏维护一份档案。主报告让没看原素材的读者理解整体设计、全部适用领域、跨系统运行、具体情境、机制条件、代价与反例，保留稳定结论索引和可追溯证据。全域表逐项写适用性、实际深度、来源、未知和下一必要材料；领域目录齐全不能证明原目标完成。重点只改变推进顺序，局部answered与整作partial可以同时成立。

采用[主报告模板](game-dossier-template.md)及[查证标准](verification.md)。每次开题使用当时完整领域基线：有宿主导航时读取并固定版本，没有则按游戏系统及表现、制作/工程、体验与额外维度形成可复核列表。未知不等同不适用，不为适配模板改宿主领域。制作过程需对应源码或开发者证据，不能从画面猜内部事实。

报告、原件和批次放在使用者指定的包外位置；原owner拥有事实，项目拥有决定，Research方法库不接管用户数据。研究档案供直接查阅，可选目录只登记显式接受的版本，不自动转换Raw/Wiki、不登记待消化、不恢复暂停任务。

## 机器合同与示例

`example_dossier.py`生成一个**完全构造的**最小档案，供学习JSON接口和运行拒绝/恢复验证，不能作为真实案例或全域研究证据。输出必须是不存在的新目录，不扫描或读取工作区业务内容：

```text
python example_dossier.py --output <new-example-directory>
python dossier.py check --manifest <new-example-directory>/manifest.json
python dossier.py return --manifest <new-example-directory>/manifest.json --request <new-example-directory>/request.json --output <new-example-directory>/returned.json
python dossier.py export --manifest <new-example-directory>/manifest.json --output <new-handoff-directory>
python dossier.py check-bundle --manifest <new-handoff-directory>/portable-manifest.json
python -m unittest discover -s . -p test_dossier.py -v
```

真实输入沿示例字段维护：`manifest.json`声明game_id、dossier_id、allowed_root、domain_baseline（完整names、来源sha256、snapshot_ref及其sha256）、domains、sources、assets、cases、claims、documents/document_hashes、dossier_ref、coverage_status、unresolved及显式export_roots。路径相对manifest；不要将秘密、账号、存档或未授权第三方素材放入导出根目录。每个来源记录实际read_status/read_scope，资产绑定source_id与哈希；case声明证据类型、所需媒体及实际连续性；claim保留version_groups、conditions、limits和support_status。

返回请求明确game_id、claim_ids、caller_ref、question；有版本约束时提供allowed_version_groups。返回绑定原报告哈希、原manifest哈希、递归证据闭包、本批状态、整作状态、未决和去向。未知结论、错误身份/版本、未接受/未读证据及依赖环不得伪装成通过。返回的adoption仅表示已返回，调用者另记实际采用与结果。

export只复制明确的研究交付根，不隐含素材公开授权；收件者使用check-bundle核对文件全集、哈希与编辑链接。默认交文件夹，ZIP沿用户要求。字节完整不证明语义正确、完整观看、亲玩或跨游戏效果。原始来源与许可继续由原权利人拥有。
