# 通用工程约定

本文件定义模板可复用的详细协议。项目专用规则放在根目录 `RULES.md`，项目参数放在稀疏 `agent.config.json`；模板源不提供 `RULES.md`。

## 1. 路径与仓库拓扑

所有仓库内相对路径以主 Git worktree 根为基准。推荐容器结构：

```text
<container>/
├── repo/          # 主 worktree
├── worktrees/     # 修改任务 worktrees
├── tmp/           # 状态、锁、测试报告
├── cache/         # 可重建缓存
└── artifacts/     # 构建/发布产物
```

脚本必须使用 `infra/scripts/shared/config.js` 的 `resolveRepoRoot()`、`getMainRepoRoot()` 和 `resolveContainerPath()` 解析路径。linked worktree 中禁止以 `../tmp` 猜测容器位置。

写入型稳定命令首次需要容器目录时必须通过共享初始化器自动递归创建：worktree 生命周期声明 `worktrees`/`tmp`，任务与模板运行状态声明 `tmp`，项目命令执行前声明 `tmp`/`cache`/`artifacts`。初始化必须幂等并保护已有内容；配置加载、纯路径解析与无需写入的只读命令不得为补齐目录而产生副作用。目标被文件或符号链接占位、路径非法或创建失败时必须 fail closed，禁止继续后续命令副作用。

主 worktree 保持在 base branch。修改 tracked 文件只在专属 worktree 中进行；只读诊断可在任意 worktree。每个 worktree 独立安装依赖，包内容复用交给包管理器 store。

## 2. 配置

有效配置按以下优先级合并：

```text
CLI > 环境变量 > agent.config.json > infra/templates/agent/config.example.json
```

`config.example.json` 是唯一默认值来源；代码不得再维护第二份大体积默认对象。项目根 `agent.config.json` 只保存与默认值不同的键。目录不存在时，通用脚本应跳过或输出明确下一动作。

模板协议文件：

- `infra/templates/agent/config.example.json`：完整默认值和配置结构。
- `infra/templates/agent/project-config.example.json`：新项目的稀疏配置起点。
- `infra/templates/agent/package-scripts.example.json`：推荐公共命令，不代表完整兼容别名。
- `infra/templates/agent/template.manifest.json`：模板所有权和合并策略。

配置和 JSON 文件使用 UTF-8、两个空格缩进、文件末尾换行。密钥只能从环境或忽略的本地文件读取。

## 3. 模板所有权

Manifest 支持以下策略：

- `overwrite`：模板协议文件可升级覆盖。
- `init-if-missing`：仅初始化，已有项目文件不覆盖。
- `merge-json` / `merge-lines`：只合并协议允许的缺失项。
- `project-owned`：模板永不写入。

`RULES.md`、真实项目文档、源码、业务部署脚本和已有 `agent.config.json` 均属于项目。模板更新流程必须：

1. dry-run 并报告 create/update/merge/conflict/skip；
2. 冲突时 fail-closed；
3. apply 后校验哈希和文件范围；
4. 再次 dry-run，预期无差异。

模板回灌默认关闭，仅处理已记录 baseline 之后的 template-owned 改动；项目规则、配置、业务文档和 generated 文件不可回灌。

## 4. 文档与阶段状态

治理流程采用模块化文档：

- `docs/PRD.md`、`ARCH.md`、`TASK.md`、`QA.md`：总纲和模块索引。
- `docs/{prd|arch|task|qa}-modules/module-list.md`：模块登记表。
- `docs/{prd|arch|task|qa}-modules/<domain>/`：功能域详情。
- `docs/data/traceability-matrix.md`：需求到测试的追踪关系。

`docs/AGENT_STATE.md` 只保存稳定里程碑：

1. `PRD_CONFIRMED`
2. `ARCHITECTURE_DEFINED`
3. `TASK_PLANNED`
4. `TDD_DONE`
5. `QA_VALIDATED`
6. `DEPLOYED`

里程碑已勾选时不得附加新的 PR、日期或重试行。运行态由外部 session 文件承担，避免每次合并产生无意义文档提交。

## 5. Worktree 生命周期

创建/恢复入口：

```bash
pnpm agent -- worktree new --phase=<phase> --task <id>
pnpm agent -- worktree bootstrap
pnpm agent -- worktree list
```

任务标识、分支名或描述至少提供一个。创建成功后必须切换到脚本输出的 `NEXT_CWD`。禁止从 worktree A 用绝对路径调用 worktree B 或主仓库脚本。

创建全新 worktree 时，默认必须在 branch、worktree 和 session 副作用前成功执行 `git fetch --prune origin`，严格解析 `refs/remotes/origin/<baseBranch>` 的 commit，并以该固定 SHA 创建新分支。fetch 或远端 base 解析失败时必须 `STATUS=BLOCKED`，禁止继续使用缓存、本地 base 或任意 `HEAD`。如果 required fetch 后已经存在 `refs/remotes/origin/<branch>`，`worktree new` 必须阻断并提示显式恢复或更名；只有 `worktree resume` 可以从远端分支固定 SHA 创建本机 tracking branch、worktree 和 session。只有显式 `--skip-fetch`（或兼容环境变量）可以不联网；该路径只允许缓存 remote base 或本地 base，必须输出 `BASE_FRESHNESS=UNVERIFIED`，两者都不存在时阻断。dry-run 与已有本机 worktree resume 不触发 fetch，也不自动 rebase；远端恢复必须先刷新目标远端引用。

并行开发状态写入 `../tmp/worktree-sessions/`，锁写入 `../tmp/agent-locks/`。锁包含 PID；仅在确认 owner 不存活后回收 stale lock。这些状态只属于当前电脑，不构成跨电脑分布式锁或权限身份。

`qa verify` 通过后在本机原子保存绑定配置主干、功能分支、`BASE_SHA` 和 `HEAD_SHA` 的回执。合并前重新 fetch，并把回执与 PR base/head refs、远端引用逐项复验；GitHub 合并必须携带期望 head SHA，本地 squash 兜底必须合并固定 head SHA，并只用普通非强制 push 更新配置主干。任何 SHA 漂移、冲突或非快进拒绝都必须停止并要求重新 QA，不得自动 rebase 已验证分支或覆盖远端历史。只有远端主干最终校验和功能分支精确 lease 清理均成功后才清理 worktree 与 session；远端功能分支已经不存在视为幂等成功，无法确认或发现新 head 时保留恢复状态。

## 6. 长任务状态文件

满足以下任一条件必须使用任务状态：用户明确要求持续执行；至少 3 个可独立验证步骤；预计跨会话、压缩或进程重启。

状态目录固定为：

```text
<container>/tmp/agent-task-runs/<task-id>/
├── state.json
└── evidence/      # 可选大体积证据
```

`state.json` 是唯一事实来源，固定记录：

- schema/version、task id、目标、描述、类型和生命周期状态；
- 验收标准、约束、步骤、当前步骤、最后错误和唯一下一动作；
- 当前治理阶段、证据化阶段历史、计划版本与追加式计划变更历史；
- 主项目、当前 repo/worktree/branch；
- 每步 `replay=safe|verify_first`、状态、简短证据和更新时间；
- 完成或清理状态。

状态写入必须复用 `agent-locks`，采用同目录临时文件、flush/sync 和原子 rename。读取时忽略残留临时文件；损坏 JSON、schema 不符、锁冲突和多候选任务必须 fail-closed。

### 命令

任务输入的补齐、假设和最小提问规则以 `AGENTS.md` 的“任务输入门禁”为准；mutation 必须显式提供可观察验收。

```bash
pnpm agent -- task start --task <id> --phase <phase> --type mutation --desc "<目标>" --acceptance "<可观察验收>" --step "<步骤>"
pnpm agent -- task checkpoint --task <id> --step <id> --status done --evidence "<证据>" --next "<下一动作>"
pnpm agent -- task resume --auto
pnpm agent -- task extend --task <id> --reason "<范围变化>" --add-step "<安全步骤>" --add-verify-step "<副作用步骤>" --add-acceptance "<验收项>"
pnpm agent -- task transition --task <id> --phase <next> --evidence "<阶段里程碑>"
pnpm agent -- task finish --task <id>
pnpm agent -- task cancel --task <id> --force
```

步骤状态为 `pending|running|done|blocked|verify_required`：

- `safe` 步骤中断后回到 `pending`，可重放。
- `verify_first` 步骤中断时转为 `verify_required`，先查询真实外部状态。
- `done` 必须有证据；`blocked`/错误/等待必须有 `nextAction`。
- 同一次 checkpoint 可更新步骤和验收项，减少机械写盘。
- 新任务安全默认 `type=mutation`；确认不会修改 tracked 文件时才显式选择只读类型。schema v1 状态在读取时升级为 v2，保留既有步骤、证据与生命周期状态。
- `extend` 只允许追加步骤和验收项并递增 `plan_revision`；不允许删除、重排或重写已完成历史。
- `transition` 要求证据且校验相邻前进或显式回流路径；存在 `blocked|verify_required` 步骤时禁止向前推进；重复提交到当前阶段幂等，不追加第二条历史。
- `resume --auto` 仅在当前主 repo/worktree/branch 唯一匹配时选择任务；否则输出候选和 `STATUS=BLOCKED`。

`task finish --task <id>` 要求该任务所有必需步骤、验收项和证据完成。修改任务还必须通过任务级 completion guard：只把 `lifecycle.keys` 明确绑定到该 task id 的 `cleanup_pending|recovery_required` worktree 作为生命周期 blocker，同时仍要求主分支已合并、工作区干净且与远端一致。无 task scope 的仓库级 `pnpm agent -- finish` 保持全仓 fail-closed，任一受管理 worktree 未收敛都会阻断。任务门禁通过后先写 `completed`，再删除精确任务目录；删除失败保留 `cleanup_pending`，但不得重新执行任务。

容器普通 tmp 清理必须保护 `agent-task-runs/` 中的未完成任务。只有 `finish` 或用户明确 `cancel --force` 可删除。

## 7. 命令面

新项目只推荐统一入口：

```text
pnpm agent -- task <action>
pnpm agent -- worktree <action>
pnpm agent -- tdd <action>
pnpm agent -- qa <action>
pnpm agent -- template <action>
pnpm agent -- dev|app|build|ship|private|finish
```

旧 aliases 在已有项目中保留兼容，但模板不继续增加同义入口。命令必须输出可解析的 `STATUS`、`SUMMARY`、`NEXT_ACTION`，失败时退出码非零。

### 客户端与服务端快捷命令

用户快捷语义与模板稳定入口如下；执行命令从模板默认配置与目标项目稀疏 `agent.config.json` 的合并结果读取，项目可在任意叶级覆盖：

| 用户快捷命令 | 模板稳定入口 | 语义 |
| --- | --- | --- |
| `/restart` | `pnpm agent -- dev restart` | 重启默认本地服务 |
| `/private restart` | `pnpm agent -- private restart` | 重启 private profile 本地服务；不得写成 `/restart private` 或 `/restart --target=private` |
| `/dev app <platform>` | `pnpm agent -- dev app <platform>` | 启动开发客户端，不等于构建发行产物 |
| `/private dev app <platform>` | `pnpm agent -- private dev app <platform>` | 启动 private profile 开发客户端，不得回退默认 profile |
| `/build app <platform>` | `pnpm agent -- build app <platform>` | 构建客户端发行产物，不执行部署 |
| `/private build app <platform>` | `pnpm agent -- private build app <platform>` | 构建 private profile 客户端发行产物 |
| `/build <env>` | `pnpm agent -- build <env>` | 构建服务端环境产物，不改变目标环境状态 |
| `/private build <env>` | `pnpm agent -- private build <env>` | 构建 private profile 服务端环境产物 |
| `/ship <env>` | `pnpm agent -- ship <env>` | 执行真实环境部署 |
| `/private ship <env>` | `pnpm agent -- private ship <env>` | 执行 private profile 真实环境部署 |

客户端平台完整矩阵：

| 平台 | 默认开发客户端 | Private 开发客户端 | 默认发行构建 | Private 发行构建 |
| --- | --- | --- | --- | --- |
| macOS | `/dev app mac` | `/private dev app mac` | `/build app mac` | `/private build app mac` |
| Windows | `/dev app win` | `/private dev app win` | `/build app win` | `/private build app win` |
| iOS | `/dev app ios` | `/private dev app ios` | `/build app ios` | `/private build app ios` |
| Android | `/dev app android` | `/private dev app android` | `/build app android` | `/private build app android` |

服务端构建环境矩阵为 `/build dev|staging|prod` 与 `/private build dev|staging|prod`。模板登记构建命令的规范 alias 默认值；项目负责实现或覆盖 alias。真实部署 `/ship`、`/private ship` 必须由项目显式配置，不提供可执行默认值。

配置结构：

- 客户端：`app.commands.<dev|build>.<platform>`；默认 profile 可使用字符串，多 profile 使用 `{ "default": "...", "private": "..." }`。
- 本地服务：`devServer.commands.<start|restart|stop|status|logs>`；多 profile 使用对象精确声明。
- 服务端构建与部署：`devops.commands.build` / `devops.commands.ship`；环境键为 `dev|staging|production`，profile 可用同名嵌套对象声明。
- 显式 profile、平台或环境缺少命令时必须 `STATUS=BLOCKED`，禁止跨 profile、平台或环境回退。
- 客户端开发、发行构建、服务端产物构建与真实部署是四种不同副作用边界，验收证据不得互相替代。

## 8. TDD、QA 与交付

测试遵循最小风险覆盖：

- 先写会失败的定向测试，再实现，再回归。
- 纯文档变更至少执行格式、链接或模板契约测试。
- 共享基础设施变更执行单元、集成和相关回归；不得用全量失败掩盖定向结果。
- 测试证据记录命令、退出码和简短结论，不粘贴超长日志。

修改任务固定执行 `tdd sync → tdd push → qa plan → qa verify → qa merge → task finish`。`tdd push` 创建 PR 时显式使用 `config.baseBranch`；`qa verify` 产生的本机 SHA 回执不可跨电脑冒充共享门禁，换电脑合并时必须在该电脑重新执行验证。任务级 completion guard 只检查本 task 明确拥有的 worktree 生命周期 blocker；仓库级 `pnpm agent -- finish` 检查全部受管理 worktree。两者都只在配置主干已合并、工作区干净且与远端一致时返回成功。

项目可在 `agent.config.json` 的 `tdd.projectChecks` 中配置 `pnpm run` 脚本硬门禁；每项使用 `{ "name": "check:name", "required": true }`。`tdd sync` 在 Schema-Doc Sync 之前执行这些检查，任一 required 项失败即阻断，脚本名只允许字母、数字、冒号、下划线和连字符。

使用显式运行时迁移注册表的项目，必须同时配置 `paths.migrationsDir` 和 `tdd.migrationRegistry.registryFile`；`tdd sync` 会按 `tdd.migrationRegistry.filePattern` 扫描迁移文件，阻断遗漏注册或注册顺序与文件名不一致。未配置注册表的项目不启用该检查。数据库持久化源的结构、约束、索引、查询、事务或数据变换发生变化时，项目规则还必须要求新增只追加迁移，并可通过 `tdd.projectChecks` 接入更深的项目专属一致性检查。

审查高风险域：认证权限、数据写删、事务一致性、缓存一致性、并发、外部 API、数据库 schema、共享基础库、跨文件业务联动和 hotfix。未命中可跳过语义 review，但不可跳过 lint、类型检查和测试。

## 9. GitHub、命名与安全

- GitHub token 变量统一为 `GH_TOKEN`。
- `.env.example` 中的 `GH_TOKEN` 必须为空；真实值只写入被忽略的 `.env.local`，不得用形似令牌的伪值充当示例。
- linked worktree 中按当前 worktree、Git 主 worktree、进程环境依次解析 `GH_TOKEN`；已知示例占位值视为未配置并继续回退，显式的非占位 worktree 令牌仍优先。
- 远端 Git/GitHub 命令必须由 `infra/scripts/shared/github-auth-run.js` 或上层脚本执行。
- 专家名称表示当前阶段职责，不绑定电脑、hostname、机器角色或专用 QA 账号；所有已获仓库权限的协作者可以执行任意阶段、合并 PR 或普通更新配置主干。
- 配置主干禁止 force push 和删除；跨电脑合并不使用分布式锁，以远端 SHA 复验和普通 push 的非快进拒绝实现乐观并发。精确 `--force-with-lease` 仅可用于功能分支清理。
- TDD、QA 与合并门禁在本地执行，不创建、修改、触发或依赖 GitHub CI、required checks 或 `.github/workflows`；工作流目录属于实际项目。
- branch、task id、目录使用小写 kebab-case；脚本使用 kebab-case，JavaScript 标识符使用 camelCase。
- 不提交凭据、`.env.local`、用户数据、未脱敏日志或本地绝对路径快照。
- destructive 操作前解析精确路径并验证归属；不对仓库根、HOME、通配符或未解析变量递归删除。

## 10. 全仓扫描

完整性影响正确性的跨目录任务先 Discovery、后 Editing。候选 manifest 写入容器 `tmp/scan-manifests/`，包含范围、排除项和全部候选。最终必须报告：

```text
scanned_count
matched_count
modified_count
skipped_count
```

并满足 `matched_count = modified_count + skipped_count`。范围变化时创建新 manifest，不得静默缩小。
