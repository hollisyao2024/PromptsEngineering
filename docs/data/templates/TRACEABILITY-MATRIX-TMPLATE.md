## traceability-matrix.md 模板说明

本文件即 `/docs/data/traceability-matrix.md` 的完整模板：PRD 专家在 Story/AC 确认后应该**完整复制本文件**到 `/docs/data/traceability-matrix.md`，以本说明、表格、命名规范与状态定义作为初版内容。  
1. 在“追溯矩阵”表格内记录 Story ID、Story Title 与 AC ID，状态可以先置为 `📝 Draft`；  
2. TDD 阶段在同一文件补入 Test Case ID 并注明相关实现细节，QA 阶段再更新状态、负责人与缺陷链接；  
3. 后续任何更新必须保持与模板一致（尤其保留开头的“目的/维护职责”段），方便跨阶段的追溯与审计。  

> ⚠️ 请务必复制整个模板内容，而不是只复制表格或某一段落；模板也可以用于审计和版本对比，确保 `/docs/data/traceability-matrix.md` 始终和本文件保持同步。

---

# 需求追溯矩阵

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
| （示例）US-USER-001 | 用户注册 | AC-USER-001-01 | TC-REG-001 | ✅ Pass | @tester-a | - |
| （示例）US-USER-001 | 用户注册 | AC-USER-001-02 | TC-REG-002 | 🔄 Pending | @tester-a | 等待环境配置 |
| （示例）US-PAY-005 | 支付确认 | AC-PAY-005-01 | TC-PAY-012 | ❌ Fail | @tester-b | [BUG-123](#) |
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
- **格式**：`TC-{MODULE}-{序号}` 或按测试框架惯例（如 Jest describe/test 路径）
- **示例**：
  - `TC-REG-001` — 用户注册相关测试用例 001
  - `TC-PAY-012` — 支付相关测试用例 012
  - `tests/user/registration.test.ts::should validate email format` — Jest 测试路径

---

## 状态标识

| 状态 | 说明 |
|------|------|
| ✅ **Pass** | 测试通过，验收标准已满足 |
| ❌ **Fail** | 测试失败，存在缺陷需修复 |
| 🔄 **Pending** | 待测试，测试用例已编写但尚未执行 |
| ⏸️ **Blocked** | 测试阻塞，无法执行（如依赖环境未就绪） |
| 📝 **Draft** | 草稿状态，验收标准或测试用例尚未完成 |
| ⏭️ **Skipped** | 跳过测试（如非当前版本范围） |

---

## 状态落地指南

- PRD 阶段把每行状态设为 `📝 Draft`，备注记录依赖/待确认项，方便 QA 后续追踪再验证；
- TDD 实现阶段在表格内补入 Test Case ID，验证通过即设置 `✅ Pass`，验证失败则记录 `❌ Fail` 并在备注附上 BUG ID（如 `[BUG-123](link)`）；
- QA 验证紧密跟踪 `🔄 Pending`/`⏸️ Blocked` 的行，完成后统一切换状态并把负责人、环境、缺陷信息写入备注；
- 每次状态更新可在备注中加上“更新人 + 日期”，便于追溯谁在什么时候改变了状态。

## 使用指南

### 1. PRD 阶段（PRD 专家）
- 在编写模块 PRD 时，为每个用户故事分配 **Story ID**
- 为每个验收标准（Given-When-Then）分配 **AC ID**
- 在追溯矩阵中创建初始条目，状态标记为 `📝 Draft`

**示例**：
```markdown
### US-USER-001: 用户注册
**作为** 新用户
**我希望** 通过邮箱和密码注册账号
**以便** 使用平台服务

**验收标准：**
- **AC-USER-001-01 (Given)** 用户访问注册页面
- **AC-USER-001-02 (When)** 输入有效邮箱和符合规则的密码
- **AC-USER-001-03 (Then)** 系统创建账号并发送验证邮件
```

### 2. TASK 阶段（TASK 专家）
- 在任务规划时，将 Story ID 关联到具体的开发任务（WBS 节点）
- 评估测试工作量，在 `/docs/TASK.md` 中预留测试任务

### 3. TDD 阶段（TDD 专家）
- 在实现前编写测试用例，分配 **Test Case ID**
- 在追溯矩阵中更新 Test Case ID 列，关联到对应的 AC ID
- 测试通过后更新状态为 `✅ Pass`

**示例**（Jest 测试）：
```typescript
// tests/user/registration.test.ts
describe('User Registration (US-USER-001)', () => {
  it('TC-REG-001: should validate email format (AC-USER-001-02)', async () => {
    // Given: 用户访问注册页面
    // When: 输入无效邮箱格式
    // Then: 系统提示邮箱格式错误
    const result = await registerUser({ email: 'invalid-email', password: 'Pass123!' });
    expect(result.error).toBe('Invalid email format');
  });
});
```

### 4. QA 阶段（QA 专家）
- 基于追溯矩阵执行回归测试，验证所有 AC 是否被测试覆盖
- 更新测试状态（Pass/Fail/Blocked）
- 若测试失败，在"备注"列链接缺陷 ID（如 `[BUG-123](issue-url)`）
- 输出覆盖率报告：
  - **需求覆盖率** = 已关联测试用例的 Story 数 / 总 Story 数
  - **测试通过率** = Pass 状态的 AC 数 / 总 AC 数

---

## 与其他文档的关系

```
/docs/PRD.md（主 PRD）
  └─ 功能域索引 → /docs/prd-modules/{domain}/PRD.md（子 PRD）
       └─ 需求追溯矩阵模板 → /docs/data/templates/TRACEABILITY-MATRIX-TMPLATE.md
       └─ 实际需求追溯矩阵文件 → /docs/data/traceability-matrix.md
            └─ Test Case ID → 测试代码（如 tests/**/*.test.ts）
                 └─ 测试执行结果 → /docs/QA.md（测试报告）
```

---

## 工具支持（可选）

推荐使用以下工具自动化追溯矩阵的生成与更新：

- **Markdown 表格编辑器**：VSCode 插件如 `Markdown Table` 或 `Excel to Markdown table`
- **测试覆盖率工具**：Jest/Vitest Coverage Report，导出为 JSON 后脚本解析
- **自定义脚本**：
  - `scripts/sync-traceability.js` — 从 PRD 模块提取 Story/AC ID，与测试文件中的注释对比，生成矩阵
  - `scripts/coverage-report.js` — 基于矩阵生成覆盖率统计

---

## 维护原则

1. **唯一真相来源**：追溯矩阵是 Story→AC→TestCase 关系的唯一权威记录
2. **持续更新**：每个阶段完成时必须更新矩阵（PRD 确认后、TDD 完成后、QA 验证后）
3. **双向追溯**：既能从 Story 找到测试用例，也能从测试用例反查需求
4. **质量门禁**：发布前检查需求覆盖率和测试通过率是否达标

---

> 本文档模板的唯一真相由 PRD 专家复制到 `/docs/data/traceability-matrix.md` 并初始化 Story/AC，TASK/TDD/QA 专家在各自阶段继续补充 Test Case ID、状态与缺陷链接；任何修改都必须与 `/docs/PRD.md` 及各子 PRD 保持同步，以保障追溯链路完整。
