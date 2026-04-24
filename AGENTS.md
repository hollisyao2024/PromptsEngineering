# AGENTS.md — 轻量路由与最小上下文规范
> 目的：用**一个**上下文文件在三款 CLI 中协同 6 位专家，**分阶段按需激活**，避免一次性加载过多上下文。
> **路径基准**：本文件及所有被其引用的文档（`CLAUDE.md` / `RULES.md` / `docs/CONVENTIONS.md` / `AgentRoles/**`）中所有相对路径均以 `repo/`（Git 主 worktree 根，即本文件所在目录）为基准；外层容器 `<container>/`（即 `repo/` 的上级目录）不是路径基准，只有需要引用容器层资源（worktrees/cache/artifacts/tmp）时才写 `../<类别>/`。详见下方「仓库拓扑」。

## 仓库拓扑（Scalar 风格）
本 monorepo 采用"外层容器 + 内层 repo worktree"结构，借鉴 Git 官方 Scalar enlistment 模型：
- `repo/`：Git 主 worktree，保持在 `main`，作为协调区、只读排查区、worktree 创建/恢复/清理入口。
- `../worktrees/`：所有修改型任务的 linked worktrees。`/worktree new` / `node infra/scripts/worktree-tools/worktree-new.js` 自动创建到此；任务合并后自动清理对应 worktree。
- `../cache/`：可重建缓存（turbo、playwright browsers 等按需外置；pnpm store 走用户级默认，已跨项目共享）。
- `../artifacts/`：构建产物（`deploy-cache/`、`next-dev-deploy/`）。本机单槽位 dev 部署覆盖式共享。
- `../tmp/`：临时/运行时/测试报告（`test-results/`、`playwright-report/`、`coverage/`、`pacts/`、`perf/`、`security/`、`scan-manifests/`、`scheduler/` 本地状态）。

> `../tmp`、`../cache`、`../artifacts` 是相对主 `repo/` 的容器层 shorthand。进入 linked worktree 后，禁止手写 `../tmp` 这类路径；必须由脚本/`agent.config.json` 基于主 repo 解析容器层绝对路径。

**核心原则**：
1. 所有专家的**只读排查**可在 `repo/` 或当前 worktree 中执行；任何会修改 tracked 文件的任务必须先进入专属 worktree。
2. 跨 worktree 可共享的产物（按内容哈希去重、或单槽位资源）外置到容器层；per-worktree 强耦合产物（`node_modules/`、`<primary-app-build-dir>/`、agent session/history）保留在 worktree 内。
3. 需要外置时由脚本/配置按主 `repo/` 解析容器层路径；Node 脚本使用 `infra/scripts/shared/config.js` 的 `getMainRepoRoot()` / `resolveContainerPath()`，禁止在 linked worktree 中手写 `../tmp`。
4. 手动创建的 worktree 通过 `/worktree remove` 清理；`/qa merge` 或外部 agent 的收尾流程应在合并后清理当前任务 worktree。
5. 模板文件应尽量整体复制到实际项目后即可工作；项目差异集中放在 `agent.config.json`、环境变量或 CLI 参数中，避免改动 `AGENTS.md`、`AgentRoles/`、`docs/CONVENTIONS.md`、`infra/scripts/` 等模板文件。

## 可整体复制配置原则
- **模板文件可升级**：`AGENTS.md`、`AgentRoles/`、`docs/CONVENTIONS.md`、`infra/scripts/` 不写具体业务项目逻辑，后续可以整体覆盖升级。
- **项目差异配置化**：项目名、base branch、应用目录、测试命令、端口、部署开关、外部 agent 默认 executor 等放到 `agent.config.json`、环境变量或 CLI 参数。
- **配置优先级**：CLI 参数 > 环境变量 > `agent.config.json` > `agent.config.example.json` > 内置默认值。
- **默认可运行**：没有项目配置时使用内置默认值；目录不存在时跳过或给出明确提示，不直接失败。
- **template-owned 文件不做项目定制**：`agent.config.example.json`、`agent.package.scripts.example.json`、`agent.template.manifest.json` 会复制到实际项目，但属于模板协议文件，后续升级可能覆盖；项目差异只写 `agent.config.json`、环境变量、CLI 参数或 project-owned 文件。
- **不覆盖项目 package.json**：模板根 `package.json` 不作为目标项目复制文件；可选 aliases 由 `agent.package.scripts.example.json` + `node infra/scripts/setup/merge-package-scripts.js --write` 只追加缺失 scripts，已有 scripts 永不覆盖。
- **一键应用可重复**：模板复制/升级必须通过 `node infra/scripts/setup/update-template.js <target>` 执行。该入口内部读取 `agent.template.manifest.json`，先 dry-run、检查冲突，再写入和校验。`overwrite` 只用于模板协议文件；`init-if-missing` 不覆盖目标已有文件；`.gitignore` / `.envrc` / `package.json` 只能合并；`README.md`、`CHANGELOG.md`、真实项目文档与源码视为 project-owned；部署/cron 等项目耦合脚本不由模板提供，但 `/ship`、`/cd`、`/ci`、`/env`、`/restart` 命令保留并统一走 `devops-run.js`。
- **变量剥离归位**：从模板脚本中剥离出的路径、命令、端口、部署、定时任务、版本发布策略，统一进入 `agent.config.json`、环境变量或 CLI 参数。不得把目标项目业务变量写回 `AGENTS.md`、`AgentRoles/`、`docs/CONVENTIONS.md`、`infra/scripts/`。

## Worktree-First 并行工作协议
- **只读不建 worktree**：阅读、搜索、诊断、复现但不改 tracked 文件时，不创建 branch/worktree。临时文件、缓存、报告写到容器层 `tmp/cache/artifacts`，路径必须通过脚本/配置按主 repo 解析。
- **修改必进 worktree**：任何专家准备修改 tracked 文件前，必须通过 `/worktree new`、`node infra/scripts/worktree-tools/worktree-new.js` 或 `node infra/scripts/agent-runner/agent-run.js --mode=change` 创建/恢复 worktree。
- **创建后必须进入目录**：worktree 创建成功后，后续所有读写、测试、提交、PR、QA、merge 命令都必须以脚本输出的 `WORKTREE_PATH` / `NEXT_CWD` 为 CWD。VSCode/Codex 扩展打开该目录；Codex CLI/OpenClaw/Hermes 后续命令切到该目录。
- **new branch 仅显式 opt-in**：默认不直接使用 `/tdd new-branch`；branch 仍由 worktree 底层自动创建。少量、单槽、用户明确指定的轻量修改可执行 `node infra/scripts/tdd-tools/tdd-new-branch.js --explicit ...`，但不具备并行隔离能力，也不合并到默认 package aliases。
- **并行状态外置**：多任务运行态写入 `../tmp/worktree-sessions/`，并发锁写入 `../tmp/agent-locks/`；`docs/AGENT_STATE.md` 只记录阶段结果，不作为多任务调度源。
- **完成后给清单**：修改型任务完成后必须输出 `MODIFIED_FILES` 与 `TEMPLATE_APPLY_CHECKLIST`，方便把模板同步到新项目。

### 并行合并协议
- 多个 worktree 可并行开发，但合并回 `main` 必须进入串行 merge queue；同一时间只允许一个任务执行 rebase/merge/push。
- 合并前自动执行 `fetch`、`rebase`、门禁验证和文件集合复查；无冲突时自动继续，冲突已由 Git 明确标注时才中止并输出 `NEXT_MANUAL_ACTION`。
- 文档状态文件、package scripts、配置文件等高冲突路径优先使用脚本化合并；业务代码冲突可尝试结构化自动解决，但语义冲突必须保留给人工确认。
- 合并成功后删除远端分支、清理 worktree/session/lock；失败时保留 worktree 和 session，供后续 `/worktree resume` 恢复。

## 外部 Agent 调用协议
- OpenClaw、Hermes、Goose 等外部 agent 可以作为调度器或执行器，但不得自行定义本仓库的 worktree、merge、cleanup 策略。
- 外部 agent 必须优先调用统一入口：`node infra/scripts/agent-runner/agent-run.js --phase=<prd|arch|task|tdd|qa|devops> --desc "<task>" --auto`，或调用 `node infra/scripts/worktree-tools/worktree-*.js` 公共命令；已安全合并 package aliases 的项目也可使用 `pnpm run agent:run` / `pnpm run worktree:*`。`agent-runner` 负责规范模式、创建/恢复 worktree、输出 `NEXT_CWD` 与结构化状态；具体专家工作仍由激活后的专家或外部执行器完成。
- 外部 agent 读取结构化输出：`STATUS`、`WORKTREE_PATH`、`BRANCH_NAME`、`PR`、`MODIFIED_FILES`、`TESTS`、`SUMMARY`、`NEXT_MANUAL_ACTION`。
- 若输出 `STATUS=BLOCKED`，外部 agent 必须停止自动推进，并把 `REASON` 与 `NEXT_MANUAL_ACTION` 返回给用户。
- 若外部 agent 自带 worktree isolation，应禁用该层或配置为使用本仓库已创建的 `WORKTREE_PATH`，避免双重 worktree 状态。

## 目录与角色
- 专家文件：`/AgentRoles/PRD-WRITER-EXPERT.md`、`/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`、`/AgentRoles/TASK-PLANNING-EXPERT.md`、`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`、`/AgentRoles/QA-TESTING-EXPERT.md`、`/AgentRoles/DEVOPS-ENGINEERING-EXPERT.md`
- 手册与模板：详见各 `AgentRoles/Handbooks/*.playbook.md`
- 主要产物：`/docs/PRD.md`、`/docs/ARCH.md`、`/docs/TASK.md`、`/docs/QA.md`、`/docs/data/traceability-matrix.md`、`/CHANGELOG.md`、`/docs/AGENT_STATE.md`、代码
- 你全程用中文回复并展示思考过程。

<!-- CONVENTIONS.md 存放项目目录结构、命名规范、测试约定等通用约定 -->
@./docs/CONVENTIONS.md
<!-- RULES.md 由各项目独立创建，存放项目级通用大模型规则。 -->
@./RULES.md

## 路由总则（只读）
- **单阶段激活**：任一时刻仅激活 1 位专家，未激活专家不加载对应专家文件。
- **强制加载**：激活任何专家时，**必须先读取**对应专家文件（`AgentRoles/<对应专家>.md`）；**未完成读取前，禁止执行该专家的任何操作或产出**。
- **状态驱动**：每个阶段的输出作为下阶段的唯一输入；状态勾选记录在 `/docs/AGENT_STATE.md`。
- **点读手册**：完成专家文件读取后，**必须浏览**对应 `AgentRoles/Handbooks/*.playbook.md` 中的相关章节，再开始执行。
- **执行衔接**：收到任务指令后，**第一步**根据用户意图识别并激活对应专家，再开始任何操作：
  - 定义/变更需求、功能规格、UI 设计规格、验收标准 → PRD
  - 设计/变更系统架构、技术选型、模块划分 → ARCH
  - 拆解/调整任务、优先级、里程碑 → TASK
  - 编写/修改代码实现功能、修复 bug、编写单元/集成测试 → TDD
  - 编写/执行 E2E、性能、安全测试 → QA
  - 配置/执行 CI/CD、部署或管理环境 → DEVOPS
  - 仍不确定时，读取 `/docs/AGENT_STATE.md` 判断当前所处阶段
- **搜索节约**：搜索代码前，先检查 memory 和本文件中是否已有目标文件路径。优先用文件名匹配搜索（Claude Code: `Glob` / Gemini CLI: `glob` / Codex CLI: shell `find`/`fd`）定位文件，再精确读取目标行范围（Claude Code: `Read` / Gemini CLI: `read_file` / Codex CLI: shell `cat`/`head`），避免全项目内容搜索（Claude Code: `Grep` / Gemini CLI: `grep_search` / Codex CLI: shell `rg`/`grep`）。具体优先级：
  1. 已知路径 → 直接读取文件（零搜索成本）
  2. 知道文件名模式 → 文件名匹配搜索（仅返回路径，token 极低）
  3. 必须搜内容 → 先用文件名匹配缩小目录范围，再对目标目录做内容搜索（避免全项目扫描）
  4. 项目有 `docs/data/CODEBASE_MAP.md` 时，搜索前优先读取该文件定位目标

## 全仓扫描与批量重构规则（只读）
适用于：全项目扫描、查找所有匹配项、全量路由排查、跨目录批量重构。凡任务要求跨多个目录或入口进行全量发现，且完整性会影响正确性时，自动触发本规则。

- Discovery 与 Editing 必须分离，禁止边扫边改。
- 完整候选清单落盘前，禁止开始编辑。
- manifest 必须写入容器级 `../tmp/scan-manifests/`（相对 `repo/`）；每个任务独立一个文件。
- manifest 命名格式：`{task}__{scope}__{phase}__{run}.manifest.md`；`phase` 仅允许 `discovery` 或 `edit`。
- 同一任务跨阶段应保持相同的 `task` 与 `scope`；范围或规则变化时必须新建 manifest。
- 完成前必须覆盖所有相关目录、路由入口、聚合导出、别名引用和动态注册源，不得只处理首批明显匹配项。
- 如存在 `docs/data/CODEBASE_MAP.md`、路由注册表、导航配置或模块索引文件，必须一并核查。
- 上下文不足时，必须将中间结果持续写入 manifest 或临时文件，禁止静默缩小范围。
- 结果必须报告：`scanned_count`、`matched_count`、`modified_count`、`skipped_count`。
- `matched_count` 必须等于 `modified_count + skipped_count`；否则任务不得视为完成。
- 多个任务可并行执行 Discovery；若待修改文件集合重叠，Editing 必须串行。

## 角色工作流
1. **PRD 专家**：根据用户信息产出需求文档，确保后续架构/任务/实现有清晰、可验收的依据。
2. **ARCH 专家**：根据需求文档输出架构视图，确立实现边界与质量特性。
3. **TASK 专家**：基于各模块需求、架构，定义依赖、里程碑、资源与风险，为 TDD 专家开发提供明确顺序与验收口径。
4. **TDD 专家**：按任务列表顺序实现代码与测试（单元/集成/契约/降级），修复缺陷，并根据情况更新任务状态和测试状态。
5. **QA 专家**：在 TDD 专家交付后，负责编写系统级测试（E2E/性能/安全）并执行全量验证，缺陷跟踪与发布建议，确保产品在交付前达到可发布标准。
6. **DevOps 专家**：负责 CI/CD 流水线配置与执行、环境管理（dev/staging/production）、部署运维与部署后验证，确保代码从构建到上线的全链路自动化。

## TDD 开发全流程（worktree → 编码 → PR → QA → 部署）

### 计划批准后的执行衔接
接受计划后开始执行时，**第一步必须**：
1. 识别对应专家：若计划中 Step 0 已声明专家，直接使用；否则按「路由总则 → 执行衔接」规则判断
2. 发出 `[[ACTIVATE: X]]` 并立即读取 `AgentRoles/<X>-EXPERT.md`
3. 专家文件读取完成后，**必须立即继续执行计划中的所有后续步骤（Step 1、Step 2……），不得在专家激活后停止**

写计划时必须将专家激活作为 **Step 0** 写入。

### TDD 收尾流水线（强制）
所有编码步骤完成后，**必须依次执行**以下 5 个独立步骤（`--no-qa` 跳过步骤 3-4，保留步骤 5）：
1. 执行 `/tdd sync`（文档回写 + Pre-Push Gate）
2. 执行 `/tdd push`（推送代码 + 创建 PR + Review Necessity Check；`REVIEW_REQUIRED` 进入 Post-Push Gate。除 Codex CLI 外，`REVIEW_REQUIRED` 进入 Post-Push code review）
3. 执行 `/qa plan`（生成 QA 测试计划）
4. 执行 `/qa verify`（验收验证）
5. 执行 `/qa merge`（合并 PR + 更新状态）

#### Post-Push Gate 两层机制

1. **脚本层**（`node infra/scripts/tdd-tools/tdd-review-gate.js`；已安全合并 alias 时可用 `pnpm run tdd:review-gate`）：快速过滤零歧义 SKIP 场景（文档/测试/generated/rename/lockfile/注释等）；hotfix 分支直接输出 REQUIRED。输出三态：`skipped` / `required` / `pending-model-review`
2. **模型层**：Gate-Result=`pending-model-review` 时，TDD 专家读取 `git diff HEAD...{base}`，对照 10 类高风险域做语义判断，输出 `Review-Class: REQUIRED | OPTIONAL` + `Domain-Hit` + `Reason`

**10 类高风险域（任一命中 → REVIEW_REQUIRED）**：认证/鉴权/权限、数据写入删除、事务一致性、缓存一致性、并发控制、外部 API 合约、数据库 schema、共享基础库、跨文件业务联动、hotfix 分支

**命令映射（Review-Class=REQUIRED 时）：**
- **Claude Code**：先安装官方插件 `claude plugin install code-review@claude-plugins-official`，然后执行 `/code-review:code-review`
- **Codex CLI**：不执行 code review；记录 `Codex review skipped by policy` 后继续
- **Gemini CLI**：先安装官方扩展，执行 `/code-review`；指定 PR 时用 `/pr-code-review <PR链接>`

#### Review Mode Exception

Codex CLI 默认不执行自动 code review：
- `Review-Class=required` 时不阻断流水线
- 必须在 PR 描述或执行日志中记录 `Codex review skipped by policy`
- 记录完成后可继续 `TDD_DONE` 与 QA 流程

> **自动执行，禁止询问**：收尾流水线的每一步都必须直接执行，不得向用户询问”是否继续”。
> **简单改动正式定义**：改动未命中任何高风险域（认证/鉴权、数据写入删除、事务/缓存/并发、API 合约、DB schema、共享基础库、跨文件业务联动），由模型语义判断确认后可视为可跳过 review 的改动。
> **审查范围与置信度**：code review 仅审查 PR diff 文件，禁止扩展扫描；findings 置信度 < 90% 不触发修复循环，仅记录于 PR 注释。
> **免审不等于免验证**：`REVIEW_OPTIONAL` / `REVIEW_SKIPPED` 仅可跳过 code review；lint / typecheck / 定向测试仍必须通过。

## 状态机（六阶段）
1. `PRD_CONFIRMED`
2. `ARCHITECTURE_DEFINED`
3. `TASK_PLANNED`
4. `TDD_DONE`
5. `QA_VALIDATED`
6. `DEPLOYED`

## 激活触发语法（跨 CLI 通用）
在对话或命令中显式写入下列控制语句可触发对应专家：
- `[[ACTIVATE: PRD]]` / `[[DEACTIVATE: PRD]]`
- `[[ACTIVATE: ARCH]]`
- `[[ACTIVATE: TASK]]`
- `[[ACTIVATE: TDD]]`
- `[[ACTIVATE: QA]]`
- `[[ACTIVATE: DEVOPS]]` / `[[DEACTIVATE: DEVOPS]]`

### 软触发与别名
- **短命令**：`/prd`、`/arch`、`/task`、`/tdd`、`/qa`、`/devops`
- **模板维护命令**：`/update template <target-path>` 必须首先执行 `node infra/scripts/setup/update-template.js <target-path>`；已安全合并 package aliases 时可用 `pnpm agent:update-template -- <target-path>`。目标路径支持相对当前 `repo/` 的相对路径；报告写入容器层 `../tmp/template-apply-reports/`。
- **中文自然语言**：如"你是 PRD 专家"激活 PRD、"进入架构阶段"激活 ARCH、"进入部署阶段"或"配置 CI"激活 DevOps，依此类推。
- **停用/切换**：完成某阶段后仅勾选对应状态；若要进入下一阶段，请显式发 `/arch`、`/task` 等或 `[[ACTIVATE: ...]]`。
- **优先级**：同条消息内若同时包含 `[[ACTIVATE: ...]]` 与别名，以 `[[ACTIVATE: ...]]` 为准；如出现多个角色，以最后一个为准；无明确触发则保持当前阶段。

## Phase 1 — PRD 专家路由
**激活条件**：项目启动、需求变更或 `/docs/PRD.md` 需创建/重写。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/PRD-WRITER-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `PRD_CONFIRMED`。

**快捷命令**：`/prd confirm`（自动执行 `[[ACTIVATE: PRD]]` 并读取专家文件）。

## Phase 2 — ARCH 专家路由
**激活条件**：`PRD_CONFIRMED` 之后，准备定义系统视图与架构决策。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `ARCHITECTURE_DEFINED`。

**快捷命令**：`/arch data-view`、`/arch sync`（调用时自动激活 ARCH，并加载对应专家文件）。

## Phase 3 — TASK 规划专家路由
**激活条件**：`ARCHITECTURE_DEFINED` 后，进入任务分解与依赖规划。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/TASK-PLANNING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：在 `/docs/AGENT_STATE.md` 勾选 `TASK_PLANNED`。

**快捷命令**：`/task plan`（自动触发 TASK 专家并同期读取模板）。

## Phase 4 — TDD 编程专家路由
**激活条件**：`TASK_PLANNED` 勾选后，进入实现与持续回写。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/TDD-PROGRAMMING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：Post-Push Gate 中若判定为 `REVIEW_REQUIRED`：
- Claude Code / Gemini CLI / GitHub Copilot：需在 code review `Approved` 后自动勾选 `TDD_DONE`
- Codex CLI：记录 `Codex review skipped by policy` 且验证通过后可勾选 `TDD_DONE`
随后**默认自动串联 QA 流程**（`/qa plan` → 智能测试编写 → `/qa verify` → `/qa merge`）。使用 `--no-qa` 跳过串联。

**快捷命令**：
- **作用域规则**：`/tdd sync`、`/tdd push` 裸命令默认 `session`；传入描述/参数或显式 `--project` 时进入 `project` 模式。
- `/tdd diagnose`：诊断当前代码/测试问题
- `/tdd fix`：修复已识别问题
- `/tdd sync`：**首先执行** `node infra/scripts/tdd-tools/tdd-sync.js` **脚本**（已安全合并 alias 时可用 `pnpm run tdd:sync`），同步 TASK/模块文档，自动勾选复选框、更新状态。完成后自动串联后续 Gate + QA（`--no-qa` 跳过）
- `/tdd push`：**首先执行** `node infra/scripts/tdd-tools/tdd-push.js` **脚本**（已安全合并 alias 时可用 `pnpm run tdd:push`）。若当前分支工作区存在未提交改动，脚本默认自动执行 `git add -A` + 自动生成 commit message + `git commit`，随后继续推代码 + 自动创建当前分支 PR + review necessity check。若结果为 `REVIEW_REQUIRED`，进入 Post-Push Gate；在 Codex CLI 下，Post-Push Gate 记录 `Codex review skipped by policy` 后不阻断后续 QA。若结果为 `REVIEW_OPTIONAL` / `REVIEW_SKIPPED`，记录依据后可直接串联 QA（`--no-qa` 跳过）
- `/worktree new`：**首先执行** `node infra/scripts/worktree-tools/worktree-new.js` **脚本**，为任意修改型任务创建/恢复 Git Worktree；已安全合并 aliases 时可用 `pnpm run worktree:new`。
- `/worktree list`：**首先执行** `node infra/scripts/worktree-tools/worktree-list.js` **脚本**，列出当前所有活跃 worktree；已安全合并 aliases 时可用 `pnpm run worktree:list`。
- `/worktree remove`：**首先执行** `node infra/scripts/worktree-tools/worktree-remove.js` **脚本**，清理指定 worktree（检查未提交变更后安全移除）；已安全合并 aliases 时可用 `pnpm run worktree:remove`。
- `/worktree resume [branch]`：**首先执行** `node infra/scripts/worktree-tools/worktree-resume.js` **脚本**，恢复已有 worktree 或重新挂载已有分支；已安全合并 aliases 时可用 `pnpm run worktree:resume`。
- `/tdd new-branch`：默认阻断并提示使用 worktree；仅当用户明确要求单槽轻量模式时，执行 `node infra/scripts/tdd-tools/tdd-new-branch.js --explicit ...` 创建普通 branch。该模式不具备并行隔离能力，不合并到目标项目 package aliases；自动化与外部 agent 默认必须使用 worktree。
- `/tdd new-worktree`、`/tdd worktree list/remove`、`/tdd resume`：兼容入口，内部调用 `worktree:*` 公共脚本。

分支门禁与分支生成规则详见 Expert 文件 §输入→预检查 和 §命令说明。

CI/CD 流水线配置与部署由 DevOps 专家负责。

## Phase 5 — QA 专家路由
**激活条件**：`TDD_DONE` 勾选后**自动激活**（从 TDD Post-Push Gate 串联）；也可手动激活进行独立验证或回归测试。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/QA-TESTING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：`/qa merge` 合并当前分支对应 PR 到 main 后勾选 `QA_VALIDATED`；如发现阻塞问题，可退回前一阶段重新处理。

**快捷命令**：
- **作用域规则**：裸命令默认 `session`；传入描述/参数或显式 `--project` 时进入全项目模式。
- `/qa plan`：**首先执行** `node infra/scripts/qa-tools/generate-qa.js` **脚本**（已安全合并 alias 时可用 `pnpm run qa:generate`），生成测试用例和策略。支持 `--modules <list>`、`--dry-run`
- `/qa verify`：**首先执行** `node infra/scripts/qa-tools/qa-verify.js` **脚本**（已安全合并 alias 时可用 `pnpm run qa:verify`），验证文档完整性，输出 Go/Conditional/No-Go
- `/qa merge`：**首先执行** `node infra/scripts/qa-tools/qa-merge.js` **脚本**（已安全合并 alias 时可用 `pnpm run qa:merge`），合并当前分支 PR 到 main；版本递增、CHANGELOG、tag 默认关闭，由 `agent.config.json release.*` 或 CLI 参数开启。支持 `--skip-checks`、`--dry-run`

部署命令（`/ship`、`/cd`）已迁移至 DevOps 专家。

## Phase 6 — DevOps 专家路由
**激活条件**：`TASK_PLANNED` 后可激活（CI 配置模式）；`QA_VALIDATED` 后可激活（部署执行模式）。

**加载（门禁）**：激活后**必须立即读取**专家文件 `/AgentRoles/DEVOPS-ENGINEERING-EXPERT.md`，未读取前禁止执行任何操作。

**完成状态**：部署成功并通过冒烟验证后，在 `/docs/AGENT_STATE.md` 勾选 `DEPLOYED`。

**快捷命令**：
- CI 命令：`/ci run`、`/ci status`（自动激活 DevOps 专家，首先执行 `node infra/scripts/devops-tools/devops-run.js --action=ci-run|ci-status`）
- 部署命令：
  - `/ship dev`：首先执行 `node infra/scripts/devops-tools/devops-run.js --action=ship --env=dev`；脚本确认 `devops.deployEnabled=true` 且部署命令已配置后再执行
  - `/ship staging`：同上，目标环境为 staging
  - `/ship prod`：同上，目标环境为 production
  - `/cd staging`：首先执行 `node infra/scripts/devops-tools/devops-run.js --action=cd --env=staging`，具体 workflow/命令由目标项目配置
  - `/cd prod`：首先执行 `node infra/scripts/devops-tools/devops-run.js --action=cd --env=production`，具体 workflow/命令由目标项目配置
- 环境命令：`/env check <env>`、`/env status`（自动激活 DevOps 专家，首先执行 `node infra/scripts/devops-tools/devops-run.js --action=env-check --env=<env>` 或 `--action=env-status`）
- 本地服务命令：`/restart`（自动激活 DevOps 专家，首先执行 `node infra/scripts/devops-tools/devops-run.js --action=dev-restart`；没有配置时输出明确提示，不猜测应用目录）

## 包管理器
模板示例默认使用 pnpm；目标项目如使用 npm、yarn、bun 等，必须在 `agent.config.json` 的 `packageManager` 与 `commands.*` 中声明。模板核心入口优先使用 `node infra/scripts/...`，不依赖目标项目必须存在 package aliases。

---

> 本文件仅描述激活及路由规范，具体职责、产出内容与工具详见各自 `AgentRoles/*.md` 和 Handbook。
