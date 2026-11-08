# 项目美术资源图册

项目固定入口为assets/index.html，通过maintenance/previews/open-asset-atlas.cmd启动本机服务。需求、用途、候选版本与审阅写入catalog.json；工程安装由实际receipt及媒体哈希读取，交付和包内检查继续引用原证据。

## 使用与保存

运行入口要求Node.js，浏览器访问仅监听127.0.0.1的地址。再次打开入口会复用已运行服务。关闭原终端可停止服务。服务运行时修改清单应使用图册或同一API；外部编辑后页面需要刷新，旧输入版本的保存会被拒绝。未保存表单保存在本机浏览器草稿，正式意见以清单中的保存结果为准。

全部资源支持按类型、对象/名称、制作进度和工程状态组合筛选。需求管理页新增或编辑尚无产出的需求，填写名称、规格、优先级、所需状态与动态要求。全部资源只读展示已有资源和版本，审阅表单仅出现在审阅清单。资源详情可登记项目assets内的媒体路径为新版本，原版本及审阅保留。审阅清单支持逐项和批量决定，必须注明用途/范围。版本对比显示实际媒体；动作图集使用已核对帧区域，声音和视频使用专用播放控件。

## 权威与版本

catalog v1保持原交付兼容。每项可增加atlas字段，包含name、category、demand_stage、requirement、required_states、dynamic、versions、current_version及可选frames、composition、coverage_gap。

versions保存稳定版本ID、用途说明、文件路径/SHA256、加工输入绑定和证据。图集帧区域按[x,y,width,height]登记，必须对应实际源尺寸。程序表现可登记代码/演示需求；预览不等于真实引擎同步。

catalog.atlas保存schema_version、不可覆盖的reviews和events及组合资源ID。审阅绑定asset_id、version_id、version_key、记录人、时间、决定、范围和意见。version_key包含文件哈希及加工输入，文件变化后原决定不可继续用于当前输入。新候选不继承旧版采用。图册功能变化由atlas-changelog.md拥有，资源事件由catalog.atlas.events拥有，页面读取它们。

制作进度与安装状态独立。旧版已安装、新版待审可同时存在。visual采用只记录具体版本意见；四门、权利、release及PCK仍按既有合同核对。封版时由维护流程将采用事件固化到该批工作目录的不可变采用证据，再交原seal/publish。程序引用显示已登记引用，实际运行与包内核验沿原证据判断。

## 覆盖与维护

新增角色、技能、敌人或界面时核对所需用途，未确定是否需要的列为coverage_gap/clarify。确认后进入制作队列。目录扫描所得媒体全部可访问，未归属项保留原路径供关联；过程截图、失败、重复副本不能自动算作正式资源或已采用版本。

新增、修改、版本登记、审阅、归档、解除引用和安装后核对图册与实际文件。归档前解除消费者和实际安装。源/交付文件不可原地覆盖；仅图册的需求/意见随清单维护。共享结构或维护能力变化时同步项目模板，游戏内容和具体采用记录留在项目。

## 自审与验证

交制作人前，全部受影响单体检查裁框、透明边、真实尺寸和比例，覆盖深浅底及实际背景。列表图像完整等比显示，详情可查看原始比例和24/32/48/64/112/128尺寸。组件须进入正常/悬停/按下/选中/禁用等实际组合，并检查九宫格角部、徽记、文字安全区及装饰遮挡。

完整状态逐张自审，核对已定布局、信息层级、比例、对齐、完整性、提示和路径遮挡、选中同步及禁用语义。静态组合由明确的展示夹具生成，真实交互及Godot效果继续同状态核对。自审问题修正后再供制作人决定，机器通过与人工视觉采用分别记录。

运行node maintenance/scripts/asset-atlas.mjs . --check，核对版本哈希、当前版本、状态、审阅绑定及安装漂移。health-check同步调用此检查。浏览器回归使用test-asset-atlas.mjs，指定--evidence新目录和--browser路径，全程headless。覆盖需求/版本/审阅保存重开、冲突拒绝、权限边界、批量原子性、各类媒体、全部缩略图边界和实际组合比例。失败保全，修复后新建证据目录。

## 目录

无下级目录。

## 页面需求与连续审阅

atlas-pages.json拥有系统/页面的需求，不在媒体版本中复制这份定义。每页登记稳定id、system、name、purpose、requirements、states、components、resources。状态记录条件组合conditions、对应的asset_id、相关状态related、资源和component_ids；控件记录asset_id和applies_to，双向关联须一致。新增页面或状态时同步此文件，health-check验证引用、身份、完整归属与双向关系。

需求管理页仅列尚未生成资源的条目，支持人通过表单提需求，Agent通过本机API提需求和登记产出。全部资源列所有已有媒体版本的条目及已有实现的程序资源，包含待审版本。审阅台列有待审候选版本的资源，提供媒体检查、版本比较、审阅填写与历史意见。全部资源提供只读规格、版本和安装信息。新增需求只在需求管理页，需求编辑仅在该页，版本登记由制作流程或Agent接口执行。

全部资源和审阅台在搜索及操作栏下常驻类型、制作进度、工程状态三行平铺多选。需求页使用类型和制作进度筛选。组内取并集，组间取交集，全部清空该组。页面状态的媒体归页面类型，按系统和具体页面细分，详情保留页面目标、条件、状态和控件关联。页面定义继续由atlas-pages.json拥有，媒体及版本沿catalog拥有。

有媒体文件登记即视为已有产出，文件缺失仍保留在全部资源并显示警示。已登记procedural-runtime消费者或ready程序资源也视为已有实现。只有需求的条目保留在需求管理，首次登记媒体版本后自动进入全部资源及待审队列。

两工作台按一级类型分组，每个类型标题旁提供独立的按二级分类开关，默认关闭。二级用途优先读取可选atlas.subcategory，旧数据按身份和用途推导。图标细分系统与行动、技能、修饰、战术标识，UI细分面板、控件、卡片、提示、页面状态和控件组合，未匹配项归其他用途。开关在当前工作台内按一级类型保持，筛选后保留，切换开关不改变筛选结果和审阅选择。

详情、新增、批量审阅和文件预览均用非模态右侧抽屉。其他资源可直接切换，点击空白或Escape关闭；未保存草稿继续保留。图片文件直接显示缩略图并可进入大图，文档在抽屉中阅读。Markdown显示标题、段落、列表、代码和引用，原始HTML按文本处理。

验收须覆盖连续切换、不遮断底层选择、空白/Escape关闭、三行筛选的尺寸和换行、组内多选和组间筛选、一级及可选二级分组、页面状态关联及Markdown显示。通过localhost核对实际画面，保护正在运行的用户图册服务和已保存数据。

## 人与Agent的需求入口

人使用需求管理页的新增需求和详情编辑。Agent读取maintenance/.asset-atlas.lock中的本机url，GET /api/state取得revision和token，POST /api/change时用X-Atlas-Token请求头携带token，JSON正文为{revision,action}。仅连接当前项目的127.0.0.1服务，收到409时先保留输入并重新读取，禁止直接覆盖正在使用的清单。

action.operation=create时提供asset_id、object_id、name、category、demand_stage、priority、requirement、required_states、dynamic。category包括页面，demand_stage初始使用queued或clarify。operation=demand沿用同字段编辑已有asset_id。产出准备完成后operation=version提供asset_id、version_id、label、files和note，files为项目assets下媒体路径数组。保存会核验文件及哈希，原需求身份与历史继续保留。审阅沿review或review-many操作并绑定具体version_key。

工作台自身增删改走maintenance/workflows/workbench.md，覆盖职责隔离、数据兼容、localhost自审、模板同步和收尾。已运行服务加载旧后端时，关闭原服务后重开入口再使用新增类型写入，用户清单与本机草稿保留。

## 概览与媒体归档

概览与目标列表共用资源、需求及待审判断。制作进度每行一个按钮，待确认需求和有需求待制作跳需求管理，待自审、待审阅、需修改跳审阅清单，其余进度跳全部资源。统计与跳转使用相同进度和目标范围，清空旧搜索及筛选后应用所选条件。保存后立即重读，窗口聚焦、页面可见及可见状态下每15秒刷新概览。

未归属媒体的归档索引由assets/atlas-media-archive.json拥有，记录原路径、归档时SHA256和时间。归档只登记查阅范围，源文件继续保留原路径。清单归属和制作人采用仍沿catalog。归档后从概览的待归属列表移出，在变更记录的媒体归档中搜索、分批预览和查阅原件，按需登记为资源版本。新发现媒体继续列待归属。

运行node maintenance/scripts/archive-atlas-media.mjs .默认预览待归档数量，显式--archive写归档索引。追加前复核catalog与索引输入版本，幂等处理现有路径，保留媒体及catalog字节。health-check核对索引格式、路径、重复、原件存在及归档哈希，发生漂移先查明后处理。

## 登记梳理与语义核对

全量梳理沿atlas-audit.md先确定边界与验收。catalog中atlas.registration_role区分deliverable、source、composition、procedural、demand、reference、historical。source图板和historical旧登记在变更记录查阅，退出当前清单计数。parent_ids连接来源与组件，reuse_with和reuse_note说明同字节的不同用途。已交付且原有四门通过的资源默认查看交付版，status_basis列原阶段依据，原版本审阅记录保持。

独立命令node maintenance/scripts/audit-asset-atlas.mjs . --output <报告路径>输出逐项核对及错误，health-check调用同一函数。检查器覆盖可读名称与描述、程序实现、来源与加工输入、循环与重复、当前版本、状态依据、跨用途复用、引擎媒体/收据/release漏登记。catalog.atlas.coverage_rules通过path、collection、prefix和suffix将宿主内容集合映射到所需登记，audit_targets核对已识别的程序实现入口。未归属媒体产生警示，由宿主核对用途后处理。

登记元数据批量修改使用changeAtlas的curate操作，沿同一输入版本校验和原子写入。patches限制元数据字段，来源、版本和门保持，新增登记仅允许已有实现的working程序表现。additions、audit_targets及coverage_rules进入同一计划。操作前保存基线、计划和合同绑定，冲突重新核对。使用服务的现有普通需求和版本入口会维护demand到deliverable的登记角色。项目内梳理记录拥有具体修改依据与反例结果。
