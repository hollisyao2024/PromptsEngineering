# 息壤（Xirang）

息壤提供两类可独立采用的能力：规范大模型的工程作业流程，以及按照实际项目的选择规划、初始化、检查和升级应用架构。它面向多端 Monorepo，也允许小项目只采用作业流程或少量技术模块。

模板源维护协议、可运行实现、组件源码、版本清单和生成器；实际项目按选择接入。模板源不预装各技术栈的应用依赖。版本记录见 [CHANGELOG](CHANGELOG.md)。

## 先决定采用范围

| 项目当前需要 | 操作 | 项目会得到什么 |
| --- | --- | --- |
| 只规范模型作业 | 首次从源执行 `template update`，或已接入后执行 `template sync`，指定 `--scope agent` | 作业协议、阶段工具、worktree 与更新引擎；不生成架构目录和业务应用 |
| 先有架构规划入口 | `template update` 或 `template sync`，指定 `--include architecture` | 作业包加 7 个轻量架构文件；不生成应用、不安装应用依赖 |
| 落实选定技术 | 确定 `architecture.config.json`，再执行 `architecture plan/init/check` | 所选应用、组件、模块和依赖闭包；后续可显式追加选择 |

以上是同一套能力的不同采用范围。已有架构项目执行 `--scope agent` 时保持已采用的架构文件；它不是卸载命令。`--scope agent` 不能与 `--include architecture` 同用。

[作业包说明](agent/README.md)介绍模型工作方式；[架构包说明](architecture/README.md)介绍选型与生成。[通用约定](docs/CONVENTIONS.md)规定流程和所有权，应用技术标准在源的 [architecture/standards](architecture/standards/directories.md) 中维护，采用后按选择进入项目 `docs/standards`。

## 首次接入项目

准备 Node.js、pnpm 和 Git。生成应用时再满足所选技术栈的工具链要求，详见[初始化与安装](architecture/README.md#初始化与安装)。

目标目录必须已经存在。全新项目可先使用尚未加入 Git 的空目录；已有 Git 项目先按自身生命周期准备干净的专用 linked worktree，把它作为目标。已有息壤的项目使用下一节的 worktree 命令。项目接入后，tracked 文件修改统一遵守 [AGENTS.md](AGENTS.md) 的任务和 worktree 门禁。

在息壤源仓库执行下列命令；把占位目标替换为实际路径，包含空格时保留引号：

~~~bash
# 先预览作业包
pnpm agent -- template update "<目标目录或目标-worktree>" --scope agent --dry-run

# 核对计划后应用；命令内部还会预演、检查冲突并验证再次预演收敛
pnpm agent -- template update "<目标目录或目标-worktree>" --scope agent

# 如果现在需要架构规划入口，可在相同目标上追加
pnpm agent -- template update "<目标目录或目标-worktree>" --include architecture
~~~

首次接入会初始化缺失的项目配置和环境示例；已有 `agent.config.json`、环境文件、`RULES.md`、业务源码和真实项目文档保持项目所有。根 `package.json` 按字段合并，项目名称、业务依赖和项目独有脚本保留。

将生成的 `xirang.lock.json` 与 `.xirang/baselines/` 一起提交。它们记录上游版本、文件所有权和后续三方更新依据；手工复制模板文件不会建立这套依据。新项目应在完成自身 Git 初始化后纳入版本管理；已有 Git 项目完成下面的交付链再合并。

## 已接入项目的日常更新

在实际项目说“更新息壤模板”，执行器会按 `AGENTS.md` 登记任务与可观察验收，建立专用 worktree，然后执行官方同步和项目交付链。核心命令如下：

~~~bash
# 在目标项目中执行；task id 与已登记的更新任务保持一致
pnpm agent -- worktree new --phase=tdd --task update-xirang

# 切换到输出的 NEXT_CWD 后执行
pnpm agent -- template sync
~~~

默认同步更新作业包和已经采用的架构选择。只更新作业包用 `--scope agent`；首次加上轻量架构入口用 `--include architecture`。同步本身不会添加新的应用、数据库或技术模块，也不会代替项目运行数据库迁移或部署。

官方同步每次通过匿名 HTTPS 获取[官方仓库](https://github.com/hollisyao2024/PromptsEngineering.git)的 main，固定本次 commit SHA，再执行该提交内的 updater。下载不读取项目 `GH_TOKEN`；项目自身的 fetch、push 和 PR 继续使用项目鉴权封装。获取失败或源校验失败会阻断，不使用缓存假装获取了最新版。仅在 Git 配置中设置的代理或 CA 不会被继承；需要时通过 `HTTPS_PROXY`、`GIT_SSL_CAINFO` 或 `GIT_SSL_CAPATH` 环境变量提供。

文档或脚本更新之后，继续在该 worktree 完成交付：

~~~bash
pnpm agent -- tdd sync
pnpm agent -- tdd push
pnpm agent -- qa plan
pnpm agent -- qa verify
pnpm agent -- qa merge
~~~

合并前会复验 QA 回执与当前 base/head SHA；发现漂移需重新同步和 QA。合并后在主 worktree 复核本地与远端主分支、执行 `pnpm agent -- finish`，再关闭对应 task。各阶段只运行本地门禁；GitHub workflows 由实际项目维护。

## 从缺少基线的旧版接入

旧版或手工复制的项目可能没有 `xirang.lock.json` 和 `.xirang/baselines/`。当已有受管文件需要接管时，普通更新会报告 `adoption required`；这需要先检查现有文件相对模板的差异。

已支持接管参数的项目，在干净 linked worktree 中执行：

~~~bash
pnpm agent -- template sync --adopt --dry-run
pnpm agent -- template sync --adopt
~~~

如果旧引导器不识别 `--adopt`、`--scope` 或 `--include`，从新版息壤源仓库对同一个目标 worktree 执行一次引导：

~~~bash
pnpm agent -- template update "<目标-worktree>" --scope agent --adopt --dry-run
pnpm agent -- template update "<目标-worktree>" --scope agent --adopt
~~~

`adopt` 保留当前内容作为相对所选上游的项目定制，并建立更新依据。它不证明旧文件来自哪个历史版本，也不会把所有旧协议和脚本强制替换成新内容。接管后必须逐项核对保留的协议、入口和脚本是否需要迁移，不能仅凭 lock 中的版本号宣称每个文件都已升级。

已有基线但出现本地漂移或重叠修改时，按计划处理冲突；`adopt` 不能绕过已有的冲突保护。具体语义和恢复方法见[更新、接管与恢复](architecture/README.md#更新接管与恢复)。

## 按需求初始化架构

获得轻量入口后，在实际项目中执行：

~~~bash
pnpm agent -- architecture catalog
pnpm agent -- architecture detect
~~~

`catalog` 列出可选实现；`detect` 只读识别现状并提供建议。ARCH 阶段根据需求确认应用、存储、平台、模块与实际目录，写入项目所有的 `architecture.config.json` 和架构决策，再执行：

~~~bash
pnpm agent -- architecture validate --config architecture.config.json
pnpm agent -- architecture plan --config architecture.config.json
pnpm agent -- architecture init --config architecture.config.json
pnpm agent -- architecture check
~~~

plan 不写入项目目标；缓存缺失时可能先准备固定源码缓存。`init` 生成所选代码并默认安装依赖，之后还要运行相应应用的测试和构建。只生成文件可指定 `--no-install`，随后用 `architecture install-deps` 补齐依赖。冻结计划由 `architecture apply --plan` 消费，它只写文件、不隐式安装依赖。

现有 Go、Node、PostgreSQL、SQLite 和目录位置都由项目选择。`detect` 不能擅自换栈；现有 DataTable 的位置和别名需要明确映射，初始化不会自动搬迁业务目录。增选模块使用显式 `architecture init/update`；减选不会自动卸载仍可能被业务引用的代码。

| 能力 | 源仓库参考 |
| --- | --- |
| 多端 Monorepo、4 种蓝图、Node/Prisma PostgreSQL 与 SQLite、契约和 API client | [Monorepo 指南](architecture/guides/monorepo.md) |
| shadcn 基础控件、公共 DataTable、表单、选择器、状态与高级交互 | [组件说明](architecture/components/shadcn/README.md) |
| 身份、权限、任务、国际化、日志、追踪、API Mock | [开源能力指南](architecture/guides/open-source-components.md) |
| 本地、S3、阿里云 OSS、腾讯云 COS 及多存储路由 | [文件存储指南](architecture/guides/file-storage.md) |
| 每项组件的实现状态、采用条件与备选方案 | [完整组件目录](architecture/open-source-catalog.json) |

## 源目录与实际项目目录

| 位置 | 息壤源仓库 | 实际项目 |
| --- | --- | --- |
| `agent/`、`AgentRoles/`、`infra/scripts/` | 作业包及兼容执行入口 | 按作业包 `manifest` 安装和更新 |
| `architecture/` | 标准、组件 Registry、模块、蓝图、生成器和测试 | 7 个轻量 metadata/入口文件；完整模板不复制到业务仓库 |
| `tooling/xirang/` | 共享更新引擎、来源验证和恢复工具 | 随所采用能力安装 |
| `apps/<app>/` | 各技术模板位于 architecture 中 | 独立应用的实际源码 |
| `packages/<module>/` | 各模块模板位于 architecture 中 | 选定共享组件与公共模块 |
| docs/standards/ | 原文位于 `architecture/standards/` | 所采用架构的目录和技术约束 |
| `architecture.config.json` | 提供 schema、示例和蓝图 | 项目自行维护的真实选择 |

实际项目的 `architecture/runtime.json` 固定来源提交、版本和内容摘要。完整生成器在容器 `cache/xirang/sources/` 按需准备；命令会输出 `ARCHITECTURE_SOURCE_ROOT`，可从其中的 `architecture/guides/` 读取匹配版本指南。缓存命中时可离线使用；丢失时重新获取同一提交，损坏或来源漂移时阻断。获取最新版本仍使用 `template sync`。

Git 下载和缓存可能包含完整源码快照；轻量化指项目只提交入口和所选生成物，不承诺逐组件网络下载。3.3 全量 runtime 升级到 3.4 时，仅缩减 lock 登记且未被项目修改的旧 runtime 文件；项目定制、未知文件及其他所有者引用的基线保留。

前端选用 shadcn 时，默认基础控件在 `<app>/<sourceDir>/components/ui/`，公共表格在 `<app>/<sourceDir>/components/data-table/`；也可映射到 `packages/ui/src/` 下供多端复用。业务层遵守项目 `docs/standards/ui.md`，统一通过公共组件实现交互。完整目录与映射规则见[目录标准](architecture/standards/directories.md)。

容器拓扑与应用内部目录分别管理：

~~~text
<container>/
├── repo/          # 主 worktree，协调与生命周期入口
├── worktrees/     # 修改任务的 linked worktree
├── tmp/           # 任务、锁、报告和短期证据
├── cache/         # 可重建源码和工具缓存
└── artifacts/     # 构建与交付产物
~~~

脚本通过共享配置解析容器路径；linked worktree 中不手写 `../tmp`。`node_modules` 在各 worktree 独立建立，依赖内容复用交给包管理器 store。

## 更新与定制的边界

| 内容 | 更新方式 |
| --- | --- |
| 模板作业协议、执行工具、轻量架构入口 | `overwrite`；先验证已安装基线，本地漂移会阻断 |
| 已实例化的组件、公共模块、技术标准 | `update`；三方合并保留项目定制，重叠修改报冲突 |
| `package.json` 等共享配置 | 按字段三方合并；项目独有键保留，未定制的受管脚本可随上游更新 |
| 迁移与稳定 ID 注册项 | 只追加；已有内容不可改写 |
| `.gitignore`、`.envrc` 的受管区域 | `managed-block`；块外内容归项目 |
| 初始业务代码、配置、环境示例 | `init-if-missing`；已有文件保持原样 |
| `RULES.md`、项目独有源码、真实项目文档、部署实现、`.github/workflows/` | 项目所有，模板不写入 |

项目差异写入稀疏 `agent.config.json`、`architecture.config.json`、环境变量或项目自有文件。通用协议或工具本身需要改进时，更新息壤源再分发。已有项目的旧 package aliases 保留兼容；新说明统一使用 pnpm agent -- <domain> <action>。

中断时保留 worktree 和日志，按冻结计划恢复。已安装架构入口用 `pnpm agent -- architecture resume`；仅作业包用 `node tooling/xirang/resume.js`。恢复完成后补检查和交付；不要删除基线或把本地文件手工标记为未修改。

模板回灌使用显式 `template backfill` 操作，只处理可回灌的 template-owned 差异。具体限制见 [AGENTS.md](AGENTS.md) 与[通用约定](docs/CONVENTIONS.md)。

## 模型作业流程

`AGENTS.md` 是轻量路由；任一时刻激活一位专家，再按需读取 [AgentRoles/Handbooks](AgentRoles/Handbooks/README.md)。

既有范围内的缺陷、重构、测试、文档和工具维护采用日常流程：只读诊断 → 专用 worktree → TDD → QA → 合并交付。需求、架构、数据合约、权限或部署拓扑变化采用治理流程：PRD → ARCH → TASK → TDD → QA，需要环境或发布工作时再进入 DEVOPS。

治理文档采用总纲和模块目录，详情在 `docs/{prd|arch|task|qa}-modules/`；`docs/AGENT_STATE.md` 只记录六阶段稳定里程碑。长任务步骤、分支、PR、重试与恢复分别进入容器 tmp 的 `task/worktree session`，不写成稳定文档日志。

各工具入口和完成条件以 [AGENTS.md](AGENTS.md) 和[通用约定](docs/CONVENTIONS.md)为准。项目的本地服务、构建、部署和平台命令通过 `agent.config.json` 接入；显式平台、环境或 profile 缺少配置时阻断，由项目补齐实际实现。
