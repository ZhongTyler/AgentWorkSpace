# Windows 构建

当前无试玩版本。先确定引擎版本和目标平台，再建立项目专属构建入口；模板不附带游戏EXE、PCK、导出模板或虚假的可运行快捷方式。

## 目录

- [packages/](packages/README.md)：可分享的独立版本文件夹和同名ZIP。
- [packs/](packs/README.md)：需本机引擎运行的候选PCK。
- [archive/](archive/README.md)：历史运行包、原启动器与恢复说明。

[layout.json](layout.json)拥有当前版本和启动文件身份。首次实际包验证后，填入current_release与current_executable，在本目录建立play.cmd，再在项目根建立唯一play.cmd路由它。尚无包时两字段保持null，不生成启动器。开发演示放[maintenance/previews/](../../maintenance/previews/README.md)。

生成包不进Git；目录README、布局配置、构建脚本与验证记录受版本管理。不要在项目根或本目录平铺EXE、ZIP、PCK及多个启动器。复制模板后即使没有本地包，健康检查也应通过；真正可分发必须另做实际包验证。
