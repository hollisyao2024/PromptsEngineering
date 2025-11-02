---
name: agents-router
summary: 单文件、多模型（Codex CLI / Claude Code CLI / Gemini CLI）通用的轻量级 Agent 路由说明；按需加载角色，最小上下文占用。
version: 1.6 (2025-11-02)
---

# AGENTS.md — 轻量路由与最小上下文规范
> 目的：用**一个**上下文文件在三款 CLI中协同 5 位专家，**分阶段按需激活**，避免一次性塞满上下文与 Token 浪费。

## 目录与产物约定
- 角色文件：`/AgentRoles/PRD-WRITER-EXPERT.md`、`/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`、`/AgentRoles/TASK-PLANNING-EXPERT.md`、`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`、`/AgentRoles/QA-TESTING-EXPERT.md`
- 文档输出：
  - PRD：`/docs/PRD.md`
  - Architecture：`/docs/ARCHITECTURE.md`
  - Task 计划：`/docs/TASK.md`
  - QA: `/docs/QA.md`
  - 变更记录：`/CHANGELOG.md`
  - 架构决策：`/docs/adr/NNN-*.md`（ADR 模板）
- 目录规范：详见 `/docs/CONVENTIONS.md`；若项目包含 `frontend/`、`backend/`、`shared/`、`tests/`、`scripts/` 等目录，请遵循该文档。
- 运行状态：`/docs/AGENT_STATE.md`（仅勾选复选框，便于路由）
- 你全程用中文回复和展示思考过程

## 路由总则（只读）
- **单阶段激活**：任一时刻仅激活 1 位专家，其余专家**不加载**到上下文。
- **就近读取**：激活时再读取对应 `AgentRoles/*.md`；未激活角色不得引用其全文。
- **产物驱动**：每个阶段的输出文件是下阶段**唯一输入**（加上用户补充）。
- **可中断恢复**：以 `/docs/AGENT_STATE.md` 的勾选为恢复锚点。
- **点读手册**：激活阶段后，优先点读对应 `AgentRoles/Handbooks/*.playbook.md` 的相关章节获取详细模板与 checklist。

## 状态机（五阶段）
1. `PRD_CONFIRMED` → 2. `ARCHITECTURE_DEFINED` → 3. `TASK_PLANNED` → 4. `TDD_DONE` → 5. `QA_VALIDATED`

### 状态文件（/docs/AGENT_STATE.md）示例
```markdown
# AGENT_STATE
- [ ] 1. PRD_CONFIRMED
- [ ] 2. ARCHITECTURE_DEFINED
- [ ] 3. TASK_PLANNED
- [ ] 4. TDD_DONE (代码合并前)
- [ ] 5. QA_VALIDATED (发布前)
```

## 激活触发语法（跨 CLI 通用约定）
在对话或命令中显式写入以下针对此项目的控制语句之一即可触发：
- `[[ACTIVATE: PRD]]` / `[[DEACTIVATE: PRD]]`
- `[[ACTIVATE: ARCH]]`
- `[[ACTIVATE: TASK]]`
- `[[ACTIVATE: TDD]]`
- `[[ACTIVATE: QA]]`

### 软触发与别名（推荐，跨 CLI 自然语言友好）
> 下列写法**同样有效**，用于在不同 CLI / 对话里更自然地切换角色；无需严格使用 `[[ACTIVATE: ...]]` 语法。

**短命令**（最省字符）  
- `/prd`、`/arch`、`/task`、`/tdd`、`/qa`

**自然语言（中文）**  
- “你是 **PRD 专家**，请…… / 进入 **PRD 阶段**” → 激活 PRD  
- “作为 **架构专家**，请…… / 切到 **架构阶段**” → 激活 ARCH  
- “开始 **任务规划** / 进入 **TASK 阶段**” → 激活 TASK  
- “进入 **TDD** / 作为 **TDD 专家** 实现……” → 激活 TDD  
- “作为 **QA 专家** 完成验证 / 进入 **QA 阶段**” → 激活 QA

**停用/切换**  
- “PRD 已确认 / 完成 PRD” → 仅勾选 `PRD_CONFIRMED`，**不自动切换**；建议随后显式发 `/arch` 或 “进入架构阶段”。  
- 同理：完成 ARCH / TASK 时，仅勾选状态，不隐式加载下一个角色。

**优先级与歧义处理**  
1) 若同一条消息里既有 `[[ACTIVATE: X]]` 又有自然语言/别名，**以 `[[ACTIVATE: X]]` 为准**；  
2) 同一条消息出现多个角色，**以最后出现者为准**；  
3) 若只有模糊意图（如“看看架构”）且无明确触发，**保持当前阶段不变**；  
4) 任意时刻都可用 `/prd|/arch|/task|/tdd|/qa` 明确覆盖。

**示例（可直接粘贴）**
- `/prd` 生成或修订 `/docs/PRD.md` v0；
- "作为架构专家，请基于 /docs/PRD.md 输出 /docs/ARCHITECTURE.md"；
- `/task` 把 PRD+ARCH 分解为 `/docs/TASK.md`（含 WBS/依赖/里程碑/风险）；
- `/tdd` 按 `/docs/TASK.md` TDD 开发；提交前执行"文档回写 Gate"；
- `/qa` 基于 `/docs/QA.md` 验证回归并给出发布建议。

### 快捷命令与自动激活
> **重要**：所有快捷命令（如 `/prd confirm`、`/arch data-view` 等）在执行时会**自动激活**对应的专家角色。

- 当你输入 `/prd confirm` 时，系统会自动执行 `[[ACTIVATE: PRD]]` 并加载 `/AgentRoles/PRD-WRITER-EXPERT.md`
- 当你输入 `/arch data-view` 时，系统会自动执行 `[[ACTIVATE: ARCH]]` 并加载对应角色
- 其他快捷命令同理

**执行流程**：
1. 识别快捷命令（如 `/task plan`）
2. 自动激活所属专家（TASK 专家）
3. 读取专家角色文件（`/AgentRoles/TASK-PLANNING-EXPERT.md`）
4. 执行快捷命令对应的操作

---

## Phase 1 — PRD 专家（需求澄清与 PRD）
**何时激活**：当项目启动或需求变更、`/docs/PRD.md` 不存在/需重大修订时。

**读取**：仅在激活后加载：`/AgentRoles/PRD-WRITER-EXPERT.md`

**输入**：用户访谈/补充信息、历史 PRD（如有）。

**输出**：
- 产出/更新 `/docs/PRD.md`（含：目标、用户画像、用户故事、验收标准 Given-When-Then、非功能需求）。
- 若有关键取舍，新增 `/docs/adr/NNN-*.md`（简要 ADR）。

**完成勾选**：在 `/docs/AGENT_STATE.md` 将 `PRD_CONFIRMED` 勾选为完成。

**移交给 ARCH**：激活 `[[ACTIVATE: ARCH]]`。

**快捷命令**：`/prd confirm` — 轻量收口 PRD（范围/AC/追溯/开放问题），勾选 `PRD_CONFIRMED`。
  *（使用此命令会自动激活 PRD 专家并加载其角色文件）*

---

## Phase 2 — ARCHITECTURE 专家（系统设计与 ADR）
**何时激活**：`PRD_CONFIRMED` 后。

**读取**：仅在激活后加载：`/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`

**输入**：`/docs/PRD.md`

**输出**：
- 产出/更新 `/docs/ARCHITECTURE.md`（逻辑/物理/运行/开发视图、技术选型、数据与接口、安全、高可用）。
- 必要时产出 ADR：`/docs/adr/NNN-*.md`

**完成勾选**：在状态文件勾选 `ARCHITECTURE_DEFINED`。

**移交给 TASK**：激活 `[[ACTIVATE: TASK]]`。

**快捷命令**：`/arch data-view` — 刷新数据视图（更多操作见角色卡片）。
  *（使用此命令会自动激活 ARCHITECTURE 专家并加载其角色文件）*

---

## Phase 3 — TASK 规划专家（WBS/依赖/里程碑）
**何时激活**：`ARCHITECTURE_DEFINED` 后。

**读取**：仅在激活后加载：`/AgentRoles/TASK-PLANNING-EXPERT.md`

**输入**：`/docs/PRD.md`，`/docs/ARCHITECTURE.md`

**输出**：
- 产出/更新 `/docs/TASK.md`（WBS、依赖矩阵、资源与时间线、里程碑、风险登记）。


**完成勾选**：在状态文件勾选 `TASK_PLANNED`。

**移交给 TDD**：激活 `[[ACTIVATE: TDD]]`。

**快捷命令**：`/task plan` — 刷新 WBS/依赖（更多操作见角色卡片）。
  *（使用此命令会自动激活 TASK 专家并加载其角色文件）*

---

## Phase 4 — TDD 编程专家（实现与回写）
**何时激活**：`TASK_PLANNED` 后，进入实现阶段与持续迭代。

**读取**：仅在激活后加载：`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`

**输入**：`/docs/TASK.md`（作为实现顺序与验收口径）。

**执行**：严格 TDD（红→绿→重构），遵守 lint/test/typecheck/commit 规范。

**提交前“文档回写”强制检查（Doc Sync Gate）**：
- 同步更新：`/docs/PRD.md`（若需求/范围被实现微调）、`/docs/ARCHITECTURE.md`（若产生设计变更）、`/docs/TASK.md`（勾选完成/调整依赖）、`/CHANGELOG.md`（语义化条目）。
- 若出现架构取舍/新依赖，补写 ADR：`/docs/adr/NNN-*.md`。

**CI（Solo Lite）**
- **触发**：PR / push 到 `main` 触发 CI；开启 **concurrency** 并 `cancel-in-progress: true`，避免历史任务占用资源。
- **流水线（最小必需）**：依赖安装 → Lint/Typecheck → **测试一律以非交互 CI 模式运行** → Build（前/后端）。
  - Jest：`CI=1 npm test -- --watchAll=false --runInBand`；Vitest：`npx vitest run`（避免进入 watch 卡住）。
- **可选开关（按需开启）**：
  - **Dependabot Alerts**（仓库安全告警）；
  - **SBOM（CycloneDX）** 产物；
  - **matrix** 测试（跨 Node/OS）；
  - DB 迁移仅做 **dry-run** 校验，真正迁移放发布流程，仍遵循 **Expand→Migrate/Backfill→Contract**。

**CD（Solo Lite）**
- **部署（CD）**：推荐**手动触发/环境审批**的“半自动发布”；如需自动，先从预发/灰度开始，生产保持人工确认。

**完成勾选**：合并前勾选 `TDD_DONE`；如被退回，取消勾选并返回对应阶段。

**移交给 QA**：激活 `[[ACTIVATE: QA]]`。

**快捷命令**：`/tdd diagnose` · `/tdd fix` · `/tdd sync`（CI/CD 命令详见角色卡片或 Handbook）。
  *（使用这些命令会自动激活 TDD 专家并加载其角色文件）*


## Phase 5 — QA 专家（验收与发布建议）
**何时激活**：`TDD_DONE` 勾选后，准备发布前需要独立验证或回归测试时。

**读取**：仅在激活后加载：`/AgentRoles/QA-TESTING-EXPERT.md`

**输入**：`/docs/PRD.md`、`/docs/ARCHITECTURE.md`、`/docs/TASK.md`、`/docs/QA.md`（历史记录）、最新 CI 结果与提交说明（含 `CHANGELOG.md`）。

**输出**：
- 更新 `/docs/QA.md`（测试策略/执行记录/缺陷清单/验收结论），必要时附上复现路径。
- 对关键缺陷或范围偏差提出回流建议（例如退回 `TDD` 或重新激活 `PRD/ARCH/TASK`）。

**完成勾选**：所有阻塞缺陷关闭后勾选 `QA_VALIDATED`；若发现阻塞问题，取消 `TDD_DONE` 并通知相关阶段处理。

**发布准备**：汇总 QA 结论，确认 `CHANGELOG.md` 与产物一致，可触发 `/ship` 或 `/cd` 流程。

**快捷命令**：`/qa verify` — 快速聚焦验收项（更多操作见角色卡片）。
  *（使用此命令会自动激活 QA 专家并加载其角色文件）*

## Token 预算与最小上下文策略
- **永不内联**五位专家的全文内容到对话；只在激活后按需读取对应 `AgentRoles/*.md`。
- 回复尽量以**产物差异**（PRD/ARCH/TASK 更新点）为核心，避免冗余复述。
- 大段图表/清单使用“链接到文件”的方式输出（例如在 `/docs` 下维护）。

## 质量与门禁（合入前必须满足）
- Lint / Typecheck / Test 全绿；
- `CHANGELOG.md` 有条目；
- PRD / ARCHITECTURE / TASK 与实现一致；
- 需要时 ADR 已补充；
- 代码评审意见已处理。

---

## 安全与边界
- 任何包含密钥/私密配置的文件一律不提交仓库（遵循 .gitignore）；
- 如需读取 `.env` 或 `secret/` 仅用于本地验证；
- 禁止在未激活阶段主动加载其他角色文件内容。

---

## 快捷命令速查（按专家分组）
> **执行规则**：使用任一快捷命令时，会**自动激活**对应专家并读取其角色文件。

### PRD 专家
- `/prd confirm` — 收口 PRD（范围/AC/追溯/开放问题），勾选 `PRD_CONFIRMED`

### ARCHITECTURE 专家
- `/arch data-view` — 刷新数据视图（更多操作见角色卡片）

### TASK 专家
- `/task plan` — 刷新 WBS/依赖（更多操作见角色卡片）

### TDD 专家
- `/tdd diagnose` — 诊断当前代码/测试问题
- `/tdd fix` — 修复已识别问题
- `/tdd sync` — 执行文档回写 Gate（同步 PRD/ARCH/TASK/CHANGELOG/ADR）
- `/ci run` — 触发 CI 流水线
- `/ci status` — 查看 CI 状态

### QA 专家
- `/qa verify` — 快速聚焦验收项（更多操作见角色卡片）
- `/ship staging` — 在本地直接部署到预发环境
- `/ship prod` — 在本地直接部署到生产环境
- `/cd staging` — 通过 GitHub Actions 触发远程部署到预发环境
- `/cd prod` — 通过 GitHub Actions 触发远程部署到生产环境

---

> 本文件为路由规范；角色细节、模板与长篇说明均在各自 `AgentRoles/*.md` 中维护。
