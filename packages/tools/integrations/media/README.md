# 本地媒体辅助

采用原生字幕/浏览器画面 + 本地OCR的轻量组合。字幕可取得时不另跑ASR；OCR供查找、转录候选和坐标定位，图形关系、条件、数值与动画仍须实际核对。工具不生成Knowledge的审核PASS。

网页采集不依赖扩展：`python integrations/media/capture.py --url <公开网址> --selector <唯一正文容器CSS> --output <空目录> --download-images` 保存原HTML、正文HTML/文字、canonical URL、作者/日期元信息、链接、图片原文件及SHA-256。此工具已在GameRes905305实跑，8,214字符、20/20原图保存成功，图片哈希与已逐张读过的底本全部一致。它只读取公开HTTP内容，不携带账号/Cookie，不是SingleFile式完整渲染快照；动态/登录页面用原生浏览器读取并检查分页、折叠、懒加载与必要媒体。首次沙箱运行DNS失败，允许联网后同一输入成功；不能把DNS失败算站点不可读。

Windows / Python3.12本轮隔离实测：RapidOCR ONNXRuntime 1.4.4 + imageio-ffmpeg 0.6.0 + BeautifulSoup 4.14.3。完整依赖/模型目录约354.5MB；29张静态输入OCR合计26.3秒（CPU、4线程），未计安装、阅读与人工校对。这是单批结果，不是准确率或其他机器速度承诺。

安装到本目录的 `runtime/`：`python -m pip install --only-binary=:all: --target integrations/media/runtime -r integrations/media/requirements-windows-py312.lock`。这是本轮可复现版本快照；跨平台/其他Python版本未验收，先在新隔离目录检查，不覆盖已有环境。依赖由[PyPI](https://pypi.org/)取得，不执行网上安装脚本；运行时、个人捕获和模型缓存不进发行包。

`python integrations/media/ocr.py --output <空目录> <图片路径...>`：原图不改，静图保留OCR框/文字/置信度；GIF抽取首、中间分位、末帧，输出帧号与时间位置，不能把首帧空白当整个动画无内容。重要动作还需连续播放或加密采样；不以五帧保证覆盖所有动画。

本机FFmpeg通过 `imageio_ffmpeg.get_ffmpeg_exe()`定位；只处理已取得的本地合法媒体。YouTube本轮浏览器直接下载失败，关键帧改走实际页面定位/播放/暂停/截图，核对正片身份、实际时间、解码状态与图义。不重试相同失败下载，不以字幕时间已跳转等同画面已加载。

[yt-dlp](https://github.com/yt-dlp/yt-dlp)可在确需取得可访问媒体时再选；[faster-whisper](https://github.com/SYSTRAN/faster-whisper)作为无字幕且有合法音频时的CPU int8备选。本轮没有安装或运行这两项，没有ASR准确率/耗时验收。现有字幕导出已补足此次任务，重复的YouTube转录MCP暂不安装；未来遇实际缺口再测。

## 已授权小红书媒体 · 2026-10-15

`capture_xhs_media.py --output <空目录>`从标准输入接收当前已授权详情中的选定文件描述，不自行登录、读取Cookie、搜索或解析站点。输入含note_id、files（name/url）、video_size及video_metadata；Agent在内存中选择原语言字幕和MP4后直接传入，短时签名不进命令参数文件、报告或收据。只允许官方CDN/小红书子域名，HTTP仅升级同一路径/查询到HTTPS；重定向仍核域名，完整200响应、文件头/字节数/哈希与字幕时间码均核查。目录已有内容则拒绝覆盖，失败可能留下已成功文件，不能把半批当完成。

单视频实测：有界MCP取得正文和媒体 → 下载720p MP4音画11,571,595字节及原语言中文字幕3,764字节 → 本地完整解码通过 → 读取39段字幕并看17个关键帧。1080p fMP4虽有完整画面但没有音轨，保留作精细抽帧来源；不能按分辨率最高就认定完整音视频。平台source/zh-CN两条字幕字节相同，只计一份证据；字幕中的工具名误识别须以画面/一手仓库校对，人工/自动来源未核实，不宣称逐字准确或完整连续观影。本例无额外ASR、付费服务或云端转录。

媒体原文件留本机忽略的 `runtime/captures/`，宿主只保存稳定来源、版本、哈希、必要图义和消费结论；移交Knowledge时再沿其Clippings/Raw合同处理，不另造知识库。当前只验收一个指定视频，不能推断所有视频、无字幕视频或分片都已支持。
