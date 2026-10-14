# 可选CPU插画抠图候选

本工具使用固定SkyTNT anime-seg ONNX模型预测前景alpha；代码、依赖锁和模型身份随Tools保存，权重与Python环境不附带。安装包不下载、不启动推理、不外传图片、不注册MCP，也不把结果自动送入项目。

先在Tools包根运行prepare_home.py，选择全新的包外home。随后用Python3.12在本工具runtime/venv建立独立环境，安装[依赖锁](requirements-windows-py312.lock)，按[source-lock.json](source-lock.json)的官方URL显式下载isnetis.onnx到runtime，核对长度与完整SHA-256。运行前核查原图使用授权。

在外部home的本工具目录执行：

```text
runtime/venv/Scripts/python.exe -X utf8 -B verify.py --integrity
runtime/venv/Scripts/python.exe -X utf8 -B cutout.py <authorized-opaque-input.png> <new-output.png>
```

verify只读库存、依赖和可选哈希，不加载模型或联网。推理固定CPUExecutionProvider；输出RGBA、同名.mask.png和JSON收据，任一已存在就拒绝覆盖。RGB原样保留，只预测alpha；已有原生alpha的素材跳过本工具，保留原图。

只作为加工候选：封闭孔洞可能残底、细叶可能被删、玻璃光学透明不等于外轮廓分割。对白/深背景、实际显示尺寸与孔洞细节实际检查，失败回原图或人工蒙版；alpha统计不代表质量验收。接收者硬件、效果和依赖需自行验证，本包不继承维护者样图、时间或采用结论。

模型与上游代码标注Apache-2.0，ONNX Runtime为MIT，其他依赖保留各自许可；官方模型和源码出处见锁。适配代码沿Tools包许可，不覆盖参考素材权利。升级时保留旧lock和环境，以细茎、毛边、孔洞和玻璃难例复验；包升级/回滚不覆盖外部home、输出和独立依赖，仍不改变项目决定。
