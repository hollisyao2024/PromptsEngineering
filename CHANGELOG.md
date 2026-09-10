# Changelog

 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v3.4.3] - 2026-09-11

### 状态文档边界与验收索引修复

- 旧 `IN_PROGRESS` 字段的读写与清理限定到真实章节，空值不跨行，保留区外内容、代码示例、字段名和换行；相同值与重复清理不写文件。
- QA 里程碑按真实列表项识别，兼容大小写勾选并排除代码块、缩进示例、引用和注释；首次完成与初始化保留换行风格，重复条目或未闭合示例明确报告错误。
- 对齐开源公共能力、文件存储和环境初始化的任务模块、索引、总纲及追溯状态，引用已有 QA 证据；真实云、外部身份服务和跨平台发布的验证边界保持明确。

## [v3.4.2] - 2026-09-10

### QA 里程碑状态修复

- QA 合并区分首次更新、里程碑已完成、文件缺失和读写失败；过程与汇总使用同一状态说明，已完成时不再误报失败。
- 已完成的 `AGENT_STATE.md` 保持内容与修改时间不变，不生成重复状态提交；缺失文件提示跳过，真实读写失败保留原因。
- 补充文件操作与合并汇总回归，覆盖首次完成、重复合并、条目初始化、文件缺失和读写错误。

## [v3.4.1] - 2026-09-10

### 轻量架构检查与模板写入边界修复

- TDD/QA 架构检查共用轻量 CLI 的固定来源校验，从缓存运行所选项目检查；损坏或缺失的来源指针和缓存明确阻断，旧全量布局及未选择架构的项目保持兼容。
- 模板更新和冻结计划写入均拒绝 Git 主 worktree、息壤源角色目标；专用 linked worktree 和独立空目录仍可正常初始化与更新。
- 无效 scope/include 明确报错；模板和架构计划文件必须保存到项目及其主 worktree 以外，拒绝符号链接绕过并避免覆盖项目文件、版本锁或 Git index。
- 修正 TDD 手册的轻量架构标准入口和发布日志责任，补充实际消费者的共享检查与写入边界回归。

## [v3.4.0] - 2026-09-10

### 轻量架构入口与按需生成

- 实际项目仅安装架构 README、catalog/schema、选型 metadata、来源指针和 CLI；未选技术模板、示例、Registry 实现与测试留在源仓库或可重建缓存。作业包可继续独立使用。
- 固定官方提交、版本与内容摘要；缓存原子发布、并发互斥、离线命中校验，缺失时匿名获取同一提交，损坏与来源漂移明确阻断。目录按实际项目的主 worktree 解析，standalone 同样支持。
- 保留 catalog/detect/plan/init/update/check、冻结 apply 与恢复入口，代码和依赖只按已选择的应用、模块及依赖闭包生成。普通模板同步不会启用新的技术选择。
- 3.3 全量 runtime 仅在文件未偏离基线时缩减；业务定制与未知文件保留。新 lock 持久化后才清理失去全部引用的旧 baseline，中断可恢复。
- 完成原始 3.3 两类升级与实际 Web 消费验证；使用约定、架构专家入口和测试追溯同步更新。未改变现有组件选型或默认安装版本。

## [v3.3.0] - 2026-09-09

### 开源公共能力与存储

- 提供 Better Auth/Prisma、CASL、pg-boss/BullMQ Redis/PostgreSQL、i18next、Pino、OpenTelemetry 追踪、MSW 的按需生成实现与使用指南；配置、业务策略和词条保持项目所有。
- 新增 shadcn 身份面板、任务状态、Uppy 上传、Tiptap 编辑、Recharts Chart、dnd-kit 排序、React Flow 与 TanStack Virtual 表格；48 项 Registry，复用唯一 DataTable。
- Node/Go 支持 local、S3、阿里云 OSS、腾讯云 COS 原生适配与多存储路由；提供受认证文件会话、上传大小签名绑定、不可变转正键、CAS 元数据及恢复。
- Prisma PG/SQLite 的身份和文件模型独立初始化，迁移只追加；队列迁移单独显式执行。依赖严格检查并固定兼容版本，模板源不安装应用依赖。
- 单模块采用/更新补齐相关应用和数据源依赖；新增完整选型目录、Monorepo 配置示例、真实消费者与升级测试。备选组件与真实云/外部 IdP 验证边界明确记录。

## [v3.2.0] - 2026-09-09

### 多端 Monorepo 与 Prisma

- 新增 v2 架构选择、pnpm workspace、共享包 exports 和四种可展开蓝图；目录按项目配置，v1 项目保持兼容。
- 新 Node TypeScript / Prisma 7.10 数据访问包支持 PostgreSQL、SQLite，独立客户端/环境/迁移历史；迁移完整性守卫阻断历史缺失、改写和失败状态。
- 提供 OpenAPI 3.1 类型与运行时校验、无 React API client、Query 缓存、配置与观测、AppShell 和 Browser/Tauri 平台适配。
- 任务示例通过公共 shadcn DataTable 联动真实 API，支持分页、多列排序、筛选、多选、CRUD、导出、权限和并发失败恢复。
- YAML 三方更新保留项目键与注释；业务 schema/合约/页面仅初始化、迁移只追加、包管理器持有依赖锁。真实 3.1 升级保留定制并收敛。
- 固定兼容安全依赖覆盖；模板源保留源码、生成器与必要 updater 工具，应用依赖只在选定消费者安装。验证与限制见 docs/qa-modules/monorepo-platform/QA.md。

## [v3.1.0] - 2026-09-09

### 公共交互组件

- 提供 FormField/Section、FormDialog/Sheet、可选 React Hook Form 适配；统一字段关联、提交防重、失败保留、未保存关闭确认和焦点恢复。
- 提供本地单选/多选、异步搜索选择、日期/日期范围、确认对话框、异步按钮、加载/空态/错误状态及通知，继续由 shadcn 基础组件组合实现。
- DataTable 复用公共确认和状态，增加受控多选与日期范围列筛选，保留原有 Props、稳定选择、CRUD 和导出合约。
- 新增 9 个官方基础组件，合计 33 个基础控件、39 个 Registry 项；依赖与官方来源摘要统一管理。

### 初始化与升级

- 支持 applications[].componentSets 按需选择；默认 DataTable 自动安装其依赖，表单与 React Hook Form 独立可选，显式空集合仅保留基础 UI。
- 组件可放在应用内或 packages/ui；共享消费者合并依赖，初始化、Registry 和架构检查共用同一组件闭包。
- 兼容旧配置默认值与组件 owner ID；取消选择不自动卸载已安装源码及其依赖。旧项目的页面、utils、按钮定制和自有脚本保持保留。
- 修复共享组件重复 React 实例、受控面板关闭焦点和受限视口中日期弹层被裁切的问题；验证范围及证据见 docs/qa-modules/architecture-platform/QA.md 第 8 节。

## [v3.0.1] - 2026-09-09

### 兼容性升级

- 对照官方 Registry 复核全部 24 个 shadcn 基础组件，采用 cn 0.2.6，并升级 React 19.2.8、Lucide 1.43.0、Next 16.3.4、TypeScript 6.0.3、Vitest 5.0.0 及配套测试/类型依赖。
- 固定版本统一记录于 architecture/dependencies.json；dependency-audit.json 记录最新版本、采用版本和兼容保留依据。TanStack Table 保留最新 V8，TypeScript 使用最新兼容 V6，Node 类型保持 22.x。
- 项目 lib/utils.ts 仅初始化，保留已有 helper；基础控件直接引用 cn，Registry 和应用生成器使用一致依赖。保留 clsx/tailwind-merge 兼容项目导入。
- 适配 TypeScript 6 的路径与显式类型配置，初始化 Next 类型声明以支持构建前独立 type-check。前端 Node 要求与 jsdom/Vitest 对齐为 22.22.2+（22.x）、24.15+（24.x）或 26+。

## [v3.0.0] - 2026-09-09

### 新增

- 分离 agent 作业包、architecture 架构包和 tooling/xirang 通用更新引擎；保留既有作业脚本的兼容路径。
- 按应用/存储选择 Vite、Next、Node、Go、Tauri、PostgreSQL、SQLite，以及契约、迁移、可观测性、资源、插件和私有交付模块。
- 提供架构配置、目录标准、检测、冻结计划、初始化、检查和模块升级命令；应用目录不绑定某一种后端或数据库。
- 内置 24 个 shadcn 基础控件、可发布 Registry 和基于 TanStack 的公共 DataTable，支持分页、多选、排序、筛选、列显隐、导出及真实异步 CRUD 回调。

### 更新与迁移

- 文件按覆盖保护、三方更新、字段合并、幂等追加、受管块和仅初始化策略管理；版本锁和基线随项目提交，运行日志保存在容器 tmp。
- 原生控件、重复低阶表格、目录/别名冲突和迁移摘要变化进入本地架构检查；中断按哈希恢复，源/目标/版本锁漂移时阻断。
- 旧消费者首次缺少基线时需要显式接管。接管保留现有内容作为定制，不等于把所有旧协议直接替换成新版本。RULES.md、业务源码和实际项目文档继续归项目维护。
- 通过 400 项源码回归、生成前端的 8 项交互测试及 Vite/Next 构建、真实浏览器旅程、Node/Go 骨架、macOS Tauri 编译和隔离数据库验证。

## [v2.2.1] - 2026-09-06

### 修复
- 官方公开息壤模板改为匿名 HTTPS 拉取，不读取项目 GH_TOKEN；隔离用户 Git 配置、credential helper、askpass、认证头与 URL 重写。
- 初始化、获取和检出使用同一匿名环境，输出 TEMPLATE_AUTH_MODE；保留固定 SHA、失败阻断及 apply 收敛，项目 GitHub 鉴权不变。
- 匿名下载保留代理/CA 环境变量、开启 TLS 校验且拒绝重定向；真实 HTTP 请求与项目凭据回归覆盖成功和拒绝路径。

## [v2.2.0] - 2026-09-06

### 新增
- 模板正式命名为“息壤”（Xirang），登记稳定 ID、官方 GitHub 仓库与默认分支。
- 新增 `pnpm agent -- template sync`：required fetch 远端、固定 commit SHA，并从远端快照自举最新版 updater。
- 实际项目中的自然语言“更新息壤模板”确定性触发专用 worktree 更新与既有 TDD/QA 交付链。

### 安全与兼容
- fetch、ref 或源形状校验失败时在目标 tracked 写入前阻断，不回退缓存或本地旧模板。
- 模板写入后新增 convergence dry-run；`RULES.md`、业务源码、项目配置等 project-owned 内容继续受 manifest 保护。
- `template.sourceRepo` 保持本地回灌语义，与官方只读上游配置分离。

## [v2.0.0] - 2026-07-12

### Breaking Changes
- PRD、ARCH、TASK、QA 仅保留“主总纲与索引 + module-list + 模块文档”结构，删除单一文档模式及规模阈值分支。
- 主模板统一重命名为 `PRD-TEMPLATE.md`、`ARCH-TEMPLATE.md`、`TASK-TEMPLATE.md`、`QA-TEMPLATE.md`。
- 模板升级会通过受控 `remove` 策略删除目标项目中 8 个废弃的 `SMALL/LARGE` template-owned 文件。

### 更新
- TASK 生成器聚合主/模块 PRD 与 ARCH，校验模块集合一致后固定生成模块 TASK。
- QA 全项目生成固定产出主 QA、模块清单和全部模块 QA。
- PRD、ARCH、TASK、QA lint 在缺少模块目录、模块清单或模块文档时失败。

## [v1.18.12] - 2026-04-20

### 更新
- feat: chore remove rules md

---


## [v1.18.11] - 2026-04-16

### 更新
- feat: fix in progress commit after push

---


## [v1.18.10] - 2026-04-16

### 更新
- feat: in progress tracking

---


## [v1.18.9] - 2026-04-16

### 更新
- feat: tighten post push gate review policy

---


## [v1.18.8] - 2026-04-11

### 更新
- feat: align tdd code review commands

---


## [v1.18.7] - 2026-04-08

### 更新
- fix: qa merge main worktree support

---


## [v1.18.6] - 2026-03-28

### 更新
- fix: qa merge auth token

---


## [v1.18.5] - 2026-03-27

### 更新
- feat: codemap high value scan

---


## [v1.18.4] - 2026-02-24

### 更新
- 发布新版 v1.18.4

---


## [v1.18.4] - 2026-02-17

### 更新
- `/qa merge` 新增自动 rebase 功能：合并前主动将 feature 分支 rebase 到最新 main，避免合并时才发现冲突。含冲突自动中止、force-push 失败回退等边界处理。
- 修正 `QA-TESTING-EXPERT.md` 步骤列表与"15个关键步骤"声明的偏差（原列 13 项，现补齐为 15 项）。

---

## [v1.18.3] - 2025-11-13

### 更新
- 扩充 `AgentRoles/QA-TESTING-EXPERT.md`，新增测试产物管理与测试工具配置检查指南，明确 .gitignore 规则、Playwright/Jest 推荐配置与 QA 预检流程。
- 将包版本提升到 `v1.18.3`，同步发布元数据以便追踪最新 QA 规范。

---

## [v1.18.2] - 2025-11-13

### 更新
- 扩展 `.gitignore`，纳入环境变量、构建产物、IDE 配置、测试缓存等常见临时文件夹，避免误提交个人或生成内容。
- 将包版本提升到 `v1.18.2`，保持发布元数据与当前仓库状态一致。

---

## [v1.18.1] - 2025-11-13

### 更新
- 将包版本提升到 `v1.18.1`，保持发布元数据与当前代码一致。

---
