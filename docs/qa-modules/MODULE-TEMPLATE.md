# {功能域名称} - 测试计划

> **所属主 QA**: [QA.md](../QA.md)
> **负责团队**: @team-name
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
- **模块 ARCH**: [architecture-modules/{domain}.md](../architecture-modules/{domain}.md)
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

```gherkin
Given 数据库可用
  And 用户已登录
When 用户执行 [操作]
Then 系统应该 [预期结果]
  And 日志应该记录 [操作记录]
```

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
```json
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
```

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
```javascript
// tests/regression/{module}.config.js
module.exports = {
  suites: {
    p0: ['TC-REG-{MODULE}-001', 'TC-REG-{MODULE}-005'],
    p1: ['TC-REG-{MODULE}-002', 'TC-REG-{MODULE}-006'],
  }
};
```

---

### 3.5 契约测试用例（仅微服务架构）

| 用例 ID | 接口 | Provider | Consumer | 契约版本 | 工具 | 状态 | 最后验证 |
|---------|------|----------|----------|---------|------|------|---------|
| TC-CONTRACT-{MODULE}-001 | POST /api/{module}/action | {MODULE} 服务 | Web 前端 | v1.2.0 | Pact | ✅ 通过 | 2025-11-05 |
| TC-CONTRACT-{MODULE}-002 | GET /api/{module}/data | {MODULE} 服务 | 其他服务 | v1.1.0 | Pact | ✅ 通过 | 2025-11-05 |

**契约定义示例**（TC-CONTRACT-{MODULE}-001）：

```javascript
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
```

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
```typescript
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
```

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
```javascript
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
```

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
```bash
zap-cli quick-scan --self-contained --spider \
  -r security-report.html \
  https://api.example.com/login
```

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
```
Error: [错误信息]
  at [文件路径]:[行号]
  Stack trace: ...
```

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

```
测试通过率趋势（近 7 天）
100%|                    ╭─
 90%|              ╭─────╯
 80%|        ╭─────╯
 70%|  ╭─────╯
 60%|──╯
    └──────────────────────
     Day1 Day3 Day5 Day7
```

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
```javascript
// tests/fixtures/{module}/users.json
[
  {
    "id": "usr_test_001",
    "email": "test1@example.com",
    "password": "hashed_password",
    "role": "user"
  }
]
```

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
- **模块 ARCH**: [architecture-modules/{domain}.md](../architecture-modules/{domain}.md)
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
