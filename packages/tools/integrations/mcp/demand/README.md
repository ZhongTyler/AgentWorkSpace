# 可选的 Codex MCP 共享按需入口

把选定的本机 STDIO MCP 配置转换为同一用户的本机 HTTP 连接：多个聊天共用一个轻量 Python 网关，初始化和工具目录从使用者实际捕获、校验过的目录返回，首次真实工具调用才启动业务后台。各配置的名称、启用状态、工具权限和审批规则保留；默认每会话独立后台，只有审阅为无会话状态的只读来源才显式选择共享。

这是可选的 Windows 适配器，不是 Codex 官方插件。需要 Windows、Python 3.11+、现有 PowerShell（可显式指定其路径），以及支持 Streamable HTTP/http_headers_helper 的 Codex。维护者验证过桌面 26.1013.3656.0、核心 0.163.0-alpha.10.2；其他版本和平台不作兼容承诺。基础传输依据 [MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp)，生命周期参见 [app-server](https://learn.chatgpt.com/docs/app-server)。

## 准备与切换

先从包根运行 prepare_home.py，把工具源复制到全新的包外版本目录。后续命令在该外部 home 的 integrations/mcp/demand 中运行；不要将运行状态写入 modules 或包事务目录。选择使用者现有配置中的服务器名称，不复制维护者的目录、配置、凭据或连接状态。

所有占位路径都由使用者替换。下列 read-source 仅为名称示例，适配器不会创建它。

```text
python demand_portable_install.py plan --config <client-config.toml> --profiles read-source --powershell <powershell-executable> --home <new-private-runtime-home> --port 18089
python demand_portable_install.py prepare --config <client-config.toml> --profiles read-source --powershell <powershell-executable> --home <new-private-runtime-home> --port 18089
python demand_portable_install.py apply --home <new-private-runtime-home>
python demand_portable_install.py check --home <new-private-runtime-home>
```

plan 只读，不创建 home 或执行所选 MCP。prepare 是独立的显式动作：短暂执行每个所选原始 MCP 的 initialize/tools/list，捕获真实 schema，随后关闭自有进程树；它不改客户端配置或启动常驻网关。原 MCP 初始化本身可能访问账号、联网或有其他副作用，执行前须审阅已有实现和授权。仅接受适合独立子进程生命周期的本地原生 STDIO，拒绝远程部署和已被其他 demand 安装拥有的入口。共享数据库、外部编辑器或模型服务的特殊 owner 适配须另行验证，不能把所有 MCP 都视为可杀的独立服务。

prepare 默认后台模式为 session。明确审阅确认无会话状态、无用户间状态污染的只读来源后，可在 plan 和 prepare 同时增加 --shared read-source；名称须属于 --profiles。不要把有状态工具、浏览器、应用控制或编辑器配置为 shared。公开包不附第三方服务、模型、依赖、原生工具目录或账号。

apply 只切换拥有的配置段，不重载桌面、不强制迁移已经运行的连接、不修改模型或调度。等原连接自然卸载，或用户在安全时机重启客户端后生效。默认不改 thread_unload_delay_secs。核心版本严格匹配已验证版本时，可以在 plan/prepare 显式增加 --unload-delay-secs 120 --codex-executable <codex.exe>；更短的既有等待值保留，不将这个未公开保证的配置项推广到未知版本。

## 运行、状态与回收

认证辅助程序在建立连接时短暂运行；它验证冻结代码、用 Windows DPAPI 读取当前用户的加密配置、绑定 Codex 进程句柄和创建时间。首次连接才通过隐藏的系统进程接口建立网关，无需安装服务、登录任务或常驻修补器。HTTP 仅监听 127.0.0.1，校验身份、Host、Origin 和 bearer；不会把本机认证转给代理。

只读状态命令需要明确带 --status，省略该参数会建立连接并输出供客户端使用的认证头，因此不要把默认输出复制到日志或聊天：

```text
python <private-runtime-home>/runtime/<revision>/demand_http_headers.py --home <private-runtime-home> --status
```

目录发现不创建业务 worker。真实调用创建自有 Windows Job 后再恢复子进程；关闭连接或所属宿主退出，只释放对应会话。其他宿主/会话仍可继续。所有连接离开后释放自有后台，网关再空闲 30 秒退出；状态读取不延长寿命。一次回合完成不等于聊天已取消订阅，正在运行、等待用户或仍被桌面订阅的聊天不应被猜测为空闲。120 秒针对最后订阅者离开后的核心卸载等待，不保证点击“结束”就立即释放全部内存。

## 兼容与恢复

本版通用安装器处理明确选定的用户 STDIO 配置，不修改插件清单、桌面原生 CUA 入口或已有 HTTP 服务。运行库保留独立插件会话能力；维护者的固定版本插件缓存接线和原生 CUA 薄入口需要另行审查，不能直接迁移。桌面更新/强制重装、第三方源变化或工具目录变化后，先核对版本与哈希，再捕获到新的 private home；不要覆盖运行中的冻结目录。

```text
python demand_portable_install.py rollback --home <private-runtime-home>
```

rollback 只恢复本次拥有的配置段和显式选择的卸载键，保留其他后续编辑；重叠改动会明确拒绝覆盖。它不会结束现有连接或删除旧 home。先恢复客户端配置，再在安全时机让该连接自然卸载；确认没有消费者后才决定是否清理外部目录。包升级/包回退只管理源文件，不代替运行 home、客户端配置或账号的独立升级恢复。

## 验证与限制

自带 test_portable.py 和合成 demand_fixture.py，仅在临时目录验证安装、权限保留、冲突拒绝、回退、真实 HTTP 目录发现、首次调用、状态隔离和会话回收；不接触使用者配置或外部业务。可在 Windows 显式运行 python -B test_portable.py。测试临时网关等待 30 秒自然退出，不安装自启。

维护者同机三个临时聊天、相同工具目录的冷态对照，入口及附属进程私有驻留内存约 466→80 MiB，独立核心约 184→154 MiB；固定版本的取消订阅卸载约 120.2 秒，活动回合保持加载。这是版本与工作负载限定的观察，不是本通用安装器在所有服务、插件、机器和繁忙状态下的保证。接收者需独立验证原生初始化副作用、并发、错误/取消、业务状态、宿主退出以及客户端重启持久性；不以内存变化替代业务正确性。
