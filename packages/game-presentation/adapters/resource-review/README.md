# 资源图册与状态组合

按[资源审阅流程](../../resource-review.md)接收宿主项目的裁框、目标尺寸和状态场景。输出独立PNG、各尺寸预览、实际资源组合和可独立打开的图册。

生图原件保持原字节。工具按明确裁框裁取和归一已有位图，以浏览器的预乘透明通道与高质量采样输出尺寸版本。项目场景通过同一组图片和实时文字/标记图层合成。

```powershell
node modules/game-presentation/adapters/resource-review/build.cjs --root <项目根> --manifest <项目内JSON> --output <新的工作目录> --browser <Chrome路径>
```

依赖当前环境已有的Playwright和Chrome，支持`--playwright`指定模块位置。工具在headless环境执行。输入路径必须留在项目内并匹配SHA256，输出写入指定的新目录。

图册默认包含实际尺寸、深浅与场景底、独立图像、控件状态组合、完整场景和裁框检查记录。图片与绘制脚本内嵌，图册单独复制后仍可审阅。采用、引擎安装与发布沿宿主原流程办理。

## 目录

无下级目录。

## 检查

```powershell
node modules/game-presentation/adapters/resource-review/check.cjs --root <项目根> --manifest <项目内JSON> --output <工作目录> --browser <Chrome路径>
```

检查真实输出哈希、单HTML离线加载、图册/PNG组合一致、各尺寸/底色和审阅文本。可通过`--reject-crops <项目内JSON>`复验已知错误裁框会被拒绝。每个独立资源须声明`require_edge_clear:true`，铺底等完整出血图明确`edge_policy:full_bleed`。

项目全资源图册接收构建器的--images-only输出，只新增媒体和组合及构建收据，gallery_sha256为null，统一HTML由项目入口拥有。
