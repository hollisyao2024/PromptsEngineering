# Agents Router 模板（v1.3 · 2025-10-13）

这是一套服务于 Codex CLI、Claude Code CLI、Gemini CLI 等多模型编码场景的提示词工程模板。核心目标是以极小的上下文体积，驱动多位领域专家按阶段协作，让大模型在明确的工序中持续交付一致、可追溯的结果。

## 模板目标与价值
- 统一语言：三款 CLI 共用一套上下文协议与激活语法，降低切换成本。
- 最小上下文：只在激活阶段加载对应专家卡片，避免把 Handbooks 或全部角色一次性塞入对话。
- 产物驱动：PRD → 架构 → 任务 → TDD → QA 的串行交接，以 `/docs` 下的产物文件作为唯一真相来源。
- 随取随用：激活专家后快速点读 `AgentRoles/Handbooks/*.playbook.md` 指定章节，获取模板、Checklist 与回写规范。

## 目录速览
- `AGENTS.md`：轻量级路由说明，定义阶段流程、激活语法、质量门禁与上下文规范。
- `AgentRoles/*.md`：五位专家的运行时短卡片（PRD / ARCH / TASK / TDD / QA）。
- `AgentRoles/Handbooks/*.playbook.md`：详尽操作手册；`AgentRoles/Handbooks/README.md` 概览各手册作用。
- `docs/`：阶段产物与运行状态，含 `PRD.md`、`ARCHITECTURE.md`、`TASK.md`、`QA.md`、`AGENT_STATE.md`、`CHANGELOG.md`、`CONVENTIONS.md`（目录与命名规范）及数据资料。
- `docs/adr/`：架构决策记录（ADR）模板目录。
- `db/migrations/`：数据库迁移骨架，默认附带 Python / SQL 双模板。
- `.gemini/`：定义 Gemini CLI 的上下文配置，指向 `AGENTS.md` 而非默认 `GEMINI.md`。
- `CLAUDE.md`：Claude Code CLI 的入口提示，确保其读取 `AGENTS.md`。

## 快速开始
1. 将整个模板放置在目标项目根目录，确保路径与文档约定保持一致。
2. 在 Codex CLI、Claude Code CLI 或 Gemini CLI 中加载 `AGENTS.md` 作为初始上下文。
3. 根据项目阶段，使用 `/prd`、`/arch`、`/task`、`/tdd`、`/qa`（或对应自然语言）激活专家；激活后按提示点读对应 Playbook 章节。
4. 专家产出或更新 `/docs` 下的文件后，在 `docs/AGENT_STATE.md` 中勾选阶段成果（五个状态：PRD_CONFIRMED → QA_VALIDATED），再切换下一位专家。
5. 实现阶段完成后，执行“文档回写 Gate”：同步 PRD/ARCHITECTURE/TASK/QA/CHANGELOG/ADR 等文件并回传给 QA。

## 阶段化工作流
1. **PRD 专家**：明确产品目标、用户故事、验收标准；必要时补写 ADR。
2. **架构专家**：输出逻辑/数据/运行视图与技术选型；同步 ADR。
3. **任务规划专家**：拆解 WBS、依赖、里程碑与风险，沉淀到 `/docs/TASK.md`。
4. **TDD 专家**：以严格红→绿→重构流程开发，实现后执行 CI、文档回写、更新 `CHANGELOG.md` 并移交 QA。
5. **QA 专家**：基于 `/docs/QA.md` 制定测试策略、执行验证并输出发布建议。

## 上下文最小化策略
- 任一时刻只激活 1 位专家；未激活角色的长卡片和 Handbooks 不进入上下文。
- 专家需要额外细节时，引用 Handbooks 中的相关章节，而非整体加载。
- 产物文件是阶段输入与交接的唯一来源，避免多源信息漂移。

## 自定义与扩展建议
- 若团队流程不同，可修改 `AGENTS.md` 的状态机或快捷命令；保持阶段产物路径一致即可。
- 可在 `AgentRoles/Handbooks` 中增补团队自定义章节，确保引用粒度尽量小。
- `db/migrations/` 模板适合快速搭建 Expand → Migrate/Backfill → Contract 流程，可按技术栈调整脚本。
- 结合仓库 CI，可在 `/ci run`、`/ci status`、`/ship`、`/cd` 等命令上扩展自动化脚本与部署策略。
- 若引入新增阶段或角色，记得同步更新 `AGENTS.md`、`docs/AGENT_STATE.md` 与相关 Playbook，以保持路由与产物一致。

---

## 拷贝指引：将模板应用到自己的项目
**建议拷贝**
- `AGENTS.md`
- `AgentRoles/`（含全部专家卡片与 `Handbooks/` 手册）
- `docs/`（含 `PRD.md`、`ARCHITECTURE.md`、`TASK.md`、`QA.md`、`AGENT_STATE.md`、`CHANGELOG.md`、`CONVENTIONS.md`、`data/` 及 `adr/` 目录）
- `db/`（含 `migrations/` 模板）
- `CLAUDE.md`（若需要支持 Claude Code CLI）

**通常不拷贝**
- 本仓库的 `README.md`、`CHANGELOG.md` —— 请在自己的项目中编写专属说明与历史记录。
- `.DS_Store`、临时文件以及与你项目无关的脚本或配置。
- 任何你不打算启用的示例数据或手册章节，可按需删减。

> 拷贝完成后，请根据目标项目情况更新 `docs/CONVENTIONS.md`、`docs/AGENT_STATE.md`、以及 Playbook 中的特定规范，以保持团队约定一致。

---

将本模板纳入项目后，你可以按阶段逐步加载专家角色，在多模型编码环境中获得一致、可维护的产物和工作流。祝使用顺利！
