# QA 模块化索引

> **说明**：本目录用于存放按功能域拆分的测试计划与执行记录文档。当主 QA 文档 `/docs/QA.md` 过于庞大时，QA 专家会将其拆分为主从结构，此文件作为模块索引与命名规范指引。

**维护者**：QA 专家
**创建日期**：2025-11-05
**最后更新**：2025-11-06
**模板版本**：v1.0（QA 模块化拆分）

---

## 何时需要拆分 QA 文档？

当项目满足以下**任一条件**时，建议采用模块化 QA 文档：

1. **主 QA 文档超过 1000 行**
2. **测试用例数量超过 100 个**
3. **存在多类型测试**（功能、性能、安全、兼容性各 > 10 个用例）
4. **多模块并行测试**（3+ 个功能域独立测试）
5. **长周期项目**（需要分阶段回归测试）

对于小型项目（< 30 个测试用例，单一测试类型），维护单一 `/docs/QA.md` 即可。

---

## 命名规范

### 模块文件命名
- **格式**：`{domain}.md`（使用 kebab-case）
- **示例**：
  - `user-management.md` — 用户管理功能测试计划
  - `payment-system.md` — 支付系统测试计划
  - `notification-service.md` — 通知服务测试计划
  - `performance-testing.md` — 性能测试计划（跨模块）
  - `security-testing.md` — 安全测试计划（跨模块）

### 测试用例 ID 规范
- **格式**：`TC-{MODULE}-{序号}`
- **示例**：
  - `TC-REG-001` — 用户注册功能测试
  - `TC-PAY-012` — 支付确认功能测试
  - `TC-NOTIF-008` — 邮件通知测试
  - `TC-PERF-001` — 首页加载性能测试
  - `TC-SEC-005` — SQL 注入安全测试

### 缺陷 ID 规范
- **格式**：`BUG-{MODULE}-{序号}` 或对接外部缺陷管理系统（如 Jira）
- **示例**：
  - `BUG-USER-001` — 用户注册邮箱验证失败
  - `BUG-PAY-003` — 支付超时未回调
  - `JIRA-PROJ-1234` — 外部缺陷系统引用

---

## 模块清单

> **维护规则**：QA 专家在创建/更新模块时，必须同步更新此表格。

| 模块名称 | 文件路径 | 测试负责人 | 对应 PRD 模块 | 对应 TASK 模块 | 状态 | 最后更新 |
|---------|---------|-----------|--------------|---------------|------|---------|
| （示例）用户管理 | [user-management.md](user-management.md) | @qa-tester-1 | [prd-modules/user-management.md](../prd-modules/user-management.md) | [task-modules/user-management.md](../task-modules/user-management.md) | ✅ 已通过 | 2025-11-05 |
| （示例）支付系统 | [payment-system.md](payment-system.md) | @qa-tester-2 | [prd-modules/payment-system.md](../prd-modules/payment-system.md) | [task-modules/payment-system.md](../task-modules/payment-system.md) | 🔄 测试中 | 2025-11-05 |
| （示例）性能测试 | [performance-testing.md](performance-testing.md) | @qa-perf-lead | - | - | 📝 待启动 | 2025-11-05 |
| （待补充） | - | - | - | - | - | - |

**状态标识说明**：
- ✅ **已通过**：所有测试用例通过，无阻塞缺陷
- 🔄 **测试中**：正在执行测试
- 📝 **待启动**：测试计划已完成，等待执行
- ⚠️ **有风险**：存在 P0/P1 缺陷，需关注
- ❌ **未通过**：存在阻塞缺陷，不可发布

---

## 标准模块 QA 文档结构

每个模块 QA 文档应包含以下章节（详见 [MODULE-TEMPLATE.md](MODULE-TEMPLATE.md) 完整模板）：

### 核心章节概览
1. **模块概述** — 测试目标、范围、关键指标
2. **测试策略** — 测试类型覆盖、优先级定义、测试环境
3. **测试用例** — 功能/集成/E2E/回归/性能/安全等 9 类测试
4. **缺陷列表** — P0/P1/P2 缺陷追踪
5. **测试执行记录** — 日期、通过率、失败原因
6. **测试指标** — 覆盖率、通过率、缺陷密度
7. **外部依赖** — 依赖服务、测试数据源
8. **风险与缓解** — 测试风险评估与应对
9. **参考文档** — 关联 PRD/ARCH/TASK 模块

### 快速开始
- **使用模板创建**：复制 [MODULE-TEMPLATE.md](MODULE-TEMPLATE.md) 并重命名为 `{domain}/QA.md`
- **目录结构指南**：参考 [STRUCTURE-GUIDE.md](STRUCTURE-GUIDE.md) 了解模块内部文件组织
- **测试用例格式**：使用 Given-When-Then 格式（详见模板 §3）
- **ID 命名规范**：`TC-{MODULE}-{NNN}` 测试用例，`BUG-{MODULE}-{NNN}` 缺陷

---

## 跨模块协作规范

### 与 PRD 专家协作
- **输入**：读取 `/docs/prd-modules/{domain}/PRD.md` 对应的 PRD 模块
- **追溯**：基于追溯矩阵（`/docs/data/traceability-matrix.md`），确保所有 Story/AC 都有对应测试用例
- **验收标准**：严格按照 PRD 中的 Given-When-Then 验收标准执行测试

### 与 ARCH 专家协作
- **输入**：读取 `/docs/arch-modules/{domain}.md` 对应的架构模块
- **接口测试**：基于架构文档的接口定义，编写契约测试
- **非功能需求**：基于架构文档的 NFR（性能/安全/可用性）制定测试策略

### 与 TASK 专家协作
- **输入**：读取 `/docs/task-modules/{domain}.md` 对应的任务模块
- **测试顺序**：根据任务完成顺序，逐步执行测试
- **阻塞反馈**：若测试发现阻塞缺陷，及时通知 TASK 专家调整计划

### 与 TDD 专家协作
- **缺陷反馈**：通过缺陷清单（或外部缺陷系统）反馈给 TDD 专家
- **重新测试**：TDD 专家修复缺陷后，QA 专家执行回归测试
- **CI 集成**：QA 专家将自动化测试集成到 CI 流水线，提前发现问题

---

## 模块化工作流

1. **拆分评估**：QA 专家根据拆分条件，决定是否采用模块化
2. **创建主 QA 文档**：在 `/docs/QA.md` 维护总纲与模块索引（< 500 行）
3. **创建模块目录**：按照 [STRUCTURE-GUIDE.md](STRUCTURE-GUIDE.md) 创建目录结构
   ```bash
   mkdir -p qa-modules/{domain}/{test-data/fixtures,reports/coverage,automation,defect-attachments}
   ```
4. **创建模块 QA 文档**：基于 [MODULE-TEMPLATE.md](MODULE-TEMPLATE.md) 创建 `{domain}/QA.md`
5. **更新模块索引**：在本文件的"模块清单"表格中注册新模块
6. **制定测试用例**：基于 PRD/ARCH/TASK 模块，编写详细测试用例
7. **执行与记录**：执行测试并实时更新测试结果与缺陷清单
8. **运行质量检查**：使用 `npm run qa:lint` 检查文档完整性
9. **生成测试报告**：使用 `npm run qa:generate-test-report` 汇总结果
10. **发布决策**：使用 `npm run qa:check-defect-blockers` 执行发布门禁检查

---

## 🛠️ 自动化工具链

项目提供完整的 QA 自动化工具，支持文档检查、覆盖率分析、缺陷追踪等：

### 核心命令
```bash
# 1. QA 文档完整性检查
npm run qa:lint

# 2. 测试覆盖率分析（生成 coverage-summary.md）
npm run qa:coverage-report

# 3. PRD ↔ QA ID 同步验证
npm run qa:sync-prd-qa-ids

# 4. 测试报告生成（汇总所有模块）
npm run qa:generate-test-report

# 5. 缺陷阻塞检查与发布门禁
npm run qa:check-defect-blockers
```

### 工作流集成
```bash
# 提交前本地检查
npm run qa:lint && npm run qa:sync-prd-qa-ids

# 测试执行后汇总
npm run qa:generate-test-report && npm run qa:coverage-report

# 发布前质量门禁
npm run qa:check-defect-blockers
```

**详细文档**：[scripts/qa-tools/README.md](../../scripts/qa-tools/README.md)

---

## 常见问题

### Q1: 如何决定测试用例拆分粒度？
**A**: 遵循以下原则：
- **需求对齐**：一个验收标准（AC）至少对应一个测试用例
- **边界覆盖**：正常场景 + 边界场景 + 异常场景
- **独立性**：测试用例之间互不依赖（可并行执行）
- **可自动化**：优先设计可自动化的测试用例

### Q2: 如何管理跨模块的端到端测试？
**A**:
- **选项1**：创建独立的"端到端测试"模块（如 `e2e-testing.md`）
- **选项2**：在主 QA 文档的"集成测试"章节统一描述
- **推荐**：选项1，便于独立维护与回归测试

### Q3: 如何处理性能测试与安全测试（跨模块）？
**A**:
- **性能测试**：创建独立模块 `performance-testing.md`，覆盖所有关键路径
- **安全测试**：创建独立模块 `security-testing.md`，基于 OWASP Top 10 制定测试计划
- **定期执行**：每个里程碑完成后执行一次全量性能/安全测试

### Q4: 如何从单一 QA 文档迁移到模块化？
**A**:
1. 保持主 `/docs/QA.md` 作为总纲
2. 按功能域逐步拆分，每个模块对应一个新文件
3. 在主文档中保留模块索引与全局测试策略
4. 历史测试记录保留在主文档，新测试写入模块文档

---

## 相关文档

### 模板与指南
- **模块 QA 模板**：[MODULE-TEMPLATE.md](MODULE-TEMPLATE.md) — 可复用的模块 QA 文档模板
- **模块结构指南**：[STRUCTURE-GUIDE.md](STRUCTURE-GUIDE.md) — 模块内部目录组织与数据管理

### 全局文档
- **主 QA 文档**：[/docs/QA.md](../QA.md)
- **全局测试报告目录**：[/docs/data/qa-reports/](../data/qa-reports/) — 汇总的覆盖率、缺陷、发布门禁报告
- **追溯矩阵**：[/docs/data/traceability-matrix.md](../data/traceability-matrix.md)

### 跨专家协作
- **PRD 模块索引与模板**：[/docs/prd-modules/MODULE-TEMPLATE.md](../prd-modules/MODULE-TEMPLATE.md)
- **ARCH 模块索引**：[/docs/arch-modules/module-list.md](../arch-modules/module-list.md)
- **TASK 模块索引**：[/docs/task-modules/module-list.md](../task-modules/module-list.md)

### 工具与规范
- **QA 工具说明**：[/scripts/qa-tools/README.md](../../scripts/qa-tools/README.md) — 5 个核心 QA 工具的详细使用说明
- **目录规范**：[/docs/CONVENTIONS.md](../CONVENTIONS.md)

---

> **注意**：本索引文件必须与 `/docs/QA.md` 中的"模块测试索引"章节保持同步。任何模块的新增、修改、通过/失败都必须同时更新两处。
