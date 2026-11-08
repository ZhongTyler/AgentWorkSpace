# 维护已有HTML报告的局部表达

适用于已有文字研究主本和人读HTML的维护。深拆中README／units是文字研究报告，study.json是同源编写底稿；HTML是人读呈现。新增或改进机制解释、案例步骤、比较和边界都先回底稿／文字，即使没有新事实。普通网页不必迁入深拆接口。

## localhost主验收与本地文件简查

浏览器工具明确允许访问本机服务时，可用localhost完成HTML的主要视觉与交互验收，再检查本地文件访问的差异。工具若已明确禁止通过替代入口访问本地文件，继续沿其限制处理，保留受限范围或使用用户反馈；切换URL不改变访问权限。

1. **提供同一份成品。** 静态服务直接读取正式HTML及已声明依赖，保持文件字节；仅绑定本机回环地址并限定报告目录。核对HTTP响应体与磁盘文件的SHA-256，有传输压缩时比较解压后的字节；分离资源同时核依赖身份。内容一致与浏览器同源策略分别判断，HTTP和file使用不同Origin。
2. **完成主要检查。** 记录实际浏览器、窗口尺寸和缩放，按原验收范围检查图表、文字、目录／领域、浮层、键盘和媒体等本次受影响行为。比较两种访问方式时对齐环境和阅读状态，结果复用仍按改动范围判断。
3. **简查本地差异。** 通过file打开同一成品，检查资源加载、目录与领域跳转、前进后退及当前实现使用的偏好保存／恢复。涉及外部分文件、fetch、模块、媒体或存储时，定向核本地访问行为。资源内嵌、逻辑不变时可缩小检查范围，保留有效的原用户反馈。
4. **如实绑定回执。** 在现有页面回执的scope与证据中分别说明HTTP和file的实际访问方式、当前文件身份、检查范围与结果。仅完成localhost验收时，file仍记未验；交付是否满足要求沿宿主约定判断。继续使用原页面门，按工具／用户实际检查填写，验收后关闭本批专用服务。

文件字节相同能支持复用大部分排版与交互结果；file的来源、资源读取和localStorage行为仍需对应检查。浏览器规则见[同源策略](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy)与[localStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage)。

## 文字档案的两条阅读路线

README在整体总览后提供“按领域查阅”和“按系统／章节顺读”，直接链接已有完整单元及必要案例。领域使用本作实际研究到且有用的选择与顺序，后台覆盖表继续查漏；不强凑领域数。较大档案可按systems/、cases/分章，轻量档案保留连续正文与units/分节，二者均能从领域入口读到同一份完整内容。共享内容只写一次，不另生成一套同义领域正文。

原目录层级按内容复杂度选择，文字和HTML可以采用不同讲解顺序。统一编译器从已编领域路线及章节布局生成文字导航；需要单独文字分组时用study.text_toc，沿toc_layout的grouped格式，所有分节必须按原顺序恰好出现一次。审计同时检查文字入口是否存在、领域阅读顺序与正文是否相符、完整章节和案例是否可达；HTML领域页签或manifest字段存在不代替文字查阅完成。

## 先判断改的是什么

- **解释内容**：先改study，由原编译器生成README、units和投影，更新manifest与导航来源绑定；保留HTML有用图解并做文字／HTML双向复核。不能以研究素材未变为由跳过文字同步。
- **纯呈现**：导航、播放器、排版和视觉强调不增加独立研究解释时，可用下述reader-only工具。此项分类由编辑／审计判断，脚本不代判语义。
- **补齐旧HTML独有解释**：可以回写文字并复用已审HTML，前提是当前内容对应已核、绑定精确版本；只有来源元数据改变且其余HTML字节一致时，沿用原页面验收，不要求用户重验不变操作。

声明了explanation_targets的深拆分节，沿evidence/explanation-bindings.json绑定当前study、README、分节及对应HTML组件。原workflow同源检查核映射和版本；过期主本、漏节或组件被普通build抹掉都会失败。这个文件不代签内容审核，语义仍需双向对照。

## 共用入口

纯呈现维护用[scripts/enhance_reader.py](../scripts/enhance_reader.py)，不按案例复制整份适配器。它读取已审HTML，在隔离副本中包装已有原视频、调整控件／样式，再复用宿主导航与检查器；不新增研究讲解，也不重编译文字。语义改变使用上节文字主本路径。

每批在原任务旁新建run，保存plan与必要CSS／JS。先读实际结构与schema。reader-only要求change_kind=presentation_only且edits为空；旧append／replace_flow语义计划不再执行，应迁回文字主本。media_observer只为已有原视频复用控制。脚本只接收本地可信制作输入。

```json
{
  "report_id": "当前navigation.json中的ID",
  "change_kind": "presentation_only",
  "edits": [],
  "css": ["reader.css"],
  "scripts": ["reader.js"],
  "media_observer": false,
  "expected_videos": 0
}
```

在宿主根执行，解释器按当前环境选择：

```text
python -X utf8 -B <skill>/scripts/enhance_reader.py capture --report <报告目录> --run <本批run>
python -X utf8 -B <skill>/scripts/enhance_reader.py build --report <报告目录> --run <本批run> --stage <新的隔离目录>
python -X utf8 -B <skill>/scripts/enhance_reader.py publish --report <报告目录> --run <本批run>
```

capture不覆盖旧基线；build失败不改变原报告。原文件集合、未选分节、媒体和旧脚本均受保护，唯一可发布文件是`reader/index.html`与`reader/navigation.json`。输入、候选或原报告漂移会阻断发布；发布有备份、单文件原子替换及失败恢复。CLI复用宿主的run锁与报告锁，记录实际动作耗时，不接管语义审核或Knowledge写入。旧锁、待发布文件或恢复备份存在时先查owner，不删掉重跑。

## 核验与版本

- 用当前生成HTML检查脚本确实存在、完整解析并初始化，不能只检查独立JS文件。省略body关闭标签、附加属性、多视频实例及导航选择器作用域要按实际输入处理。
- 新表达核同一数据／单位／版本；播放器核素材字节、多个实例相互独立、控件与媒体状态同步。稳定未变组件的全套测试可以复用，本报告仍需验证实际接入。
- 生产控制代码变化时运行[test_enhance_reader.py](../scripts/test_enhance_reader.py)。它覆盖基线、路径、错误身份、候选漂移、失败恢复和重复发布；合成夹具只证明控制边界，实际报告构建与页面另验。
- 内容与页面回执、冻结及Knowledge增量门继续由宿主workflow管理。既有manifest和单元不变时，关联owner核对精确身份、入口和关系后复用旧接受／查阅证据，不重做全库关联。旧冻结不自动代表新reader。
- 成稿、审计和页面反馈已通过时停止扩展形式。向用户交付本地HTML时用不带片段定位的文件链接，并说明目录条目；报告内部目录与领域锚点保持正常跳转。

构建输入与当前维护工具版本分别记录。工具修正不改变产物时，保留原构建回执，用新工具从精确原基线重建并对比字节；不改旧记录伪造当时使用了新工具。更多跨案例复用并不能只由两篇成功推定，后续按实际新输入验证，不预建覆盖全部报告的平台。
