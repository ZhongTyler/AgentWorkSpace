# FLUX.2 klein 4B · 可选本地候选素材工具

提供固定ComfyUI版本、三个模型组件的官方URL/长度/SHA-256、Windows Python3.12依赖锁、显式启动/停止、生成/参考编辑和只读校验。安装Tools包只交付维护代码与锁，不下载权重、不安装GPU依赖、不启动服务、不注册MCP，也不把生成结果自动加入项目。

先从Tools包根运行`python prepare_home.py --home <external-tools-home>`，在全新包外home操作。不要在modules中安装或写runtime。工具恢复需Python3.12、适配CUDA/cu128的NVIDIA环境和足够内存/磁盘；活跃模型文件共8.255GB，磁盘大小不等于显存需求。Windows基础生成和参考编辑曾在维护环境小样试跑，接收者必须自行验证，不能保证任意12GB显卡、分辨率或批量稳定。

## 显式准备

1. 阅读[source-lock.json](source-lock.json)。下载固定ComfyUI源码归档，核对archive_sha256，展开为`runtime/ComfyUI-<commit>`，把绝对目录写入`runtime/source-path.txt`。版本为0.39.0，源码commit以锁为准；不执行网络脚本或追latest。
2. 在本工具`runtime/venv`建立独立Python3.12环境，从官方cu128索引安装`torch==2.9.1+cu128`与`torchvision==0.24.1+cu128`，按[依赖锁](requirements-windows-py312.lock)安装其余依赖。模板媒体库不属于基础API验证范围。
3. 按锁中official_url显式下载FP8生成器、FP4编码器和VAE，放到锁定的models路径；核对每项长度与SHA-256。默认无需旧BF16编码器。权重与上游源码不随本包附带。
4. 在外部home的本工具目录运行`python verify.py --integrity`。这不加载模型或验证图像质量；安装完成后再按明确任务启动和实测。

## 按需使用

```powershell
& ./start.ps1
# 核对本次/system_stats返回的精确源码入口与版本。
python -X utf8 -B generate.py --prompt 'A single brass key, plain ivory background, no text' --width 768 --height 768 --seed 102
python -X utf8 -B generate.py --prompt 'Change daylight to night; preserve camera and furniture' --width 768 --height 768 --reference '<authorized-image.png>'
& ./stop.ps1
```

仅监听127.0.0.1:8199，关闭自定义和云端节点；拒绝忙队列或身份不符的监听者。停止只匹配本工具固定源码的进程。默认4步Euler和FP4编码器，每项任务保留工作流、失败、输出哈希与端到端收据，输出不覆盖旧图。全卡GPU采样不等于进程独占占用；耗时不包含服务启动和人工筛图。OOM或服务失败保留现场，先确认本服务状态，不自动关闭其他模型。

将它作为道具/背景候选和参考返修的可选路径。先固定用途、尺寸、不可变项，再检查主体一致性、局部瑕疵、小尺寸可读性及所需透明度；当前没有原生透明输出或自动抠图承诺。项目决定和资源权利由宿主负责，真实游戏采用、百张稳定、实时ADV和跨平台运行仍未验收。

## 许可、升级与恢复

维护适配代码沿Tools包许可；固定ComfyUI为GPL-3.0，锁定4B生成器和两个组件仓标注Apache-2.0，具体代码、权重和参考素材条款分别核查，不能用本包MIT覆盖上游。官方出处及精确版本在锁中。未随包再分发ComfyUI源码或模型权重。

依赖、权重、输入、输出、日志和收据均在外部home的runtime。包升级/回滚不迁移或覆盖它们；需要更新时建立新版本home、重新核查锁及生成/编辑/内存/回退，再切换使用。客户端配置和其他模型进程保持原owner。本工具不增加常驻任务或自主生成授权。
