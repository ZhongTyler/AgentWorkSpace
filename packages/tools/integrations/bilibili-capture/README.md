# Bilibili capture

Read-only public-video research tools: metadata, available subtitles, bounded storyboard frames, and explicitly requested audio capture. Python 3.12+ and Node.js 22+; Pillow is needed for frames. `python capture.py health` and `node reader.mjs health` check fixed sources without network or login. Run `python capture.py --help` for commands and select the video, page, output and operation in the current task.

The strict anonymous reader is a reviewed subset of @xzxzzx/bilibili-mcp 1.14.3, Apache-2.0; reader-lock.json pins every patched file under vendor/reader. It never reads credentials and stops on authentication, risk-control or denied responses. No cookie probing or account fallback. DSH's fixed MIT archive supplies only two AST-selected storyboard helpers; its server is not executed. Vendor licenses and source locks are included.

ASR is optional and separate from subtitle reading. The fixed requirements and model lock describe a separately prepared Python environment and model; neither models nor installed dependencies are bundled or downloaded by package installation. A model file must already be present in an explicitly selected external `BILI_CAPTURE_HOME`. Audio content and transcripts remain user-owned outputs; recording permission and source conditions still apply.

`server.py` is an optional stdio MCP entry, requiring the separately prepared MCP dependency and an explicit absolute external BILI_CAPTURE_HOME. Its input scope defaults to that home; widen only through an explicit BILI_CAPTURE_INPUT_ROOT. Installing this package does not register MCP, start a server, log in or enable ASR. Synthetic tests cover source identity and failure boundaries; a recipient's live video/network and listening validation remain separate.
