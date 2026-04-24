# Agents Router 模板（v1.18.12 · 2026-04-22）

这是一套面向 Codex CLI、Claude Code CLI、Gemini CLI 的多专家提示词工程模板。它用一个 `AGENTS.md` 作为轻量路由入口，把 PRD、架构、任务、TDD、QA、DevOps 六位专家拆成按需激活的阶段角色，让大模型在最小上下文里完成清晰、可追溯、可交接的工程协作。

请注意：本仓库本身是**纯模板仓库**，交付的是角色协议、目录约定、文档骨架与自动化脚本示例；它不代表当前仓库存在一个真实产品需求、开发任务、QA 验收或部署任务需要执行。把模板复制到具体项目后，再根据那个项目的真实目标激活专家、生成产物并推进阶段状态。

当前版本重点强化了四件事：
- **轻量路由**：任一时刻只激活 1 位专家，先读专家短卡片，再按需点读 Playbook 章节。
- **Worktree-First 并行任务**：只读排查不建 worktree；任何会修改 tracked 文件的任务自动创建/恢复专属 worktree，创建后进入 `WORKTREE_PATH` 开发。
- **Scalar 风格仓库拓扑**：主 `repo/` 保持在 `main` 作为协调区；并行 worktree、缓存、构建产物和临时报告放在容器层 `../worktrees/`、`../cache/`、`../artifacts/`、`../tmp/`。
- **自动化交付闭环**：TDD 完成后串联 `/tdd sync`、`/tdd push`、`/qa plan`、`/qa verify`、`/qa merge`，并由 DevOps 专家负责 CI/CD、环境与部署。

## 模板目标与价值
- 统一协议：三款 CLI 共用 `[[ACTIVATE: ...]]`、`/prd`、`/arch`、`/task`、`/tdd`、`/qa`、`/devops` 等激活语法，降低多工具切换成本。
- 最小上下文：专家文件与 Handbooks 分离，只有当前阶段需要的内容进入上下文。
- 状态驱动：以 `docs/AGENT_STATE.md` 记录 PRD_CONFIRMED → ARCHITECTURE_DEFINED → TASK_PLANNED → TDD_DONE → QA_VALIDATED → DEPLOYED 六阶段进度。
- 产物驱动：PRD → 架构 → 任务 → TDD → QA → DevOps 串行交接，以 `/docs` 下的产物文件作为阶段输入与唯一真相来源。
- 模块化扩展：大型项目可按功能域拆分 PRD / ARCH / TASK / QA 文档，主文档保留总纲，模块文档按需加载。
- 可整体复制：项目差异集中在 `agent.config.json`、环境变量或 CLI 参数中，模板文件尽量不需要在实际项目中修改。
- 工程闭环：内置脚本入口、Review Gate、QA Gate、worktree 管理和部署命令约定；`package.json` 只通过安全合并脚本追加缺失 aliases，不覆盖项目自有内容。

## 目录速览
- `AGENTS.md`：轻量级路由说明，定义阶段流程、激活语法、质量门禁与上下文规范。
- `AgentRoles/*.md`：六位专家的运行时短卡片（PRD / ARCH / TASK / TDD / QA / DevOps）。
- `AgentRoles/Handbooks/*.playbook.md`：详尽操作手册；`AgentRoles/Handbooks/README.md` 概览各手册作用。
- `docs/`：阶段产物与运行状态，含 `PRD.md`、`ARCH.md`、`TASK.md`、`QA.md`、`AGENT_STATE.md`、`CONVENTIONS.md` 及数据资料。
  - `docs/prd-modules/`：大型项目 PRD 模块化目录，按功能域拆分详细需求。
  - `docs/arch-modules/`：大型项目架构模块化目录，按功能域拆分系统设计。
  - `docs/task-modules/`：大型项目任务模块化目录，按功能域拆分任务计划。
  - `docs/qa-modules/`：大型项目 QA 模块化目录，按功能域拆分测试计划。
  - `docs/data/traceability-matrix.md`：需求追溯矩阵，集中维护 Story → AC → Test Case ID 映射。
- `docs/adr/`：架构决策记录（ADR）模板目录。
- `infra/scripts/`：PRD / ARCH / TASK / TDD / QA / DevOps 自动化脚本。
- `agent.config.example.json`：template-owned 默认配置示例；首次应用可初始化 `agent.config.json`，项目差异只改 `agent.config.json`。
- `agent.package.scripts.example.json`：template-owned 可选 package scripts 清单；通过 `infra/scripts/setup/merge-package-scripts.js` 合并，禁止直接覆盖目标项目 `package.json`。
- `agent.template.manifest.json`：template-owned 模板应用策略清单，声明哪些路径可覆盖、只初始化、只合并、项目自有或排除。
- 数据库迁移目录由目标项目决定，可在 `agent.config.json paths.migrationsDir` 中声明。
- `.gemini/`：定义 Gemini CLI 的上下文配置，指向 `AGENTS.md` 而非默认 `GEMINI.md`。
- `CLAUDE.md`：Claude Code CLI 的入口提示，确保其读取 `AGENTS.md`。
- `.codex/`、`.claude/`：CLI 侧辅助说明与上下文入口。

## 快速开始
1. 在模板仓库 `repo/` 下执行一键应用或升级，目标路径支持相对路径：
   `pnpm agent:update-template -- ../target-project/repo`
2. `package.json` 不复制、不覆盖；脚本只通过 `agent.package.scripts.example.json` 追加缺失 aliases，冲突项保留项目原值并阻断自动写入。
3. 变量统一放到目标项目的 `agent.config.json`、环境变量或 CLI 参数；不要修改 `agent.config.example.json`、`agent.package.scripts.example.json`、`agent.template.manifest.json` 这类 template-owned 文件。
4. 在 Codex CLI、Claude Code CLI 或 Gemini CLI 中加载 `AGENTS.md` 作为初始上下文。
5. 只读排查直接执行，不创建 worktree；若任务会修改 tracked 文件，执行 `node infra/scripts/worktree-tools/worktree-new.js` 或 `node infra/scripts/agent-runner/agent-run.js` 创建/恢复 worktree。
6. 创建成功后进入脚本输出的 `WORKTREE_PATH`：VSCode/Codex 扩展打开该目录；Codex CLI/OpenClaw/Hermes 后续命令以该目录为 CWD。
7. 根据项目阶段激活专家；执行器完成修改后按 TDD/QA/DevOps 流程 push/PR/QA/merge/cleanup，并输出修改清单与模板应用清单。

## 一键应用与重复升级
`update-template.js` 封装了模板升级全流程：先 dry-run，发现 `package.json scripts` 冲突则阻断；无冲突后自动写入、校验 JSON、执行 `git diff --check` 并输出修改清单。dry-run/write 日志写入容器层 `../tmp/template-apply-reports/`，不落在模板或目标项目 `repo/` 中。

```bash
# 首次应用或重复升级，目标路径支持相对路径
pnpm agent:update-template -- ../target-project/repo

# 仅预览，不写入
pnpm agent:update-template -- ../target-project/repo --dry-run

# 部署/cron 快捷命令保留；项目耦合脚本由目标项目通过 agent.config.json 接入
```

应用策略：
- `overwrite`：模板协议和核心脚本，可覆盖升级。
- `init-if-missing`：目标没有才创建，例如 `docs/AGENT_STATE.md`、`agent.config.json`。
- `append-block`：用 managed block 合并，例如 `.gitignore`、`.envrc`。
- `merge-package-scripts`：只向 `package.json` 追加缺失 scripts，已有 scripts 永不覆盖。
- `project-owned` / `generated`：目标项目自有或生成文件，永不覆盖。
- `exclude`：目标项目自有内容，模板不应用；部署/cron 命令保留为 `devops-run.js` 配置入口。

template-owned 文件说明：
- `agent.config.example.json`、`agent.package.scripts.example.json`、`agent.template.manifest.json` 会复制到目标项目，但属于模板协议文件，后续升级可能覆盖。
- 实际项目需要改配置时，只改 `agent.config.json`、环境变量、CLI 参数、目标项目 `package.json` 或 `scripts/ops/` 等 project-owned 文件。
- 如果确实需要扩展模板应用策略，优先回到模板仓库修改并升级模板，不在单个实际项目里手改 `agent.template.manifest.json`。

剥离出来的变量统一进入 `agent.config.json`，例如：
- `paths.*`：应用目录、数据库目录、迁移目录、E2E/性能/安全目录。
- `commands.*`：lint、typecheck、test、build、QA 命令。
- `release.*`：是否递增版本、是否更新 CHANGELOG、是否打 tag。
- `devops.*`：部署开关、应用目录、构建/启动命令、环境配置。
- `cron.*`：定时任务是否启用与任务注册表。

### 实际项目 Ops 一次性迁移

模板不再提供 `infra/scripts/server/`、`infra/scripts/cron/` 的具体实现，但 `/ship`、`/cd`、`/ci`、`/env`、`/restart` 这些命令仍保留，统一通过 `infra/scripts/devops-tools/devops-run.js` 调度。实际项目只需做一次迁移：把自己的部署、cron、本地服务脚本放到项目自有目录（推荐 `scripts/ops/`），再在 `agent.config.json` 接入。

```json
{
  "devops": {
    "deployEnabled": true,
    "commands": {
      "ship": {
        "dev": "bash scripts/ops/deploy.sh local dev",
        "staging": "bash scripts/ops/deploy.sh local staging",
        "production": "bash scripts/ops/deploy.sh local production"
      },
      "cd": {
        "staging": "bash scripts/ops/deploy.sh ci staging",
        "production": "bash scripts/ops/deploy.sh ci production"
      },
      "envCheck": {
        "dev": "bash scripts/ops/env-check.sh dev",
        "staging": "bash scripts/ops/env-check.sh staging",
        "production": "bash scripts/ops/env-check.sh production"
      }
    }
  },
  "devServer": {
    "commands": {
      "restart": "bash scripts/ops/dev-server.sh restart",
      "status": "bash scripts/ops/dev-server.sh status"
    }
  },
  "cron": {
    "enabled": true,
    "registry": [
      { "name": "daily-cleanup", "command": "bash scripts/ops/cron-run.sh daily-cleanup" }
    ]
  }
}
```

可交给大模型执行的一次性迁移指令：

```text
请执行一次性迁移：把当前项目的部署、cron、本地服务脚本迁移到 project-owned ops 结构。保留快捷命令 /ship、/cd、/env、/restart，但它们必须通过 agent.config.json 接入 infra/scripts/devops-tools/devops-run.js。不要修改模板文件；项目自有脚本放 scripts/ops/，敏感变量继续走环境变量或 CI secrets。迁移后运行 pnpm ship:staging -- --dry-run、pnpm env:check:staging、pnpm dev:status，并输出旧脚本到新配置的映射表。
```

## Worktree-First 并行开发
- `diagnose` 模式：排查问题、读代码、跑只读检查，不创建 worktree；临时产物写容器层 `tmp`，缓存写容器层 `cache`，构建/部署产物写容器层 `artifacts`。这些路径由脚本/`agent.config.json` 按主 `repo/` 解析，进入 linked worktree 后不要手写 `../tmp`。
- `change` 模式：任何会修改 tracked 文件的任务都创建或恢复专属 worktree；主 `repo/` 不承载修改型任务。
- `new branch` 不是默认工作流；branch 仍由 Git worktree 底层自动创建。少量、单槽、用户明确指定的轻量修改可使用 `node infra/scripts/tdd-tools/tdd-new-branch.js --explicit ...`，但不具备并行隔离能力。
- 每个并行任务对应一个 worktree、一个 branch、一个 PR；合并成功后自动清理 worktree。
- 外部 agent（OpenClaw、Hermes、Goose 等）只调用 `agent-runner` 或 `worktree-tools` 统一入口，不自行管理 worktree/merge/cleanup。
- 多任务可并行开发，但 merge 回 `main` 串行排队：自动 `fetch/rebase/verify/merge/cleanup`，只有 Git 冲突或语义冲突才需要人工介入。

### Worktree 命令速查
```bash
node infra/scripts/worktree-tools/worktree-new.js --phase=tdd --task TASK-USER-001 --desc "login"
node infra/scripts/worktree-tools/worktree-new.js --phase=prd --desc "billing v2"
node infra/scripts/worktree-tools/worktree-list.js
node infra/scripts/worktree-tools/worktree-resume.js --branch feature/TASK-USER-001-login
node infra/scripts/worktree-tools/worktree-remove.js --branch feature/TASK-USER-001-login

node infra/scripts/agent-runner/agent-run.js --mode=diagnose --desc "inspect failing tests"
node infra/scripts/agent-runner/agent-run.js --phase=tdd --task TASK-USER-001 --desc "login" --auto
```

运行 `node infra/scripts/setup/merge-package-scripts.js --write` 后，可使用等价的 `pnpm run worktree:new` / `pnpm run agent:run` aliases。`/tdd new-worktree`、`/tdd worktree list/remove`、`/tdd resume` 保留为兼容入口；`/tdd new-branch` 默认阻断并提示使用 worktree，仅 `--explicit` 时创建普通 branch，且默认不合并到目标项目 package aliases。

```bash
node infra/scripts/tdd-tools/tdd-new-branch.js --explicit --desc "fix typo"
node infra/scripts/tdd-tools/tdd-new-branch.js --explicit --task TASK-USER-001 --desc "login"
```

`infra/scripts/agent-runner/agent-run.js` 是外部 agent 的生命周期入口：它负责规范任务模式、创建/恢复 worktree、输出 `NEXT_CWD` 与结构化状态；具体 PRD/ARCH/TASK/TDD/QA/DevOps 工作仍由激活后的专家或外部执行器完成。

## 命令作用域速查（TDD / QA）
以下 5 个命令采用统一规则：
- 裸命令（前后无描述/参数）默认 `session`：仅处理当前会话内容
- 显式 `--project`（或附加明确描述/参数）进入 `project`
- 说明：`/tdd push`、`/qa merge` 在两种作用域下都只处理当前分支/当前 PR，不会操作其他分支

| 命令 | 默认（session） | 项目级（project） |
|------|------------------|-------------------|
| `/tdd sync` | `node infra/scripts/tdd-tools/tdd-sync.js` | `node infra/scripts/tdd-tools/tdd-sync.js --project` |
| `/tdd push` | `node infra/scripts/tdd-tools/tdd-push.js`（推送当前分支并创建当前分支 PR） | `node infra/scripts/tdd-tools/tdd-push.js --project bump "release note"` |
| `/qa plan` | `/qa plan`（仅会话范围） | `/qa plan --project`（全量刷新） |
| `/qa verify` | `/qa verify`（仅会话范围） | `/qa verify --project`（项目级验收） |
| `/qa merge` | `node infra/scripts/qa-tools/qa-merge.js`（合并当前分支对应 PR） | `node infra/scripts/qa-tools/qa-merge.js --project`（显式项目模式） |

## 阶段化工作流
1. **PRD 专家**：明确产品目标、用户故事、验收标准；必要时补写 ADR。
   - 自动评估是否需要拆分 PRD（> 1000 行 或 50+ 用户故事 或 3+ 业务域），采用主从结构（主 PRD + 模块 PRD + 追溯矩阵）。
   - 支持企业级需求管理工具链（见下文）
2. **架构专家**：输出 C4 架构视图（上下文/容器/组件）、数据/接口/运维/安全视图与技术选型；同步 ADR。
   - 自动评估是否需要拆分架构（> 1000 行 或 8+ 子系统 或 3+ 业务域），采用主从结构（主 ARCH + 模块 ARCH）。
3. **任务规划专家**：拆解 WBS、依赖矩阵、关键路径（CPM）、里程碑与风险，沉淀到 `/docs/TASK.md`。
   - 自动评估是否需要拆分任务（> 1000 行 或 50+ 工作包 或 3+ 并行开发流），采用主从结构（主 TASK + 模块 TASK）。
4. **TDD 专家**：以严格红→绿→重构流程开发，实现后执行 CI、文档回写并移交 QA；版本、CHANGELOG、tag 由 `release.*` 配置控制。
5. **QA 专家**：基于 `/docs/QA.md` 制定测试策略（功能/集成/性能/安全）、执行验证并输出发布建议。
   - 自动评估是否需要拆分测试计划（> 1000 行 或 100+ 测试用例 或 3+ 功能域），采用主从结构（主 QA + 模块 QA + 追溯矩阵）。
6. **DevOps 专家**：统一管理 CI/CD 流水线、环境管理（dev/staging/production）、部署运维与部署后验证，确保从构建到上线全链路自动化。

---

## PRD 工具链状态
模板默认只合并已实现、可运行的 PRD alias，避免目标项目得到坏命令：

```bash
pnpm run prd:lint
pnpm run prd:check-dependency-cycles
pnpm run nfr:check-compliance
```

CR、优先级矩阵、角色覆盖、目标追溯、前置验证报告等属于可选治理主题。模板保留文档模板和方法，但不默认声明 `cr:*`、`priority:*`、`persona:*`、`goal:*`、`prd:preflight-report` 等 aliases；目标项目实现对应脚本后，再通过项目自己的 `package.json` 或 `agent.config.json` 增加入口。

---

### 预期收益（基于中型项目 50+ Story）

| 指标 | 改进幅度 |
|------|---------|
| 变更管理效率 | **+40%** |
| 需求返工率 | **-30%** |
| 优先级决策时间 | **-50%** |
| QA 验证效率 | **+25%** |
| PRD 评审一次通过率 | **50% → 80%** |

---

## 上下文最小化策略
- 任一时刻只激活 1 位专家；未激活角色的长卡片和 Handbooks 不进入上下文。
- 专家需要额外细节时，引用 Handbooks 中的相关章节，而非整体加载。
- 产物文件是阶段输入与交接的唯一来源，避免多源信息漂移。

## 自定义与扩展建议
- 若团队流程不同，可修改 `AGENTS.md` 的状态机或快捷命令；保持阶段产物路径一致即可。
- 可在 `AgentRoles/Handbooks` 中增补团队自定义章节，确保引用粒度尽量小。
- 数据库迁移模板按目标技术栈放入项目自有目录，并在 `agent.config.json paths.migrationsDir` 中声明。
- `/ci`、`/ship`、`/cd`、`/env`、`/restart` 统一通过 `infra/scripts/devops-tools/devops-run.js` 调度，实际命令写入 `agent.config.json`。
- 若引入新增阶段或角色，记得同步更新 `AGENTS.md`、`docs/AGENT_STATE.md` 与相关 Playbook，以保持路由与产物一致。

---

## 拷贝指引：将模板应用到自己的项目
**推荐整体复制**
- `AGENTS.md`
- `AgentRoles/`
- `docs/CONVENTIONS.md`、`docs/data/templates/`、各模块 `MODULE-TEMPLATE.md`
- `infra/scripts/shared/`、`worktree-tools/`、`agent-runner/`、`devops-tools/`、`setup/`、PRD/ARCH/TASK/TDD/QA 工具脚本
- `agent.config.example.json`
- `agent.package.scripts.example.json`
- `agent.template.manifest.json`
- `.gemini/`、`CLAUDE.md`（如需要 Gemini / Claude Code 入口）

**按项目情况合并**
- `package.json`：不要复制覆盖；通过 `node infra/scripts/setup/merge-package-scripts.js --write` 从 `agent.package.scripts.example.json` 只追加缺失 scripts，冲突项人工决定
- `.gitignore`
- `.envrc`
- `.github/workflows/`
- `README.md`、`CHANGELOG.md`
- 项目自有迁移目录模板
- `agent.config.json`（复杂项目可由 example 复制后维护）
- 部署/cron 项目自有脚本：模板不提供 `infra/scripts/server/`、`infra/scripts/cron/` 实现；实际项目通过 `agent.config.json devops.*` / `cron.*` 接入自己的命令

**不要复制**
- 模板根 `package.json`（目标项目保留自己的文件）
- `.env.local`、`.env.*` 非 example 文件
- `.codex/auth.json`、`.codex/sessions/`
- `.claude/settings.local.json`
- `.gemini/settings.local.json`
- `node_modules/`
- 容器层 `../worktrees/`、`../tmp/`、`../cache/`、`../artifacts/`

> 拷贝完成后，优先通过 `agent.config.json` 调整目标项目差异；不要把业务项目细节写回模板文件，这样后续可以整体覆盖升级模板。

---

将本模板纳入项目后，你可以按阶段逐步加载专家角色，在多模型编码环境中获得一致、可维护的产物和工作流。祝使用顺利！
