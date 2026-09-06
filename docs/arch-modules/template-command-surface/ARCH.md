# 模板命令面架构说明

> 模块 ID：`CMDSURF`  
> 状态：Accepted  
> 负责人：@template-maintainers  
> 最后更新：2026-09-06
> 对应 PRD：[`US-CMDSURF-001~009`](../../prd-modules/template-command-surface/PRD.md)

## 1. 摘要

目标是以单一模板执行面覆盖本地服务、客户端开发、客户端构建、环境部署和息壤模板自身生命周期。模板配置登记稳定的规范 alias、模板身份与官方来源，项目实现或覆盖业务 alias；产品参数继续外置。非目标是规定具体客户端框架、真实部署实现或后台模板更新服务。

| ID | 决策 | 原因 | 状态 |
| --- | --- | --- | --- |
| ADR-001 | 扩展现有 Agent CLI 和 DevOps dispatcher | 保持单一执行面与证据模型 | Accepted |
| ADR-003 | 在共享配置层提供显式、按需的容器目录初始化器 | 统一路径校验与失败语义，同时避免配置读取产生副作用 | Accepted |
| ADR-004 | 任务输入语义集中在 `AGENTS.md`，`createTask()` 只强制 mutation 显式验收 | 以最小模板改动同时获得上下文补齐和可执行门禁，并保持只读任务兼容 | Accepted |
| ADR-005 | 全新 worktree 默认 required fetch 并从固定远端 base SHA 创建；现有 `--skip-fetch` 是唯一离线逃生口 | 防止陈旧 remote-tracking ref 或任意 HEAD 被误报为最新基线，同时保持显式离线能力 | Accepted |
| ADR-006 | 本机状态只保护本机生命周期；跨电脑使用远端 SHA 校验与普通非快进更新，不设置机器角色或远程锁 | 以最小改动支持所有电脑同权并阻止同名分支误建、陈旧 QA 与覆盖先到提交 | Accepted |
| ADR-007 | 实际项目通过轻量引导器 required fetch 固定息壤官方源，以不可变 SHA 快照中的最新应用器执行更新 | 避免旧项目自引用旧模板，同时保证来源、版本、失败边界和收敛证据 | Accepted |
| ADR-008 | 官方公开模板采用独立匿名 HTTPS Git 环境，项目鉴权保持原入口 | 下载不依赖项目 token，隔离凭据与 URL 重写 | Accepted |

## 2. 上下文与边界

```mermaid
flowchart LR
  S[Slash 语义] --> CLI[CMDSURF-API-001 Agent CLI]
  CLI --> DISPATCH[CMDSURF-SVC-001 Dispatcher]
  CFG[CMDSURF-SVC-002 Config Resolver] --> DISPATCH
  DIR[CMDSURF-SVC-003 Container Directory Initializer] --> DISPATCH
  CFG --> DIR
  DISPATCH --> CMD[项目自有命令]
  CLI --> BASE[CMDSURF-SVC-005 Worktree Base Synchronizer]
  BASE --> ORIGIN[origin]
  BASE --> WT[Git branch/worktree creation]
  CLI --> REMOTE[CMDSURF-SVC-006 Remote Branch Resolver]
  REMOTE --> ORIGIN
  CLI --> MERGE[CMDSURF-SVC-007 QA SHA Merge Guard]
  MERGE --> ORIGIN
  CLI --> XF[CMDSURF-SVC-008 Xirang Upstream Fetcher]
  XI[Template-owned Xirang Identity] --> XF
  XF --> XG[Official GitHub Repository]
  XF --> XS[Immutable SHA Snapshot]
  XS --> XA[CMDSURF-SVC-009 Template Sync Orchestrator]
  XA --> TW[Target Linked Worktree]
```

职责：解析稳定动作、校验平台/profile/环境、精确选择配置、执行并输出证据。不负责定义端口、服务名、框架、数据库或签名策略。

## 3. 组件设计

### 组件/服务清单

| 组件 ID | 组件 | 职责 | 输入 | 输出 | 所有者 |
| --- | --- | --- | --- | --- | --- |
| CMDSURF-API-001 | Agent CLI Router | 将 `app dev/build` 等路由为执行器动作 | CLI argv | action argv | 模板 |
| CMDSURF-SVC-001 | Command Dispatcher | 维度校验、执行、结构化结果 | action/platform/target/env | STATUS 与运行证据 | 模板 |
| CMDSURF-SVC-002 | Config Resolver | 从合并配置精确选择命令 | `app.commands`、`devServer.commands`、`devops.commands` | command 或空 | 模板 |
| CMDSURF-SVC-003 | Container Directory Initializer | 对声明的容器目录执行解析、拓扑校验、递归创建与真实目录复核 | config、main root、目录 key 集合 | 已校验绝对路径或明确错误 | 模板 |
| CMDSURF-SVC-004 | Task State Manager | 校验 mutation 显式验收并持久化任务目标、步骤与验收 | task type、goal、acceptance | task state 或明确错误 | 模板 |
| CMDSURF-SVC-005 | Worktree Base Synchronizer | 在创建副作用前刷新并解析远端 base，或在显式 skip 时解析缓存 remote/local base；输出固定 commit SHA 与新鲜度 | main root、base branch、skip flag | base ref、base commit、fetch status、freshness 或明确错误 | 模板 |
| CMDSURF-SVC-006 | Remote Branch Resolver | 区分本地/远端分支，新建时阻断远端同名分支，恢复时从远端固定 SHA 建立本机 worktree/session | branch、origin refs、operation | branch source、remote head、worktree/session 或明确错误 | 模板 |
| CMDSURF-SVC-007 | QA SHA Merge Guard | 记录本机 QA 的 base/head SHA，合并前重新核验并执行 SHA 绑定的 PR merge 或普通非强制 push | base branch、PR、base/head SHA、QA verdict | merge/push/remote verification 状态或陈旧回执错误 | 模板 |
| CMDSURF-SVC-008 | Xirang Upstream Fetcher | 校验息壤身份与官方源，在容器临时目录匿名 required fetch 默认分支并检出不可变 SHA 快照 | target root、template identity、official repo/branch、独立匿名环境 | source repo/branch/commit、detached snapshot 或明确错误 | 模板 |
| CMDSURF-SVC-009 | Template Sync Orchestrator | 要求目标为 linked worktree，调用固定 SHA 快照内的最新更新器完成 dry-run、apply、convergence 和结构化报告 | target worktree、immutable snapshot、template manifest | fetch/apply/convergence 状态、修改文件、报告路径或明确错误 | 模板 |

关键调用链：CLI 标准化参数 → Dispatcher 校验必需维度 → Config Resolver 精确查找 → 按动作声明并初始化所需容器目录 → 项目命令执行 → 记录结果。

初始化策略：

- `resolveContainerPath()` 保持纯解析、无文件系统副作用。
- 新增显式初始化接口，只接受白名单 key：`worktrees`、`tmp`、`cache`、`artifacts`；内部先复用拓扑校验与绝对路径解析，再以 recursive 方式创建，并用 `lstat` 拒绝文件或符号链接冒充目录。
- 状态/worktree/template 命令只声明自身写入的目录；构建、CI、发布等项目命令在启动前声明 `tmp`、`cache`、`artifacts`，并通过环境变量获得同一批已初始化绝对路径。
- 只读列表、状态审计或单纯配置加载不调用初始化接口。

任务输入策略：`AGENTS.md` 是短提示词补齐、最小提问与修改前验收门禁的唯一语义入口；`docs/CONVENTIONS.md` 只保留命令示例和入口引用。`createTask()` 在任何状态写入前拒绝缺少显式验收的 mutation；`diagnose`、`research`、`operation` 沿用目标回退，不新增状态 schema 或 CLI 参数。

Worktree 基线策略：请求与恢复态预检先于网络和文件系统副作用；全新创建的默认路径必须成功执行 `git fetch --prune origin`，随后严格解析 `refs/remotes/origin/<base>^{commit}`。创建命令使用解析出的 commit SHA，不再使用可能被并发 fetch 改写的符号 ref。`--skip-fetch` 只允许缓存 remote base 或本地 base，输出 `BASE_FRESHNESS=UNVERIFIED`；两者都不存在时阻断，禁止回退任意 `HEAD`。dry-run 与已有 worktree resume 不 fetch、不改变已有分支。

多电脑分支策略：默认 new 在 required fetch 后同时检查本地与远端请求分支。本地不存在而远端存在时 fail closed，并提示显式 resume 或更名；显式 resume 从远端 commit SHA 创建本地分支和本机独立 session。分支名和现有 session schema保持兼容，不引入 hostname、机器角色或全局 lease。

QA/合并策略：`qa verify` 在本地检查通过后原子写入包含 configured base、branch、PR、`BASE_SHA` 与 `HEAD_SHA` 的临时回执。`qa merge` 必须重新 fetch 并匹配这两个 SHA，且不得在该阶段自动 rebase/force-push 功能分支。GitHub squash merge 使用 expected head SHA；本地 fallback 使用精确 refspec 的普通 push。远端 base/head 漂移、非快进拒绝或结果不明时保留生命周期状态并要求验证/重新 QA，远端确认前禁止清理。

息壤同步策略：模板默认配置提供 `template.identity` 与 `template.upstream`；原有 `template.sourceRepo` 保留为项目向本地模板工作区回灌时的兼容配置，不承担在线更新事实源。同步引导器先验证调用目录属于 Git linked worktree、模板 ID 为 `xirang`、官方 URL/branch 合法，再在容器 `tmp/template-sync-runs/<run-id>` 初始化隔离 Git 仓库，通过独立匿名 HTTPS 环境执行 required shallow fetch，屏蔽项目 token、用户 Git 配置、helper、askpass 和 URL 重写。`FETCH_HEAD^{commit}` 是本次唯一模板版本，detached checkout 后还需验证 manifest、最新 update 脚本和身份字段。只有上述步骤与首次 dry-run 全部成功，最新快照内的更新器才可写目标；写入后立即再次 dry-run，任何非收敛结果均阻断交付。临时快照按精确目录安全清理，报告保留在目标容器 tmp。

自然语言策略：template-owned `AGENTS.md` 将“更新息壤模板”定义为修改任务入口，要求 Agent 在实际项目先创建/恢复专用 worktree，再执行 `pnpm agent -- template sync` 并完成该项目自身 TDD/QA/合并门禁。CLI 提供确定性机制，语言模型不负责自行猜测模板 URL 或手工拼接更新步骤。

## 4. 接口视图

### 提供的接口

| 名称 | 请求 | 响应 | 错误 |
| --- | --- | --- | --- |
| `app dev` | `--platform=<platform> [--target=<profile>]` | 结构化执行结果 | missing platform/config |
| `app build` | `--platform=<platform> [--target=<profile>]` | 结构化执行结果 | missing platform/config |
| `dev restart` | 可选内部 `--target=<profile>` | 结构化执行结果 | missing profile config |
| `task start` | `--type=<type> --desc=<goal> [--acceptance=<criterion>]` | task state | mutation 缺少显式 acceptance 时拒绝创建 |
| `worktree new` | identity/phase 与可选 `--skip-fetch` | `FETCH_STATUS`、`BASE_REF`、`BASE_COMMIT`、`BASE_FRESHNESS`、worktree 路径 | 默认 fetch/base 失败或 skip 无可用 configured base 时拒绝创建 |
| `worktree resume` | 已有本地或远端 branch | `BRANCH_SOURCE`、`REMOTE_HEAD`、worktree 路径和本机 session | 远端缺失、SHA 无法解析或本地冲突时拒绝恢复 |
| `qa verify` | 当前 branch、PR、configured base 与本地检查 | base/head SHA 绑定的本地通过回执 | HEAD 未推送、PR 不匹配或必需检查失败时不生成通过回执 |
| `qa merge` | 已通过回执与当前远端 refs | `QA_STATUS`、`MERGE_STATUS`、`PUSH_STATUS`、`REMOTE_MAIN_SHA` | base/head 漂移、非快进、权限或未知远端状态时 fail closed |
| `template sync` | 无位置参数；测试/受控 fork 可显式注入 source repo/branch | `TEMPLATE_ID/NAME/REPO/BRANCH/COMMIT` 与 fetch/apply/convergence 状态 | 非 linked worktree、身份/URL/ref/source shape、fetch、dry-run、冲突或收敛失败时 fail closed |

用户快捷语法将 `/private restart` 翻译为内部 `dev restart --target=private`；模板文档不把后者呈现为用户快捷命令。

### 依赖的接口

| 依赖 | 合约 | 失败行为 |
| --- | --- | --- |
| `loadConfig()` | CLI > env > project > template defaults | 配置无效时阻断 |
| 项目命令 | shell command string | 非零退出转 `STATUS=BLOCKED` |
| 容器路径解析 | `resolveContainerPath()` | 越界路径阻断 |
| 容器目录初始化 | 显式目录 key 集合；返回绝对路径映射 | 非白名单 key、非法拓扑、非目录目标或创建失败时阻断 |
| Git `origin` 与 configured base | 默认在线刷新并解析 `refs/remotes/origin/<base>^{commit}` | fetch、鉴权、remote 或 base ref 失败时在创建副作用前阻断 |
| GitHub PR API/CLI | 查询 PR base/head；merge 时绑定 expected head SHA | PR 缺失、base/head 不符或权限失败时阻断或进入受控本地普通 push fallback |
| 息壤官方 GitHub 源 | template-owned URL 与 branch；匿名 HTTPS fetch，无 Authorization/Cookie | 获取失败、ref 缺失或 SHA 不可解析时在目标 tracked mutation 前阻断 |
| 固定 SHA 模板快照 | 必须包含有效 identity、manifest、`update-template.js` 与 apply engine | 形状或身份不匹配时阻断，不调用目标项目内旧应用器 |

兼容策略：`config.example.json` 提供完整默认矩阵，项目稀疏 `agent.config.json` 通过深合并继承并可在任意叶级覆盖；已有 package aliases 不删除。项目显式选择未知 profile、平台或环境时不跨维度回退。

## 5. 数据视图

### 数据资产表

| 表名 | 类型 | 关键字段 | 保留策略 |
| --- | --- | --- | --- |
| `app.commands` | JSON 配置，不是数据库表 | action → platform → profile → command | 模板登记规范 alias 默认值；项目稀疏覆盖 |
| `devops-runs/result.json` | 临时运行证据 | action/platform/target/command/cwd/status | 容器 tmp 策略 |
| Worktree base result | 进程内证据，不新增持久 schema | fetchStatus/baseRef/baseCommit/freshness | CLI 返回后不单独保留；branch HEAD 提供确定性 Git 证据 |
| QA verification receipt | 本机临时 JSON | schemaVersion/baseBranch/branch/pr/baseSha/headSha/verdict/verifiedAt | 容器 tmp；跨电脑不复制；SHA 漂移后失效；不保存密钥或大日志 |
| Xirang template identity | template-owned JSON 配置 | id/name/upstream repository/branch | 随模板传播；实际项目无需复制到稀疏配置 |
| Template sync run | 临时 Git 工作区与文本报告 | repo/branch/commit/fetch/apply/convergence | 唯一运行目录；快照结束后清理，报告按容器 tmp 策略保留 |

无 schema 迁移、事务、并发写入或业务数据保留变化。

## 6. 质量属性

| 属性 | 可测目标 | 设计措施 | 验证方式 |
| --- | --- | --- | --- |
| 可靠性 | 不发生跨 profile 回退 | 精确嵌套选择 | 负向单元测试 |
| 可移植性 | 0 个产品硬编码参数且完整矩阵可继承 | 规范 alias 默认值 + 项目叶级覆盖 | 内容扫描与枚举契约测试 |
| 可观测性 | 每次执行有结构化字段 | 复用 run directory | 集成测试 |
| 兼容性 | 既有 dev/ship 测试全部通过 | 增量 action 分支 | 回归测试 |
| 可恢复性 | 缺目录首次写入成功，重复调用不改已有内容 | 共享显式初始化器 + recursive mkdir + lstat | 缺失/已存在/文件占位/只读场景测试 |
| 输入完整性 | mutation 状态均含显式可观察验收 | 文档语义门禁 + 创建时 fail closed | 单元测试与模板内容扫描 |
| 基线一致性 | 默认新 worktree HEAD 100% 等于本次 fetch 后解析的远端 base commit | required fetch + `rev-parse --verify <ref>^{commit}` + SHA 创建 | bare remote 集成测试与 HEAD 比对 |
| 多机分支一致性 | 远端同名分支 0 次被 new 从主干误建 | local/remote ref 分类 + 显式 remote resume | 三 clone 集成测试 |
| QA 新鲜度 | base/head 任一漂移 100% 阻断旧回执 | 双 SHA 回执 + merge 前 required fetch | 单元与并发负向测试 |
| 主干完整性 | 模板对配置主干 0 次 force push；并发更新不丢先到提交 | expected head merge + 普通非快进 push | 参数断言与 bare remote 并发测试 |
| 模板来源完整性 | 普通同步 100% 来自本次官方 fetch 后 SHA | 固定 URL/branch + required fetch + detached SHA snapshot | bare remote 前进、SHA 和 source executor 断言 |
| 失败原子边界 | 来源、fetch、ref、shape 或首次 dry-run 失败时目标 tracked 文件 0 修改 | mutation 前置验证 + isolated run directory | sentinel 与 `git status --porcelain` 断言 |
| 自更新能力 | 实际项目内旧模板快照不决定应用内容 | 由 fetch 快照内最新 updater/manifest 执行 | old-target/new-source 集成测试 |
| 幂等性 | 成功应用后 convergence dry-run 为 0 差异 | apply 后强制二次 dry-run | 重复同步与 summary 断言 |

## 7. 安全与隐私

不新增用户身份或权限。专家阶段不作为授权身份，所有授权电脑运行同一合约。项目远端操作继续复用 `buildGitHubGitEnv()`；官方公开模板使用独立匿名环境，不得把 token、HTTP header 或完整敏感 stderr 写入结构化输出。普通息壤同步只读取 template-owned 官方源；测试和明确 fork 场景的 source 注入必须显式，不改变“更新息壤模板”的默认含义。模板不创建、触发或依赖 GitHub CI；`.github/workflows` 保持 project-owned。配置主干禁止 force push 与删除，功能分支策略由项目决定。

官方匿名获取遵循 [ADR-008](../../adr/008-arch-xirang-anonymous-fetch.md)：隔离继承的 Git 配置和凭据，不读取项目 GH_TOKEN；官方源与显式测试/fork override 使用不同环境，项目自身 GitHub 操作保持既有鉴权入口。

## 8. 部署与运行

无新部署单元、daemon 或端口。模板更新通过 manifest 传播；`template sync` 仅在用户请求时短暂访问 GitHub并创建隔离快照。真实客户端和服务端命令由目标项目执行并负责其健康/产物验收。

## 9. 可测试性

| 层级 | 合约或场景 | 测试类型 | 证据 |
| --- | --- | --- | --- |
| 单元 | CLI 路由、配置选择、缺失维度 | Node unit | `agent-cli`、`devops-run` tests |
| 集成 | dry-run 结构化输出 | process integration | dispatcher test |
| 系统 | 模板 apply 所有权与收敛 | template integration | update-template test + 目标 dry-run |
| 单元/集成 | 四类容器目录缺失、重复初始化和非法目标 | Node unit/process integration | shared config、worktree、task、devops tests |
| 集成 | 远端 base 前进、默认 fetch、固定 SHA 创建 | local bare Git remote | worktree-core tests |
| 负向集成 | fetch 失败、远端 base 缺失、skip 无缓存/local base | local invalid/bare Git remote | 无 branch/worktree/session 副作用断言 |
| 兼容 | dry-run、已有 worktree resume、显式 skip | Node process integration | 不 fetch、不改变已有 HEAD |
| 多机集成 | 远端同名分支、新电脑恢复、两个并发主干更新 | 三份 clone + 本地 bare remote | 精确 HEAD、陈旧 QA 与非快进断言 |
| GitHub 合约 | PR base/head 解析、expected head SHA merge | mock API/CLI | 请求体和参数断言，不访问真实 GitHub |
| 模板传播 | CI-free 与 workflows 所有权 | template apply dry-run/apply/convergence | `.github/workflows` 字节级不变 |
| 单元 | 息壤配置、CLI 路由、URL/branch/linked-worktree 预检 | Node unit | identity 与负向参数断言 |
| 集成 | 官方分支前进、required fetch、固定 SHA 与最新 updater 自举 | local bare Git remote + old target fixture | repo/branch/SHA、目标内容与执行器来源断言 |
| 负向集成 | fetch、ref、source shape、dry-run conflict 失败 | invalid/local bare remotes + sentinel target | 非零状态与目标 tracked 文件零修改 |
| 系统 | apply 后 convergence 与 project-owned 保护 | template source/target fixtures | 二次 dry-run 0 差异、`RULES.md`/业务文件字节级不变 |

## 10. 风险与验证表

| ID | 风险类型 | 影响 | 缓解/负责人 | 截止 |
| --- | --- | --- | --- | --- |
| R-001 | profile fallback | 操作错误目标 | 精确查找 + @template-maintainers | TDD Gate |
| R-002 | alias 实现缺失 | 配置可解析但项目脚本执行失败 | 模板只登记规范名称；目标项目负责实现或覆盖，传播验收检查目标 alias | ARCH/QA Gate |
| R-003 | project-owned overwrite | 目标行为损坏 | manifest 收敛测试 + @qa | QA Gate |
| R-004 | 配置读取隐式创建目录 | 只读命令污染文件系统 | 解析与初始化 API 分离，只在写入边界显式调用 | TDD Gate |
| R-005 | 文件或链接冒充容器目录 | 写入越界或状态损坏 | `lstat` 复核真实目录，异常 fail closed | TDD Gate |
| R-006 | 把用户原始目标机械复制为验收 | 任务看似完整但不可验证 | mutation 禁止目标回退；文档要求可观察验收 | TDD Gate |
| R-007 | fetch 失败仍使用陈旧缓存 | 新任务起点不可证明 | 默认 fetch 失败即阻断；缓存只由显式 skip 使用 | TDD Gate |
| R-008 | base ref 在解析与创建之间变化 | 记录 SHA 与实际 HEAD 不一致 | 创建命令使用已解析的 commit SHA，并在测试中比对 HEAD | TDD Gate |
| R-009 | 远端同名任务分支被误建 | 不同电脑的历史争用同一 ref | new 阻断远端同名；resume 从远端 SHA 恢复 | TDD Gate |
| R-010 | QA 后 base/head 漂移 | 未验证提交或组合进入主干 | 双 SHA 回执、merge 前 fetch 与 expected head | TDD/QA Gate |
| R-011 | 本机锁被当成跨电脑锁 | 两台电脑同时进入 merge | 文档边界 + Git 远端非快进协调 | QA 并发模拟 |
| R-012 | 无 CI 且所有人可直接 push | 原始 Git 命令可绕过模板 QA | 明确信任模型；不宣称远端强制，主干仅禁止 force/delete | 用户已接受 |
| R-013 | 实际项目用旧快照更新自身 | 宣称成功但遗漏官方模板变化 | required fetch + 固定 SHA 快照内最新 updater | TDD/QA Gate |
| R-014 | 网络或认证失败后使用缓存 | 模板来源新鲜度无法证明 | 普通路径 fail closed，不提供隐式缓存降级 | TDD Gate |
| R-015 | 临时快照路径或清理越界 | 删除目标或泄露运行内容 | 容器 tmp 解析、唯一目录与 no-follow 精确清理 | 安全负向测试 |
| R-016 | 应用后未收敛 | 部分更新或非幂等规则进入项目 | 强制 convergence dry-run，非零差异阻断交付 | QA Gate |

## 11. 实现约束

- 必须：模板配置登记 mac、win、ios、android 的 dev/build 默认与 private 变体、本地服务五项生命周期默认与 private 变体、dev/staging/prod 服务端 build 默认与 private 变体。
- 必须：`ship` 只保留配置槽且无可执行默认值；显式清空或未知维度时 `STATUS=BLOCKED`。
- 禁止：在模板中写入 XiaoLan 名称、端口、URL、脚本或签名参数。
- 可选：项目通过同名 package aliases 实现规范名称，或在 `agent.config.json` 覆盖为项目命令。
- TASK 拆分提示：先负向测试，再路由和选择器实现，最后传播验收。
- 必须：容器目录初始化集中于共享 helper；调用方声明目录需求，禁止复制散落的 `mkdir` 与 `../tmp` 路径猜测。
- 必须：项目命令启动前提供已创建的 `AGENT_TMP_DIR`、`AGENT_CACHE_DIR`、`AGENT_ARTIFACTS_DIR`；只读命令不触发全量目录创建。
- 必须：mutation 任务只有显式 `--acceptance` 才可创建；`diagnose`、`research`、`operation` 保持目标回退。
- 禁止：为短提示词补齐新增 schema、CLI 参数或重复的专家规则。
- 必须：全新 worktree 默认 fetch `origin` 成功且远端 base commit 可解析后才能创建 branch/worktree/session。
- 必须：新分支以解析出的 commit SHA 创建，并输出 `FETCH_STATUS=OK`、`BASE_REF`、`BASE_COMMIT`、`BASE_FRESHNESS=VERIFIED`。
- 必须：`--skip-fetch` 继续作为兼容入口，只允许缓存 remote base 或本地 base，输出 `BASE_FRESHNESS=UNVERIFIED`。
- 禁止：默认 fetch 失败后继续、回退任意 `HEAD`、在 resume 中 fetch/rebase，或新增 remote/policy/retry 配置面。
- 必须：new 在远端分支存在时阻断误建；显式 resume 可 fetch 并从该远端分支的固定 SHA 恢复，不沿用旧“resume 无网络”限制处理跨电脑恢复。
- 必须：QA 回执至少绑定 configured base SHA 与远端 feature head SHA；任一漂移时禁止继续 merge。
- 必须：PR merge 绑定 expected head SHA；本地 fallback 只允许普通非强制 push 配置主干。
- 禁止：以专家阶段、机器环境变量或 hostname 控制合并权限；禁止依赖 GitHub CI 或把本机锁描述为分布式 merge queue。
- 必须：模板身份使用 `xirang`/“息壤”；普通 `template sync` 的默认来源是 template-owned 官方 GitHub URL 与 `main`，且用户短语“更新息壤模板”只能映射该入口。
- 必须：同步先验证 linked worktree，再 required fetch；使用 `FETCH_HEAD^{commit}` 固定 SHA 和 detached source snapshot，调用快照中的最新 updater 与 manifest。
- 必须：首次 dry-run、冲突检查、apply、convergence dry-run 顺序固定；fetch/ref/source/dry-run 失败时目标 tracked 文件零修改。
- 必须：项目 GitHub 凭据仅通过既有进程环境注入；官方模板获取禁用该凭据注入；结构化输出不得包含 token、extraheader 或未脱敏远端错误正文。
- 必须：既有 `template.sourceRepo` 的本地 backfill 语义保持兼容；在线息壤来源使用独立 `template.identity`/`template.upstream`，避免 URL 被 `path.resolve()` 误解。
- 禁止：普通同步静默使用项目内旧模板、缓存快照、可变 symbolic ref 或任意第三方 URL；禁止直接在主 worktree 写模板更新。

## 12. Story/Component 追溯表

| Story | Component |
| --- | --- |
| US-CMDSURF-001 | CMDSURF-API-001、CMDSURF-SVC-001 |
| US-CMDSURF-002 | CMDSURF-API-001、CMDSURF-SVC-002 |
| US-CMDSURF-003 | CMDSURF-SVC-001、CMDSURF-SVC-002 |
| US-CMDSURF-004 | CMDSURF-SVC-002、模板 manifest |
| US-CMDSURF-005 | CMDSURF-SVC-003、CMDSURF-SVC-001 |
| US-CMDSURF-006 | CMDSURF-SVC-004、AGENTS 任务输入规则、Codex 配置模板 |
| US-CMDSURF-007 | CMDSURF-API-001、CMDSURF-SVC-005、Git origin/base 与 worktree lifecycle |
| US-CMDSURF-008 | CMDSURF-API-001、CMDSURF-SVC-005~007、Git origin/PR/base 与本机 session lifecycle |
| US-CMDSURF-009 | CMDSURF-API-001、CMDSURF-SVC-008~009、息壤 identity、官方 GitHub 源、template manifest 与目标 linked worktree |

## 13. 完成检查

- [x] PRD Story/AC 均有架构落点。
- [x] 边界、合约、数据和失败路径明确。
- [x] 安全、兼容和可观测性可测试。
- [x] 无迁移或新部署单元。
- [x] 风险有验证 Gate。
