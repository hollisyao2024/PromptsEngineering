# 模块 QA 文档模板

> 本文档整合了模块目录约定、模板结构、协作规范等要素，是模块化需求治理的唯一权威参考。
>
> **提醒**：QA 专家在评估拆分前，请先梳理本文件的目录与模板规范；拆分后各模块的 `/docs/qa-modules/{domain}/QA.md` 均按此模板生成，并在开头引用主 `/docs/QA.md`，确保模块文档与主文档保持追溯与协同。

**维护者**：QA 专家
**创建日期**：2025-11-05
**最后更新**：2025-11-06
**模板版本**：v1.0（QA 模块化拆分，如有变更请更新此字段）
**功能域**：{domain}（复制模板时替换为具体模块名称以保持一致）

---

## 1. 目录与命名规范

### 1.1 模块目录结构
每个功能域模块在 `/docs/qa-modules/{domain}/` 目录下维护以下文件和子目录：

```
/docs/
└── qa-modules/
    ├── MODULE-TEMPLATE.md # 本模板（权威）
    ├── module-list.md # 模板清单（由 QA 专家根据本文件 §3 模块清单模板 生成）
    └── {domain}/
        ├── QA.md （模块 QA 文档）
        ├── priority-matrix.md （模块级测试优先级矩阵）
        ├── nfr-tracking.md （模块 NFR 追踪表）
        ├── defect-log.md （模块缺陷日志）
        └── test-data/                   # 测试数据管理（推荐）
          ├── fixtures/                  # 静态测试数据
          ├── generators/                # 数据生成脚本
          └── cleanup.md                 # 数据清理策略
        └── reports/                     # 本地测试报告（推荐）
          ├── coverage/                  # 覆盖率报告
          ├── performance/               # 性能测试报告
          └── security/                  # 安全扫描报告
        └── automation/                  # 自动化测试脚本（可选）
          ├── e2e/                       # E2E 测试脚本
          ├── integration/               # 集成测试脚本
          └── performance/               # 性能测试脚本
        └── defect-attachments/          # 缺陷附件（可选）
          ├── screenshots/               # 截图
          ├── logs/                      # 日志文件
          └── recordings/                # 屏幕录制

```
#### QA.md
- 模块 QA 文档，包含了模块的测试计划。

#### priority-matrix.md
- 模块级测试优先级矩阵，按 Story/TC 的风险、影响、资源与依赖打分，输出综合优先级（P0~P3）与调整建议。
- 结构通常包含 Story/TC ID、风险等级、自动化覆盖、依赖冲突、建议轮次，并附带当前状态与执行人。参考 `docs/qa-modules/PRIORITY-MATRIX-TEMPALTE.md`，或由大模型根据该模板生成最终 `priority-matrix.md`，再在 `/qa plan` 中补入最新 Story/Task 状态。
- QA 在测试计划开始时初始化该表，`/qa plan` 可参考 `/docs/data/test-priority-matrix.md` 的评分维度，每轮执行后刷新实际执行顺序与异常说明。
- 若资源紧张或优先级发生冲突，标注“复核人”“调整理由”并同步至 ARCH/TASK 以便决策。

#### nfr-tracking.md
- 记录模块 NFR（性能、安全、可靠性、容量、可观测性等）的目标 vs 实际值、验证轮次、状态与证据链接。模板详见 `docs/qa-modules/NFR-TRACKING-TEMPLATE.md`，QA 或大模型可据此生成 `nfr-tracking.md`，并参照 ARCH/TASK 中确认的 NFR 目标逐项填充。
- 状态可采用 `✅ 达标`、`⚠️ 需观察`、`🔄 优化中`、`❌ 未达标`，每条记录需附带验证环境与负责人。
- QA 在执行测试后更新该表，未达标项需填写缓解措施与回归计划，并与 ARCH/TASK 同步影响/上线前检查。
- 建议参照 `/docs/prd-modules/NFR-TRACKING-TEMPLATE.md` 的字段命名，但以“验证结果”与“证据”为核心，形成需求→验证→发布的闭环。

#### defect-log.md
- 模块缺陷日志，使用 `docs/qa-modules/DEFECT-LOG-TEMPLATE.md` 或让大模型参照该模板生成 `defect-log.md`，再由 QA 补入具体缺陷/验证信息。
- 追踪当前验证状态（Pending/Fixed/Verified）、回归计划、验证人、CI 结果与冒烟结论，确保缺陷闭环可审计。
- 可附带“阻塞等级”“回流责任人”“审查备注”列，必要时引用外部缺陷 ID（如 Jira）。
- QA 与 TDD 协同更新，修复后 QA 在该表中补写验证结果/签字，并同步至主 QA 与 `module-list`。

#### 测试数据 / 报告 / 附件
- **test-data/**：存放模块级的测试数据资产，`fixtures/` 保存固定场景数据，`generators/` 管理性能/压力数据脚本，`cleanup.md` 记录每轮测试后的清理策略，确保环境可复现且不污染。
- **reports/**：保存覆盖率、性能、安全等本地报告（HTML/JSON/summary），方便 QA 审查、分享和汇总进入全局 `docs/data/qa-reports/`。
- **automation/**：可选的自动化脚本目录（`e2e/`、`integration/`、`performance/`），鼓励模块自动化与手工测试用例并行，便于将测试行为映射到 CI 工具链。
- **defect-attachments/**：按缺陷编号组织截图、日志、录像等附件，帮助复现、验证和归档阻塞/高优先级缺陷。
- 以上提到的 4 个文件目录的详细情况参考本文件 § 文件用途说明。

#### 文件创建时机

##### 初始阶段
- ✅ **必创建**：`{domain}/QA.md` (模块 QA 文档)
- ✅ **必创建**：在 `qa-modules/module-list.md` 添加模块清单索引条目

##### 测试准备阶段
- ⚠️ **推荐创建**：`{domain}/test-data/fixtures/`（有静态测试数据时）
- ⚠️ **推荐创建**：`{domain}/test-data/cleanup.md`（定义数据清理策略）
- 📝 **可选创建**：`{domain}/automation/`（需要模块特定自动化脚本时）

##### 测试执行阶段
- ⚠️ **推荐创建**：`{domain}/reports/coverage/`（每次测试后生成）
- ⚠️ **推荐创建**：`{domain}/defect-attachments/screenshots/`（提交缺陷时）
- 📝 **可选创建**：`{domain}/reports/performance/`（有性能测试时）
- 📝 **可选创建**：`{domain}/reports/security/`（有安全测试时）

##### 持续维护
- 🔄 **实时更新**：模块 QA.md（新增/更新测试用例、缺陷状态）
- 🔄 **定期更新**：测试报告（每次测试轮次后）
- 🔄 **动态更新**：追溯矩阵（测试执行后更新状态）
- 🔄 **按需更新**：测试数据（新增边界用例、性能测试数据）

### 1.2 命名与 ID

#### 模块文件命名
- **格式**：`{domain}/QA.md`（使用 kebab-case）
- **示例**：
  - `user-management/QA.md` — 用户管理功能测试计划
  - `payment-system/QA.md` — 支付系统测试计划
  - `notification-service/QA.md` — 通知服务测试计划
  - `performance-testing/QA.md` — 性能测试计划（跨模块）
  - `security-testing/QA.md` — 安全测试计划（跨模块）

#### 测试用例 ID 规范
- **格式**：`TC-{MODULE}-{序号}`
- **示例**：
  - `TC-REG-001` — 用户注册功能测试
  - `TC-PAY-012` — 支付确认功能测试
  - `TC-NOTIF-008` — 邮件通知测试
  - `TC-PERF-001` — 首页加载性能测试
  - `TC-SEC-005` — SQL 注入安全测试

#### 缺陷 ID 规范
- **格式**：`BUG-{MODULE}-{序号}` 或对接外部缺陷管理系统（如 Jira）
- **示例**：
  - `BUG-USER-001` — 用户注册邮箱验证失败
  - `BUG-PAY-003` — 支付超时未回调
  - `JIRA-PRJ-1234` — 外部缺陷系统引用


#### 状态与优先级
- ✅ 已通过：所有测试用例通过，无阻塞缺陷
- 🔄 测试中：正在执行测试
- 📝 待启动：测试计划已完成，等待执行
- ⚠️ 有风险：存在 P0/P1 缺陷，需关注
- ❌ 未通过：存在阻塞缺陷，不可发布

---

## 2. 模块清单模板

| 模块名称 | 文件路径 | 测试负责人 | 对应 PRD 模块 | 对应 ARCH 模块 | 对应 TASK 模块 | 状态 | 最后更新 |
|---------|---------|-----------|--------------|---------------|---------------|------|---------|
| （示例）用户管理 | [user-management/QA.md](user-management/QA.md) | @qa-tester-1 | [prd-modules/user-management/PRD.md](../prd-modules/user-management/PRD.md) | [arch-modules/user-management/ARCH.md](../arch-modules/user-management/ARCH.md) | [task-modules/user-management/TASK.md](../task-modules/user-management/TASK.md) | ✅ 已通过 | 2025-11-05 |
| （示例）支付系统 | [payment-system/QA.md](payment-system/QA.md) | @qa-tester-2 | [prd-modules/payment-system/PRD.md](../prd-modules/payment-system/PRD.md) | [arch-modules/payment-system/ARCH.md](../arch-modules/payment-system/ARCH.md) | [task-modules/payment-system/TASK.md](../task-modules/payment-system/TASK.md) | 🔄 测试中 | 2025-11-05 |
| （示例）性能测试 | [performance-testing/QA.md](performance-testing/QA.md) | @qa-perf-lead | - | - | - | 📝 待启动 | 2025-11-05 |
| （待补充） | - | - | - | - | - | - | - |

该表格仅作为模板，实际模块清单信息由 QA 专家根据以上表格生成到`module-list.md`，每次 QA 模块变化都更新`module-list.md`。

---

## 3. 标准模块 QA 文档结构

- `{domain}/QA.md` 根据模板创建，模板见本文件 § Appendix A: 模块 QA 文档模板。
- 每次更新需记录 `最后更新` 时间戳

## 4. 跨模块协作规范

### 与 PRD 专家协作
- **输入**：读取 `/docs/prd-modules/{domain}/PRD.md` 对应的 PRD 模块
- **追溯**：基于追溯矩阵（`/docs/data/traceability-matrix.md`），确保所有 Story/AC 都有对应测试用例
- **验收标准**：严格按照 PRD 中的 Given-When-Then 验收标准执行测试

### 与 ARCH 专家协作
- **输入**：读取 `/docs/arch-modules/{domain}/ARCH.md` 对应的架构模块
- **接口测试**：基于架构文档的接口定义，编写契约测试
- **非功能需求**：基于架构文档的 NFR（性能/安全/可用性）制定测试策略

### 与 TASK 专家协作
- **输入**：读取 `/docs/task-modules/{domain}/TASK.md` 对应的任务模块
- **测试顺序**：根据任务完成顺序，逐步执行测试
- **阻塞反馈**：若测试发现阻塞缺陷，及时通知 TASK 专家调整计划

### 与 TDD 专家协作
- **缺陷反馈**：通过缺陷清单（或外部缺陷系统）反馈给 TDD 专家
- **重新测试**：TDD 专家修复缺陷后，QA 专家执行回归测试
- **CI 集成**：QA 专家将自动化测试集成到 CI 流水线，提前发现问题

---

## 5. 模块化工作流

1. **创建主 QA 文档**：在 `/docs/QA.md` 维护总纲与模块索引（< 500 行）
2. **创建模块目录**：按照下方“QA 模块结构与模板”中描述的目录结构创建模块目录
   ```bash
   mkdir -p qa-modules/{domain}/{test-data/fixtures,reports/coverage,automation,defect-attachments}
   ```
3. **创建模块 QA 文档**：基于下方“模块 QA 模板”章节复制内容到 `{domain}/QA.md`
4. **更新模块索引**：在本文件的"模块清单"表格中注册新模块
5. **制定测试用例**：基于 PRD/ARCH/TASK 模块，编写详细测试用例
6. **执行与记录**：执行测试并实时更新测试结果与缺陷清单
7. **运行质量检查**：使用 `npm run qa:lint` 检查文档完整性
8. **生成测试报告**：使用 `npm run qa:generate-test-report` 汇总结果
9. **发布决策**：使用 `npm run qa:check-defect-blockers` 执行发布门禁检查

---

## 6. 自动化工具链

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



---

## 7. 文件用途说明

### 1. test-data/ — 测试数据管理（推荐）

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

### 2. reports/ — 本地测试报告（推荐）

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

### 3. automation/ — 自动化测试脚本（可选）

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

### 4. defect-attachments/ — 缺陷附件（可选）

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

## 8. 与全局数据的协作关系

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



---

## 9. 自动化脚本支持

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

## 10. 常见问题

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


## Appendix A: 模块 QA 文档模板
> 以下内容不允许 QA 专家自动修改，只能由人工修改。

```markdown
# {功能域名称} - 测试计划

> **所属主 QA**: [QA.md](../QA.md)
> **关联 PRD 模块**: [prd-modules/{domain}/PRD.md](../prd-modules/{domain}/PRD.md)
> **关联 ARCH 模块**: [arch-modules/{domain}/ARCH.md](../arch-modules/{domain}/ARCH.md)
> **关联 TASK 模块**: [task-modules/{domain}/TASK.md](../task-modules/{domain}/TASK.md)
> **状态**: 📝 待启动 / 🔄 测试中 / ✅ 已确认 / ⚠️ 有风险 / ❌ 未通过
> **负责团队**: @qa-team-name
> **最后更新**: YYYY-MM-DD
> **版本**: v0.1.0
---

## 1. 模块概述

**测试范围**：
[描述功能模块的测试范围，包含的用户故事、验收标准]

**负责人**：@qa-tester-1

**依赖模块**：
- [模块名称 A]：依赖 [具体接口/功能]
- [模块名称 B]：依赖 [具体接口/功能]

**测试关键指标**：
- 测试用例总数：XX 条
- 测试通过率目标：≥ 95%
- 缺陷密度目标：< 1 个/KLOC
- 需求覆盖率目标：100%
- 自动化覆盖率目标：≥ 80%

**关联文档**：
- **模块 PRD**: [prd-modules/{domain}.md](../prd-modules/{domain}.md)
- **模块 ARCH**: [arch-modules/{domain}.md](../arch-modules/{domain}.md)
- **模块 TASK**: [task-modules/{domain}.md](../task-modules/{domain}.md)

---

## 2. 测试策略

### 2.1 测试类型覆盖

| 测试类型 | 优先级 | 覆盖目标 | 自动化要求 |
|---------|--------|---------|-----------|
| **功能测试** | P0/P1 | 100% Story 覆盖 | ≥ 80% |
| **集成测试** | P0/P1 | 所有模块内集成点 | ≥ 70% |
| **E2E 测试** | P0 | 核心用户旅程 | ≥ 90% |
| **回归测试** | P0/P1 | 核心功能 | 100% |
| **契约测试** | P0 | 对外接口 | 100% |
| **降级策略测试** | P1 | 所有降级策略 | ≥ 80% |
| **事件驱动测试** | P1 | 所有事件 | ≥ 80% |
| **性能测试** | P1 | 关键接口 | 100% |
| **安全测试** | P0 | OWASP Top 10 | 100% |

### 2.2 测试优先级定义

- **P0（阻塞）**：核心功能，必须通过才能发布
- **P1（严重）**：重要功能，发布前必须修复
- **P2（一般）**：增值功能，可延迟修复
- **P3（建议）**：优化项，不阻塞发布

### 2.3 测试环境

| 环境 | URL | 用途 | 数据库 |
|------|-----|------|--------|
| Dev | http://dev.example.com | 开发测试 | dev_db |
| Staging | https://staging.example.com | 集成测试 | staging_db |
| Production | https://www.example.com | 生产验证 | prod_db |

### 2.4 测试工具链

- **功能测试自动化**: Playwright / Cypress
- **API 测试**: Postman / REST Client
- **单元测试**: Jest / Vitest
- **性能测试**: k6 / JMeter / Lighthouse
- **安全测试**: OWASP ZAP / Burp Suite
- **契约测试**: Pact / Spring Cloud Contract
- **代码覆盖率**: NYC / Istanbul

---

## 3. 测试用例

### 3.1 功能测试用例

#### 3.1.1 Story: US-{MODULE}-001 - [用户故事标题]

| 用例 ID | 用例名称 | 优先级 | AC 引用 | 前置条件 | 状态 | 执行人 | 执行日期 |
|---------|---------|--------|---------|---------|------|--------|---------|
| TC-{MODULE}-001 | [用例名称] | P0 | AC-{MODULE}-001-01 | [前置条件] | ✅ 通过 | @qa-tester-1 | 2025-11-05 |
| TC-{MODULE}-002 | [用例名称] | P1 | AC-{MODULE}-001-02 | [前置条件] | ❌ 失败 | @qa-tester-1 | 2025-11-05 |
| TC-{MODULE}-003 | [用例名称] | P2 | AC-{MODULE}-001-03 | [前置条件] | 🔄 测试中 | @qa-tester-2 | - |

**详细测试步骤示例**（TC-{MODULE}-001）：

\`\`\`gherkin
Given 数据库可用
  And 用户已登录
When 用户执行 [操作]
Then 系统应该 [预期结果]
  And 日志应该记录 [操作记录]
\`\`\`

**测试步骤**：
1. [步骤一 - 准备测试数据]
2. [步骤二 - 执行操作]
3. [步骤三 - 验证结果]
4. [步骤四 - 清理测试数据]

**预期结果**：
- [期望的正确行为]
- [系统状态变化]
- [数据库变更]

**测试数据**：
\`\`\`json
{
  "input": {
    "field1": "value1",
    "field2": "value2"
  },
  "expected_output": {
    "status": "success",
    "data": {}
  }
}
\`\`\`

#### 3.1.2 Story: US-{MODULE}-002 - [用户故事标题]

[继续添加其他 Story 的测试用例...]

---

### 3.2 集成测试用例（模块内）

| 用例 ID | 用例名称 | 集成点 | 优先级 | 前置条件 | 状态 | 执行人 | 执行日期 |
|---------|---------|--------|--------|---------|------|--------|---------|
| TC-{MODULE}-INT-001 | [用例名称] | 组件 A ↔ 组件 B | P0 | [前置条件] | ✅ 通过 | @qa-tester-1 | 2025-11-05 |
| TC-{MODULE}-INT-002 | [用例名称] | 组件 B ↔ 组件 C | P1 | [前置条件] | 🔄 测试中 | @qa-tester-1 | - |

**详细测试步骤示例**（TC-{MODULE}-INT-001）：

**集成场景**：组件 A 调用组件 B 的接口

**测试步骤**：
1. 启动组件 A 和组件 B
2. 组件 A 发送请求到组件 B
3. 验证组件 B 响应正确
4. 验证数据流正确传递

**预期结果**：
- 接口调用成功
- 数据正确传递
- 无异常日志

---

### 3.3 E2E 测试用例（跨模块）

| 用例 ID | E2E 场景 | 涉及模块 | 优先级 | 工具 | 状态 | 执行人 | 执行日期 |
|---------|---------|---------|--------|------|------|--------|---------|
| TC-E2E-{MODULE}-001 | [完整用户旅程] | {MODULE} + {OTHER_MODULE} | P0 | Playwright | ✅ 通过 | @qa-tester-2 | 2025-11-05 |

**详细测试步骤示例**（TC-E2E-{MODULE}-001）：

**场景**：用户从注册到完成第一笔交易的完整流程

**测试步骤**：
1. 用户注册（{MODULE}）
2. 用户登录（{MODULE}）
3. 用户浏览商品（商品模块）
4. 用户下单（订单模块）
5. 用户支付（支付模块）
6. 用户查看订单状态（订单模块）

**预期结果**：
- 整个流程无中断
- 数据跨模块正确传递
- 用户体验流畅

**自动化脚本**：`tests/e2e/{module}/user-journey.spec.ts`

---

### 3.4 回归测试用例

| 用例 ID | 回归场景 | 优先级 | 执行频率 | 自动化 | 状态 | 最后执行 |
|---------|---------|--------|---------|--------|------|---------|
| TC-REG-{MODULE}-001 | [核心功能名称] | P0 | 每次提交 | ✅ Playwright | ✅ 通过 | 2025-11-06 |
| TC-REG-{MODULE}-002 | [重要功能名称] | P1 | 每周 | ✅ Playwright | ✅ 通过 | 2025-11-05 |
| TC-REG-{MODULE}-003 | [增值功能名称] | P2 | 每月 | ⏸️ 手动 | ✅ 通过 | 2025-11-01 |

**回归测试套件配置**：
\`\`\`javascript
// tests/regression/{module}.config.js
module.exports = {
  suites: {
    p0: ['TC-REG-{MODULE}-001', 'TC-REG-{MODULE}-005'],
    p1: ['TC-REG-{MODULE}-002', 'TC-REG-{MODULE}-006'],
  }
};
\`\`\`

---

### 3.5 契约测试用例（仅微服务架构）

| 用例 ID | 接口 | Provider | Consumer | 契约版本 | 工具 | 状态 | 最后验证 |
|---------|------|----------|----------|---------|------|------|---------|
| TC-CONTRACT-{MODULE}-001 | POST /api/{module}/action | {MODULE} 服务 | Web 前端 | v1.2.0 | Pact | ✅ 通过 | 2025-11-05 |
| TC-CONTRACT-{MODULE}-002 | GET /api/{module}/data | {MODULE} 服务 | 其他服务 | v1.1.0 | Pact | ✅ 通过 | 2025-11-05 |

**契约定义示例**（TC-CONTRACT-{MODULE}-001）：

\`\`\`javascript
// tests/contract/provider.spec.js
describe('POST /api/{module}/action', () => {
  it('returns 201 with expected response', async () => {
    await provider.addInteraction({
      state: 'database is available',
      uponReceiving: 'a request to perform action',
      withRequest: {
        method: 'POST',
        path: '/api/{module}/action',
        headers: { 'Content-Type': 'application/json' },
        body: {
          field1: 'value1',
          field2: 'value2',
        },
      },
      willRespondWith: {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
        body: {
          code: 0,
          message: 'Success',
          data: {
            id: Matchers.string('abc123'),
            status: 'completed',
          },
        },
      },
    });
  });
});
\`\`\`

---

### 3.6 降级策略测试

| 用例 ID | 降级场景 | 降级策略（PRD 引用） | 验证内容 | 工具 | 状态 | 最后验证 |
|---------|---------|---------------------|---------|------|------|---------|
| TC-DEGRADE-{MODULE}-001 | [依赖服务不可用] | 异步重试队列（3 次） | 主流程不阻塞、错误记录日志 | 手动故障注入 | ✅ 通过 | 2025-11-05 |
| TC-DEGRADE-{MODULE}-002 | [服务超时] | 超时后跳过，默认值 | 超时逻辑生效、监控告警 | 模拟延迟响应 | ✅ 通过 | 2025-11-05 |

**详细测试步骤示例**（TC-DEGRADE-{MODULE}-001）：

**降级场景**：邮件服务不可用

**降级策略**：异步重试队列（3 次，间隔 5/10/30 分钟）

**测试步骤**：
1. 关闭邮件服务（`docker stop email-service`）
2. 触发需要发送邮件的操作
3. 验证主流程不阻塞（操作成功完成）
4. 验证错误日志记录（`logger.error('邮件发送失败', error)`）
5. 验证重试队列已添加任务（Redis 查询 `retryQueue`）
6. 等待 5 分钟，验证第 1 次重试
7. 等待 10 分钟，验证第 2 次重试
8. 等待 30 分钟，验证第 3 次重试
9. 验证监控告警触发

**预期结果**：
- ✅ 主流程正常完成
- ✅ 错误日志记录成功
- ✅ 重试队列工作正常
- ✅ 监控告警触发

---

### 3.7 事件驱动测试

| 用例 ID | 事件名称 | 验证内容 | 工具 | 状态 | 最后验证 |
|---------|---------|---------|------|------|---------|
| TC-EVENT-{MODULE}-001 | {Event}Published | Schema 验证、幂等性、重试机制 | Kafka 监控 | ✅ 通过 | 2025-11-05 |

**详细测试步骤示例**（TC-EVENT-{MODULE}-001）：

**事件名称**：UserRegistered

**事件 Schema**：
\`\`\`typescript
interface UserRegisteredEvent {
  eventId: string;           // 唯一标识（UUID）
  eventName: "UserRegistered";
  timestamp: string;         // ISO 8601 格式
  version: "1.0";
  data: {
    userId: string;
    email: string;
    source: "web" | "mobile" | "api";
  };
}
\`\`\`

**测试步骤**：
1. 发布事件 `UserRegistered`（eventId: "evt_12345"）
2. 验证订阅方接收事件
3. 验证事件 Schema 正确（字段类型、必填项）
4. 重复发布相同事件（eventId: "evt_12345"）
5. 验证幂等性（订阅方不重复处理）
6. 查询 Redis 去重记录（key: `processed_events:evt_12345`）
7. 模拟订阅方失败，验证重试机制（3 次）

**预期结果**：
- ✅ 事件发布成功
- ✅ Schema 验证通过
- ✅ 幂等性保障（重复事件不影响结果）
- ✅ 重试机制正常工作

---

### 3.8 性能测试用例

| 用例 ID | 测试场景 | 性能目标 | 测试工具 | 实际结果 | 状态 | 最后执行 |
|---------|---------|---------|---------|---------|------|---------|
| TC-PERF-{MODULE}-001 | [接口名称] P95 响应时间 | < 500ms | k6 | 450ms | ✅ 通过 | 2025-11-05 |
| TC-PERF-{MODULE}-002 | [批量操作] 吞吐量 | > 1000 QPS | JMeter | 950 QPS | ❌ 失败 | 2025-11-05 |
| TC-PERF-{MODULE}-003 | [页面加载] Lighthouse 得分 | ≥ 90 | Lighthouse | 92 | ✅ 通过 | 2025-11-05 |

**详细测试步骤示例**（TC-PERF-{MODULE}-001）：

**测试场景**：用户登录接口性能测试

**性能目标**：
- P95 响应时间 < 500ms
- P99 响应时间 < 1000ms
- 错误率 < 1%

**测试工具**：k6

**测试脚本**：
\`\`\`javascript
// tests/performance/login.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],  // 95% of requests must complete below 500ms
  },
};

export default function () {
  const res = http.post('https://api.example.com/login', {
    email: 'test@example.com',
    password: 'password123',
  });

  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
\`\`\`

**执行命令**：`k6 run tests/performance/login.js`

**结果分析**：
- P95 响应时间: 450ms ✅
- P99 响应时间: 780ms ✅
- 错误率: 0.2% ✅

---

### 3.9 安全测试用例

| 用例 ID | 安全场景 | OWASP 分类 | 工具 | 状态 | 最后验证 |
|---------|---------|-----------|------|------|---------|
| TC-SEC-{MODULE}-001 | SQL 注入防护 | A03:2021-Injection | OWASP ZAP | ✅ 通过 | 2025-11-05 |
| TC-SEC-{MODULE}-002 | XSS 防护 | A03:2021-Injection | OWASP ZAP | ✅ 通过 | 2025-11-05 |
| TC-SEC-{MODULE}-003 | 认证绕过测试 | A07:2021-Authentication Failures | Burp Suite | ✅ 通过 | 2025-11-05 |
| TC-SEC-{MODULE}-004 | CSRF 防护 | A01:2021-Broken Access Control | Postman | ✅ 通过 | 2025-11-05 |

**详细测试步骤示例**（TC-SEC-{MODULE}-001）：

**安全场景**：SQL 注入防护测试

**OWASP 分类**：A03:2021-Injection

**测试步骤**：
1. 在登录表单输入恶意 SQL：`' OR '1'='1`
2. 提交表单
3. 验证系统是否正确拒绝（返回 400 或 403）
4. 验证数据库未执行恶意 SQL
5. 验证安全日志记录攻击尝试

**预期结果**：
- ✅ 系统拒绝恶意输入
- ✅ 数据库未执行恶意 SQL
- ✅ 安全日志记录攻击

**使用 OWASP ZAP 自动扫描**：
\`\`\`bash
zap-cli quick-scan --self-contained --spider \
  -r security-report.html \
  https://api.example.com/login
\`\`\`

---

## 4. 缺陷列表

### 4.1 阻塞缺陷（P0）

#### BUG-{MODULE}-001: [缺陷标题]

**严重程度**: 阻塞（Blocker）
**优先级**: P0
**状态**: 🔄 修复中
**发现日期**: 2025-11-05
**负责人**: @dev-backend-1
**关联 Story**: US-{MODULE}-003
**关联测试用例**: TC-{MODULE}-004

**环境信息**:
- **操作系统**: macOS 13.5
- **浏览器**: Chrome 119
- **数据库版本**: PostgreSQL 15.3
- **部署环境**: Staging
- **版本**: v1.2.0

**复现步骤**:
1. [步骤一 - 准备环境]
2. [步骤二 - 执行操作]
3. [步骤三 - 观察错误]

**预期结果**: [期望的正确行为]

**实际结果**: [实际观察到的错误行为]

**错误日志**:
\`\`\`
Error: [错误信息]
  at [文件路径]:[行号]
  Stack trace: ...
\`\`\`

**截图/录屏**: [附件链接]

**影响分析**:
- **影响范围**: [影响哪些功能/模块]
- **影响用户数**: [预估受影响用户数]
- **业务影响**: [对业务的影响程度]

**建议回流阶段**: TDD（代码修复）

**修复验证计划**:
1. 开发修复后重新测试 TC-{MODULE}-004
2. 执行回归测试确认未破坏其他功能
3. 部署到 staging 验证

---

### 4.2 严重缺陷（P1）

| 缺陷 ID | 标题 | 关联 Story | 状态 | 负责人 | 发现日期 | 影响分析 |
|---------|------|-----------|------|--------|---------|---------|
| BUG-{MODULE}-002 | [缺陷标题] | US-{MODULE}-005 | 📝 待修复 | @dev-backend-2 | 2025-11-05 | [影响分析] |
| BUG-{MODULE}-003 | [缺陷标题] | US-{MODULE}-007 | 🔄 修复中 | @dev-backend-3 | 2025-11-04 | [影响分析] |

---

### 4.3 一般缺陷（P2）

| 缺陷 ID | 标题 | 关联 Story | 状态 | 负责人 | 发现日期 | 计划修复版本 |
|---------|------|-----------|------|--------|---------|-------------|
| BUG-{MODULE}-004 | [缺陷标题] | US-{MODULE}-010 | ✅ 已修复 | @dev-backend-3 | 2025-11-03 | v1.2.1 |
| BUG-{MODULE}-005 | [缺陷标题] | US-{MODULE}-012 | 📝 待修复 | @dev-frontend-1 | 2025-11-05 | v1.3.0 |

---

## 5. 测试执行记录

### 5.1 第 1 轮测试（2025-11-05）

**测试轮次**: Round 1
**测试时间**: 2025-11-05 09:00 - 18:00
**测试负责人**: @qa-tester-1

**执行统计**:
- **执行用例数**: 40 条
- **通过**: 35 条
- **失败**: 3 条
- **阻塞**: 2 条
- **通过率**: 87.5%

**每日执行日志**:

| 日期 | 执行人 | 执行用例数 | 通过 | 失败 | 阻塞 | 通过率 | 备注 |
|------|--------|-----------|------|------|------|--------|------|
| 2025-11-05 | @qa-tester-1 | 20 | 18 | 2 | 0 | 90% | 功能测试 |
| 2025-11-06 | @qa-tester-1 | 20 | 17 | 1 | 2 | 85% | 集成测试 |

**本轮发现的缺陷**:
- BUG-{MODULE}-001 (P0): [缺陷标题]
- BUG-{MODULE}-002 (P1): [缺陷标题]
- BUG-{MODULE}-003 (P2): [缺陷标题]

---

### 5.2 第 2 轮测试（2025-11-08，回归测试）

**测试轮次**: Round 2 (Regression)
**测试时间**: 2025-11-08 09:00 - 18:00
**测试负责人**: @qa-tester-1

**执行统计**:
- **执行用例数**: 40 条
- **通过**: 38 条
- **失败**: 2 条
- **阻塞**: 0 条
- **通过率**: 95%

**回归测试结果**:
- P0 回归测试通过率: 100% (15/15)
- P1 回归测试通过率: 95% (19/20)
- P2 回归测试通过率: 90% (4/5)

---

## 6. 测试指标

### 6.1 用例统计

- **总用例数**: 40 条
- **已执行**: 40 条
- **未执行**: 0 条
- **总通过率**: 95% (38/40)
- **自动化用例数**: 32 条
- **自动化覆盖率**: 80% (32/40)

### 6.2 缺陷统计

- **总缺陷数**: 5 个
- **P0（阻塞）**: 1 个（修复中）
- **P1（严重）**: 2 个（1 个待修复，1 个修复中）
- **P2（一般）**: 2 个（1 个已修复，1 个待修复）
- **缺陷密度**: 0.5 个/KLOC（千行代码）

### 6.3 需求覆盖率

- **总 Story 数**: 15 个
- **已关联测试用例**: 15 个
- **需求覆盖率**: 100% (15/15)
- **AC 覆盖率**: 100% (45/45)

### 6.4 测试类型分布

| 测试类型 | 用例数 | 通过数 | 失败数 | 通过率 | 自动化率 |
|---------|-------|-------|-------|--------|---------|
| 功能测试 | 20 | 19 | 1 | 95% | 80% |
| 集成测试 | 10 | 10 | 0 | 100% | 70% |
| E2E 测试 | 5 | 5 | 0 | 100% | 100% |
| 回归测试 | 3 | 3 | 0 | 100% | 100% |
| 性能测试 | 3 | 2 | 1 | 67% | 100% |
| 安全测试 | 4 | 4 | 0 | 100% | 100% |

### 6.5 质量趋势图

\`\`\`
测试通过率趋势（近 7 天）
100%|                    ╭─
 90%|              ╭─────╯
 80%|        ╭─────╯
 70%|  ╭─────╯
 60%|──╯
    └──────────────────────
     Day1 Day3 Day5 Day7
\`\`\`

---

## 7. 外部依赖

### 7.1 依赖服务

| 依赖服务 | 提供方 | 依赖接口/功能 | 状态 | SLA | 降级策略 |
|---------|--------|-------------|------|-----|---------|
| 通知服务 | @team-notification | POST /api/notifications/send-email | ✅ 可用 | 99.9% | 异步重试队列 |
| 支付系统 | @team-payment | POST /api/payments/create | ✅ 可用 | 99.95% | 切换备用通道 |
| 数据分析服务 | @team-analytics | POST /api/analytics/track | ✅ 可用 | 99.5% | 超时后跳过 |

### 7.2 依赖数据

**测试数据准备**:
- **Fixtures 路径**: `tests/fixtures/{module}/`
- **Seed 脚本**: `npm run seed:{module}`
- **数据清理**: `npm run cleanup:{module}`

**测试数据示例**:
\`\`\`javascript
// tests/fixtures/{module}/users.json
[
  {
    "id": "usr_test_001",
    "email": "test1@example.com",
    "password": "hashed_password",
    "role": "user"
  }
]
\`\`\`

---

## 8. 风险与缓解

| 风险 | 严重程度 | 影响 | 缓解措施 | 责任人 | 状态 |
|------|---------|------|---------|--------|------|
| 依赖服务不稳定可能导致集成测试失败 | 中 | 测试阻塞 | 使用 Mock 服务进行测试，定期验证真实服务 | @qa-tester-1 | ✅ 已实施 |
| 测试数据不完整可能导致测试覆盖不足 | 中 | 质量风险 | 建立完善的测试数据管理流程 | @qa-tester-1 | 🔄 进行中 |
| P1 缺陷未修复可能影响发布 | 高 | 延迟发布 | 提前与开发团队沟通，制定修复计划 | @qa-lead | ✅ 已处理 |
| 性能测试未达标可能影响用户体验 | 高 | 用户体验 | 性能优化，监控关键指标 | @dev-backend-lead | 🔄 进行中 |

---

## 9. 参考文档

### 9.1 关联文档
- **模块 PRD**: [prd-modules/{domain}.md](../prd-modules/{domain}.md)
- **模块 ARCH**: [arch-modules/{domain}.md](../arch-modules/{domain}.md)
- **模块 TASK**: [task-modules/{domain}.md](../task-modules/{domain}.md)
- **主 QA 文档**: [QA.md](../QA.md)
- **追溯矩阵**: [traceability-matrix.md](../data/traceability-matrix.md)

### 9.2 测试资源
- **测试代码仓库**: `tests/{module}/`
- **自动化测试报告**: [CI Report](link)
- **性能测试报告**: [Performance Report](link)
- **安全扫描报告**: [Security Report](link)
- **覆盖率报告**: [Coverage Report](link)

### 9.3 CI/CD 集成
- **CI 配置**: `.github/workflows/qa-{module}.yml`
- **测试命令**: `npm run test:{module}`
- **覆盖率命令**: `npm run coverage:{module}`
- **发布 Gate**: `npm run qa:release-gate`

---

**文档版本历史**:
- v0.1.0 (2025-11-05): 初始版本
- v0.2.0 (2025-11-08): 补充回归测试结果

```
