# 固定组件与使用者安装

这是可审阅的手动恢复合同，**没有经过全新Windows机器联网安装验证，也不是一键安装承诺**。包升级/回滚只管理源码；外部home、模型、项目图像和客户端配置由使用者保管。安装和下载需使用者授权，不能因为包已安装就启动。

1. 在包外新目录准备Tools home。CPU/Pillow调用环境可使用Python3.12；生成环境采用flux-klein/source-lock.json的Comfy0.39.0精确commit、Torch2.9.1+cu128/torchvision0.24.1+cu128和requirements-windows-py312.lock。审阅官方源与许可证后安装依赖；本包不执行网络脚本、不升级既有共享环境。
2. 将锁内Comfy archive按SHA校验后安全解压为integrations/flux-klein/runtime/ComfyUI-<commit>；将此真实绝对路径写入同runtime/source-path.txt。Python在runtime/venv/Scripts/python.exe。按flux-klein/source-lock.json的三个models行下载官方固定revision并校验字节数/SHA，放到该Comfy目录下对应models路径。仅安装三组件，不恢复旧BF16编码器。
3. Anima/Z按image-extension-suite/source-lock.json中G/H行的model/revision/path构造官方HuggingFace resolve URL。校验size/SHA；去掉path前缀split_files/，放入image-extension-suite/runtime/models/。没有复制历史LayerDiffuse、Sprite、RefControl或其他未采用大权重。Anima权重条款与离线生成图片商用授权分开审阅；本组合不授予收费模型服务/商业运行时生成资格。
4. CPU抠图按cutout的锁和固定依赖安装，Python位于cutout/runtime/venv/Scripts/python.exe。Pillow负责确定性遮罩合成、规范化与预览。BiRefNet是额外可选环境：按其模型revision取source_files中的五个文件，逐个验SHA放runtime/source；按official_url验权重放runtime/model.safetensors。独立venv装适配Torch、numpy、Pillow、safetensors、accelerate、timm、einops及锁内源码实际导入依赖；不要盲装上游旧Torch要求覆盖生成环境。其完整依赖重建尚需使用者验证。
5. 可选Real-ESRGAN：按锁archive_url取得官方Windows NCNN/Vulkan便携包，校验archive_bytes及archive_sha256_measured，安全解压至realesrgan/runtime/portable，验exe及两个所用模型的SHA。上游无单独发布者校验签名；该SHA是维护者对官方下载的测量。保留上游许可/依赖通知，不把包的MIT授予第三方模型或程序。
6. 在新home做toolbox health --integrity（维护源）和local-image health --integrity（实际模型）。缺模型应明确失败；不要伪造runtime通过。资源有余量后先单张，无自动改系统设置。再用本地PNG测试只加工、恢复和审图，最后才评估真实项目采用。

源码锁是恢复身份，不是已经安装或许可永久有效的证明。模型/参考角色、字体和素材的权利另审。运行输出、提示词、凭据和批次数据不得写到受管modules内。

清理属于研究收尾的条件动作，不是本包授予的删除授权：采用且有调用方的依赖保留；未采用专属大文件先核对消费者、进程、并行owner与共享依赖，保存来源/revision/SHA/许可、报告和恢复方法，再由宿主批准精确删除计划。保留原文、输入输出、失败、评分及已采用资源。不要按文件年龄定时扫盘、自动删用户数据或恢复被清理的备选。
