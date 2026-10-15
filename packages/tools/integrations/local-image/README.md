# 本地素材统一入口

按需、离线、有人审图：FLUX.2 klein4B通用道具/背景/参考编辑；Anima Turbo1.1离线动漫角色/卡面；Z-Image-Turbo中文场景与文字概念。加工按缺口选择CPU抠图、BiRefNet替代、明确遮罩合成和可选Real-ESRGAN。源图、加工版、采用版分开；技术成功不表示合格、权利已清或项目已采用。

先从Tools包运行prepare_home.py准备新的包外版本目录，再读[安装恢复](setup.md)配置需要的固定组件。没有权重、运行环境、账号或自动安装。Windows Python3.12、适配的NVIDIA GPU驱动；CPU预览/已有PNG规范化只需Pillow。主机能力需要使用者实测，不能继承维护者连接或性能证明。

在外部Tools home运行：

```text
python toolbox.py request --workflow local-image --tool local-image --action run
python toolbox.py run --workflow local-image --tool local-image --action health -- --integrity
python toolbox.py run --workflow local-image --tool local-image --action run -- --request <spec.json> --output <new-external-batch>
```

schema1每批1–64项；每项id/profile/prompt/width/height/seed，选填source（已有PNG，不启动生成器）、reference（仅FLUX）、mask＋original、target_size、cutout、upscale。示例example.json。按模型分组，先少量代表图确认风格和真实尺寸再扩批；准确中文字优先独立文字层。一般一次有界返修，失败回原图/人工/规格，不反复抽图冒充合格率。

完成partial后原请求加--resume恢复同批，成功步骤核验输入/输出哈希后不重算。变更、孤立输出和失败不覆盖；重试写新批次并关联原失败。进程留下owner时先核对PID、身份、输出与收据，不能自动抢锁。单重模型、专属回环8211、只结束本次子进程；没有MCP、云外发、页面文件修改或关闭其他应用动作。

安装后的game-presentation包可用其adapters/local-image/prepare.py制作实际尺寸深浅底审图工作台，输出默认未采用、权利未审核；审核后再走宿主原交付。缺该包时按宿主已有审图路径处理，不强制新增包。

启动最低可用物理/提交各5GiB、空闲GPU8GiB；运行物理<2GiB、提交<1GiB、GPU used≥12000MiB或free<256MiB即停止。BiRefNet另需10GiB提交。最低预检不是运行保证；先单张观测当前桌面负载，不能把显存空闲等同于提交余量。[测试限制与未采用原因](../../docs/local-image-validation.md)随包保留。
