# Travel · 旅行工作流

本目录是一套独立的旅行工作流，包含方法、工具、模板和测试，不包含旅行事实、订单或个人账号。通用源码在来源仓的 `Travel/工作流/` 维护，正式版本发布到 AgentWorkSpace 的 `packages/travel/`，安装到使用者的 `modules/travel/`。不再维护同级 `released/` 副本；安装后的包可独立运行，不依赖原作者目录、meta、Knowledge 或游戏包。

## 开始使用

需要 Node.js 22+。按[快速开始](运行/快速开始.md)创建旅行，再让模型读取[协作约定](AGENTS.md)和[任务入口](SKILL.md)。核心工具不需要安装 npm 依赖，也不需要小红书账号或服务器。

```sh
node scripts/travel.mjs doctor
node scripts/travel.mjs init --project "./my-trip" --title "我的旅行" --start 2027-05-01 --end 2027-05-03
node scripts/travel.mjs build --project "./my-trip"
```

打开 `my-trip/build/index.html` 阅读。已有旅行沿用自己的事实源，不能用初始化命令覆盖。

网页以每天的项目和地图为主，时间线、餐饮、住宿、核对收在当天工具；天气、订单、餐厅、购物、指南、Wiki与手册在顶部直接进入，手机可横向滚动。项目正文与手册共用，临时选点只留在当前浏览器会话，不会改动正式行程。

## 独立试用与 AgentWorkSpace 接入

在发布仓运行 `python scripts/workspace.py init --target <workspace> --mode compatible --packages travel` 预览，加 `--apply` 安装。新建完整工作区可省略 `--mode compatible`，由安装器同时安装 meta。已有工作区先执行 `audit --target <workspace> --needs travel`，让 Agent 审阅同类旅行模块、事实归属和输入输出；安装器不会自动合并或迁移旅行。

旅行项目放在包外，例如 `<workspace>/trips/my-trip`。从工作区根运行：

```sh
node modules/travel/scripts/make-demo.mjs --project ./trips/demo
node modules/travel/scripts/travel.mjs build --project ./trips/demo
node modules/travel/scripts/travel.mjs validate --project ./trips/demo
```

打开 `trips/demo/build/index.html`。这是完全虚构的两天样例，不是已验证的景点、路线、预订或天气。`init` 可创建自己的空旅行；不要覆盖已有项目。核心 CLI 无 npm 运行依赖，小红书采集、Playwright 浏览器验收和服务器部署都可选。内置 Skills 由 Agent 按需读取，不自动注册或启用；无需安装 Skills package。

## 按任务查阅

品质复现先读[品质复现与验收](运行/品质复现与验收.md)和完整[设计skill](skills/travel-presentation/SKILL.md)。中文正文按[文案审校](运行/旅行文案审校.md)执行Humanizer。`quality --project`只提供覆盖与编辑线索，不替代语义、视觉和人工判断。

| 阶段 | 入口 | 何时结束 |
|---|---|---|
| 明确需求、研究与比较 | [需求](流程/01-需求与研究范围.md) → [收集消化](流程/02-双轨收集与提取消化.md) → [主题分析](流程/03-主题知识与综合分析.md) | 有证据支持可行方案，剩余缺口及影响明确 |
| 做出每天的安排 | [逐日路线](流程/04-逐日安排与路线.md)、[餐饮预算](流程/05-餐饮咖啡采购与预算.md)、[订单天气](流程/06-订单待办天气与出发.md) | 固定安排衔接，体验、餐食和返程可执行 |
| 生成阅读与执行页面 | [网站](流程/07-网站与信息呈现.md)、[手册](流程/08-旅行手册与素材.md) | 样章认可后扩展；展示不另写一份事实 |
| 变更、交付和复盘 | [同步验证](流程/09-同步验证与发布.md) | 受影响消费者已更新，验证及限制可复核 |

字段和事实归属见[数据合同](运行/数据合同.md)，操作见[命令参考](运行/命令参考.md)。全模块的分层呈现与截图审阅见[视觉层级与全量巡检](运行/视觉层级与全量巡检.md)。地图、天气、采集等能力按需加载，不要求每次通读所有章节。已知能力与未验证范围见[实施状态](运行/实施状态.md)。

## 目录边界

```text
workflow/
  流程/ 运行/                 方法与按需能力
  scripts/ web/ schemas/      工具、基础网页和合同
  skills/ 模板/ examples/ tests/
```

旅行项目、个人偏好、账号工具和归档由使用者在包外单独存放，通过命令中的 `--project` 指定项目。包内没有默认旅行或个人档案。

```text
workspace/
  workflow/                  独立工作流
  trips/my-trip/             每趟旅行各自存事实、研究和产物
  private/                   私有偏好、凭据与账号工具
```

偏好只有在使用者指定后才读取；本次旅行要求优先于历史偏好。如何引用和覆盖见[偏好模板](模板/偏好记录.md)。已有目的地、工具运行目录和旧兼容入口留在本地，不属于通用包。

## 验证与分发

```sh
node scripts/travel.mjs package-check
node --test tests/*.test.mjs
node scripts/travel.mjs release
node scripts/travel.mjs release --apply
node scripts/travel.mjs verify-package --root "./released"
node scripts/travel.mjs pack --out "../travel-workflow-export"
node scripts/travel.mjs verify-package --root "../travel-workflow-export"
```

`release` 可按需生成带 MANIFEST 的独立副本，默认输出包内 `released/`；这只是导出功能，不是来源仓的正式维护目录。不要直接公开整个宿主工作区：它可能包含私有旅行和账号资料。`pack` 和 `release` 只读取公开白名单。复制出的工作流可独立运行；旅行离线网页仍是私人文件。发布许可、素材权利和服务器边界见[分发与隐私](运行/发布与隐私.md)。正式发布走 AgentWorkSpace 的 `scripts/publish.py` 和版本验证流程；`pack` / `release` 仅用于按需导出，不维护第二份发布源。源码采用 MIT，第三方内容保留各自条款，见 [许可与内容边界](LICENSE-NOTICE.md)。创建私人旅行、公开发布工作流与部署网站是不同授权。
