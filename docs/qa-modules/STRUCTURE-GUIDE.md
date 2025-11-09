# QA 模块内部结构指南（v1.0）

> **适用范围**：大型项目（满足拆分条件：单文件 > 1000 行 或 100+ 测试用例 或 3+ 功能域）
> **更新日期**：2025-11-06

---

## 📁 模块目录结构

每个功能域模块在 `/docs/qa-modules/{domain}/` 目录下维护以下文件和子目录：

```
qa-modules/
  {domain}/                      # 功能域目录（如 user-management, payment-system）
    QA.md                        # 模块 QA 文档（必需）
    test-data/                   # 测试数据管理（推荐）
      fixtures/                  # 静态测试数据
      generators/                # 数据生成脚本
      cleanup.md                 # 数据清理策略
    reports/                     # 本地测试报告（推荐）
      coverage/                  # 覆盖率报告
      performance/               # 性能测试报告
      security/                  # 安全扫描报告
    automation/                  # 自动化测试脚本（可选）
      e2e/                       # E2E 测试脚本
      integration/               # 集成测试脚本
      performance/               # 性能测试脚本
    defect-attachments/          # 缺陷附件（可选）
      screenshots/               # 截图
      logs/                      # 日志文件
      recordings/                # 屏幕录制
```

---

## 📄 文件用途说明

### 1. QA.md — 模块 QA 文档（必需）

**用途**：定义该功能域的测试策略、测试用例、执行记录和缺陷追踪

**标准结构**：
```markdown
# {功能域名称} - QA 模块

> 所属主 QA: [QA.md](../QA.md)
> 关联 PRD 模块: [prd-modules/{domain}.md](../prd-modules/{domain}.md)
> 关联 ARCH 模块: [arch-modules/{domain}.md](../arch-modules/{domain}.md)
> 负责团队: @qa-team-name
> 最后更新: YYYY-MM-DD

## 1. 模块概述
- 模块范围与测试边界
- 关联 Story ID 列表
- 关键测试指标

## 2. 测试策略
- 测试类型覆盖（功能/集成/E2E/性能/安全等）
- 测试优先级定义（P0/P1/P2）
- 测试环境要求

## 3. 测试用例
### 3.1 功能测试
TC-{MODULE}-001: {测试用例标题}
- **Story ID**: US-{MODULE}-XXX
- **Given**: 前置条件
- **When**: 执行步骤
- **Then**: 预期结果
- **优先级**: P0/P1/P2

### 3.2 集成测试
[集成测试用例...]

### 3.3 E2E测试
[E2E测试用例...]

## 4. 缺陷列表
BUG-{MODULE}-001: {缺陷标题}
- **严重级别**: P0/P1/P2
- **影响 Story**: US-{MODULE}-XXX
- **复现步骤**: [步骤]
- **附件**: [screenshots/BUG-{MODULE}-001.png]

## 5. 测试执行记录
- 日期、测试轮次、通过/失败统计

## 6. 测试指标
- 覆盖率、通过率、缺陷密度

## 7. 外部依赖
- 依赖的外部服务、测试数据源

## 8. 风险与缓解
- 模块特定测试风险

## 9. 参考文档
- 关联的 PRD/ARCH/TASK 模块
```

**创建时机**：QA 专家评估需要拆分时，按功能域创建

---

### 2. test-data/ — 测试数据管理（推荐）

**用途**：组织和管理该模块的测试数据，确保测试可重复性

#### 2.1 test-data/fixtures/ — 静态测试数据

**格式**：JSON、YAML、SQL 等

**示例目录结构**：
```
test-data/fixtures/
  users.json              # 用户数据
  products.json           # 产品数据
  orders.json             # 订单数据
  edge-cases.json         # 边界用例数据
```

**users.json 示例**：
```json
{
  "valid_users": [
    {
      "id": "test-user-001",
      "email": "test@example.com",
      "role": "customer",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "edge_cases": [
    {
      "id": "test-user-long-email",
      "email": "very-long-email-address-for-boundary-testing@example.com",
      "role": "customer"
    }
  ]
}
```

**创建时机**：
- 测试用例需要预定义数据时
- 需要测试边界条件或异常数据时

---

#### 2.2 test-data/generators/ — 数据生成脚本

**用途**：动态生成大批量测试数据（性能测试、压力测试）

**示例**：
```javascript
// generate-users.js
const faker = require('@faker-js/faker');

function generateUsers(count = 1000) {
  return Array.from({ length: count }, (_, i) => ({
    id: `perf-user-${i}`,
    email: faker.internet.email(),
    name: faker.person.fullName(),
    created_at: faker.date.past().toISOString()
  }));
}

module.exports = { generateUsers };
```

**创建时机**：
- 性能测试需要大量数据时
- 测试数据需要随机化时

---

#### 2.3 test-data/cleanup.md — 数据清理策略

**用途**：定义测试后数据清理规则，避免数据污染

**示例**：
```markdown
# 测试数据清理策略

## 自动清理（每次测试后）
- 删除所有 `id` 前缀为 `test-*` 的记录
- 清空测试邮箱（`@test.example.com`）相关数据

## 手动清理（每周）
- 清理 > 7 天的性能测试数据
- 归档已关闭的缺陷附件（移动到 `archive/`）

## 不清理
- 基线数据（`fixtures/baseline/`）
- 长期回归测试数据（标记为 `regression-*`）

## 清理脚本
\`\`\`bash
npm run qa:cleanup-test-data -- --module={domain}
\`\`\`
```

**创建时机**：模块测试开始后，制定数据管理策略

---

### 3. reports/ — 本地测试报告（推荐）

**用途**：存储该模块的测试报告，便于快速查看和分享

#### 3.1 reports/coverage/ — 覆盖率报告

**格式**：HTML、JSON、Cobertura XML

**示例**：
```
reports/coverage/
  2025-11-06-coverage.html      # 可视化报告
  2025-11-06-coverage.json      # 机器可读
  summary.md                    # 覆盖率趋势汇总
```

**summary.md 示例**：
```markdown
# 覆盖率趋势

| 日期 | 语句覆盖率 | 分支覆盖率 | 函数覆盖率 | 行覆盖率 |
|------|---------|---------|---------|---------|
| 2025-11-06 | 85% | 78% | 90% | 84% |
| 2025-11-05 | 83% | 76% | 88% | 82% |
```

---

#### 3.2 reports/performance/ — 性能测试报告

**格式**：k6 HTML 报告、JMeter JTL 文件

**示例**：
```
reports/performance/
  2025-11-06-load-test.html     # k6 报告
  2025-11-06-stress-test.html
  performance-baseline.json     # 基线数据
```

---

#### 3.3 reports/security/ — 安全扫描报告

**格式**：OWASP ZAP JSON、Trivy JSON

**示例**：
```
reports/security/
  2025-11-06-zap-scan.json      # ZAP 扫描结果
  2025-11-06-dependency-scan.json  # 依赖漏洞扫描
  security-summary.md           # 风险汇总
```

**创建时机**：
- 每次测试轮次完成后生成
- 用于模块内快速查看，不替代全局报告（`/docs/data/qa-reports/`）

---

### 4. automation/ — 自动化测试脚本（可选）

**用途**：存放该模块的自动化测试脚本（不同于 `/tests/`，此处为模块特定脚本）

#### 4.1 automation/e2e/ — E2E 测试脚本

**示例**：
```javascript
// automation/e2e/user-login-flow.spec.js
const { test, expect } = require('@playwright/test');

test('US-USER-003: 用户登录完整流程', async ({ page }) => {
  await page.goto('/login');
  await page.fill('#email', 'test@example.com');
  await page.fill('#password', 'Test@1234');
  await page.click('#login-btn');
  await expect(page).toHaveURL('/dashboard');
});
```

**创建时机**：
- E2E 测试需要模块特定脚本时（与项目根目录 `/tests/e2e/` 互补）

---

#### 4.2 automation/performance/ — 性能测试脚本

**示例**：
```javascript
// automation/performance/load-test.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 },
    { duration: '5m', target: 100 },
    { duration: '2m', target: 0 },
  ],
};

export default function () {
  let res = http.get('https://example.com/api/users');
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
```

---

### 5. defect-attachments/ — 缺陷附件（可选）

**用途**：存储缺陷复现证据（截图、日志、录屏）

**目录结构**：
```
defect-attachments/
  screenshots/
    BUG-USER-001-login-error.png
    BUG-USER-002-blank-page.png
  logs/
    BUG-USER-001-console.log
    BUG-USER-003-network.har
  recordings/
    BUG-USER-004-crash.webm
```

**命名规范**：
- 文件名前缀：缺陷 ID（`BUG-{MODULE}-NNN`）
- 描述性后缀：问题简述（`login-error`、`blank-page`）

**创建时机**：
- 缺陷提交时附加证据
- 需要视觉化说明复现步骤时

---

## 🔗 与全局数据的协作关系

### 全局数据目录（`/docs/data/`）

| 文件 | 范围 | 包含内容 |
|------|------|---------|
| `traceability-matrix.md` | 全局 | 所有模块的 Story → AC → Test ID 映射 |
| `qa-reports/` | 全局 | 汇总的测试报告（所有模块） |

### 协作规则

1. **追溯矩阵**：
   - 模块 QA 定义测试用例（TC-{MODULE}-NNN）
   - `/docs/data/traceability-matrix.md` 集中维护 Story → AC → TC 映射
   - 测试执行时，QA 专家更新全局追溯矩阵的测试状态（Pass/Fail）

2. **测试报告**：
   - 模块报告：在 `{domain}/reports/` 存储（便于模块团队快速查看）
   - 全局报告：在 `/docs/data/qa-reports/` 汇总（用于发布决策）
   - **规则**：模块报告是全局报告的数据源，定期同步

3. **缺陷追踪**：
   - 模块 QA 记录缺陷（BUG-{MODULE}-NNN）
   - 主 QA 文档（`/docs/QA.md`）汇总 P0/P1 阻塞性缺陷
   - 缺陷附件存储在模块目录（`{domain}/defect-attachments/`）

4. **测试数据**：
   - 模块测试数据：在 `{domain}/test-data/` 管理（模块特定）
   - 共享测试数据：在 `/tests/fixtures/` 管理（跨模块共享）
   - **规则**：优先使用共享数据，模块特定数据放在模块目录

---

## 📝 文件创建时机

### 初始阶段（QA 拆分时）
- ✅ **必创建**：`{domain}/QA.md`
- ✅ **必创建**：在 `qa-modules/README.md` 添加模块索引条目

### 测试准备阶段
- ⚠️ **推荐创建**：`{domain}/test-data/fixtures/`（有静态测试数据时）
- ⚠️ **推荐创建**：`{domain}/test-data/cleanup.md`（定义数据清理策略）
- 📝 **可选创建**：`{domain}/automation/`（需要模块特定自动化脚本时）

### 测试执行阶段
- ⚠️ **推荐创建**：`{domain}/reports/coverage/`（每次测试后生成）
- ⚠️ **推荐创建**：`{domain}/defect-attachments/screenshots/`（提交缺陷时）
- 📝 **可选创建**：`{domain}/reports/performance/`（有性能测试时）
- 📝 **可选创建**：`{domain}/reports/security/`（有安全测试时）

### 持续维护
- 🔄 **实时更新**：模块 QA.md（新增/更新测试用例、缺陷状态）
- 🔄 **定期更新**：测试报告（每次测试轮次后）
- 🔄 **动态更新**：追溯矩阵（测试执行后更新状态）
- 🔄 **按需更新**：测试数据（新增边界用例、性能测试数据）

---

## 🛠️ 自动化脚本支持

项目已提供以下脚本扫描 QA 模块目录：

### 1. QA 文档完整性检查
```bash
npm run qa:lint
```
**检查内容**：
- 主 QA 必需章节
- 模块 QA 结构规范
- Test Case ID 格式（TC-MODULE-NNN）
- 缺陷 ID 格式（BUG-MODULE-NNN）
- Given-When-Then 格式

### 2. 覆盖率分析
```bash
npm run qa:coverage-report -- --module={domain}
```
**检查内容**：
- 解析 `traceability-matrix.md`
- 统计每个模块的 Story 覆盖率（已测试 / 总 Story）
- 识别未覆盖的 Story（Missing Test Cases）
- 生成覆盖率报告（`/docs/data/qa-reports/coverage-summary.md`）

### 3. PRD ↔ QA 同步检查
```bash
npm run qa:sync-prd-qa-ids
```
**检查内容**：
- 验证 QA 文档中引用的 Story ID 是否存在于 PRD 模块
- 验证 PRD 中的 Story 是否都有对应测试用例
- 检测孤立测试用例（关联不存在的 Story ID）

### 4. 缺陷阻塞检查
```bash
npm run qa:check-defect-blockers
```
**检查内容**：
- 扫描所有模块 QA 的缺陷列表
- 识别 P0/P1 未关闭缺陷
- 生成发布 Gate 报告（阻塞性问题列表）

### 5. 测试数据清理
```bash
npm run qa:cleanup-test-data -- --module={domain}
```
**执行操作**：
- 根据 `test-data/cleanup.md` 策略清理测试数据
- 删除 `test-*` 前缀的数据库记录
- 归档旧的缺陷附件（> 30 天）

---

## ❓ 常见问题

### Q1: 小型模块（< 20 测试用例）需要创建所有目录吗？
**A**: 不需要。仅创建 `QA.md`，其他目录按需创建：
- 无静态测试数据 → 不创建 `test-data/fixtures/`
- 测试简单 → 不创建 `automation/`
- 无复杂缺陷 → 不创建 `defect-attachments/`

### Q2: 模块报告和全局报告的同步策略？
**A**:
1. 模块报告（`{domain}/reports/`）：实时生成，便于模块团队查看
2. 全局报告（`/docs/data/qa-reports/`）：定期汇总（如每日 CI 聚合），用于发布决策
3. **工具支持**：`npm run qa:aggregate-reports` 自动汇总所有模块报告到全局目录

### Q3: 测试数据如何管理避免数据污染？
**A**:
1. 使用统一前缀（`test-*`、`perf-*`）标识测试数据
2. 在 `test-data/cleanup.md` 定义清理策略
3. 测试结束后运行 `npm run qa:cleanup-test-data`
4. 生产环境禁止使用测试数据（通过环境变量隔离）

### Q4: 模块 QA 与主 QA 的职责边界？
**A**:
- **主 QA**（`/docs/QA.md`）：
  - 全局测试策略（测试方法论、工具链）
  - 模块测试索引（哪些模块、负责人）
  - 跨模块集成测试
  - 全局 P0/P1 缺陷汇总
  - 发布建议（是否通过验收）
- **模块 QA**（`{domain}/QA.md`）：
  - 模块内测试用例（功能/集成/E2E/性能/安全）
  - 模块内缺陷列表
  - 模块测试执行记录
  - 模块测试指标（覆盖率、通过率）
- **规则**：模块 QA 是数据源，主 QA 汇总和决策

### Q5: 如何处理跨模块的集成测试？
**A**:
1. **测试用例位置**：定义在主 QA 文档（`/docs/QA.md`）的"跨模块集成测试"章节
2. **Test Case ID 格式**：`TC-INTEGRATION-NNN`（不归属单一模块）
3. **关联 Story**：关联多个 Story ID（如 `US-USER-003 + US-PAY-001`）
4. **执行记录**：记录在主 QA 的执行记录中，不重复记录到模块 QA

---

## 📚 相关资源

- [QA-TESTING-EXPERT.playbook.md](../../AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md) — 详细操作手册
- [CONVENTIONS.md](../CONVENTIONS.md) — 项目目录规范
- [MODULE-TEMPLATE.md](MODULE-TEMPLATE.md) — 模块 QA 模板
- [traceability-matrix.md](../data/traceability-matrix.md) — 全局追溯矩阵
- [qa-reports/README.md](../data/qa-reports/README.md) — 全局测试报告说明

---

> 本指南随项目实践持续更新。如有疑问，请在团队会议中提出或联系 QA 专家。
