# REA：按需发行产物研究

REA 是分析工具，适用于发行包、ASAR、JavaScript/Electron 产物和源码缺失的具体机制问题；不是新的资讯来源。完整源码分析优先直接阅读源码。CLI 与 MCP 共用固定的 `rea-agents@6.4.0`，两者按任务选择。

用于游戏设计与开发时，沿[开发支持路径](../../README.md)进入：参考机制、开发工具或发行版本问题确实需要产物证据时调用，结果回到项目原记录。Skills包的 `game-decision-support` 是可选路由入口；未安装时可直接按本页与宿主协议执行，不形成强制包依赖。

本目录包含精确依赖锁、[官方归档锁](source-lock.json)、MIT 与匹配官方 skill v37。顶层发行包不是完整离线依赖镜像；传递依赖须从 npm registry 或缓存恢复。Node 需满足上游支持范围（^22.19、^24.11 或 >=26），安装器需要 Python 3.11+。维护者在 Windows/Node 24.15.0 上验证过 JS 静态路径；接收者连接和其他平台仍需自己验证。

## 安装、接线与调用

Research 包安装不会自动下载运行依赖、注册 MCP 或启用 skill。需要时，在 Research 包根目录先看计划，再应用：

```text
python integrations/rea/scripts/install.py --runtime <external-rea-runtime> --install --configure-codex --skill
python integrations/rea/scripts/install.py --runtime <external-rea-runtime> --install --configure-codex --skill --apply
```

runtime 必须在安装器拥有的 Research 包目录之外，例如目标工作区的 `tools/rea-6.4.0`。安装器固定版本、跳过 npm 安装脚本；只追加 `mcp_servers.rea`，保留原配置字节，并把私有备份留在使用者的 Codex home。不同的已有 REA 注册或 skill 会明确拒绝覆盖。`--codex-home <test-or-client-home>` 可指定其他客户端配置目录；默认使用 CODEX_HOME 或用户的 `.codex`。

三项操作可以分开选：`--install` 只安装 CLI，`--configure-codex` 只注册所选 runtime，`--skill` 只安装技能入口；写入均须 `--apply`。重复相同设置可复用；发现 runtime 被修改或安装不完整时，保留它并选择新目录恢复，不递归清空用户目录。

重启客户端后，确认能发现 REA 工具及 `$rea-investigate`，实际对获准的小样本调用一次。注册、握手、当前会话调用、具体目标分析覆盖分别判断。CLI 可随时使用：

```text
python integrations/rea/scripts/rea.py --runtime <external-rea-runtime> --version
python integrations/rea/scripts/rea.py --runtime <external-rea-runtime> analyze-javascript-application <approved-artifact-directory> --json
```

也可把 REA_RUNTIME 设置为该外部目录，或直接 `node <runtime>/node_modules/rea-agents/scripts/rea.mjs ...`。MCP 的启动参数为同一 Node/entry 加 `mcp`。新开分析时先摘要，再用当前服务器实际 schema 按保留 Evidence 分页/精查；不要反复输送完整关系图。

探针支持独立只读握手、工具目录及可选 JS 分析：

```text
python integrations/rea/scripts/probe_mcp.py --runtime <external-rea-runtime> --target <approved-artifact-directory> --output <new-external-check-directory>
```

输出目录须新建且放包外。独立探针成功不替代客户端实际工具调用。Skill 安装副本内的 `references/install-paths.json` 记录该次安装的本机定位信息，留使用者本机；skill 自身是指导入口，不是额外分析引擎。

## 保存、升级与恢复

遵循[工具与证据保存规范](../../README.md)：结论与实验保存在包外用户目录，runtime 与客户端设置不由 Research 包升级接管。源码归档、版本锁与许可随本包升级；运行依赖固定版本，不能自动跳 `latest`。升级工具时先新建 runtime 并验证，再明确审阅旧 REA 注册/skill 的切换；现有不同配置不会被静默覆盖。

回退工具先停止当前调用，再只处理 `rea` 注册与本次 skill；不要用整份旧备份覆盖后续其他配置。Research 包事务回滚只恢复包文件，不回滚包外 runtime、Codex 设置或个人研究资料。CLI 仍可作为连接失败/批处理时的路径。

本包不附带作者已连接状态、试跑输出、机器路径、账号或 runtime。安装 REA 不等于所有原生能力可用：Ghidra/JDK/IDA/Hopper 等按真实目标另行评估和授权。静态分析不执行目标，缺失调用/窗口/IPC 配对不等于不存在；保留 partial/unknown，并结合源码或获准运行验证。本工具包不证明普遍效率提升或游戏设计收益。
