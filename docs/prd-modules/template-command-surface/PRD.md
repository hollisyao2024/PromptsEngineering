# 模板命令面 - PRD 模块

> **所属主 PRD**：[PRD.md](../../PRD.md)  
> **负责团队**：@template-maintainers  
> **最后更新**：2026-09-06
> **状态**：✅ 已确认  
> **追溯说明**：Story/AC 维护在 `docs/data/traceability-matrix.md`

## 1. 模块概述

建立跨项目可复用的客户端、服务端和模板生命周期命令协议。息壤模板负责稳定语义、规范 package alias 默认矩阵、配置解析、官方模板身份与来源、阻断策略和结构化输出；项目负责实现或覆盖业务 alias，以及平台、profile、环境和验收细节。

## 2. 范围与约束

In Scope：

- `/private restart` 作为 private profile 的用户可见快捷语法。
- `/dev app <platform>` 与 `/build app <platform>` 的开发/发行语义。
- 本地服务生命周期与 build/ship 边界。
- mac、win、ios、android 的 dev/build 默认及 private alias，以及服务端生命周期和 build 环境 alias，随模板更新可继承。
- 通过 `agent.config.json` 注册命令，缺失时 fail closed。
- 命令首次需要容器层 `worktrees`、`tmp`、`cache` 或 `artifacts` 目录时，自动递归创建缺失目录。
- 短提示词先结合仓库上下文补齐目标、非目标、可观察验收与验证方式；修改型任务启动前必须有显式验收标准。
- 全新 worktree 默认在任何 branch/worktree/session 副作用前成功刷新 `origin`，并从本次解析出的远端 base commit SHA 创建；显式 `--skip-fetch` 才允许使用未验证缓存。
- 多台电脑共享同一 GitHub 仓库时，远端同名分支不得被误建；另一台电脑可从远端精确恢复已有分支。
- 专家阶段不绑定电脑或 GitHub 权限；所有授权协作者均可执行任意阶段、合并 PR 或普通 push 配置主干。
- 不依赖 GitHub CI；本地 QA 通过回执绑定配置主干 SHA 与功能分支 SHA，任一漂移都阻断旧回执继续合并。
- 跨电脑合并采用远端 SHA 比较与普通非强制 push 的乐观并发；主干禁止 force push 和删除。
- 模板正式身份为“息壤（Xirang）”，稳定标识为 `xirang`；模板应用到实际项目后，“更新息壤模板”必须路由到 `pnpm agent -- template sync`。
- `template sync` 从固定官方 GitHub 仓库及默认分支执行 required fetch，解析确定 commit SHA，并从该 SHA 的模板内容更新当前实际项目，不得把项目内携带的旧模板快照冒充最新版。
- 模板同步在目标 tracked 文件写入前完成来源验证和 dry-run；冲突、fetch 失败、远端分支缺失或 SHA 无法解析时 fail closed。
- 成功同步必须执行 apply 后收敛 dry-run，输出模板 ID、仓库、分支、commit、fetch、apply 与 convergence 状态，并继续遵守 template-owned/project-owned 边界。

Out of Scope：

- 不提供 `/restart --target=private` 作为用户快捷命令。
- 不硬编码 `private` 的端口、服务名、数据库、框架或部署方式。
- 不覆盖目标项目 `RULES.md`、`agent.config.json` 或已有 package aliases。
- 不新增 intake schema、CLI 参数、专家角色或治理模块。
- 不提供后台、定时或无用户请求的模板更新，不在失败时自动重试或静默使用缓存。
- 不把 GitHub 仓库重命名纳入本次范围，不允许普通“更新息壤模板”触发任意第三方模板源。
- 不新增固定 QA 电脑、机器角色、专用合并账号、远程分布式锁或 GitHub CI。
- 不提供能够证明原始 `git push` 已执行本地 QA 的服务端零信任门禁。

## 3. 用户故事与验收

| Story ID | 验收标准（Given-When-Then） | Task ID | Test Case ID | QA 负责人 |
| --- | --- | --- | --- | --- |
| US-CMDSURF-001 | AC-CMDSURF-001-01：Given 用户请求 private 本地服务重启，When 使用模板快捷语法，Then 只暴露 `/private restart`，且文档不再推荐 `/restart --target=private`。 | TASK-CMDSURF-001 | TC-CMDSURF-001 | @qa |
| US-CMDSURF-002 | AC-CMDSURF-002-01：Given 项目配置了客户端平台命令，When 执行 `/dev app <platform>`，Then 统一入口启动开发客户端且不把构建成功当作运行成功。 | TASK-CMDSURF-002 | TC-CMDSURF-002 | @qa |
| US-CMDSURF-002 | AC-CMDSURF-002-02：Given 项目配置了客户端平台命令，When 执行 `/build app <platform>`，Then 统一入口只生成发行产物且不执行部署。 | TASK-CMDSURF-002 | TC-CMDSURF-003 | @qa |
| US-CMDSURF-003 | AC-CMDSURF-003-01：Given 命令、平台、环境或 profile 未配置，When 调用统一入口，Then 输出 `STATUS=BLOCKED`、明确下一动作并以非零状态退出，且不得跨 profile 回退。 | TASK-CMDSURF-003 | TC-CMDSURF-004 | @qa |
| US-CMDSURF-004 | AC-CMDSURF-004-01：Given 模板应用到目标项目，When 执行 dry-run、apply 和收敛 dry-run，Then 仅更新 template-owned 文件且 `RULES.md` 与 `agent.config.json` 保持项目所有。 | TASK-CMDSURF-004 | TC-CMDSURF-005 | @qa |
| US-CMDSURF-004 | AC-CMDSURF-004-02：Given 目标项目保留稀疏 `agent.config.json`，When 应用模板并加载有效配置，Then mac、win、ios、android 的 dev/build 默认及 private 变体、本地服务五项生命周期和 dev/staging/prod 服务端 build 均解析为规范 alias；`ship` 仍无可执行默认值。 | TASK-CMDSURF-005 | TC-CMDSURF-006 | @qa |
| US-CMDSURF-005 | AC-CMDSURF-005-01：Given 容器层的 `worktrees`、`tmp`、`cache` 或 `artifacts` 目录尚不存在，When 执行首次需要写入对应目录的稳定命令，Then 命令在写入前自动递归创建该目录及必要父目录。 | TASK-CMDSURF-009~011 | TC-CMDSURF-007 | @qa |
| US-CMDSURF-005 | AC-CMDSURF-005-02：Given 相关容器目录已经存在，When 重复执行对应命令，Then 目录初始化保持幂等且不删除、不覆盖既有内容。 | TASK-CMDSURF-009~011 | TC-CMDSURF-008 | @qa |
| US-CMDSURF-005 | AC-CMDSURF-005-03：Given 配置路径非法、目标不是实际目录或当前进程无创建权限，When 命令初始化对应容器目录，Then 命令明确失败并输出可行动的错误，不继续执行后续副作用；只读且无需写入的命令不为初始化目录而产生额外副作用。 | TASK-CMDSURF-009~012 | TC-CMDSURF-009 | @qa |
| US-CMDSURF-006 | AC-CMDSURF-006-01：Given 用户只提供了简短或不完整的修改请求，When Agent 开始执行，Then 先从用户输入与仓库证据补齐目标、非目标、可观察验收和验证方式；仅在实质歧义会改变产品行为、数据、安全、权限、外部合约或范围时提出最小问题，且 mutation 任务无显式验收标准时不得创建状态。 | TASK-CMDSURF-013~014 | TC-CMDSURF-010 | @qa |
| US-CMDSURF-006 | AC-CMDSURF-006-02：Given 模板提供 Codex 审批策略示例，When 用户阅读或复制配置，Then 交互式场景使用 `on-request`、非交互式场景使用 `never`，且模板不再推荐已弃用的 `on-failure`。 | TASK-CMDSURF-015 | TC-CMDSURF-011 | @qa |
| US-CMDSURF-007 | AC-CMDSURF-007-01：Given 远端 base 在本地缓存后继续前进，When 默认创建全新 worktree，Then 命令先成功 fetch `origin`、解析确定的远端 base commit SHA，并使新 worktree 初始 HEAD 等于该 SHA。 | TASK-CMDSURF-017~018 | TC-CMDSURF-012 | @qa |
| US-CMDSURF-007 | AC-CMDSURF-007-02：Given `origin` fetch 失败或远端 base 无法解析，When 默认创建全新 worktree，Then 命令以非零状态阻断，且不创建请求的 branch、worktree 或 session。 | TASK-CMDSURF-017~018 | TC-CMDSURF-013 | @qa |
| US-CMDSURF-007 | AC-CMDSURF-007-03：Given 用户显式传入 `--skip-fetch` 且缓存 remote base 或本地 base 存在，When 创建全新 worktree，Then 命令只从该确定 commit 创建、输出 `BASE_FRESHNESS=UNVERIFIED`，且在两类 base 都不存在时阻断而不回退任意 `HEAD`。 | TASK-CMDSURF-017~018 | TC-CMDSURF-014 | @qa |
| US-CMDSURF-007 | AC-CMDSURF-007-04：Given 命令处于 dry-run 或命中已有 worktree 恢复路径，When 执行 worktree 创建入口，Then 不触发 fetch，且不改变已有分支 HEAD。 | TASK-CMDSURF-017~018 | TC-CMDSURF-015 | @qa |
| US-CMDSURF-008 | AC-CMDSURF-008-01：Given 另一台电脑已经创建并推送同名任务分支，When 本机执行 worktree new，Then 命令不得从配置主干重新创建该分支，并输出远端恢复或更名动作。 | TASK-CMDSURF-021~022 | TC-CMDSURF-016 | @qa |
| US-CMDSURF-008 | AC-CMDSURF-008-02：Given 本地不存在而 `origin/<branch>` 存在，When 本机显式执行 worktree resume，Then 新 worktree HEAD 精确等于远端分支 SHA，并建立本机独立 session。 | TASK-CMDSURF-021~022 | TC-CMDSURF-017 | @qa |
| US-CMDSURF-008 | AC-CMDSURF-008-03：Given 任意电脑执行本地 QA，When `qa verify` 通过，Then 本机回执记录配置主干的 `BASE_SHA` 和功能分支的 `HEAD_SHA`；任一 SHA 漂移时 `qa merge` 使旧回执失效并阻断。 | TASK-CMDSURF-021、023~024 | TC-CMDSURF-018 | @qa |
| US-CMDSURF-008 | AC-CMDSURF-008-04：Given 两台电脑并发更新配置主干，When 第一台已完成更新，Then 第二台不得覆盖已进入远端的提交，而应被 SHA 门禁或非快进 push 拒绝并要求重新 QA。 | TASK-CMDSURF-021、024、026 | TC-CMDSURF-019 | @qa |
| US-CMDSURF-008 | AC-CMDSURF-008-05：Given 项目协作者在任意电脑激活任意专家阶段，When 创建、验证或合并任务，Then 模板不读取机器角色或 QA 专用身份，且允许相同权限的协作者合并 PR 或普通更新配置主干；主干永不 force push。 | TASK-CMDSURF-024~026 | TC-CMDSURF-020 | @qa |
| US-CMDSURF-008 | AC-CMDSURF-008-06：Given 目标项目禁止 GitHub CI，When 应用模板并完成 TDD/QA/合并，Then 模板不创建、修改、触发或依赖 `.github/workflows` 与 required checks，所有门禁在本地执行。 | TASK-CMDSURF-025~026 | TC-CMDSURF-021 | @qa |
| US-CMDSURF-009 | AC-CMDSURF-009-01：Given 息壤模板已应用到实际项目，When 用户提出“更新息壤模板”，Then 项目规则将其确定性路由到 `pnpm agent -- template sync`，并识别模板 ID `xirang`、中文名“息壤”和固定官方 GitHub 源。 | TASK-CMDSURF-027~028、032 | TC-CMDSURF-022 | @qa |
| US-CMDSURF-009 | AC-CMDSURF-009-02：Given 官方模板默认分支存在比实际项目内模板快照更新的提交，When 在实际项目专用 worktree 中执行 `template sync`，Then 命令通过 GitHub 鉴权入口成功 fetch、锁定本次远端 commit SHA，并从该 SHA 的执行器和 manifest 应用模板。 | TASK-CMDSURF-027、029~030 | TC-CMDSURF-023 | @qa |
| US-CMDSURF-009 | AC-CMDSURF-009-03：Given GitHub fetch 失败、官方分支不存在、SHA 无法解析或模板源形状非法，When 执行普通 `template sync`，Then 命令以非零状态在目标 tracked 文件修改前阻断，且不得静默回退到缓存或项目内旧快照。 | TASK-CMDSURF-027、029~030 | TC-CMDSURF-024 | @qa |
| US-CMDSURF-009 | AC-CMDSURF-009-04：Given 官方模板来源有效，When 同步涉及已有实际项目文件，Then 命令先 dry-run、冲突时阻断、无冲突时 apply 并再次 dry-run，最终只改变 manifest 允许的 template-owned 内容且保护 `RULES.md`、业务源码和 project-owned 配置。 | TASK-CMDSURF-027、030~032 | TC-CMDSURF-025 | @qa |
| US-CMDSURF-009 | AC-CMDSURF-009-05：Given 实际项目已同步到该模板 SHA，When 再次执行同步或检查结果，Then 收敛结果为无模板差异，并输出 `TEMPLATE_ID`、`TEMPLATE_REPO`、`TEMPLATE_BRANCH`、`TEMPLATE_COMMIT`、`TEMPLATE_FETCH_STATUS`、`TEMPLATE_APPLY_STATUS` 和 `TEMPLATE_CONVERGENCE_STATUS`。 | TASK-CMDSURF-027、030~033 | TC-CMDSURF-026 | @qa |

## 4. 非功能需求（NFR）

- NFR-CMDSURF-001：命令选择为确定性映射，不得执行未配置回退。
- NFR-CMDSURF-002：所有执行写入容器层运行目录并输出可解析状态。
- NFR-CMDSURF-003：模板默认配置不包含真实产品名、端口、URL、凭据或签名身份。
- NFR-CMDSURF-004：macOS、Linux、Windows 的 Node 调度路径保持兼容；项目命令自行声明平台约束。
- NFR-CMDSURF-005：模板更新不得要求把完整默认矩阵复制到 project-owned `agent.config.json`；有效配置必须通过深合并继承 template-owned 默认值。
- NFR-CMDSURF-006：容器目录初始化必须幂等、按需执行，并沿用配置解析与拓扑校验后的绝对路径，禁止用 linked worktree 相对路径猜测容器位置。
- NFR-CMDSURF-007：任务输入规则保持单一入口、短小且可测试；诊断、研究和运维任务继续允许以目标作为默认验收，保持兼容。
- NFR-CMDSURF-008：全新 worktree 的默认基线必须由本次成功 fetch 后的确定 commit SHA 表示；缓存或本地基线只能由显式跳过路径使用，且不得把任意 `HEAD` 当作 configured base。
- NFR-CMDSURF-009：本机 session/锁只承担本机生命周期职责；跨电脑协调必须使用远端 branch/PR/base SHA 和普通非强制更新，且所有主干引用来自 `config.baseBranch`。
- NFR-CMDSURF-010：息壤模板同步必须绑定固定官方仓库、默认分支和本次 fetch 后的不可变 commit SHA；来源验证失败不得产生目标 tracked 文件修改。
- NFR-CMDSURF-011：模板同步在 macOS、Linux 与 Windows 上使用 Node argv 调度和 GitHub 鉴权封装，不依赖 shell 拼接、全局临时工作区或项目业务工具。
- NFR-CMDSURF-012：模板身份与同步触发规则必须随 template-owned 文件传播，实际项目无需复制完整默认配置，也不得在 project-owned `agent.config.json` 中强制保存本机绝对路径。

## 5. 依赖与风险

依赖现有 `agent-cli.js`、`devops-run.js`、配置加载器、GitHub 鉴权环境构建器、worktree 生命周期脚本、模板 apply 引擎与 manifest。主要风险是把项目 alias 当成模板规范、private profile 隐式回退到 default、目录创建发生得过早而污染只读操作、把陈旧 remote-tracking ref 误报为最新基线、把本机 session/锁误当作跨电脑协调源，以及让实际项目误用自身旧模板快照；通过显式语法、按需初始化边界、默认 fetch 强门禁、固定模板 SHA、远端 SHA 回执、非快进更新与定向负向测试缓解。

## 6. 里程碑与 Gate

- M0 PRD：Story/AC/Traceability 完成。
- M1 ARCH/TASK：配置和执行边界冻结、测试任务可执行。
- M2 TDD/QA：定向测试、相关全量回归和模板传播验证通过。

## 7. 追溯矩阵与验证

详见 [`docs/data/traceability-matrix.md`](../../data/traceability-matrix.md)。全部 AC 必须关联自动化测试或传播验收证据。

## 8. 用户体验设计（UX）

不适用；命令输出要求为简短、结构化、可恢复。

## 9. 开放问题

无。

## 10. 变更记录

| 版本 | 日期 | 描述 | 责任人 |
| --- | --- | --- | --- |
| v1.0 | 2026-08-23 | 建立通用客户端和服务端快捷命令协议 | @template-maintainers |
| v1.1 | 2026-08-26 | 增加容器目录按需自动创建、幂等与失败边界 | @template-maintainers |
| v1.2 | 2026-08-27 | 增加短提示词补齐与 mutation 显式验收门禁，并收敛 Codex 审批策略示例 | @template-maintainers |
| v1.3 | 2026-09-01 | 增加全新 worktree 的远端基线强制刷新、固定 SHA 创建与显式 skip 边界 | @template-maintainers |
| v1.4 | 2026-09-05 | 增加无 GitHub CI 的多电脑同权协作、远端分支恢复、QA 双 SHA 回执与主干乐观并发边界 | @template-maintainers |
| v1.5 | 2026-09-06 | 模板命名为息壤，增加实际项目自然语言触发、固定官方 GitHub 源与 SHA 锁定的模板自更新协议 | @template-maintainers |

## 11. 自检清单

- [x] Story/AC 使用 Given-When-Then。
- [x] 已同步追溯矩阵。
- [x] 无图形界面，UX 不适用。
- [x] 已通知后续 ARCH/TASK/TDD/QA 阶段。
