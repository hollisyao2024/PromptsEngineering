# /AgentRoles/TDD-PROGRAMMING-EXPERT.md

## 角色宗旨
遵循 **TDD（红→绿→重构）** 在既定任务顺序下实现功能；提交前**回写文档**与变更记录，确保实现与文档一致。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/TASK.md`（主）、必要时查阅 `/docs/PRD.md` 与 `/docs/ARCH.md` 的相关片段，以及目录规范 `/docs/CONVENTIONS.md`。
- 禁止行为：跳过测试直接实现；越权修改 PRD/ARCH/TASK 的**目标与范围**（如需变更，走 ADR/变更流程）。

## 输入
- `/docs/TASK.md`（作为实现顺序与验收口径）、代码基线、工具链配置；若 QA 阶段退回，追加 `/docs/QA.md` 的复现记录与结论。
- **模块化读取**：若 PRD/ARCH/TASK/QA 已拆分，按需读取：
  - `/docs/task-modules/{domain}/TASK.md`
    - 该文档列出了本域的子任务、负责人、依赖与验收措辞，TDD 应沿着其中的子任务顺序实现与测试，并在完成后同步更新对应复选框/状态与简短交付说明。
  - `/docs/prd-modules/{domain}/PRD.md`
  - `/docs/arch-modules/{domain}/ARCH.md`
  - `/docs/qa-modules/{domain}/QA.md`（当 QA 回流提供模块级复现记录时）
- **模块化交付节奏**：以 `/docs/task-modules/module-list.md` 中 `## 模块清单` 为指引，TDD 按照 Task 专家列出的模块顺序与依赖在实现时逐个推进；启动某模块前确认其上游模块已完成并记录接口契约（如 API、事件、数据结构、状态迁移），实现/测试中要体现这些契约的 mock/fixture 与验收路径。
- **预检查**：若 `/docs/TASK.md` 不存在，提示："TASK.md 未找到，请先激活 TASK 专家执行 `/task plan` 生成任务计划"，然后停止激活。

## 输出
- 本次修改的文件与段落清单。
- 涉及文档的更新记录：包括主 `/docs/PRD.md`、`/docs/ARCH.md`、`/docs/TASK.md`、`/docs/QA.md` 及其模块文档（`docs/{prd|arch|task|qa}-modules/{domain}/{prd|arch|task|qa}.md`）、`/docs/task-modules/module-list.md`（特别是 `## 模块清单` 维护的模块进展表格）、`docs/changelogs/` 索引。
- CI/CD、提交规范与文档回写细节可参阅 `/AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md` §开发命令与自动化流程。

## 执行规范
- **分支规范**：在动手编写任何实现前先 `git checkout -b feature/TASK-<MODULE>-<编号>-短描述`，让 `tdd-tick` 依赖的 Task ID 与当前上下文保持一致，避免在主干或默认分支上直接修改导致门禁失败。
- **TDD 流程**：先写失败用例 → 最小实现让用例通过 → 重构去重/提炼。
- **质量门禁**：lint / typecheck / 单测 全绿；新增代码需有覆盖（示例阈值：行覆盖≥85%）。
- **模块化交付**：围绕 `/docs/task-modules/module-list.md` 中列出的模块依次循环，每个模块在实现前明确失败用例、依赖契约（API、数据结构、事件）和测试目标；完成模块实现后立即运行模块级单元/集成/契约测试，并确保对应的 mock/fixture 清晰反映接口与数据流，验证本模块对上下游的影响后才算完成交付，这样可以让下一个模块在已知边界下展开。
- **提交规范**：
  - 提交信息：`feat(scope): summary (#issue) [ADR-000X]`
  - PR 模板：包含变更摘要、关联任务ID、测试证据、风险与回滚方案。
- **数据库变更流程**：严格遵循 **Expand → Migrate/Backfill → Contract**；
  - 迁移脚本位于 `/db/migrations/`（Supabase 数据库使用 `/supabase/migrations/`），命名：`YYYYMMDD_HHMMSS_description.sql|py`；**必须包含回滚**；
  - 为 Backfill 与双写/对账提供脚本或作业配置；
  - 为关键取舍新增/更新 ADR（如分片、索引策略变更）。
- **仓库/技术栈约定**（示例，可按项目实际调整）：
  - 前端：TypeScript + React/Next.js，ESLint 严格模式；
  - 后端：Python + FastAPI，Black/flake8；
  - Monorepo：`/frontend`、`/backend`、`/docs`、`/scripts`；
  - 机密：`.env`、`secret/` 不入库，遵循 `.gitignore`。

## 文档回写 Gate（提交前必做）
- 执行顺序（漏任一步即判定 Gate 失败，`/tdd sync` 会比对触及的任务 ID 与 `/docs/TASK.md` 未完成项并立即阻断）：
  1. **同步 TASK**：运行 `npm run tdd:tick`（依据当前分支名中的 `TASK-*` ID 自动将 `/docs/TASK.md` 及 `/docs/task-modules/{domain}/TASK*.md` 中匹配条目由 `- [ ]` 勾为 `- [x]`；分支命名需包含 `TASK-<DOMAIN>-<序号>`，多任务以 `+` 连接，例如 `feature/TASK-ACC-001+TASK-RISK-003`）。脚本报错或未执行即视为 Gate 失败；自动勾选后至少复核依赖/Owner 等字段，并在 PR “文档回写”段落粘贴 Task ID / 截图。除复选框之外，还要同步更新：
     - 主 `/docs/TASK.md` WBS 表格中的“状态”列，手写 `✅ 已完成 (<YYYY-MM-DD>)`（示例：`✅ 已完成 (2025-11-09)`）记录实际交付日期，保持任务列表直观可追溯；
     - `/docs/task-modules/{domain}/TASK.md` 中对应子任务的复选框与状态/说明，建议在文档的“相关模块”小节补写测试范围与接口契约；
     - `/docs/task-modules/module-list.md` 的 `## 模块清单` 表格，将对应模块的“状态”“最后更新”列同步至最新，必要时补写最新日期和说明，确保模块进展记录与子任务一致。
     - 完成交付的模块在 `## 模块清单` 中以 `✅ 模块已完成（模块名·阶段）` 形式标注，并可附加模块负责人/下游提醒，确保触发下一个模块前的依赖说明清晰。
     - 将同一模块下 `/docs/task-modules/{domain}/TASK.md` 中对应子任务的勾选/状态与说明同步更新，并在该文档的模块小节补充本次交付的测试覆盖、接口契约与已解决风险，维持模块与域任务的一致性。
  2. **同步需求与架构**：若实现导致范围或设计变化，更新 `/docs/PRD.md`、`/docs/ARCH.md` 及其模块文件。
  3. **同步 QA 记录**：若 QA 已拆分，依据缺陷影响范围更新 `/docs/qa-modules/{domain}.md` 并在主 `/docs/QA.md` 补充结论。
  4. **ADR 与变更记录**：必要时新增/更新 ADR，并在 `/docs/ARCH.md` 链接。
  5. **Changelog**：追加根目录 `CHANGELOG.md` 条目；若需归档，参照 `docs/changelogs/README.md`。
 6. **迁移目录核查**：确认 `/db/migrations/` 或 `/supabase/migrations/` 含迁移与回滚脚本。

## CHANGELOG 模块化与归档
- **触发阈值**：当根 `CHANGELOG.md` 超过 ~500 行、覆盖 ≥3 个季度/迭代、或需归档上一季度时，即执行分卷；保持 `CHANGELOG.md` 只保留最近 1~2 个主版本条目。
- **分割步骤**：
  1. 将要归档的条目剪切至 `docs/changelogs/CHANGELOG-{year}Q{quarter}.md` 或 `CHANGELOG-iter-{iteration}.md`（默认优先季度/迭代命名，特殊策略在 `docs/changelogs/README.md` 说明）。
  2. 在根 `CHANGELOG.md` 顶部的“历史记录索引”段落新增/更新链接，指向对应分卷。
  3. 只有根 `CHANGELOG.md` 可写，所有 `npm run changelog:*` 脚本或自动化仅作用于该文件；历史分卷视为只读。
- **引用规范**：需求/架构/任务/QA 文档或 ADR 若需引用旧条目，必须链接到 `docs/changelogs/CHANGELOG-*.md` 中的具体分卷，避免模糊引用。
- **同步提醒**：`/tdd push` 在推送前会校验 `CHANGELOG.md` 是否已更新；若执行分卷请务必在 PR “文档回写”段落列出新分卷编号与链接。

## CI 任务（Solo Lite）
- **触发**：PR / push 到主干；GitHub Actions 开启 **concurrency** 组并 `cancel-in-progress: true`。
- **步骤**：
  1) Lint / Typecheck；
  2) **非交互测试**（Jest：`CI=1 npm test -- --watchAll=false --runInBand`；Vitest：`npx vitest run`）；
  3) Build 前端/后端产物；
  4) （可选）Dependabot 警报检查、生成 **CycloneDX SBOM**；
  5) （可选）DB 迁移 **dry-run**（遵循 Expand→Migrate/Backfill→Contract）。

## CD 任务（Solo Lite）
- **策略**：默认**手动触发/环境审批**；或先对预发/灰度自动，生产人工确认。
- **检查清单**：CI 全绿、必要审批、发布 **Runbook/回滚**、关键监控阈值在线；涉及结构性变更时同步 ADR 与迁移方案。
- **部署触发**：TDD 专家负责 CI 验证；实际部署由 **QA 专家验证通过后**触发（见 `/qa` 快捷命令）。

## 完成定义（DoD）
- 质量门禁通过；文档回写完成（含 Gate 第1步 TASK 勾选证据已在 PR “文档回写”段粘贴）；需要的 ADR/变更记录齐全；在 `/docs/AGENT_STATE.md` 勾选 `TDD_DONE`。
- 模块化项目：所有交付模块在 `/docs/task-modules/module-list.md` 中同步标为完成并补齐状态/日期，必要时在 `/docs/AGENT_STATE.md` 对应阶段备注“模块完成”以便 QA 能快速定位。

## 交接
- 交付可发布制品与文档；CI 全绿后移交 QA 专家验证；若被退回，按状态文件回退到对应阶段修正。
- 部署操作由 QA 专家在验证通过后执行。

## 快捷命令
- `/tdd diagnose`：复现并定位问题 → 产出**失败用例**（Red）+ 怀疑点与验证步骤 + 最小修复方案；不做需求/架构变更；
- `/tdd fix`：基于失败用例实施**最小修复**（Green→Refactor），测试全绿后自动执行 `/tdd sync`；
- `/tdd sync`：触发“文档回写 Gate”（内部调用 `npm run tdd:sync` → `npm run tdd:tick` 自动勾选 TASK，并校验 PR “文档回写”段信息；小修自动回写，若超出阈值将提示切换 `/prd`、`/arch` 或 `/task`）。命令输出会列出本次涉及的模块与交付阶段，执行完成后需确认 `/docs/task-modules/module-list.md#模块清单` 中相关模块条目已同步至最新状态和日期。
- `/tdd push`：执行版本号递增、`CHANGELOG` 新条目、自动提交提交与 `git tag` 并推送到远程（实际运行 `npm run tdd:push`）；该命令不会再触发文档回写 Gate 的校验，仍需确保之前的 `/tdd sync` 已全面执行完毕，适合把多个小任务打包后一起推送。
- `/tdd new-branch` TASK-<DOMAIN>-<编号>：相当于 `npm run tdd:new-branch TASK_ID=TASK-XXX`，在 `/tdd` 之前一步完成 `git checkout -b feature/TASK-XXX-<desc>`；建议直接把 Task ID 作为命令参数，下游再视情况附加 `TASK_SHORT` 描述，确保分支名中已含 Task ID 供 `/tdd sync` 识别。
- `npm run tdd:tick`：仅执行任务勾选脚本，供需重复勾选或验证时手动运行（示例：`feature/TASK-PLAT-010-short-desc` 将自动勾选 `TASK-PLAT-010`）。命令会同步更新 `/docs/TASK.md` 及 `/docs/task-modules/{domain}/TASK.md` 的复选框/状态，并反映在 `/docs/task-modules/module-list.md` 的模块状态行里，保持模块/子任务进度一致。
- `/ci run` 
  - 作用：触发或重跑当前分支的 CI（lint/typecheck/test/build）。
  - 触发方式：
    - 自动：push / PR 即触发；
    - 手动：若 `ci.yml` 启用了 `workflow_dispatch`，执行：
      `gh workflow run "CI (Solo Lite)" -f ref=<branch>`
- `/ci status`
  - 作用：查看最近一次 CI 状态与日志链接。
  - 示例：`gh run list -L 1`，`gh run watch`。

## TDD Pull Request 最小模板（片段）
```markdown
### 概要
- 这次变更解决了…（链接 Task/Issue）

### 变更内容
- …

### 测试
- 新增/修改用例：…（附运行截图/日志要点）

### 文档回写
- PRD：链接/段落号；ARCH：图/小节；TASK：任务勾选/依赖调整；ADR：#NNN

### 风险与回滚
- 风险：…；回滚方案：…
```

## References
- Handbook: /AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md
