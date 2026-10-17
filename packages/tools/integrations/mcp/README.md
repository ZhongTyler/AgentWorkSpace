# Research MCP · 可选接线

发行产物分析工具的独立可选接线见 [REA CLI/MCP 与 skill](../rea/README.md)，不计入资讯来源池，也不随来源安装自动启用。

本包保存固定依赖、源码/顶层发行归档、许可证和安装/恢复工具。来源分工见[来源目录](../../README.md)。**初始安装没有连接任何账号，也不注册或启用 MCP**；目录中的正式来源是可选池，连接状态须在使用者自己的宿主重新验证。

| 来源 | 接入路径 | 边界 |
|---|---|---|
| HN | 固定 HN MCP；公开 Firebase/Algolia | 列表、搜索、评论和外链正文分别核对 |
| 掘金 | 固定公开搜索 MCP与公开 SSR 正文修复 | 保留正文、代码、链接、图片引用；图义另读，缺正文报错 |
| GitHub | 优先宿主官方 GitHub 插件；PAT 只读备选 | 本人授权；不继承维护者账号 |
| Reddit | 固定只读 RSS MCP | 社区样本、截断和评论覆盖须报告 |
| Hugging Face | 官方 Hub MCP | 元数据不是模型效果证明 |
| 知乎 | 官方 HTTP MCP与本机令牌桥 | 本人申请 Access Secret，按实际免费额度读取；搜索摘要不等于全文 |
| 少数派 | RSS MCP与选定公开正文 | feed通常只有摘要，正文与媒体另取 |
| Lobsters | 保存接入代码、端点与只读白名单 | 网关可用性和授权另验，不包含云端后台 |
| V2EX / Stack Overflow / 小红书 | 停用备选 | 默认跳过；只有使用者明确决定才恢复，不自动登录或网页绕回 |

## 安装与验证

Node.js、npm、Python及网络依赖按所选工具准备；Windows本机令牌桥与媒体锁有平台限制，其他系统需另验。执行前先查看计划：

```text
python integrations/mcp/scripts/install.py --runtime <local-runtime> --output <config-preview>
python integrations/mcp/scripts/install.py --runtime <local-runtime> --install --output <config-preview>
python integrations/mcp/scripts/install.py --runtime <local-runtime> --config <host-config.toml> --apply
```

`--install`下载运行依赖；`--apply`只写受管理配置块，拒绝同名非管理项，并保留本机备份与已有启用开关。新账号来源默认停用。运行目录放包外；移除管理块可撤销注册，不自动删除用户会话或依赖。固定归档不是完整离线镜像，不自动启动服务或付费。

Windows本人授权入口：`python integrations/mcp/scripts/connect-local.py`。按实际帮助与本机页面填写令牌，DPAPI文件留在当前用户本机；不发送到聊天或版本库。入口随机绑定127.0.0.1，需保持服务存活；访问失败检查本机服务，不反复粘贴密钥。只读启动器与桥按[服务器目录](servers.json)的白名单过滤工具；不代表远端服务永久可信。

## 固定依赖与许可

[源码锁](source-lock.json)、[npm锁](npm-package-lock.json)、[Reddit锁](reddit-package-lock.json)、[兼容源码锁](xhs-compat-lock.json)及[第三方声明](THIRD_PARTY_NOTICES.txt)记录版本、SHA-256与许可；归档不改变其上游条款。无再分发许可证的Stack Overflow完整源码不随包分发。浏览器、账号、Cookie、QR、profile、本机配置、运行依赖、私人研究和当前连接验证收据不随包分发。

```text
python -B -m unittest discover -s integrations/mcp/tests
node --test integrations/mcp/tests/juejin-reader.test.mjs
```

这些检查覆盖安装/恢复、冲突与读取边界；实时服务、授权、所有正文/图片及研究收益仍需按实际任务验证。失败时继续可用的文件/网页入口；用户停用来源不自动绕回。研究方法和发布说明见[包入口](../../README.md)。

## 可选的共享按需入口

Windows Codex 可按需选择[共享 HTTP 入口](demand/README.md)，减少每聊天的重复运行进程。安装本包不会捕获目录、修改客户端配置或启动后台。
