# 息壤应用架构能力包

本包把技术标准、可选择的实现、组件源、初始化脚本和检查放在一起。模型如何工作由 `agent/` 管理；项目选了哪些技术由项目的 `architecture.config.json` 管理；两个包共用 `tooling/xirang/` 的文件更新引擎。

多端 Monorepo、Prisma 和四种预置组合的完整操作见 [Monorepo 指南](guides/monorepo.md)。模板源不预装应用依赖；新项目可用 `architecture init --blueprint admin-api --database sqlite` 按需生成。

## 从模板到实际项目

已有项目先按正常流程建立专属 linked worktree。使用息壤源仓库更新目标项目时：

```bash
pnpm agent -- template update <目标-worktree> --include architecture
```

已有息壤的项目可在自身干净 linked worktree 从官方源获取架构目录：

```bash
pnpm agent -- template sync --include architecture
```

此时只获得架构目录与执行能力，不生成应用。只需要模型作业流程的项目使用 `--scope agent`，无需安装前端、Go 或数据库依赖。

在目标项目中查看选择并规划：

```bash
pnpm agent -- architecture catalog
pnpm agent -- architecture detect
pnpm agent -- architecture validate --config architecture.config.json
pnpm agent -- architecture plan --config architecture.config.json --out <容器-tmp>/architecture-plan.json
```

ARCH 专家根据需求和 detect 结果维护项目配置，记录架构/ADR 后再初始化。`detect` 是只读建议，不能把无法识别的框架或混合存储猜成默认方案。已有 `components.json`、`tsconfig.json` 的别名可解析时保留；JSONC/继承配置和遗留 DataTable 位置会提示进一步核对。目录可确定，技术不由目录名字推断。

## 初始化与安装

前端应用及测试要求 Node.js 22.22.2+（22.x）、24.15.0+（24.x）或 26+，并需要 pnpm 和 Git；此范围与 jsdom/Vitest 的实际运行要求一致。所选 Go/Tauri 实现还需要对应 Go/Rust 与平台构建工具链。依赖固定值见 [dependencies.json](dependencies.json)，已核对的最新版本及兼容保留理由见 [dependency-audit.json](dependency-audit.json)。

```bash
pnpm agent -- architecture init --config architecture.config.json
pnpm agent -- architecture check
```

`init` 校验所有选择，生成计划，阻断冲突，写入所选骨架、组件和版本基线，然后安装依赖并检查。v1 安装关闭依赖生命周期脚本；v2 使用单根 workspace，在 onlyBuiltDependencies 中声明必要构建包，随后显式生成 Prisma Client 和合约类型。Go/Rust 工具链不会偷偷下载安装，原生构建由对应应用命令显式执行。

离线预演用 `plan` 或 `init --dry-run`，目标目录零写入；只生成文件用 `init --no-install`，输出 `DEPENDENCIES=PENDING`。随后执行 `architecture install-deps`、`architecture check`，再运行各应用的 `test`、`build`。`apply --plan <文件>` 消费之前冻结的计划，只写文件，不重复选择新源，也不隐式安装依赖。

架构包也能独立使用：`node architecture/scripts/cli.js <action>`。首次在一个已经创建的空目录初始化时从息壤源调用该入口，并显式 `--target <目录> --config <配置文件>`。Git 项目中的 mutation 必须使用 linked worktree，模板源本身不能作为应用生成目标。

## 配置模型与已提供实现

- applications：每个应用的 id、stack、path、sourceDir、targets、components、componentSets、modules。
- datastores：每个存储的 id、engine、path、consumers；一个项目可同时使用多个引擎。
- modules：独立公共模块和实际安装目录。
- profiles：id、kind、edition、environment、应用集合与交付目录；不自动回退其他 profile。

示例：[Web + Go + PostgreSQL](examples/web-go-postgres.json)、[Web + Node + SQLite](examples/web-node-sqlite.json)、[Web/API/桌面与多存储](examples/multi-platform.json)、[不生成应用](examples/agent-only.json)。Schema 为 [architecture.schema.json](architecture.schema.json)。

| 实现 | 生成物与验证入口 |
| --- | --- |
| react-vite | React/Vite/TypeScript、shadcn、DataTable；`pnpm test`、`pnpm build` |
| react-next | Next App Router、TypeScript、shadcn、DataTable；`pnpm test`、`pnpm build` |
| node-ts / Prisma（v2） | 类型化 Node API、Prisma PG/SQLite、OpenAPI、Query 与真实任务 CRUD；见 Monorepo 指南 |
| node | Node HTTP API、健康接口、HTTP 测试；`pnpm test`、`pnpm build` |
| go | Go HTTP API、健康接口、测试；`go test ./...`、`go build .` |
| tauri | Tauri 2 + React/Vite、Rust 入口、能力清单与平台矩阵；`pnpm build:web`，宿主机完整构建 `pnpm build` |
| postgres / sqlite | 独立迁移目录、SHA-256 注册表及执行器；`node migrate.mjs` 预检，`--apply` 才写数据库 |
| observability | 结构化事件、递归脱敏、采样与可注入 sink |
| contracts | 受支持 JSON Schema 对象生成 TypeScript，`node generate.mjs --check` 检查漂移 |
| runtime-assets | 文件/平台/摘要验证；目标无资源时拒绝宣称验证成功 |
| plugins | 清单、路径、目标和声明权限校验；第三方插件不被自动认定签名可信 |
| private profile | 非空产物扫描、项目填写禁用地址策略、发布链接切换与健康检查脚本 |

这些是可扩展的实现目录，不是所有项目的强制技术栈。不支持的实现明确阻断，先在 catalog 注册实现和验证，不能静默替换用户选择。Tauri 初次构建生成 PNG/ICO/ICNS 起始图标，已有图标保持原样。原生签名、公证、生产迁移、远程部署、业务身份与权限策略需要实际项目配置；v2 蓝图已带可运行任务 CRUD 示例。

## 存放目录与复用

完整应用目录标准见 [directories.md](standards/directories.md)。默认只创建被选中的 `apps/<app>`、`packages/<module>` 和存储目录。旧项目的 apps/server、apps/api、packages/database、db 都由配置映射，不自动搬迁。

组件选择与可执行 API 示例见 [公共组件](components/shadcn/README.md)。省略 componentSets 保持 DataTable 默认入口，显式 [] 只初始化原有 24 个基础控件；选择 forms 或 react-hook-form 才安装表单组合。

shadcn 基础控件默认 `<app>/<sourceDir>/components/ui/`，公共表格 `<app>/<sourceDir>/components/data-table/`。共享配置例如：

```json
{
  "id": "admin",
  "stack": "react-vite",
  "path": "apps/admin",
  "componentSets": ["data-table", "react-hook-form"],
  "components": {
    "ui": "packages/ui/src/ui",
    "dataTable": "packages/ui/src/data-table"
  }
}
```

forms、selectors、feedback 默认位于应用 components 下；UI 映射到共享包时，这三组默认在 ui 的同级目录。日期组件放 selectors。可分别通过 components.forms/selectors/feedback 显式映射。

共享组件根 `packages/<包名>/` 会生成独立 package.json，安装器同时建立该包的依赖。React 运行时和类型解析保持一致，Tailwind 显式扫描共享组件路径；共享 DataTable 必须搭配共享 UI 原子。Next/Go 使用框架约定的源布局，Vite/Tauri/Node 支持自定义 sourceDir。

别名由生成器统一写入 components.json、tsconfig 和 Vite 配置。架构 checks 验证别名实际解析结果、原生交互控件、业务层低阶 Table 导入、跨应用源码依赖、迁移摘要与公共模块。项目还应在已有 tdd.projectChecks/qa.projectChecks 中登记业务约束和构建检查。

## 更新、接管与恢复

| 内容 | 更新语义 |
| --- | --- |
| 作业协议、执行工具、架构源目录 | overwrite；已有本地漂移先阻断 |
| 已实例化的 shadcn、DataTable、公共模块、技术标准 | update；三方合并保留项目定制 |
| package.json 等共享 JSON | 字段三方合并；项目独有字段保留 |
| 迁移文件/迁移注册表 | append / append-json；既有 ID 不改写 |
| .gitignore/.envrc 受管块 | managed-block；块外文本保留 |
| 业务起始代码、项目 lib/utils.ts、真实 ARCH、配置、环境 example | init-if-missing；后续归项目维护 |
| RULES.md、项目独有文件、未选模块 | 不写入 |

```bash
pnpm agent -- template sync --scope agent
pnpm agent -- template sync
pnpm agent -- architecture update --scope architecture:table:apps/web/src/components/data-table
```

默认 template sync 只升级已经采用的架构选择，新增应用或改变选型会要求显式 architecture init/update。项目配置属于项目；从外部配置文件规划已有项目时必须先把确认的选择写入项目 architecture.config.json，避免出现两份选型。切换框架、搬迁目录和移除应用不会自动删除旧业务代码，需独立治理任务。减少 componentSets 也不会卸载组件：已登记的组件及依赖继续维护，避免仍被项目使用的源码失效；需要卸载时由项目显式清理引用、文件、依赖及所有权记录。旧版配置补齐默认字段不被误判为项目改选。单独升级组件时同时带入其依赖及消费者配置，确保生成结果可编译。

上次模板、项目当前、新模板组成三方依据。`xirang.lock.json` 和 `.xirang/baselines/` 必须一起提交；不能手工把本地文件标成“未修改”。缺少基线的旧项目会得到 adoption-required：

```bash
pnpm agent -- architecture adopt --dry-run
pnpm agent -- architecture adopt --write --no-install
```

adopt 默认只展示计划；`--write` 表示维护者已核对差异，保留当前内容作为相对所选上游的项目定制并建立新基线。旧作业模板接管可使用 `template sync --adopt --dry-run` 查看，再用 `template sync --adopt` 执行；仍保留冲突保护和项目所有权。它不证明原文件来自哪个历史版本，也不是强制覆盖开关；保留下来的旧协议/脚本需要逐文件审查，不能把接管完成当作每个旧文件已替换成新版本。

中断后保留 worktree 和容器 tmp 日志，执行：

```bash
pnpm agent -- architecture resume
```

同一引擎也恢复模板写入；仅安装作业包时用 `node tooling/xirang/resume.js`。恢复使用日志内的冻结计划，按 before/after 哈希判断已写入项；用户额外修改引起第三种状态时阻断。修复/恢复明确文件后重试，不删除整个 worktree 或日志。恢复后补依赖、checks、构建、再次 dry-run 和项目交付门禁。

文件锁只协调本机写入器，Git worktree/分支仍是最终审查和历史边界。普通初始化/更新不执行数据库迁移或部署。若遗留 writer-recovery.lock，先确认相关进程和日志状态，再恢复精确锁文件；不自动清理不明恢复状态。
