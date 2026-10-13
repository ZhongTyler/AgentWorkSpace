# 本地媒体辅助

采用原生字幕/浏览器画面 + 本地OCR的轻量组合。字幕可取得时不另跑ASR；OCR供查找、转录候选和坐标定位，图形关系、条件、数值与动画仍须实际核对。工具不生成Knowledge的审核PASS。

网页采集不依赖扩展：`python integrations/media/capture.py --url <公开网址> --selector <唯一正文容器CSS> --output <空目录> --download-images` 保存原HTML、正文HTML/文字、canonical URL、作者/日期元信息、链接、图片原文件及SHA-256。此工具已在GameRes905305实跑，8,214字符、20/20原图保存成功，图片哈希与已逐张读过的底本全部一致。它只读取公开HTTP内容，不携带账号/Cookie，不是SingleFile式完整渲染快照；动态/登录页面用原生浏览器读取并检查分页、折叠、懒加载与必要媒体。首次沙箱运行DNS失败，允许联网后同一输入成功；不能把DNS失败算站点不可读。

Windows / Python3.12本轮隔离实测：RapidOCR ONNXRuntime 1.4.4 + imageio-ffmpeg 0.6.0 + BeautifulSoup 4.14.3。完整依赖/模型目录约354.5MB；29张静态输入OCR合计26.3秒（CPU、4线程），未计安装、阅读与人工校对。这是单批结果，不是准确率或其他机器速度承诺。

安装到本目录的 `runtime/`：`python -m pip install --only-binary=:all: --target integrations/media/runtime -r integrations/media/requirements-windows-py312.lock`。这是本轮可复现版本快照；跨平台/其他Python版本未验收，先在新隔离目录检查，不覆盖已有环境。依赖由[PyPI](https://pypi.org/)取得，不执行网上安装脚本；运行时、个人捕获和模型缓存不进发行包。

`python integrations/media/ocr.py --output <空目录> <图片路径...>`：原图不改，静图保留OCR框/文字/置信度；GIF抽取首、中间分位、末帧，输出帧号与时间位置，不能把首帧空白当整个动画无内容。重要动作还需连续播放或加密采样；不以五帧保证覆盖所有动画。

本机FFmpeg通过 `imageio_ffmpeg.get_ffmpeg_exe()`定位；只处理已取得的本地合法媒体。YouTube本轮浏览器直接下载失败，关键帧改走实际页面定位/播放/暂停/截图，核对正片身份、实际时间、解码状态与图义。不重试相同失败下载，不以字幕时间已跳转等同画面已加载。

[yt-dlp](https://github.com/yt-dlp/yt-dlp)可在确需取得可访问媒体时再选；[faster-whisper](https://github.com/SYSTRAN/faster-whisper)作为无字幕且有合法音频时的CPU int8备选。本轮没有安装或运行这两项，没有ASR准确率/耗时验收。现有字幕导出已补足此次任务，重复的YouTube转录MCP暂不安装；未来遇实际缺口再测。
