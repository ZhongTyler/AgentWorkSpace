# 可选渲染约定

只在已选同稿HTML/PDF时读取。脚本不提供自动解释、图形设计或事实判断；不能用其有限块类型约束更适合的其他报告。

输入UTF-8 JSON：

```json
{
  "schema": 1,
  "title": "研究讲解标题",
  "subtitle": "版本与用途",
  "short_title": "页眉简称",
  "edition": "版本；证据截止日期",
  "reader": "谁在什么情况下独立读，要理解什么",
  "sources": {
    "original": {"label": "原研究", "path": "../original.md"}
  },
  "sections": [{
    "id": "context",
    "title": "本节要形成的认识",
    "subtitle": "本节回答的问题",
    "reader_goals": [1],
    "references": ["original"],
    "blocks": [
      {"type": "p", "text": "独立解释，不只是一条来源链接。"},
      {"type": "flow", "items": ["输入", "动作", "后态"]},
      {"type": "note", "text": "适用条件与不知道的事。"}
    ]
  }]
}
```

块类型：p/note的text；flow的非空items；image的src和caption；table的headers、rows、可选合计为1的widths；links的items为`[显示文字, source键]`数组。source可为本地path或公开https URL。本地路径相对于输入稿，脚本不联网、不执行来源内容。PDF按节分页，篇幅溢出可能自然增加页数，要实际检查而非默认一节一页。

```text
python render_report.py explanation.json --out guide --format html
python render_report.py explanation.json --out guide --format both --font /absolute/path/to/font.ttf
```

PDF分支依赖ReportLab与Pillow；字体需支持正文文字，TTC使用第0个子字体。按环境选已有字体，不打包未知许可字体。先执行可用PDF技能要求的操作标记，再第一次实际PDF制作；用Poppler等渲染所有页检查。脚本不会替代这些步骤。

输出：index.html（图片内嵌、无脚本/CDN）、reading-guide.pdf、build-receipt.json。相同输入/字体/依赖的本次实测可重复生成相同载体字节；跨版本不保证。收据保留源文件、图、解释稿和渲染器哈希，非远程网页内容快照、事实审计或读者效果证明。网页原研究链接相对于输出文件夹；PDF本地来源用可查找路径显示，不写绑定本机盘符的链接。可选source.reader_path给相对原档案的短路径，须在讲解稿交代档案根的位置；缺省显示相对PDF路径。PDF正文/图片可单独转交，查阅本地原件仍需原档案目录。

用原稿重新生成，不分别手改两个派生载体。失败输出在核验前不作正式交付；可以选择HTML-only避免PDF依赖阻断阅读。此渲染器的14节真实试产只覆盖图解讲义分支，演示、视频与交互分支没有被它验证。

## 完整图解主线，只生成HTML

`render_visual_html.py`复用`render_visual.py`的SVG图形和总分总story，供已选单份HTML的完整报告使用，不经过PDF排版。story含title、edition、intro、source_hashes、reference_titles、evidence_reader、chapters、scenes；章节和scene.role沿hierarchy。scene含id/title/lead/takeaway/refs/claims/limits；无必要图时visual可省略或kind=none。

```text
python render_visual_html.py story.json --out work/visual
python render_book.py book.json --out work/detail --format html
python assemble_html.py assembly.json --out reader
```

新增的HTML视觉形式按真实任务选择：

- `evidence_sequence`：steps逐个给title、image_path、image_sha256、alt、caption、locator；可选image_size和crop `[x,y,width,height]`。crop只改变CSS观察窗口，原图字节保持。markers的label与at `[x百分比,y百分比]`对应当前显示窗口，图注/正文同时解释标记，不能只靠颜色或悬浮。
- `spatial_states`：basis明确原图重建、规则推演或示意；states含title/alt/caption/rows，单元格含label与可选tone（neutral/danger/accent/info）。它可表示局部空间或一组对齐检查点，须说清位置/列的含义，不把示意伪装成实际棋盘或连续数据。
- `depth_map`：data条目含title/scope/limit/level；level=boundary仅改变边界栏外观。它表达深浅和空白，不产生研究覆盖判断。

原图在目标尺寸过小，应为主解释选局部窗口或原生数量/关系图，完整原图留同页证据与放大。图注多行时高度按实际行数计算；检查SVG文字包围盒和浏览器显示，不只检查页面横向溢出。`test_render_visual_html.py`覆盖所实现的输入拒绝和HTML依赖边界，真实报告仍要在浏览器核验。

`compare`默认表达并列条目，使用项目符号；确需每栏内部先后关系时才显式设`data.ordered=true`并核对来源。目录按章形成视觉组，首项不与外层重复画线。`test_diagram_layout.py`包含种子生成的文字保留/宽度不变量和具体图形语义检查，不依赖Hypothesis；它不替代实际字体、目录展开、箭头压字和跨尺寸排版核验。
