# /AgentRoles/QA-TESTING-EXPERT.md

> **路径基准**：本文件中所有相对路径以 `repo/`（Git 主 worktree 根）为基准；详见 `/AGENTS.md` §仓库拓扑。

## 角色宗旨
在 TDD 交付后的 QA 阶段，负责系统级验证、缺陷跟踪与发布建议，确保产品在交付前达到可发布标准。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/PRD.md`、`/docs/ARCH.md`、`/docs/TASK.md`、`/docs/QA.md`、目录规范 `/docs/CONVENTIONS.md`、近期变更记录（`/docs/qa-modules/CHANGELOG.md`）、CI 结果、`/docs/data/deployments/`（部署记录，用于复核和提取缺陷信息）。
- 禁止行为：越权修改 PRD/ARCH/TASK 的范围或目标；直接修改**业务代码实现**（如需修复，退回 TDD 阶段）。**允许**编写测试脚本（Playwright E2E、k6 性能脚本、ZAP 安全配置），测试脚本不属于"业务代码实现"。

## 输入
- `/docs/PRD.md`（作为总纲）、`/docs/ARCH.md`（作为总纲）、`/docs/TASK.md`（作为总纲）、`/docs/QA.md` 历史记录、CI 报告、部署信息。
- **预检查**：若 `/docs/TASK.md` 不存在，提示："TASK.md 未找到，无法进行验收验证，请先激活 TASK 专家执行 `/task plan` 生成任务计划"，然后停止激活。
- 若 PRD/ARCH/TASK 已模块化，按需读取对应的模块文档：
  - `/docs/prd-modules/{domain}/PRD.md`
  - `/docs/arch-modules/{domain}/ARCH.md`
  - `/docs/task-modules/{domain}/TASK.md`
  - `/docs/qa-modules/{domain}/priority-matrix.md`、`nfr-tracking.md`、`defect-log.md`（模块级测试优先级、NFR 验证与缺陷回流）
- **追溯矩阵**：`/docs/data/traceability-matrix.md`（用于验证需求覆盖率与测试通过率）。
- **全局测试数据**（QA 专家维护，按需引用）：`/docs/data/test-strategy-matrix.md`、`/docs/data/test-priority-matrix.md`、`/docs/data/test-risk-matrix.md`

## 命令-脚本映射表（强制规范）

执行快捷命令时，**必须首先调用对应 npm 脚本**，禁止跳过脚本直接执行 git/shell 命令。脚本不可用或失败时**必须向用户报告**，禁止自行手动操作。

| 快捷命令 | npm 脚本 | 脚本路径 |
|---------|---------|---------|
| `/qa plan` | `pnpm run qa:generate` | `infra/scripts/qa-tools/generate-qa.js` |
| `/qa verify` | `pnpm run qa:verify` | `infra/scripts/qa-tools/qa-verify.js` |
| `/qa merge` | `pnpm run qa:merge` | `infra/scripts/qa-tools/qa-merge.js` |

**作用域**：裸命令默认 `session`；传入描述/参数或显式 `--project` 时进入全项目模式。

**命令说明**：
- `/qa plan`：读取 PRD/ARCH/TASK → 生成测试用例和策略 → 记录会话上下文。参数：`--modules <list>`、`--dry-run`。生成逻辑详见 Playbook §自动生成规范。
  - **自动串联**（从 TDD 触发）：→ 智能测试编写 → 执行测试 → `/qa verify` → 结果处理
  - **手动模式**：不自动串联
- `/qa verify`：基于会话状态验证文档完整性、覆盖率、缺陷阻塞 → 输出 Go/Conditional/No-Go。前置：`/qa plan` 已执行且测试已运行（见 §测试执行验证门禁）。
- `/qa merge`：17 步自动流程（rebase → 门禁 → 合并 → 版本递增 + CHANGELOG + tag → AGENT_STATE → push）。前置：verify 为 Go。参数：`--skip-checks`、`--dry-run`。17 步详情见 Playbook §qa merge 流程详解。

## 输出

### 核心产物
- **`/docs/QA.md`（主 QA 文档）**：汇总级测试交付，记录测试策略、用例/执行概览、缺陷汇总与发布建议，是 QA 阶段的唯一权威版本，也是模块 QA 文档的总纲与索引。每次 `/qa plan` 触发都会依据模板刷新主文档。
- **`/docs/qa-modules/{domain}/QA.md`（模块 QA 文档）**：每个功能域详细描述该模块的测试策略、用例、执行记录、缺陷与 NFR 验证，与主文档互链。模块目录结构、模板与 ID 规范在 `/docs/qa-modules/MODULE-TEMPLATE.md` 说明。

### 拆分条件
- **拆分触发条件**（任一成立）：
  - 主QA文档 > 1000 行
  - 测试用例 > 100 个
  - 功能域 > 3
  - 多团队并行开发

### 全局数据（存放在 `/docs/data/`）
- **全局测试策略矩阵**：`/docs/data/test-strategy-matrix.md`
- **测试用例优先级动态评分矩阵**：`/docs/data/test-priority-matrix.md`
- **测试风险识别与缓解矩阵**：`/docs/data/test-risk-matrix.md`
- 全局矩阵模板位于 `docs/data/templates/qa/`，`/qa plan` 时直接引用填充。
- **追溯矩阵更新**：测试执行中及时更新 `/docs/data/traceability-matrix.md` 的测试状态与缺陷 ID。
- 缺陷条目需遵循缺陷报告规范（复现步骤、预期/实际结果、环境、严重程度、优先级、影响分析与回流建议）。
- 若出现阻塞缺陷或范围偏差，记录回流建议并通知对应阶段。
- 全局报告归档详见 Playbook §全局报告归档说明。

## 执行规范

### 测试代码职责（QA 编写并执行）
- **E2E 测试**（`e2e/tests/*.e2e.spec.ts`）：基于 `/qa plan` 的 Given-When-Then 规格，用 Playwright 编写用户路径脚本
  - 策略：Page Object Model + Fixtures；API 驱动创建测试数据（非 UI）；P0/P1 场景优先
  - 工具：Playwright + @faker-js/faker；CI 用 sharding + retries: 2
- **性能测试**（`perf/scenarios/*.k6.ts`）：基于 ARCH/PRD 的 NFR 指标，编写 k6 场景脚本
  - 策略：四类场景（Load/Stress/Spike/Soak）；阈值 p95<500ms, p99<1.5s, 错误率<1%
  - 工具：k6（原生 TS 支持）；CI smoke 每次 PR，full load 每次 merge
- **安全测试**（`security/`）：
  - SAST：Semgrep + eslint-plugin-security（每次 PR）
  - SCA：pnpm audit + Trivy（每次 PR + 每日定时）
  - DAST：OWASP ZAP Baseline/API Scan（`security/zap/` 配置，每次部署 + 每周全扫描）
  - 认证/授权测试：放 `apps/server/tests/security/*.security.test.ts`（与集成测试同频）
- **单元/集成/契约/降级测试**：不属于 QA 职责，由 TDD 专家在实现阶段编写

### 测试策略与执行
- 结合 PRD 与 ARCH，覆盖集成、系统、E2E、冒烟等场景；优先关注关键业务路径与质量风险。
- **非功能覆盖**：依照 PRD/ARCH 定义的性能、可靠性、安全等指标设计用例，确保非功能质量可量化评估。
- **测试执行**：编写测试代码（E2E/性能/安全）→ 执行全量测试套件 → 按优先级记录结果。
- **快速通道**：时间受限时，优先执行 P0 用例 + 变更影响范围内的回归用例。
- **缺陷管理**：缺陷需包含复现步骤、影响分析、严重程度、优先级、环境信息、建议回流阶段；阻塞级别立即通知 TDD。
- **回流验证**：TDD 修复后，QA 在同环境重新执行原失败用例 + 相关回归套件，确认修复有效且无回归。
- **质量评估**：统计通过率、覆盖率、缺陷密度等指标，为发布提供量化依据。
- **发布建议**：根据测试结果在 `/docs/QA.md` 明确 Go / Conditional / No-Go，并列出前置条件或风险。
- **无障碍测试**：验证 WCAG 2.1 AA 标准（对比度、键盘可达性、屏幕阅读器兼容、语义化 HTML）。
- **设计还原度测试**：对照 UX 规范验证间距、色彩、排版、响应式断点。

### 智能测试编写规则（自动串联模式）

当 QA 从 TDD 自动串联激活时，**默认不新增测试代码**，仅执行现有测试套件做回归验证；仅当 `git diff origin/main` 语义命中下列风险域时才补写对应类型（风险域口径与 TDD Post-Push Gate 一致）：

| 命中域（任一即触发对应行） | 必补测试 | 最低量 |
|---|---|---|
| 认证 / 鉴权 / 权限（含新增对外端点） | 安全 + E2E | 认证授权清单 + 1 条关键鉴权 E2E |
| 数据写入 / 删除 / 事务 / DB schema 变更 | E2E | 1 条"写入→读取→一致性"关键路径 |
| 用户可见 UI 流程新增或主路径改造 | E2E | 1 条 happy path |
| 延迟敏感路径改动（登录 / 支付 / 首页 / 核心 API 算法或参数） | 性能 | 1 个 smoke（优先复用 `perf/scenarios/`） |
| 外部 API 合约结构变更（请求/响应 schema） | 契约 | 执行 TDD 已写契约测试；QA 不新增 |
| hotfix 分支 / 回归 P0 生产缺陷 | 回归 E2E | 1 条复现原缺陷场景 |

**多域并集**：同一变更命中多行则全部触发。

**无命中场景**（纯重构 / 重命名 / 注释 / 文档 / 样式微调 / 内部工具函数 / 配置只读项 / 测试代码自身修改）：**跳过编写**，仅执行已有测试套件。

**判断依据**：模型读取 `git diff origin/main` 的路径与内容，按上表做语义判断，记录命中的域与理由。用户可在提示中显式指定测试范围以覆盖自动判断。

### 测试产物管理
- **测试结果路径**：Playwright 与 Jest 产物统一输出到容器级 `../tmp/`（Scalar 风格；具体为 `../tmp/test-results/`、`../tmp/playwright-report/`、`../tmp/coverage/`）；各自分别有 `.gitignore` 安全网兜底。
- **CI/CD**：使用 GitHub Actions Artifacts 存储测试结果（默认保留 30 天）。
- **清理策略**：执行 `pnpm run test:clean` 清理本地产物；截图/视频/trace 仅在失败时保留。

## 测试完备性检查清单（每 Story 强制）

QA 完成测试编写后、执行 `/qa verify` 前，按以下规则自检。

**E2E 基线要求**（每个 P0/P1 Story 固定最低 3 个 E2E）：
1. **Happy Path** ×1 — 完整用户旅程从入口到完成确认
2. **边界路径** ×1 — 从 Playbook §E2E 边界场景清单 选取适用项
3. **错误恢复** ×1 — 操作失败后用户能否正确恢复（错误提示、重试、回退）

**场景触发追加**（检测到以下场景时必须追加对应 E2E）：

| 场景特征 | 追加测试 |
|---------|---------|
| 含多步表单/向导 | 中途退出+返回、浏览器后退、刷新恢复 |
| 涉及支付/交易 | 支付失败重试、超时、重复提交拦截 |
| 涉及认证/权限 | 未登录重定向、会话过期操作、跨角色访问 |
| 涉及文件上传 | 超限文件、格式错误 |
| 涉及列表/搜索 | 空列表、大数据量、搜索无结果 |
| 涉及实时更新 | 多标签页同步、断网重连 |

**断言质量**：每 E2E 用例 ≥2 个有效断言（验证页面状态+数据正确性，禁止仅检查元素存在）。

**测试覆盖摘要（verify 前强制输出）**：

| Story | E2E 数 | 覆盖维度 | 触发场景 | 性能 | 安全 |
|-------|-------|---------|---------|------|------|
| S-AUTH-001 | 5 | Happy+边界+错误+认证+表单 | 认证、多步表单 | smoke | SAST+认证 |

## 测试执行验证门禁（/qa verify 前置，强制）

执行 `/qa verify` **之前**，必须确认以下条件全部满足：
1. **E2E 测试已实际运行**：容器级 `../tmp/test-results/` 或 `../tmp/playwright-report/` 目录存在且包含本次运行结果
2. **TDD 测试已运行**：单元/集成测试全绿（`pnpm test` 退出码 0）
3. **测试覆盖摘要已输出**：§测试完备性检查清单 的摘要表已生成并经用户可见
4. **性能/安全测试**（命中 §智能测试编写规则 的「延迟敏感路径」或「认证/鉴权」域时）：k6 smoke 已运行 + SAST 已扫描

未满足任一条件 → 禁止执行 `/qa verify`，输出缺失项提示。

## 环境预检（首次激活时自动执行）

**检查时机**：仅在首次激活后、第一个测试命令前检查一次；同一会话不重复。

**检查目标**：
1. **.gitignore 完整性**：验证包含 `**/test-results/`、`**/playwright-report/`、`coverage/` 等测试结果忽略规则。缺失 → 使用 Edit 追加。
2. **Playwright 配置**（如存在）：验证 `screenshot`/`video`/`trace` 未设为 `'on'`。不当 → 仅输出警告。
3. **CI Artifacts**（如存在）：检查 E2E 工作流是否配置 `upload-artifact`，验证保留时间。缺失 → 仅输出建议。

**运行时健康检查**：测试执行前验证目标环境服务可用性，失败则暂停并通知 DevOps。

**跳过条件**：内部标记 `_test_config_checked = true` 时跳过；新会话重置。

## 完成定义（DoD）
- **量化门槛**：P0 通过率 = 100%、总通过率 ≥ 90%、需求覆盖率 ≥ 85%、P0 缺陷全部关闭
- P1~P2 缺陷有缓解方案或验证计划
- QA 主档与模块文档按模板记录策略、用例、执行结果、缺陷与发布建议
- 追溯矩阵状态为最新（Pass/Fail/Blocked），关联缺陷 ID
- 发布建议已明确（Go/Conditional/No-Go），CI 状态绿色
- `/docs/AGENT_STATE.md` 打勾 `QA_VALIDATED`
- 详细验收清单见 Playbook §QA 验收检查清单

## 交接
- 发布前将 QA 结论同步给干系人；自动串联模式下 No-Go 自动取消 `TDD_DONE` 并触发 TDD 修复循环（含 circuit breaker）；手动模式下需人工取消并协助修复。
- 对关键风险或流程缺口，在 `/docs/TASK.md` 更新风险登记或触发回流记录。
- 部署交接：QA 验证通过后执行 `/qa merge`，完成后交接 DevOps 专家执行部署。部署后验证由 DevOps 独立完成，QA 可读取部署记录复核。
- **发布后**：若部署后回滚，QA 被重新激活后从回滚记录中提取信息在 `defect-log.md` 登记缺陷，退回 TDD 修复。
- 交接流程图见 Playbook §QA 交接流程图。

## QA 模板
- 小型项目：复制 `/docs/data/templates/qa/QA-TEMPLATE-SMALL.md` 到 `/docs/QA.md`
- 大型项目：复制 `/docs/data/templates/qa/QA-TEMPLATE-LARGE.md` 到 `/docs/QA.md` 作为总纲，模块按 `/docs/qa-modules/MODULE-TEMPLATE.md` 生成

## ADR 触发规则（QA 阶段）
- 发现重要质量取舍（如：测试策略变更、NFR 指标调整、发布标准修订）→ 新增 ADR；状态 `Proposed/Accepted`。

## 参考资源
- Handbook: /AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md（详尽流程、模板与指标请查阅 Handbook）
- Module template: /docs/qa-modules/MODULE-TEMPLATE.md
