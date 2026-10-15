# Workspace Tools

独立、可选的通用工具包：本地决策模型、REA、网页/图片采集、浏览器辅助、只读来源连接和原理交互解释。Research 保存研究问题与试验，Knowledge 保存知识，项目保存决定与采用反馈；Tools 维护可复用实现、固定调用、版本、许可与恢复。Skills 方法仍由独立 Skills 包管理，工具专属 REA skill 随工具保存。

## 开始使用

Python 3.10+ 可读取目录和做源文件巡检。Windows 本地模型安装需 Python 3.12、审阅过的 uv 和适配硬件；REA/来源工具还需 Node。此包不包含权重、已安装依赖、账号或任何维护者连接证明。

在本包根运行：

```text
python toolbox.py list
python toolbox.py request --workflow research --tool decisions --action classify
python toolbox.py health --integrity
python prepare_home.py --home <external-versioned-tools-home>
```

最后一步只复制已核验维护源，不联网、不安装、不注册 MCP。位置必须在 modules 和事务目录之外，且不存在；已有工具目录不覆盖。后续在外部 home 中按各工具说明审阅并安装所需组件，然后从该 home 调用 toolbox.py。升级可准备一个新版本 home、单独配置和验证，再切换调用方；保留旧 home 和客户端配置的恢复记录。包升级与回滚不替你迁移运行依赖或修改账号。

| 入口 | 适用情况 |
|---|---|
| anatomy | 按需用SVG/HTML解释概念、结构与过程；固定MIT源码，显式包外恢复，不自动制片。见[Anatomy](integrations/anatomy/README.md) |
| retrieval | BM25默认的可重建只读检索；混合按需、Knowledge原Query回退、网站接口预留。见[integrations/retrieval](integrations/retrieval/README.md)；不附知识正文或索引 |
| decisions | Intern 可选批量主题分流；Laya 实验；StartLux 仅非商业研究对照。见 integrations/decision-models/README.md |
| rea | 指定发行包的静态实现分析；源码足够时直接读。见 [REA](integrations/rea/README.md) |
| media | 公开正文、必要图片和 OCR；OCR 后仍实际读图。见 [媒体](integrations/media/README.md) |
| browser | 可选扩展准备；安装或加载不证明宿主保存成功。见 [浏览器](integrations/browser/README.md) |
| research-sources | 只读来源模板，使用者自行决定启用并授权。见 [来源连接](integrations/mcp/README.md) |
| flux-klein | 可选本地生成/参考编辑候选；固定组件与显式准备，权重不附带。见 [FLUX klein](integrations/flux-klein/README.md) |
| cutout | 可选CPU插画前景分割；孔洞、细叶和玻璃须实际查验。见 [抠图候选](integrations/cutout/README.md) |
| local-image | FLUX/Anima/Z三profile统一生成、已有PNG加工、哈希恢复和审图交接。见[本地素材](integrations/local-image/README.md)及[测试限制](docs/local-image-validation.md)；接收者自行配置验证 |

登记即发现，不是授权或实际业务接入。request 给出固定入口与回退；run 只执行已登记动作，仍须遵守宿主范围和输入输出授权。缺工具、低质量或不适合时回原流程，不能自动丢弃资料或替代最终审核。

## 可选的助手自主选择

[模型选择、效果记录与复盘模板](docs/decision-model-policy.md)支持宿主一次明确授权后，由Agent自行判断是否调用、选哪个已配置模型，无需逐次点名。Intern优先考虑已验证分流，StartLux仅明确非商业研究且有对照价值，Laya保持实验。默认保留原路径，通常选一个模型，不常规联跑或投票。

手动报告或原周期收据记录model_decision、实际tool_usage、消费、纠正/漏项、失败回退、端到端耗时与成本；未测为unknown，不凭推理速度估算节省。沿宿主既有复盘窗口逐模型/profile评估，按证据调整已验证用途与优先级；严重退化立即回退，实质变化按宿主规则报告。安装不启用这项授权或新调度，接收者自行决定；频率、升级、许可和新工作流仍走原门。

## 维护和接入

轻量检查：health 只核对维护源和运行文件是否存在，不加载模型、不查外部来源、不读客户端凭据；文件存在不等于安装成功。--integrity 再核对发布源哈希。实际连接需在使用者环境做独立握手和一次小输入调用；更新依赖后做相关回归和失败回退。长周期检查实际采用、人工纠正、耗时与 unknown 成本，连接通过不代表收益。

新工具登记 registry.json：维护源、固定动作、许可、版本锁、依赖、恢复和输入输出边界。新调用方登记 workflows.json，并验证代表性真实材料、原路径对照、错误回退、授权/隐私、产物去向和使用记录；未通过前保持可选建议。周研究可合并轻量检查，不因安装本包创建调度；频率调整仍由宿主和用户决定。

研究正文、模型推理输入、媒体、实验收据及账号保存在包外。公开版没有私人来源停用决定、连接状态、主机路径或旧路径联接。旧 Research helper 保持兼容；新工具优先在独立 Tools home 维护，不要求迁移历史证据。

FLUX klein和CPU抠图维护组件随包保存固定版本与显式入口，权重与运行环境不附带。先准备外部Tools home，再自行配置验证；私人配对实验不包含在本版本。
