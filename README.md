# Agents Router 模板（v1.8 · 2025-11-05）

这是一套服务于 Codex CLI、Claude Code CLI、Gemini CLI 等多模型编码场景的提示词工程模板。核心目标是以极小的上下文体积，驱动多位领域专家按阶段协作，让大模型在明确的工序中持续交付一致、可追溯的结果。

**v1.8 新增**：支持大型项目**全流程模块化**（PRD / ARCH / TASK / QA），按功能域拆分详细需求、架构、任务与测试计划，避免单文件过大撑爆上下文。

## 模板目标与价值
- 统一语言：三款 CLI 共用一套上下文协议与激活语法，降低切换成本。
- 最小上下文：只在激活阶段加载对应专家卡片，避免把 Handbooks 或全部角色一次性塞入对话。
- **全流程模块化**（v1.8）：大型项目可按功能域拆分 PRD / ARCH / TASK / QA 文档，主文档 < 500 行，子模块按需加载，避免上下文撑爆。支持统一的功能域对齐与 ID 命名规范。
- 产物驱动：PRD → 架构 → 任务 → TDD → QA 的串行交接，以 `/docs` 下的产物文件作为唯一真相来源。
- 随取随用：激活专家后快速点读 `AgentRoles/Handbooks/*.playbook.md` 指定章节，获取模板、Checklist 与回写规范。

## 目录速览
- `AGENTS.md`：轻量级路由说明，定义阶段流程、激活语法、质量门禁与上下文规范。
- `AgentRoles/*.md`：五位专家的运行时短卡片（PRD / ARCH / TASK / TDD / QA）。
- `AgentRoles/Handbooks/*.playbook.md`：详尽操作手册；`AgentRoles/Handbooks/README.md` 概览各手册作用。
- `docs/`：阶段产物与运行状态，含 `PRD.md`、`ARCHITECTURE.md`、`TASK.md`、`QA.md`、`AGENT_STATE.md`、`CHANGELOG.md`、`CONVENTIONS.md`（目录与命名规范）及数据资料。
  - **`docs/prd-modules/`**（v1.8）：大型项目 PRD 模块化目录，按功能域拆分的详细 PRD，含 `README.md` 模块索引。
  - **`docs/arch-modules/`**（v1.8）：大型项目架构模块化目录，按功能域拆分的架构设计，含 `README.md` 模块索引。
  - **`docs/task-modules/`**（v1.8）：大型项目任务模块化目录，按功能域拆分的任务计划，含 `README.md` 模块索引。
  - **`docs/qa-modules/`**（v1.8）：大型项目 QA 模块化目录，按功能域拆分的测试计划，含 `README.md` 模块索引。
  - **`docs/data/traceability-matrix.md`**（v1.8）：需求追溯矩阵，集中维护 Story → AC → Test Case ID 映射。
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
   - **v1.8 增强**：自动评估是否需要拆分 PRD（> 1000 行 或 50+ 用户故事 或 3+ 业务域），采用主从结构（主 PRD + 模块 PRD + 追溯矩阵）。
   - **v1.8+ 新增**：企业级需求管理工具链（见下文）
2. **架构专家**：输出 C4 架构视图（上下文/容器/组件）、数据/接口/运维/安全视图与技术选型；同步 ADR。
   - **v1.8 增强**：自动评估是否需要拆分架构（> 1000 行 或 8+ 子系统 或 3+ 业务域），采用主从结构（主 ARCH + 模块 ARCH）。
3. **任务规划专家**：拆解 WBS、依赖矩阵、关键路径（CPM）、里程碑与风险，沉淀到 `/docs/TASK.md`。
   - **v1.8 增强**：自动评估是否需要拆分任务（> 1000 行 或 50+ 工作包 或 3+ 并行开发流），采用主从结构（主 TASK + 模块 TASK）。
4. **TDD 专家**：以严格红→绿→重构流程开发，实现后执行 CI、文档回写、更新 `CHANGELOG.md` 并移交 QA。
5. **QA 专家**：基于 `/docs/QA.md` 制定测试策略（功能/集成/性能/安全）、执行验证并输出发布建议。
   - **v1.8 增强**：自动评估是否需要拆分测试计划（> 1000 行 或 100+ 测试用例 或 3+ 功能域），采用主从结构（主 QA + 模块 QA + 追溯矩阵）。

---

## 🎯 v1.8+ 企业级需求管理增强（PRD 专家）

> **新增于 2025-11-05**：面向大型项目（50+ 用户故事）的专业需求管理工具链。

### 核心增强功能

#### 1. 变更请求（CR）管理 📋
**位置**：`/docs/data/change-requests/`

结构化管理需求变更，支持：
- **影响范围分析**：自动识别变更影响的 Story、AC、模块、测试用例
- **多专家协同审批**：PRD / ARCH / TASK / QA 专家联合评审
- **状态追踪**：Draft → Under Review → Approved → Implemented → Closed

**快速开始**：
```bash
# 创建新变更请求
npm run cr:new -- --type="需求修改" --priority="High"

# 查看待审批 CR
npm run cr:pending
```

---

#### 2. 依赖关系图可视化 🔗
**位置**：`/docs/data/dependency-graph.md`

使用 Mermaid 可视化需求依赖网络，支持：
- **关键路径识别**：自动计算最长依赖链
- **循环依赖检测**：发现并修正 A → B → C → A 循环
- **并行开发规划**：识别可并行实施的 Story

**快速开始**：
```bash
# 检测依赖循环
npm run prd:check-dependency-cycles

# 在线预览依赖图
# 访问 https://mermaid.live/ 粘贴 dependency-graph.md 内容
```

---

#### 3. 优先级动态评分矩阵 ⭐
**位置**：`/docs/data/priority-matrix.md`

量化需求优先级，支持：
- **多维度评分**：业务价值 × 2 + 用户影响面 × 1.5 + (6-技术风险) + 依赖权重 × 0.5
- **优先级冲突检测**：自动识别"建议优先级"与"当前优先级"不一致的 Story
- **ROI 分析**：预期贡献 / 预估工时

**快速开始**：
```bash
# 检测优先级冲突
npm run priority:check-conflicts

# 生成优先级报告
npm run priority:report
```

---

#### 4. 业务目标追溯表 🎯
**位置**：`/docs/data/goal-story-mapping.md`

确保需求与业务目标强绑定，支持：
- **Story → OKR 映射**：每个 Story 关联至少 1 个 Objective / Key Result
- **目标覆盖验证**：预期贡献之和是否覆盖目标差值
- **孤儿 Story 检测**：识别无关联业务目标的需求

**快速开始**：
```bash
# 检查孤儿 Story
npm run goal:check-orphans

# 生成目标覆盖报告
npm run goal:coverage-report
```

---

#### 5. 用户角色-故事覆盖矩阵 👥
**位置**：`/docs/data/persona-story-matrix.md`

验证每个用户角色的功能完整性，支持：
- **覆盖率统计**：每个角色的 Story 覆盖率
- **孤儿角色检测**：覆盖率 < 30% 的角色
- **权限冲突检测**：Guest 拥有需登录功能等

**快速开始**：
```bash
# 生成角色覆盖报告
npm run persona:coverage-report

# 检测孤儿角色
npm run persona:check-orphans
```

---

#### 6. NFR 量化追踪表 📊
**位置**：`/docs/data/nfr-tracking.md`

将抽象的非功能需求具体化，支持：
- **8 大类 NFR**：性能、可扩展性、安全、可用性、易用性、兼容性、可维护性、合规
- **达标状态追踪**：基准值 vs 目标值 vs 当前值
- **发布 Gate 验证**：阻塞性 NFR 未达标则阻止发布

**快速开始**：
```bash
# 检查 NFR 达标情况
npm run nfr:check-compliance
```

---

#### 7. Shift-Left 需求验证 ✅
**位置**：`/AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md` §7

在 PRD 阶段前置验证，支持：
- **技术可行性**：新技术栈 PoC、数据量级评估、第三方依赖稳定性
- **数据合规性**：GDPR/PIPL 符合性、敏感数据识别、数据保留策略
- **依赖风险**：循环依赖、跨团队依赖协调
- **文档完整性**：章节、追溯矩阵、依赖图

**快速开始**：
```bash
# 运行前置验证报告
npm run prd:preflight-report

# PRD 完整性检查
npm run prd:lint
```

---

### 快速实施路线图

#### 📋 立即可用（Day 1，推荐优先级 ⭐⭐⭐）
1. **引入依赖关系图** — 可视化需求网络（2-3 小时）
2. **建立 NFR 追踪表** — 性能安全可量化（3-4 小时）
3. **使用角色-故事矩阵** — 覆盖率验证（2 小时）

#### 📈 短期投入（Week 1-2）
1. **引入 CR 流程** — 结构化变更管理（1 周）
2. **建立优先级矩阵** — 量化决策（1 周）
3. **执行 Shift-Left 检查清单** — 前置验证（1-2 周）

#### 🔧 持续优化（长期）
1. **自动化脚本开发** — 减少手工劳动（2-4 周）
2. **CI/CD 集成** — 发布 Gate 自动化（1 周）
3. **工具集成** — Jira / Notion / Confluence（按需）

**详细指南**：参见 `/AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md` §7（Shift-Left 检查与质量门禁）。

---

### 自动化工具链

#### 安装
```bash
# 本工具使用 Node.js，无额外依赖
npm install
```

#### 核心命令
```bash
# PRD 质量检查
npm run prd:lint                          # PRD 完整性检查
npm run prd:check-dependency-cycles       # 依赖循环检查
npm run prd:preflight-report              # 前置验证报告

# NFR 管理
npm run nfr:check-compliance              # NFR 达标检查（发布 Gate）

# 优先级管理
npm run priority:check-conflicts          # 优先级冲突检测
npm run priority:report                   # 生成优先级报告

# 角色覆盖分析
npm run persona:coverage-report           # 角色覆盖率报告
npm run persona:check-orphans             # 孤儿角色检测

# 业务目标追溯
npm run goal:coverage-report              # 目标覆盖率报告
npm run goal:check-orphans                # 孤儿 Story 检测

# 变更请求管理
npm run cr:new                            # 创建新变更请求
npm run cr:pending                        # 查看待审批 CR
```

**完整文档**：[scripts/prd-tools/README.md](scripts/prd-tools/README.md)

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
- `db/migrations/` 模板适合快速搭建 Expand → Migrate/Backfill → Contract 流程，可按技术栈调整脚本。
- 结合仓库 CI，可在 `/ci run`、`/ci status`、`/ship`、`/cd` 等命令上扩展自动化脚本与部署策略。
- 若引入新增阶段或角色，记得同步更新 `AGENTS.md`、`docs/AGENT_STATE.md` 与相关 Playbook，以保持路由与产物一致。

---

## 拷贝指引：将模板应用到自己的项目
**建议拷贝**
- `AGENTS.md`
- `AgentRoles/`（含全部专家卡片与 `Handbooks/` 手册）
- `docs/`（含 `ARCHITECTURE.md`、`TASK.md`、`QA.md`、`AGENT_STATE.md`、`CHANGELOG.md`、`CONVENTIONS.md`、`data/` 及 `adr/` 目录）
  - **注意**：原仓库的 `PRD.md` 为模板示例，建议删除后由 PRD 专家按需生成（模板已内置于 `AgentRoles/PRD-WRITER-EXPERT.md` §PRD 模板）
  - **v1.8 新增模块化目录**（可选，按需创建）：`prd-modules/`、`arch-modules/`、`task-modules/`、`qa-modules/`，含各自的 `README.md` 模块索引
- `db/`（含 `migrations/` 模板）
- `.gemini/`（将 Gemini CLI 上下文指向 `AGENTS.md`）
- `CLAUDE.md`（若需要支持 Claude Code CLI）

**通常不拷贝**
- 本仓库的 `README.md`、`CHANGELOG.md` —— 请在自己的项目中编写专属说明与历史记录。
- `.DS_Store`、临时文件以及与你项目无关的脚本或配置。
- 任何你不打算启用的示例数据或手册章节，可按需删减。

> 拷贝完成后，请根据目标项目情况更新 `docs/CONVENTIONS.md`、`docs/AGENT_STATE.md`、以及 Playbook 中的特定规范，以保持团队约定一致。

---

将本模板纳入项目后，你可以按阶段逐步加载专家角色，在多模型编码环境中获得一致、可维护的产物和工作流。祝使用顺利！
