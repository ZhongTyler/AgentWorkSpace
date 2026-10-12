# 当前安装定位与恢复

读取本 skill 的 `references/install-paths.json`，其中 runtime 是外部 REA 安装，integration 是提供工具/文档的 Research 包内目录。该文件由使用者明确安装 skill 时生成，不能套用维护者机器路径。

已有 `rea` MCP 工具时，直接按其实际 schema 分析指定目标，不每轮重复 setup。工具未发现或客户端拒绝时，先区分配置、客户端刷新、目标权限与引擎缺失；可先用固定 CLI 继续静态研究：

```text
python <integration>/scripts/rea.py --runtime <runtime> analyze-javascript-application <approved-artifact-directory> --json
```

需要精确参数时读固定版本 `--help`。恢复或接线读 `<integration>/README.md`；不能因为某个 provider 不可用就安装全部引擎。输出存使用者指定的包外研究目录。注册、独立握手、当前会话工具调用和实际分析覆盖分别验证。
