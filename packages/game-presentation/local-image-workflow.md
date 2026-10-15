# 本地素材制作与审图

可选Tools包的local-image入口提供FLUX通用、Anima离线动漫、Z-Image中文概念三个固定profile，以及CPU/BiRefNet抠图、明确遮罩合成和按需Real-ESRGAN。没有Tools或模型时可继续规格和已有PNG交付；不可声称已生成，不自动改用云端。

规格（用途、真实尺寸、风格、计数/文字、透明、不可变区域、参考权利）→少量代表图→源图审查→一次有界返修→按需加工→深浅底/实际尺寸审图→制作人采用→原交付与引擎验证。源、加工、采用与运行副本分开，不覆盖项目现有资产；固定seed不能保证身份一致。文字层、alpha和放大分别检查，抠图不能掩盖结构错误。

Tools需先按其prepare_home.py准备包外home，再审阅并安装固定运行依赖；本包没有权重或安装授权。其source-only路径能规范化已有PNG；真实生成需对应GPU、物理/提交余量。普通5GiB物理/提交、8GiB空闲GPU只是最低预检；BiRefNet提交10GiB。运行触停止线停本任务进程，不关闭其他任务或修改页面文件。恢复同批必须验证输入/输出哈希；失败不覆盖。

候选批次完成后，用Pillow Python准备审图工作台：

```text
python adapters/local-image/prepare.py --batch <external-batch/batch.json> --output <new-external-review>
```

打开新目录index.html，按实际像素看深浅底和完整原图；窄窗口允许横向滚动。generation.json保留原源图，加工候选单独记录，默认rights_verified/project_adopted/adopted均false。它只准备审核，不修改引擎；确认后再用既有工作台receive/generated及seal/publish流程，不能把消费收据当采用。

维护者环境曾贯通八张三profile素材、加工/恢复与浏览器消费，但计数、文字、裁切仍有失败。重启回原8/16GB页面文件配置后FLUX与SANA发生提交不足，不承诺繁忙桌面长批稳定。新增CPP省显存但未过质量门；SDXL/IP原配方及一次修复未显示足够增量；SANA资源停止，质量和FLUX协作未评，三项均不作为默认工具。完整公开限制位于Tools包docs/local-image-validation.md，私人实验原图/日志不随包分发。

Anima离线图片用途与模型商业运行限制分开审阅；其他模型、参考角色/字体权利仍需核查。TRPG/ADV先预生成、缓存、异步补图和旧画面回退，实时生图/身份连续性/真实游玩没有本批验收。实际项目规则和采用决定仍由宿主拥有。
