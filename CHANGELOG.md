# Changelog

 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [Unreleased]

## [v3.7.25] - 2026-10-05

- `docs/CONVENTIONS.md` §8 去除五处已在同节或 `AGENTS.md` 中有逐字副本的重复子句，规则含义不变：首段「进入 QA、创建 PR 或命中高风险标签也不能单独证明需要全量」（保留于「全量」段「均不能单独触发全量」）；「遇到范围不明先调查，仍不明再升级，不猜测范围」并入第三类全量触发「（不猜测范围）」；「大日志留在任务 evidence」（保留于 `AGENTS.md`「完整日志写入任务 evidence」与 §6 `evidence/` 目录）；QA 复用段重复的「提交前运行可用受测文件摘要核对」并入记录段「（可用受测文件摘要核对）」；运行器段「按上段记录触发依据」（保留于同段 `task exec` 放行条件与记录段 `full_trigger`/`trigger_evidence`）。变更影响表、`TEST_SCOPE_DECISION/RESULT` 字段与枚举、示例命令及全部必须/禁止类规则原样保留；新增契约测试固定各保留项与删除项。

## [v3.7.24] - 2026-10-04

- `docs/CONVENTIONS.md` §8 删除已在 `AGENTS.md`「修改与交付门禁」「GitHub 与安全」、TDD 专家（数据库与迁移、语义审查）和架构数据标准中有正式副本的四个段落（交付流水线与 completion guard、数据库 schema 变更、迁移注册表、高风险域），官方息壤源 `tdd sync` 版本递增段落缩为一句话并指向 `source-version-sync.js`；`### 测试范围与证据复用` 标题、影响范围表、四类全量触发与 `TEST_SCOPE_DECISION/RESULT` 规范保持不变。§5 回执段落补充「回执不跨电脑共享，换电脑合并须重新 `qa verify`」，原跨电脑语义不丢失；新增契约测试固定保留项、删除项与各正式副本。

## [v3.7.23] - 2026-10-04

- Node/Go 通用 OSS 适配兼容未开启、开启及暂停版本控制：缺少版本头规范化为 null，新增可选固定版本读/核验/删及包含删除标记的完整分页，权限或状态异常中止；保留独立最终文件与暂存重放保护，不回灌项目配置或迁移。

## [v3.7.22] - 2026-10-04

- `docs/CONVENTIONS.md` 删除与 `AGENTS.md`“上下文预算与阶段交接”重复的 §11（仅留一行指向）以及「失败分类与恢复」章节；失败分类（`tool_error|policy_denied|unknown_result`）、启动状态证据与恢复规则并入 `AGENTS.md`“长任务断点续跑”作为唯一来源，`.codex/README.md`、TDD playbook 引用同步改指 `AGENTS.md`，相关契约测试随之更新。

## [v3.7.21] - 2026-10-04

- `.claude/settings.json` 团队 allowlist 放行稳定入口的本地生命周期命令（`pnpm agent -- task start|checkpoint|resume|context|extend|transition|finish|paths`、`worktree new|list|resume`、`tdd sync`、`qa plan`、`qa verify`）；`tdd push`、`qa merge`、`finish`/`tdd finish`（自动串联 push 与 merge）、`worktree bootstrap`（执行依赖安装）、`task exec`、`task cancel`、`test`、`build`、`ship`、`template` 等有远端、部署或任意命令执行副作用的入口仍需确认。新增 `claude-settings-allowlist.test.js` 契约测试，`.claude/README.md` 同步说明。

## [v3.7.20] - 2026-10-04

- `tdd push` 生成 PR 概要、变更内容与标题时排除同步配置主干产生的 merge 提交；分支上还有其他提交时，工作区自动提交的文件清单不再写入概要、也不影响标题判定（仅剩一个人工 Conventional 提交时直接用其标题），只有自动提交时仍保留文件清单。

## [v3.7.19] - 2026-10-04

- 子进程被信号终止时 `pnpm agent`、`github-auth-run.js`、`tdd finish` 及 worktree/TDD 入口按 `128+信号号` 非零退出，不再把 `status=null` 当作成功；`pnpm agent` 只把 `--` 之前的 `-h`/`--help` 视为自身帮助，透传给下游运行器的参数不再被拦截。
- `tdd push`、`qa plan|verify|merge`、`worktree remove|cancel|resume|bootstrap`、`template sync|update|backfill`、devops 运行器等有副作用的入口被直接调用时，`--` 之前的 `-h`/`--help` 只打印用法并退出，不再被当作普通参数继续提交、推送、合并或改写文件。
- 移除从未接入且依赖未分发钩子源的 `install-git-hooks.js` 与 `pre-commit`，模板迁移按基线删除未修改的旧安装器；需要提交前检查的项目改用 `agent.config.json` 的 `tdd.projectChecks` / `qa.projectChecks`，由 `tdd sync` 与 `qa verify` 强制执行，不受 `--no-verify` 绕过、无需逐机安装。
- 删除源仓库残留的其他项目 GitHub workflow；根 `pnpm test` 纳入 `architecture/__tests__/*.test.mjs`，并以契约测试防止测试文件漏出聚合脚本；存储模块声明 ESM，消除 Node 模块类型重解析告警。
- `docs/CONVENTIONS.md` 补全 `remove` 策略与 manifest 兼容写法说明；`[Unreleased]` 历史条目归档到实际发布版本，官方源 `tdd sync` 递增版本时同步把 `[Unreleased]` 条目移入对应版本标题。
- `docs/data` 全局测试矩阵补齐 3.5–3.7 模块登记。

## [v3.7.18] - 2026-10-04

- PRD ↔ ARCH 追溯检查扫描 `docs/prd-modules/<domain>/` 下全部直接子级 Markdown 文档（含拆分规格），不再只读取模块 `PRD.md`；仅正式需求标题中的编号计为定义。

## [v3.7.17] - 2026-10-04

- `tdd push` 旧 PR 升级覆盖 3.7.14 生成的无标记正文（概要取提交要点、变更内容列 sha7）：与按分支提交重建的内容逐字一致时升级为带摘要标记的块，已修改或所列提交已不在分支上时保持原文。

## [v3.7.16] - 2026-10-04

- `tdd push` 自动概要起始标记记录内容摘要，人工修改过标记内文本时不再覆盖并给出提示；早期无标记但仍为自动格式（概要只有 PR 标题）的 PR 在再次推送时升级为带标记格式；工作区自动提交的正文逐条列出改动文件，概要不再只剩标题。修复 `git status --porcelain` 首行状态列被 trim 截断的问题。

## [v3.7.15] - 2026-10-04

- `tdd push` 自动生成的「概要」「变更内容」包在 `xirang:auto-summary` 标记内，已有 PR 再次推送时按当前分支提交刷新标记内文本，标记外手写内容与无标记的旧 PR 保持不变；`qa merge` 解析概要时忽略 HTML 注释行。修复 Review Gate 替换后吞掉下一章节前空行的问题。

## [v3.7.14] - 2026-10-04

- `tdd push` 新建 PR 时读取分支相对配置主干的提交：「概要」取提交正文中的 `-`/`*` 要点（无要点时取提交标题，无提交时回退为 PR 标题），「变更内容」列出短 SHA 与提交标题；分支只有一个 Conventional 提交时直接用其标题作 PR 标题。`qa merge` 以概要作为 squash 提交正文，合并记录不再只有一行。

## [v3.7.13] - 2026-10-04

- `qa merge` 的远端 squash 合并（gh CLI 与 GitHub API）与本地降级使用同一提交格式：标题为 `PR 标题 (#编号)`，正文为 PR「概要」段，不再落入 GitHub 默认的逐提交列表。

## [v3.7.12] - 2026-10-04

- `qa merge` 摘要的「策略」按实际合并后端显示：gh CLI 为 `gh pr merge --squash`，GH_TOKEN 走 GitHub API 时为 `GitHub API squash merge`，降级时为 `本地 git merge --squash`；本地 squash 提交信息不再硬编码 `Co-Authored-By: Claude Opus 4.6`，模板对 Codex 与 Claude 等执行器保持中立。

## [v3.7.11] - 2026-10-04

- `tdd push` 在本机缺少 gh CLI 时改用 `.env.local` 的 `GH_TOKEN` 走 GitHub API 创建 PR（base 为配置主干）或同步已有 PR 的 Review Gate，与 `qa merge` 共用 `infra/scripts/shared/github-api.js`；gh 与 GH_TOKEN 都不可用或 PR 创建失败时输出 `STATUS=BLOCKED` 并非零退出，不再只打印手动链接后静默成功。自动提交信息与 PR 标题按分支前缀（feature/fix/docs/refactor/test 等）生成 Conventional 类型并去掉末尾日期，不再出现 `chore: auto-commit before /tdd push`。

## [v3.7.10] - 2026-10-04

- 修复合并证据门禁：fixed-commit 下历史阻塞记录仅降级严重度或改为条件通过、未明确关闭/达标时阻断；严格模式（含 project）同样按 `qa.mergeEvidence.qaModulesDir`、`nfrTrackingFile` 读取证据；fixed-commit 发布结论的 P1 未修复/修复中统计与严格模式一致。

## [v3.7.9] - 2026-10-04

- 合并证据保持默认严格，新增项目显式启用的 `qa.mergeEvidence.mode=fixed-commit`：从 QA 回执的固定 base/head Git 快照检查新增或变化的阻塞、证据删除与未闭环记录，并单独输出发布结论。逐记录语义指纹避免无关文档修改误阻断；证据路径可配置且非法输入 fail closed。模板同步/update 的 Git 测试夹具固定换行；既有 Codex 维护分支兼容只做回归，不增加或推荐新的分支命名。

## [v3.7.1] - 2026-10-01

- 首次应用与后续更新息壤时自动补齐缺失的 `RULES.md`；已有文件（含空文件）保持原样，初始化后由项目维护。模板接入允许补齐缺失规则，创建后仍须完整预读再执行其他项目操作。

## [v3.7.0] - 2026-10-01

- 增加 Drizzle ORM/Kit 稳定组合，补齐任务 API、身份权限、文件 CAS、pg-boss 同库事务与原生迁移检查；Prisma 扩展 PostgreSQL、MySQL/MariaDB、SQLite。独立 schema、历史和驱动禁止自动转换，保留项目定制与旧 SQL。
- 官方源交付同步自动递增整体/独立架构版本，保留更高显式版本且重复同步幂等；整体模板与 Agent 发布清单同步为 `3.7.0`，独立架构能力包为 `3.5.0`；数据库差异、目录、原生迁移与验证限制见架构文档。
- 模板从 linked worktree 更新实际项目时，六个环境文件检查与缺失补建以目标项目主 `repo` 根目录为准；已有内容保持不变，实际文件从主 repo 对应 example 初始化，dry-run 不写入并报告目标路径。

## [v3.6.2] - 2026-09-28

- 测试范围默认按影响定向选择；全量仅在四类有证据的条件下升级。TDD 执行前记录结构化决策，QA 复核并复用有效结果；实际项目 `qa verify` 在签发 SHA 回执前校验证据与当前提交，纯文档任务可只提交静态/契约检查结果。
- 移除 Codex 侧无效的 `SessionStart` `GH_TOKEN` 环境注入钩子。Codex 不提供 `CLAUDE_ENV_FILE`，且 Hook 输出不能修改父进程环境；模板迁移会显式删除旧 `.codex/hooks.json`，Windows/macOS/Linux 的远端 GitHub 操作统一使用跨平台 Node 鉴权入口读取 `.env.local`。
- 修复阶段交接导致已授权任务停顿：PRD→ARCH→TASK→TDD→QA 默认刷新胶囊后连续推进，转换、恢复和胶囊统一输出自动续跑状态及精确 task ID 恢复命令。确需换执行器时先确认接管，宿主无交接能力且预算允许时在当前任务继续；保留未知副作用、真实阻塞、QA 和 completion guard，并增加跨进程完整阶段与中断恢复回归。

## [v3.6.1] - 2026-09-24

- 修正 `3.6.0` 迁移清单遗漏，显式删除状态模板和 `agent-state-utils` 实现及旧测试，确保旧消费者同步后不会残留已废弃入口。

## [v3.6.0] - 2026-09-24

### 移除 tracked 阶段状态文件

- 删除 `docs/AGENT_STATE.md` 和状态模板；分支、PR、步骤、重试、QA 回执与部署结论只保存在 task state、worktree session 和权威报告。
- `tdd push`、`qa plan`、`qa verify` 不再写阶段状态 Markdown；`qa merge` 不再读取或更新该文件。
- 删除 `agent-state-utils.js` 运行态写入入口；共享 Markdown 扫描器改为只读模块。
- AGENTS、专家、Handbook 和模板文档移除 `AGENT_STATE` 里程碑回流指令，并增加移除防回归契约。

## [v3.5.0] - 2026-09-23

### 上下文预算与阶段交接

- 新增只读 `task context`：按字节上限生成任务目标、阶段、验收、当前步骤、最近证据和下一动作胶囊，不创建目录、锁或状态。
- 新增 `task exec`：完整 stdout/stderr 写入任务 evidence，自动去除 ANSI，只回传退出码、耗时、日志路径、SHA-256 和有界摘要。
- `task transition` 增加 `CONTEXT_HANDOFF_REQUIRED` 与 `CONTEXT_COMMAND`，要求阶段边界在新执行上下文中继续。
- AGENTS、CONVENTIONS、阶段专家和 Codex 配置示例增加 180k 工作阈值、70% 缓存门禁、默认 4k 工具输出和约 8KB 长命令摘要预算。
- TDD/QA 改为使用任务胶囊和模块点读，不再要求全文加载 `docs/AGENT_STATE.md` 或大型阶段文档。

### 任务记录与 worktree 交付

- 缺少 lock 的旧消费者可显式指定 `--legacy-baseline <ref>`，按固定 Git 提交迁移未改动的模板 overwrite 文件；保留漂移阻断、项目所有权和已有 lock 优先。增加真实安装副本的模板边界回归，确认不依赖完整架构源码。
- 修复 Windows 匿名 Git 环境使用 Node 扩展空设备路径导致配置读取失败；改用 Git 可识别的 `NUL`，保留凭据隔离、禁止认证重试与 HTTPS 限制，并增加真实 Git 配置回归。
- 修正 TDD 手册仍默认落盘核查产物和任务帮助把工作类型称为只读类型的残留指引；通用约定直接提供跨执行器失败恢复协议，记录不可用时继续独立只读工作，保留修改与授权门禁。
- 允许开发 worktree 保留本地未提交内容并合并已验证提交；增加 `tdd push --committed-only`，合并后保留未提交内容并单独报告清理状态。
- 单会话只读核查不再因步骤数量强制创建或恢复任务记录；六阶段统一引用持久化触发规则，修改和需恢复的副作用仍保留任务门禁。
- 新增只读 `pnpm agent -- task paths [--task <id>]`，列出主项目、任务状态与锁目录，明确路径解析不等于权限授权；更新容器可写范围与策略拒绝说明，记录不可用时继续获准的独立只读检查。
- 任务 checkpoint 增加普通工具故障、策略拒绝、未知结果的结构化证据和只追加恢复历史；未知执行结果先核验，恢复必须提供依据，不自动重试或修改平台权限。
- 明确任务记录自身不可用时的最小证据协议、生命周期操作拆分和恢复边界，纠正 Codex never 等于所有命令放行的说明。

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
