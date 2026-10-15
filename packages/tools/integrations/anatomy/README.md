# Anatomy · 按需原理解释

帮助用户理解概念、结构、运动与过程的可选SVG/HTML工具。优先文字和简图；空间关系、状态变化或动手探索有实际价值时再用。适合给当前用户解释，不要求对外制作内容；技术可用不代表理解率或节时已经验证。

## 准备与调用

先从Tools包根运行 `python prepare_home.py --home <全新包外版本目录>`。安装包不会解压、联网、注册Skill/MCP或启动服务。进入新home后：

```text
python integrations/anatomy/anatomy.py restore
python integrations/anatomy/anatomy.py status --integrity
python integrations/anatomy/anatomy.py guide
python toolbox.py run --workflow explanation --tool anatomy --action example -- --output <全新包外输出目录>
```

Python3.10+；样例构建另需Node20.10+。restore只从本地固定归档核验并解压，已有runtime拒绝覆盖；禁止在managed modules或事务目录恢复运行文件。example只运行固定dial-indicator浅色样例构建，不接任意命令，已有输出拒绝覆盖，输出也须在modules/事务之外。构建成功不自动开浏览器；用宿主允许的本机预览打开生成的HTML并实际操作。不得因上游技术指南降低宿主浏览器安全设置。

guide返回固定上游SKILL.md及本说明位置；Agent按需要读取相关reference/样例并使用kit针对问题制作。固定样例不是任意概念一键生成器。登记的explanation/research调用仍需当前任务范围允许；Skills包中的dual-layer-explainer只是可选方法，不是Tools的强制依赖。自然表达“用交互模型给我解释X”即可由Agent判断。

## 表达与验证

文字、图示、运动和读数尽量使用同一个机制模型。核对真实结构、参数、条件与反例，区分类比和事实；允许简洁SVG/HTML和必要标签，不把上游至少40部件或机械风格推广为所有任务要求。实际打开、操作与恢复，检查关键画面；画面能运行不证明科学正确或用户已理解。不可用或准备成本过高时继续原文字/简图方式。

视频仅在声音或顺序讲解有用、或用户明确要求时追加。当前没有完整制片/配音接口或效果验收，不自动调用云TTS、付费、外传、发布或修改用户项目。新增图片、字体、声音与第三方服务分别核对许可和权限。

## 固定版本与恢复

[source-lock.json](source-lock.json)固定wheresryan22/anatomy的完整147文件清单与哈希（仓名以锁中的URL为准），revision `bc943e40c59998be5da61f9d39c6a983b1116099`；[MIT原许可](vendor/LICENSE.txt)随约2.85MiB源码ZIP保留，恢复约11.72MiB。无模型权重、账号、维护者连接或私人研究记录。上游技术指令不扩大宿主授权。

升级另建新版本包外home，核查归档、许可、样例和真实用途，再显式切换调用方；保留旧home供恢复。包/选定Skill回退不删除外部runtime、用户输出或第三方客户端设置。源缺失、损坏、Node不可用时回原解释，不自动下载latest或反复启动。测试入口是 `python integrations/anatomy/test_contract.py`；它验证恢复/拒绝边界，不证明学习效果、完整上游几何审计或视频产出。
