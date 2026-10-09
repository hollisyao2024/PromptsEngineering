# 全局需求追溯矩阵

> **目的**：维护全局的 User Story → Acceptance Criteria → Test Case ID 映射，确保需求、验收标准与测试用例之间的完整追溯性。
>
> **维护职责**：
> - **PRD 专家**：初始化 Story ID 和 AC ID
> - **TASK 专家**：在任务规划阶段记录 Story 对应的工作包与依赖（见 `/docs/TASK.md` / 模块任务文档），并在追溯矩阵的“备注”或链接中注明关联任务，方便 TDD/QA 对齐
> - **TDD 专家**：在实现阶段关联测试用例
> - **QA 专家**：在验证阶段更新测试状态与缺陷链接

---

## 追溯矩阵

| Story ID | Story Title | AC ID | Test Case ID | 状态 | 负责人 | 备注 |
|----------|-------------|-------|--------------|------|--------|------|
| （示例）US-USER-001 | 用户注册 | AC-USER-001-01 | TC-USER-001 | ✅ 已确认 | @tester-a | - |
| （示例）US-USER-001 | 用户注册 | AC-USER-001-02 | TC-USER-002 | 🔄 进行中 | @tester-a | 等待环境配置 |
| （示例）US-PAY-005 | 支付确认 | AC-PAY-005-01 | TC-PAY-012 | ⚠️ 需更新 | @tester-b | [BUG-123](#) |
| （待填充） | - | - | - | - | - | - |

---

## 覆盖率统计（自动或手动维护）

| 指标 | 数值 | 目标 |
|------|------|------|
| 总 Story 数 | 0 | - |
| 已关联测试用例的 Story 数 | 0 | 100% |
| 总 AC 数 | 0 | - |
| 已关联测试用例的 AC 数 | 0 | 100% |
| 测试通过的 AC 数 | 0 | 100% |
| 测试失败的 AC 数 | 0 | 0 |
| **需求覆盖率** | 0% | ≥ 95% |
| **测试通过率** | 0% | ≥ 98% |


> 该统计表应被复制到 `/docs/data/traceability-matrix.md` 并随着 QA 测试进度实时更新，作为发布门禁的量化依据。

---

## ID 命名规范

### Story ID
- **格式**：`US-{MODULE}-{序号}`
- **示例**：
  - `US-USER-001` — 用户管理模块第 1 个用户故事
  - `US-PAY-005` — 支付系统模块第 5 个用户故事
  - `US-ANALYTICS-012` — 分析服务模块第 12 个用户故事

### AC（验收标准）ID
- **格式**：`AC-{MODULE}-{Story序号}-{AC序号}`
- **示例**：
  - `AC-USER-001-01` — US-USER-001 的第 1 个验收标准
  - `AC-PAY-005-03` — US-PAY-005 的第 3 个验收标准

### Test Case ID
- **格式**：`TC-{MODULE}-NNN`（序号固定 3 位，模块标记与 Story/AC 一致）；只有这一种写法，不用测试文件路径或框架描述代替
- **多个用例**：逐个列出完整编号并以逗号分隔（如 `TC-USER-001, TC-USER-002`）；不写区间（`001~005` 式）或在编号后追加字母、数字子编号，`qa-lint` 会输出 `TC_ID_NONCANONICAL=<文件>:<行> <写法>` 警告
- **示例**：
  - `TC-USER-001` — 用户管理模块测试用例 001
  - `TC-PAY-012` — 支付系统模块测试用例 012
- **与自动化测试的关系**：测试名同时携带 TC 与 AC 标识，`pnpm agent -- qa run` 据此把测试结果绑定回 AC

---

## 状态标识

| 状态 | 说明 |
|------|------|
| 📝 **待启动** | Story/AC 已确认，尚未分配到任务/测试；由 TASK/QA 安排里程碑与 Test Case |
| 🔄 **进行中** | 测试用例已编写或正在执行，TDD/QA 正在验证对应 AC |
| ✅ **已确认** | 测试通过，验收标准已满足，可作为发布门禁依据 |
| ⚠️ **需更新** | 状态或 Test Case 需要重新审查（如 Story 变更、测试失败待复测或 Traceability 信息需补） |

---

## 状态落地指南

- PRD 阶段把每行状态设为 `📝 待启动`，备注记录依赖与待确认项，便于 TASK/QA 后续排入计划；
- 当 Task/TDD 已编写或开始执行 Test Case，状态改为 `🔄 进行中`，Test Case ID、负责人、环境、用例路径等信息同步补入；
- QA 完成验证且无缺陷或缺陷已复测通过时置为 `✅ 已确认`，同时在备注中链接验证报告或 evidence；
- 若 Story/AC 已调整、Traceability 信息不完整或测试失败需复测，改为 `⚠️ 需更新` 并在备注附上重做原因与目标担当；每次状态变更可写“更新人 + 日期”提升审计性。

## 使用指南

### 1. PRD 阶段（PRD 专家）
- 在编写模块 PRD 时，为每个用户故事分配 **Story ID**
- 为每条验收标准分配 **AC ID**：一条 AC 占原子 AC 表的一行，Given/When/Then 各占一列
 - 在追溯矩阵中创建初始条目，状态标记为 `📝 待启动`

**示例**：
```markdown
| Story ID | 用户故事 | Task ID | QA 负责人 |
|----------|----------|---------|-----------|
| US-USER-001 | 作为访客，我希望用邮箱注册账号，以便使用平台服务 | TASK-USER-001 | @qa-lead |

| AC ID | Story | 优先级 | 验证 | 端 | Given | When | Then | TC |
|-------|-------|--------|------|----|-------|------|------|----|
| AC-USER-001-01 | US-USER-001 | P0 | auto | web | 访客在注册页，邮箱未被注册 | 提交合法邮箱、合规密码与正确验证码 | 返回 201，系统创建账号并发送验证邮件 | TC-USER-001 |
| AC-USER-001-02 | US-USER-001 | P1 | auto | web | 邮箱已被注册 | 使用同一邮箱再次提交注册 | 返回错误码 1001，不新建账号 | TC-USER-002 |
```

每条 AC 一行，Given/When/Then 各占一列，不要拆成三个 AC。完整列定义见 `/docs/prd-modules/MODULE-TEMPLATE.md` Appendix A。

### 2. TASK 阶段（TASK 专家）
- 在任务规划时，将 Story ID 关联到具体的开发任务（WBS 节点）
- 评估测试工作量，在 `/docs/TASK.md` 中预留测试任务

### 3. TDD 阶段（TDD 专家）
- 在实现前编写测试用例，分配 **Test Case ID**
- 在追溯矩阵中更新 Test Case ID 列，关联到对应的 AC ID
- 测试通过后更新状态为 `✅ 已确认`

**示例**（Jest 测试，测试名同时携带 TC 与 AC 标识）：
```typescript
// tests/user/registration.test.ts
describe('User Registration (US-USER-001)', () => {
  it('TC-USER-002: rejects an email that is already registered (AC-USER-001-02)', async () => {
    // Given: 邮箱已被注册
    await registerUser({ email: 'taken@example.com', password: 'Pass123!', captcha: 'ABC123' });
    // When: 使用同一邮箱再次提交注册
    const result = await registerUser({ email: 'taken@example.com', password: 'Pass123!', captcha: 'ABC123' });
    // Then: 返回错误码 1001，不新建账号
    expect(result.code).toBe(1001);
  });
});
```

- 基于追溯矩阵执行回归测试，验证所有 AC 是否被测试覆盖
- 更新测试状态（`🔄 进行中` / `✅ 已确认` / `⚠️ 需更新`）；若测试失败或需要复测请标记为 `⚠️ 需更新`
- 若测试失败或状态为 `⚠️ 需更新`，在"备注"列链接缺陷 ID（如 `[BUG-123](issue-url)`）
- 输出覆盖率报告：
  - **需求覆盖率** = 已关联测试用例的 Story 数 / 总 Story 数
  - **测试通过率** = Pass 状态的 AC 数 / 总 AC 数

---

## 与其他文档的关系

```
/docs/PRD.md（主 PRD）
  └─ 功能域索引 → /docs/prd-modules/{domain}/PRD.md（子 PRD）
       └─ 需求追溯矩阵模板 → /docs/data/templates/prd/TRACEABILITY-MATRIX-TEMPLATE.md
       └─ 实际需求追溯矩阵文件 → /docs/data/traceability-matrix.md
            └─ Test Case ID → 测试代码（测试名携带 AC/TC 标识，如 tests/**/*.test.ts）
                 └─ 测试执行结果 → /docs/QA.md（测试报告）
```

---

## 工具支持（可选）

推荐使用以下工具自动化追溯矩阵的生成与更新：

- **Markdown 表格编辑器**：VSCode 插件如 `Markdown Table` 或 `Excel to Markdown table`
- **测试覆盖率工具**：Jest/Vitest Coverage Report，导出为 JSON 后脚本解析
- **自定义脚本**：
  - `pnpm agent -- qa paths` — 只读解析原子 AC 表与 `docs/qa-modules/{domain}/PATHS.md`，输出 AC 与操作路径的追溯矩阵
  - `scripts/sync-traceability.js` — 从 PRD 模块提取 Story/AC ID，与测试文件中的注释对比，生成矩阵
  - `scripts/coverage-report.js` — 基于矩阵生成覆盖率统计

---

## 维护原则

1. **唯一真相来源**：追溯矩阵是 Story→AC→TestCase 关系的唯一权威记录
2. **持续更新**：每个阶段完成时必须更新矩阵（PRD 确认后、TDD 完成后、QA 验证后）
3. **双向追溯**：既能从 Story 找到测试用例，也能从测试用例反查需求
4. **质量门禁**：发布前检查需求覆盖率和测试通过率是否达标

---

> 本文档模板的唯一真相由 PRD 专家复制到 `/docs/data/traceability-matrix.md` 并初始化 Story/AC，TASK/TDD/QA 专家在各自阶段继续补充 Test Case ID、状态与缺陷链接；任何修改都必须与 `/docs/PRD.md` 及各模块 PRD 保持同步，以保障追溯链路完整。
