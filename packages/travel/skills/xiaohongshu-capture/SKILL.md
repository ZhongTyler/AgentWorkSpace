---
name: xiaohongshu-capture
description: Install or connect a user's local read-only Xiaohongshu MCP, select scoped candidates and preserve exact source text and every image for later travel research digestion.
---

# Capture evidence

Read [setup](../../运行/小红书安装与登录.md), [workflow](../../流程/02-双轨收集与提取消化.md) and CLI help. Never assume a preinstalled server or logged-in account.

Check mcp-status first. New setup uses mcp-install, mcp-start, mcp-login; the person scans their own QR. Never publish, comment, like, favorite, clear cookies or switch accounts automatically. Health and account login differ.

Search only relevant gaps. Register exact IDs, authors, query and public URLs. Use existing candidates first, count unique IDs rather than titles.

mcp-extract uses serial batches (max ten, usually three to five), transient tokens, exact detail IDs and stable image manifests. Every image must download before a raw revision is registered. Schema changes fail closed.

Failures retain their own IDs/reasons. Bounded retry or source command for user-provided materials; never substitute text-only extraction for an illustrated note. Tokens/QR/Cookies remain private. Extraction is not digestion; hand off raw hashes and image counts to [digest](../xiaohongshu-evidence-digest/SKILL.md).
