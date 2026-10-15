# 可切换的只读检索核心

默认BM25；按需启用固定Embedding的混合RRF。Tools拥有唯一算法，Knowledge拥有查询/全文/消化/审核；网站可消费相同版本包和接口。没有自动生成Wiki、记忆层、联网、账号或发布权限。

Python 3.10+与标准库即可运行BM25，无GPU、Ollama、数据库服务或模型。可选混合使用固定ONNX/NumPy/tokenizers；权重和依赖在包外，不能把同维不同模型混用。首次安装不下载或启用它们。

## 本地接入

维护阶段显式从一个已审提交建包，输出到Knowledge之外的新版本home：

```text
python integrations/retrieval/cli.py build --root <Knowledge> --home <external-home/v1> --revision <commit>
python integrations/retrieval/cli.py search --config <external-home/v1/config.json> --request <request.json>
python integrations/retrieval/cli.py context --config <external-home/v1/config.json> --request <request.json>
python integrations/retrieval/cli.py read --config <external-home/v1/config.json> --request <read.json>
python integrations/retrieval/cli.py health
```

搜索请求为`{"question":"失败成本如何影响道具囤积？","terms":["囤积"],"limit":18}`，全文请求为`{"source_id":"knowledge:wiki:实际页面名"}`。固定动作也可由`toolbox.py run --workflow knowledge --tool retrieval --action search -- --config ... --request ...`调用。`search`仅候选、`context`完整小节，不等于Agent读懂或整篇阅读；重要机制和决定性数字沿Knowledge原全文与Raw路径。

build只接受已提交的普通Wiki；工作树除CRLF/LF之外变化时拒绝。派生包记录实际读取字节hash、原Git blob和提交，不刷新原审核哈希。空库继续原Query；不为查询自动建包。版本home必须全新，失败产物保留现场，不覆盖上版。日常读取校验包、配置源字节；来源变化/删除时退出并由宿主回原Query。

Knowledge把包外可信绑定复制到其`system/query/retrieval.local.json`（不入Git）。里面是Python、Tools home和runtime config；请求只能选择`retrieval:{mode:"bm25"|"hybrid"|"legacy"}`，不能换路径/账号/预算。无绑定、Tools/Python不可用、索引陈旧或混合不可用均显式回原Query。原Query保留导航、Domain/Group/原则；检索仅补候选排序，不替换全文读取、reuse/verify/assemble和终审。

## 混合开关与恢复

默认BM25不加载模型。可信Embedding配置须包含`embedding_dir`、`dependency_dir`、`embedding_profile`、`embedding_files:[{path,sha256}]`，从固定模型/修订和同一编码规范生成；再build到另一个新home并传`--embedding-config <本机配置>`。查询时`--mode hybrid`才加载模型并核对资产hash；不隐式外发或用其他模型顶替。可选版本/文件SHA及依赖见`optional-embedding.lock.json`与`requirements-optional.txt`；接收者在包外独立环境审阅恢复，不自动下载。建议先验证小范围/代表性问题，不以相似度当置信度。切换时替换整个版本绑定，保持旧home及旧绑定，可立即回退；没有后台watcher或自动重建。

本地候选参考为原始MIT的BAAI/bge-small-zh-v1.5；ONNX转换、运行依赖和实际输入分别核对许可。发行包不附模型、私有配置或维护者验证资料。当前通用核心的工程验证不证明在接收者整库更准确/更省工；目标资料量和资源需实测。

## 网站接缝

CLI与`service.execute`共用一个协议。`cli.py serve --config ... --keys <本机token到profile映射> --port 18971`仅监听127.0.0.1，默认BM25；明确`--allow-hybrid`才加载Embedding。`POST /v1/search`、`/v1/context`、`/v1/read`要求Bearer身份，profile从服务端取，客户端不能自选角色、源根、模型命令或预算。拒绝跨域、超预算和越权读取；默认不提供回答生成接口，网站自己的provider负责后续回答与真实token计量，不复制本机订阅凭据。

对不同访问范围显式导出新只读视图（`export --profile <允许视图> --destination <新.sqlite>`）；身份ID保留，未授权文档/向量行物理删除并VACUUM。网站的视图配置使用相对pack、准确SHA和`source_root:null`，不用连接家中电脑。生产网关、每次权限核验/撤权、TLS、限流、取消、缓存与部署仍归网站owner；缓存键至少含快照/权限版本/检索与生成配置。不能把loopback测试当正式上网验收。

源码与恢复归Tools；包外home/版本包和私有资料归接收者。升级/回退包不会迁移用户知识、删除运行数据或启用模型。合成测试见`test_contract.py`，不附私人题集/回答或聊天链接。

本地两种模式可由宿主可信绑定分别指定版本包和Python；同一获准源版本/来源ID必须一致。共享运行依赖必须登记消费者，清理时保留其他调用者；包外配置不随公开包发布。

## 审核提交后的自动维护

Knowledge的consolidated advance在用户精确终审通过、退出结果提交后调用同一个refresh；普通查询仍只读。接收者须明确启用本机可信绑定的maintenance：enabled=true、versions_root为Knowledge外部目录；refresh_hybrid可选，开启时指定包外embedding_config并复用已批准的hybrid_python。安装包不启用维护、不下载模型、不自动安装Git hook或watcher。

refresh比较上一来源提交与当前HEAD的Wiki差异，只接受本次审核明确覆盖的页面；验证当前文件与提交一致，未审核草稿、越界差异或并行HEAD/绑定漂移均拒绝。新版本在包外构建和验证后原子切换绑定，旧版本与previous-binding.json保留；同内容重复调用返回unchanged。存在refresh.lock时返回busy，不重叠启动，不擅自清锁。

BM25刷新失败保留原绑定，查询发现过期仍回原Query。已授权混合刷新失败时，可激活验证通过的BM25并明确移除过期混合绑定，hybrid请求回原Query；收据标明局部失败，不声称两路都更新。所有日志/来源身份/前绑定只留包外私有运行目录。维护耗时与回答生成成本分别记录。

已授权本机可显式运行 `node system/query/retrieval-maintenance.mjs --root <Knowledge> --install-hook true` 安装post-commit事件（该命令从Knowledge执行）。它只在本机维护配置启用后工作：本次提交包含已完成并精确批准的run.json时自动核验并更新；已审Wiki维护提交带 `Knowledge-Review-Ref: <实际审核记录>` 和 `Knowledge-Review-Paths: ["wiki/实际页.md"]` 两条消息尾注时走同一入口。没有审核事件的普通提交不刷新。尾注是责任owner的实际审核引用，不能制造批准或替代原审核。已有非本工具hook拒绝覆盖，由owner在原hook内接入事件或保留advance回调。hook失败不撤销Git提交，实际状态写包外events收据，失败需报告并在修复后显式恢复；无监听、轮询或后台模型。默认advance仍调用同一函数作为可移植回调，重复触发按内容去重。
