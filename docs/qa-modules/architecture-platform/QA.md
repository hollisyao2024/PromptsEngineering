# 双能力包与架构落地 QA

> 模块：architecture-platform；日期：2026-10-06；状态：测试 Passed，交付以本机 QA receipt 和合并门禁为准；负责人：@template-maintainers。

## 1. 范围与输入

验证 [PRD](../../prd-modules/architecture-platform/PRD.md)、[ARCH](../../arch-modules/architecture-platform/ARCH.md)、[TASK](../../task-modules/architecture-platform/TASK.md) 的 US-ARCHPLAT-001～015。第 2～6 节记录 3.0.0 基线；3.0.1 兼容升级复验见第 7 节，3.1 公共 UI 见第 8 节，3.8 界面视觉契约见第 9 节。消费者都在容器 tmp 内初始化；三青鸟、小懒实际仓库没有写入。

## 2. 验收追踪与执行

| TC / AC 后缀 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- |
| 001 / 001-01 | 只安装作业包、架构目录显式获取且不自动生成应用 | upgrades.test.js：agent-only、inert kit、二次收敛 | Pass |
| 002 / 002-01 | 多应用、多存储、目标及目录；未知字段、路径重叠阻断 | project.test.js；Web/Next/Go/Node/Tauri 与共享 UI 样本 | Pass |
| 003 / 003-01 | 初始化具体文件、安装依赖、构建与再次零差异 | 三个隔离组合，Vite/Next 构建、Node HTTP、Go test/build、Tauri cargo check | Pass |
| 004 / 004-01 | 既有目录和别名检测、显式接管保护 | project.test.js、engine.test.js；真实 2.2.1 消费者接管 | Pass |
| 005 / 005-01 | 公共表格、基础控件、业务源码检查 | 24 个 shadcn 原子、25 个 Registry 项闭包检查；每个前端样本 8 项 DOM 测试；3 条真实浏览器旅程；原生 button 和重命名 Table 导入负向检查 | Pass |
| 006 / 006-01 | 所有权策略和定制保护 | 覆盖漂移、文本/JSON 三方合并、迁移追加、受管块、初始化保护及幂等 | Pass |
| 007 / 007-01 | 冻结计划和异常恢复 | 源/目标/锁漂移、基线损坏、路径/链接、部分写入恢复、用户改动阻断、提交前锁复验 | Pass |
| 008 / 008-01 | 工程模块 | SQLite/PG 真实迁移和回滚；契约、脱敏、资源、插件、私有产物负向检查；发布并发和外部指针保护 | Pass |
| 009 / 009-01 | 旧模板与统一升级 | 固定来源回归；2.2.1 原始安装器生成消费者后验证缺失基线阻断、显式接管、项目规则/源码保留及收敛 | Pass |

自动化入口：`pnpm test`（400 项，0 失败、0 跳过）；各生成前端的 `pnpm test`、`pnpm build`；Node 样本 `pnpm test`；Go 样本 `go test ./...` / `go build .`；桌面样本 `pnpm build:web` 和 `cargo check --offline --manifest-path src-tauri/Cargo.toml`。

## 3. 环境与组合

macOS arm64，Node.js 26.7.0，pnpm 10.33.0；独立安装每个样本及共享包依赖，不链接其他 worktree 的 node_modules。

- repo 样本：React/Vite + Node + SQLite + contracts/observability。
- matrix 样本：Next + Go + Tauri，Postgres 与 SQLite，资源/插件模块。
- shared 样本：Vite 与 Next 共用 packages/ui，另有全新 Tauri 骨架；共享 React 运行时/类型、工具函数别名、Tailwind 扫描与原生图标均实际验证。
- legacy-consumer：由 main 既有 2.2.1 快照的原始安装器初始化，验证 3.0 接管流程。

PG 使用带专用标签、仅绑定 127.0.0.1 的一次性 postgres:16-alpine 容器，完成后已停止并自动删除；未访问项目生产库。

## 4. 浏览器与 UI 覆盖摘要

| Story | 浏览器旅程 | 覆盖维度 | 自动交互测试 | 性能 / 安全 |
| --- | --- | --- | --- | --- |
| US-ARCHPLAT-005 | 3 | 选中 1/11 跨页保留、末页禁用；搜索空态及清除恢复；列显隐且记录数保持 | 8：含异步 CRUD 回调、失败保留弹窗、防重复、导出转义、受控服务端、分组列 | 生产构建；CSV 公式文本转义；真实权限由项目回调和后端负责 |
| US-ARCHPLAT-001～004、006～009 | CLI/文件系统/HTTP/DB 集成 | 初次写入、重复执行、故障阻断与恢复 | 包含于 400 项源码回归和隔离样本 | 路径、所有权、日志脱敏、迁移历史与事务检查 |

浏览器使用 CUA 在隔离 localhost 样本操作并核对可访问性树和截图；这三条是实际浏览器验收，不计作 Playwright 自动化测试。空态清除后恢复 24 条、选中状态按稳定 ID 保留，列显隐不改变数据总数。大数据量性能、跨屏幕阅读器认证、原生签名/公证和 Windows/Linux 二进制构建不属于本机已验证结论。

## 5. 语义审查

Review-Class: REQUIRED。Domain-Hit: 共享基础库、文件写入、事务/并发、迁移、配置协议、跨模块初始化。

- 所有目标先规划，冲突先于写入；记录原子逐文件 journal，不承诺整个目录一次原子替换。
- 本地改动保留并参与三方合并；覆盖漂移和基线未知需要明确处理。接管保留旧内容，不等同于已替换全部旧协议。
- 写入完成与依赖安装/构建是分离结果；版本锁记录文件基线，依赖失败仍要求后续补齐验证。
- 中断不盲目重放；本机 writer/recovery 锁、版本锁复验和 before/after 校验保护恢复。
- 迁移默认预检；写库必须 --apply，PG 事务失败回滚，非事务 running 状态阻断重试。
- 发布指针仅在本次版本仍占有时回退；不执行实际生产部署。
- Codex review skipped by policy。没有创建、修改或依赖 GitHub Actions。

## 6. 缺陷与结论

本轮发现并关闭的生成问题见 [defect-log.md](defect-log.md)。本模块 9 项 AC 均有对应验证，无遗留阻断缺陷；Go（模板源码交付）。实际项目采用后仍应补业务授权、数据接口和各平台发布配置。

外部证据：容器 `tmp/architecture-platform-validation/` 的 full-test-final.log、postgres-live.json、legacy-upgrade.json、architecture-negative.json 及隔离项目；浏览器摘要 `tmp/test-results/architecture-platform/browser-smoke.json`。本机交付 receipt 位于 worktree-sessions，具体 commit 由 receipt/PR 记录，避免在受测提交内写入自身 SHA。

## 7. 3.0.1 依赖兼容升级复验

日期：2026-09-09。范围为既有 shadcn/Radix、前端框架、类型与测试依赖，复验 TC-003、005、006、009；公共 DataTable 的 Props、`ColumnDef<Row>[]` 和项目业务回调合约保持兼容。24 个官方 Registry JSON 的 SHA-256 均与前次相同，基础组件改用官方 `cn` 导入；26 项直接依赖的 latest/selected/原因见 [dependency-audit.json](../../../architecture/dependency-audit.json)。

| 验证 | 环境与方法 | 结果 |
| --- | --- | --- |
| 源码回归 | `pnpm test`，新增生成配置、Registry 固定依赖闭包和工具函数保留测试 | 403/403，0 失败、0 跳过 |
| 全新应用 | Vite 应用内 UI、Vite 共享 UI、Next 共享 UI、Tauri Web；各自独立安装依赖 | 每个应用 11/11 DOM 测试，类型检查和生产构建通过 |
| 最低 Node 版本 | Node 22.22.2 实际运行 Vite 的 11 项测试、类型检查和构建；Next 生产构建 | Pass；其余组合使用 Node 26.7.0 |
| 原始消费者升级 | 由 3.0.0 快照生成 Vite + 共享 UI，再应用 3.0.1 | 按钮样式、页面、工具函数和 package script 定制均保留；cn 依赖生效；再次 plan 零差异；11 项测试、类型检查、构建通过 |
| 架构与 Registry | 对全新和升级样本运行 architecture check，构建 25 项 Registry | 全部通过，无重复依赖版本或遗漏运行时导入 |
| 真实浏览器 | CUA 在全新 Vite 样本复验跨页多选、空态清除、列显隐三条旅程，并检查截图 | 选中 1/11 后第 3/3 页仍显示已选 2；末页按钮禁用；空态清除恢复 24 条；列显隐不改变记录数 |

新增 3 项基础组件 DOM 回归覆盖 `cn` 类名合并、Dialog/Button 组合与 Escape 焦点恢复、受控 Select/Switch/禁用 Checkbox；与原有 8 项 DataTable 回归一起执行。浏览器旅程为实际 CUA 验收，不计入自动化用例数。本轮没有修改后端、数据库或 Rust 原生代码，也不以 Tauri Web 构建代表原生发布验证。

以下选择有实际兼容性证据：

- TanStack Table latest 9.2.4 改变 `ColumnDef` 泛型并替换 `useReactTable`；使用原有业务列定义的独立编译探针出现 TS2707，因此保留最新 V8 8.21.3。
- TypeScript latest 7.0.2 不再导出架构检查使用的 `createSourceFile/readConfigFile/resolveModuleName`；安装后实际探针确认缺失，因此升级到 API 兼容的最新 V6 6.0.3。
- `@types/node` 使用 Node 22 分支最新 22.20.1，避免在最低支持环境暴露不存在的 Node 26 API。前端 engines 与依赖交集对齐为 `^22.22.2 || ^24.15.0 || >=26.0.0`。
- `lib/utils.ts` 改为仅缺失时初始化；既有项目辅助函数保持原样。保留 clsx/tailwind-merge 依赖以兼容旧工具函数，基础控件直接使用新 cn。

Review-Class: REQUIRED；Domain-Hit: 共享基础库、生成配置和跨文件升级。语义检查确认依赖来自统一固定版本目录、项目定制走既有所有权策略、不自动迁移破坏性业务接口。Codex review skipped by policy。测试 Passed，无遗留阻断缺陷；交付结论仍以当前提交的 QA receipt 和合并门禁为准。

本轮证据在容器 `tmp/shadcn-compatible-latest/`：`npm-snapshot.json`、`upstream-components.json`、`source-tests-final.log`、`next-recheck.json`、`upgrade-result.json`、`upgrade-validation.json`、`node22-validation.json`、`browser-smoke.json` 及各样本的测试/类型/构建日志。临时浏览器标签和开发服务已关闭。首次失败和修复后的复验分别保留，最终 Next 结论以 `next-recheck.json` 为准。

## 8. 3.1 公共 UI 与按需初始化验收

日期：2026-09-09。范围：US-ARCHPLAT-010～014，各 1 项 AC，关联 TASK-ARCHPLAT-007～010。四组公共交互、DataTable 集成、选择式生成和升级均有实现及验证；33 个官方基础组件与 6 个组合 Registry 项共用固定依赖闭包。RHF/Zod 按选择安装；既有 DataTable Props 不变，新增多选数组及日历字符串范围筛选。

| TC / Story 后缀 | 完整路径、边界、失败恢复 | 自动化与浏览器证据 | 结果 |
| --- | --- | --- | --- |
| 010 | 新增填写并保存；必填/dirty 取消/继续编辑；失败后原值保留并重试；Dialog/Sheet 焦点恢复 | forms 5 + RHF 2 项 DOM；Vite 新增旅程、Next 生产弹窗和侧栏两种视口 | Pass |
| 011 | 标签多选与远程负责人选择；无匹配与禁用选项；远程加载失败、恢复服务后重试，取消及乱序保护 | selectors 3 项 DOM；多选保存、无匹配和服务失败重试 3 条浏览器路径 | Pass |
| 012 | 日期和范围应用到表单及 DataTable；无效日/反向区间/min/max；纠正日期后恢复，跨时区一致 | dates 3 + forms-dates 2 项 DOM；筛选纠错与嵌套表单浏览器复验；UTC/Honolulu 各 3 项 | Pass |
| 013 | 确认删除与成功通知；取消不删除/空态/加载禁用；失败提示与重试 | feedback 2 项 DOM、DataTable 9 项回归；删除、表单失败、独立异步按钮、5,000 行搜索/分页路径 | Pass |
| 014 | 全新按集初始化；空集/共享闭包/不兼容目录；升级保留定制、取消选择保留已安装依赖并收敛 | component-sets 9 项源码集成；5 应用真实生成和 3.0.1 消费者升级，冲突阻断及再次零差异 | Pass |

浏览器路径通过 CUA 的真实语义操作执行，核对页面状态和结果数据，包含成功、边界和错误恢复；相同旅程可覆盖多个 Story，不与 DOM 用例相加计算自动化数量。014 的对应端到端入口为 CLI/文件系统，三个维度由生成、负向配置、升级/收敛集成验证。没有变更认证授权、生产数据写入或服务延迟合约，不宣称业务权限或生产容量验证。

| 验证层 | 组合与结果 |
| --- | --- |
| 模板全量回归 | `pnpm test`：412/412，0 失败、0 跳过；覆盖原有生命周期、更新引擎及新增 9 项组件集集成 |
| 应用内完整 UI | React/Vite：29/29 DOM、类型检查、生产构建通过 |
| 共享 UI | Next 及 Tauri Web 共用 packages/ui：各 29/29 DOM、类型检查、生产构建通过；实际 Next 生产服务浏览器验证通过 |
| 按需集合 | 显式空集合：3/3；仅 forms：10/10；均类型/构建通过，不安装未选中的 Table/RHF/日期依赖 |
| 最低 Node | Node 22.22.2：完整 Vite 29/29、类型检查和生产构建通过；主矩阵 Node 26.7.0 |
| 旧版升级 | 原始 3.0.1 初始化的共享 UI 消费者升级到 3.1：20/20、类型/构建通过；按钮、页面、utils 和 script 定制保留；初次升级 258 项、零冲突，再次计划零差异；最终修复补丁应用后再次零差异 |
| 架构与 Registry | 全新/升级样本 architecture check 通过；39 项 Registry 的依赖与组件导入闭包由源码测试验证 |
| 浏览器 | Next 弹窗及 Vite 侧栏在 1280×720、390×640；Vite 综合表单另验 390×844。5,000 行列表末页包含 5000、下一页禁用；无匹配为 0 且已选 1，清除恢复 5000 且保留选择 |

QA 曾因 Next 生产弹窗内日期弹层超出可用高度给出 No-Go，并回流 TDD。修复后 Calendar/Input/Apply 在可用空间内滚动，日期提交不再误触 dirty 关闭；新增 Dialog/Sheet 两项嵌套回归，桌面与窄屏均重新操作并保存正确值。共享 React 实例和面板焦点问题也已修复，详见 [缺陷记录](defect-log.md)。最终浏览器检查未捕获 console warning/error；开发服务早期视口切换曾记录一次 ResizeObserver 通知，不作为生产运行结论，后续生产和窄屏复验未再出现。

性能边界：完整演示入口一次引入所有组件，Vite 主 JS 约 570 kB（gzip 174 kB），保留超过 500 kB 的构建提示；升级 DataTable 样本约 516 kB（gzip 159 kB）。这不是预算通过或性能压测结论，实际项目可按路由拆分和按需选集。未执行本轮 Tauri 原生签名/发行或跨浏览器、屏幕阅读器认证。

Review-Class: REQUIRED；Domain-Hit: 共享基础库、异步并发、跨文件初始化和升级所有权。已复核防重与取消/乱序、RHF 校验及转换结果、失败保留、日期时区与边界、旧 owner ID、共享目录依赖和取消选择语义。Codex review skipped by policy。5/5 新增 AC 通过，无遗留阻断缺陷，Go（模板源码）；最终交付以当前提交 QA receipt、合并及 completion guard 为准。

本轮证据：容器 `tmp/ui-foundations/` 中 `upstream.json`、`npm-new.json`、`source-tests-final.log`、`*-test.log`、`*-build.log`、`*-final.log`、`*-architecture-check-final.json`、`upgrade-result.json`、`*-final-update.json` 及隔离样本；真实浏览器摘要为 `tmp/test-results/ui-foundations/browser-smoke.json`。临时浏览器标签和服务已关闭，证据保留。具体 base/head SHA 由回执与 PR 保存，文档不嵌入自身提交 SHA。

## 9. 3.8 界面视觉契约验收

日期：2026-10-06。范围：US-ARCHPLAT-015，3 项 AC（015-01～03，对应 TC-ARCHPLAT-015～017），关联 TASK-ARCHPLAT-011；TASK-ARCHPLAT-012（架构包 `ui.md` 增补、`DESIGN.md` 与 `styles.css` 漂移检查、`architecture init` 生成骨架）不在本轮。交付物是模板自有骨架 `docs/data/templates/prd/DESIGN-TEMPLATE.md`（61 行、2,938 B，`overwrite` 登记），由 PRD 专家按需实例化为项目根 `DESIGN.md`；根文件属项目，不入任何 manifest。色值、间距、断点与无障碍目标只写在 `DESIGN.md`，UX 规范、PRD 模板和 prd 模块模板改为指向它；仅当任务触及界面且根 `DESIGN.md` 存在时，PRD 建立维护、ARCH 只记实现映射、TDD 与 QA 点读，缺失时回退 UX 规范 §5 与 `styles.css`；TASK、DEVOPS 与常驻规则没有路由。

| TC / AC 后缀 | 完整路径、边界、负向 | 自动化证据 | 结果 |
| --- | --- | --- | --- |
| 015 / 015-01 形态 | 骨架 ≤ 80 行；七个 front matter 键按序且 `version: alpha`；八个二级章节与 Google 规范同序；Accessibility、Motion、Visual QA 三个三级小节位于 Do's and Don'ts 之后；Accessibility 含 `4.5:1`、`3:1` 与「推荐 ≥ 44×44；WCAG 2.2 SC 2.5.8 最低 24×24（AA）」，不含 44×44 误标为 2.5.8 的旧写法 | template-surface：TC-ARCHPLAT-015 骨架体量、键序、章节与无障碍目标 | Pass |
| 015 / 015-01 同源 | 组件中所有 `{ref}` 都能在 front matter 解析；无外部 URL、`@font-face`、`@import`；在息壤源中色值、三档圆角与正文字体族同 `tokens.css`（实际项目没有组件源，同源比对跳过） | template-surface：TC-ARCHPLAT-015 Token 同源与引用可解析 | Pass |
| 016 / 015-02 所有权 | 骨架为 `overwrite` 登记；根 `DESIGN.md` 不在模板 manifest、作业包与架构包 manifest 中；README 有骨架行并说明根目录 `DESIGN.md` 属项目文件；模板更新后根 `DESIGN.md` 哨兵内容不变，投递的骨架与源一致 | template-surface：TC-ARCHPLAT-016 所有权；update-template 引导断言 | Pass |
| 016 / 015-02 去重 | UX 规范删除色彩、排版、间距、其他视觉 Token 四张表及 `4.5:1`、`44×44`，保留「状态覆盖」、检查清单与 §7.5 工具表；PRD 模板、prd 模块模板改指向 `DESIGN.md`；四个文件无误标，PRD 手册不含 `44×44` | template-surface：TC-ARCHPLAT-016 去重与误标 | Pass |
| 017 / 015-03 路由 | PRD、ARCH、TDD、QA 四个阶段的七个专家与手册文件均指向 `DESIGN.md`；PRD 专家点名骨架，ARCH 手册只写实现映射、不复述取值，两份 QA 文件对照 `DESIGN.md` 核验设计还原度，TDD「UI 实现约定」点名 `DESIGN.md`、YAML front matter、`docs/standards/ui.md`、`styles.css` | template-surface：TC-ARCHPLAT-017 路由 | Pass |
| 017 / 015-03 范围 | TASK、DEVOPS 专家与手册、`AGENTS.md`、`docs/CONVENTIONS.md`、`RULES.example.md` 不含 `DESIGN.md`；`AGENTS.md` ≤ 180 行、TDD 专家 ≤ 220 行、三份 MODULE-TEMPLATE ≤ 350 行 | template-surface：TC-ARCHPLAT-017 范围与体量 | Pass |

| 验证层 | 组合与结果 |
| --- | --- |
| 先红后绿 | 6 条新增契约测试在无实现时 5 条因预期原因失败（缺骨架、缺登记、模板未去重、专家未路由）；第 6 条（017 范围与体量守卫）在基线即通过，作为边界守卫保留；实现后 template-surface 47/47，update-template 14/14 |
| 定向回归 | 合并 origin/main（v3.7.33，含 `pnpm agent -- tdd commit` 与令牌来源条款）后，27 个测试文件逐个执行 `pnpm agent -- test --file … -- node --test`：281/281，0 失败、0 跳过；setup 13 个文件 175/175，agent-runner 7 个 70/70，tdd/qa/shared 3 个 14/14，architecture 4 个 22/22 |
| 体量 | 骨架 61/80 行；`AGENTS.md` 175/180 行；TDD 专家 170/220 行（含同步带入的 `tdd commit` 两行）；prd、arch、qa 三份 MODULE-TEMPLATE 为 160、175、176/350 行 |
| 常驻上下文 | `AGENTS.md`（18,970 B）、`docs/CONVENTIONS.md`（26,778 B）、`RULES.example.md` 零改动；新增 UI 文字全部落在按需读取的文件，TDD 阶段每次激活多读一句（+140 B） |
| 字节账 | 13 个内容文件净 +4,279 B：骨架 +2,938 B，UX 规范 −1,360 B（242→199 行），其余专家、手册、模板、README 与 manifest 合计 +2,701 B |
| 版本 | `package.json`、`agent/manifest.json`、`template.manifest.json` 一致为 3.8.0，高于合并后的 origin/main（3.7.33） |

测试范围按 `docs/CONVENTIONS.md` §测试范围与证据复用界定：本轮只改文档、模板与清单路由，没有改运行时代码，选择定向范围而非全量；未运行全量 `pnpm test`、E2E、性能、安全与负载测试，也未运行架构包的浏览器样本和 `devops-run` 测试。范围决策与逐文件结果记录在任务证据中。

Review-Class: REQUIRED；Domain-Hit: 共享模板、跨专家路由、清单所有权。已复核：取值只在 `DESIGN.md` 一处，UX 规范、PRD 模板、模块模板与 PRD 手册不再复述 `4.5:1`、`44×44`，PRD 的 AC-015-02 所说「误标更正」体现为误标不再出现于这些文件，更正后的写法只在骨架 Accessibility 中；骨架 `overwrite` 而根 `DESIGN.md` 不入任何 manifest，更新不会写入或覆盖项目文件；路由以「任务触及界面且根 `DESIGN.md` 存在」为条件并有回退，TASK、DEVOPS 与三份常驻规则无路由；44×44 只更正标注（推荐值与 WCAG 2.2 SC 2.5.8 最低 24×24 AA 并列），不改 WCAG 2.1 AA 基线；骨架色值与圆角同 `tokens.css`；下游影响见 CHANGELOG：骨架为新增的 `overwrite` 文件，下游下次同步时创建，其余模板自有文件的更新沿用既有所有权与基线比对规则。Post-Push `/code-review` 未执行：执行器为 Claude Code，需先安装 `code-review@claude-plugins-official` 插件，安装属外部下载、未获授权；替代复核有两项：`code-simplifier` 子代理复核了本分支新增测试（在首次推送之后执行，提 7 条建议，全部采纳，均未放宽断言），以及执行器对完整 diff 的语义自查（业务文件仅三处版本号与一条 `overwrite` 登记，共 10 行），二者都不等同于独立 `/code-review`。3/3 新增 AC 通过，无遗留阻断缺陷，Go（模板源码）；最终交付以当前提交 QA receipt、合并及 completion guard 为准。

限制与未覆盖：① 没有运行官方 `@google/design.md` lint（规范为 alpha，运行需要下载，未获授权），骨架的键、章节顺序与 `{ref}` 解析只由契约测试固化；② `DESIGN.md` 与 `styles.css` 之间没有自动漂移检查，依赖专家点读与 QA 核验，由 TASK-ARCHPLAT-012 补齐；③ 规范 alpha 没有暗色机制，骨架以「暗色策略」一句文字约定，不能机器校验；④ 没有真实浏览器或设备上的视觉验收，规范合规不代替视觉还原度与无障碍实测；⑤ 文档脚本：`arch:lint` 退出 0（既有 6 条警告），`task:lint` 退出 0，`qa:lint` 退出 0（1 条既有警告：data-semantics 缺 QA 模块）；`prd:lint` 退出 1，仅因 data-semantics 与 drizzle 两个未触及的模块缺第 7 节，Story ID 格式（109 个）、Given-When-Then 与 architecture-platform 模块结构三项对本轮新增内容均通过；`arch:sync` 与 `sync-prd-task-ids` 在 main 基线即失败，因为检查器只认标题式 Story 定义，而多数模块 PRD 以表格登记，本轮新增的 US-ARCHPLAT-015 使 `arch:sync` 由 31 条增至 32 条，TASK-ARCHPLAT-011、012 与既有 001～010 一同列为孤立任务，同因，均未在本轮修复。

本轮证据：任务证据中的 `TEST_SCOPE_DECISION` 与 `TEST_SCOPE_RESULT`、逐文件测试日志（由 `task exec` 写入并记录哈希）和 RED/GREEN 摘要。具体 base/head SHA 由回执与 PR 保存，文档不嵌入自身提交 SHA。
