# Local decision model gateway

Optional Windows research tools; package installation does not install or load models. Intern-Decision-2B is an optional semantic topic router, Laya multilingual remains experimental, and StartLux 4B Q8 is a noncommercial research comparison. Do not share probability thresholds, automatically vote, discard inputs or promote an output to a project decision. Keep the original Agent/rule path and review disagreements. No portable quality or efficiency guarantee is made.

After the recipient explicitly authorizes autonomous selection for a defined host scope, the Agent may choose whether to call and which installed backend to use under the [selection and review policy](../../docs/decision-model-policy.md). Record actual consumption, corrections, fallback and complete cost in host records; review per model/task profile on the existing window. The gateway still executes an explicit backend, and installation grants no such authority.

Prepare an external versioned Tools home first. All following commands run from its integrations/decision-models directory, using Python 3.12 and a reviewed uv executable:

```text
python restore.py --uv <absolute-uv-path> --weights
python restore_backends.py laya
python restore_backends.py llama
python restore_backends.py startlux
python verify_installation.py
```

Restore only requested backends after reviewing their dependencies and licenses. Intern restore includes GPU PyTorch CUDA12.8 pins; verify local GPU/driver suitability. Laya source/weights and StartLux/llama are separately pinned. StartLux weights are CC BY-NC 4.0; source Apache-2.0 does not grant commercial weight use. Bundled upstream metadata and source archives retain their licenses. Model weights are downloaded only by explicit restore; network access, disk and memory are required. A small model can still exhaust system commit memory. Load one backend at a time, unload after use, and keep original-path fallback; startup/idle behavior requires local validation.

Create the client MCP entry yourself with command=<external-home>/integrations/decision-models/runtime/client/Scripts/python.exe and args=[-X,utf8,-B,<external-home>/integrations/decision-models/mcp_server.py]. This package never edits client config or enables startup. Use the stdio MCP to classify, inspect status and unload; CLI research_adapter.py accepts --materials, --questions and a new --output. The gateway is local loopback with per-runtime token and owned-process shutdown. Do not export service-state.json or logs.

From the external Tools home, toolbox.py request/run gives the fixed workflow adapter; StartLux run requires --purpose noncommercial_research. Topic slices are only advisory and never substitute for reading the complete source or Knowledge routing and final review. Run test_gateway_contract.py after code changes; test actual small inputs and lifecycle separately. Preserve pinned locks, use a new home for upgrades, and retain the old environment until verified.
