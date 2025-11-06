# 全局 QA 报告目录说明（/docs/data/qa-reports/）

> **用途**：存放跨模块、全局级别的测试报告与质量分析数据
> **更新日期**：2025-11-06
> **版本**：v1.0

---

## 📂 目录结构

```
/docs/data/qa-reports/
  README.md                          # 本文件：目录说明

  # 覆盖率报告
  coverage-summary.md                # 全局覆盖率汇总（所有模块）
  coverage-history.json              # 覆盖率历史趋势数据

  # 测试执行报告
  test-execution-summary.md          # 全局测试执行汇总（所有模块）
  test-execution-YYYYMMDD.json       # 每日测试执行详细数据

  # 缺陷分析报告
  defect-summary.md                  # 全局缺陷汇总（按模块/严重级别分组）
  defect-trends.json                 # 缺陷趋势数据（新增/关闭/修复时间）

  # 非功能测试报告
  performance-baseline.json          # 性能基线数据（所有模块）
  security-scan-summary.md           # 安全扫描汇总（所有模块）

  # 发布质量报告
  release-gate-YYYYMMDD.md           # 发布门禁报告（阻塞性问题列表）
  quality-dashboard.json             # 质量看板数据（实时指标）
```

---

## 🔍 全局报告 vs 模块报告

### 本目录（data/qa-reports/）存放全局/跨模块报告：

| 文件 | 范围 | 说明 |
|------|------|------|
| `coverage-summary.md` | **全局** | 所有模块的需求覆盖率汇总（Story → Test Case 覆盖率） |
| `test-execution-summary.md` | **全局** | 所有模块的测试执行结果汇总（Pass/Fail/Blocked 统计） |
| `defect-summary.md` | **全局** | 所有模块的缺陷汇总（按严重级别、模块、状态分组） |
| `performance-baseline.json` | **全局** | 各模块性能基线数据（响应时间、吞吐量等） |
| `security-scan-summary.md` | **全局** | 各模块安全扫描结果汇总（漏洞等级、CVE 编号） |
| `release-gate-YYYYMMDD.md` | **全局** | 发布门禁报告（所有阻塞性 P0/P1 缺陷、未达标 NFR） |

### 模块内部报告存放在 qa-modules/{domain}/reports/：

| 文件 | 范围 | 说明 |
|------|------|------|
| `coverage/*.html` | **模块级** | 模块的覆盖率详细报告（可视化 HTML） |
| `performance/*.html` | **模块级** | 模块的性能测试详细报告（k6/JMeter） |
| `security/*.json` | **模块级** | 模块的安全扫描详细报告（ZAP/Trivy） |

**❌ 不应在此目录存放的内容**：
- 模块内部的测试报告 HTML → 放入 `qa-modules/{domain}/reports/`
- 模块内部的测试数据 → 放入 `qa-modules/{domain}/test-data/`
- 缺陷附件（截图/日志） → 放入 `qa-modules/{domain}/defect-attachments/`

---

## 📋 文件详细说明

### 1. coverage-summary.md — 全局覆盖率汇总

**作用**：统计所有模块的需求覆盖率（Story → Test Case 映射完整性）

**数据来源**：解析 `/docs/data/traceability-matrix.md`

**格式**：
```markdown
# 全局需求覆盖率汇总

> 生成时间：2025-11-06 14:30:00
> 数据来源：traceability-matrix.md

## 按模块统计

| 模块 | 总 Story 数 | 已覆盖 Story | 覆盖率 | 未覆盖 Story |
|------|-----------|------------|---------|------------|
| user-management | 15 | 15 | 100% | - |
| payment-system | 20 | 18 | 90% | US-PAY-012, US-PAY-018 |
| notification | 10 | 8 | 80% | US-NOTIF-007, US-NOTIF-010 |
| **总计** | **45** | **41** | **91%** | **4** |

## 按优先级统计

| 优先级 | 总 Story 数 | 已覆盖 Story | 覆盖率 |
|-------|-----------|------------|---------|
| P0 | 20 | 20 | 100% ✅ |
| P1 | 18 | 16 | 89% ⚠️ |
| P2 | 7 | 5 | 71% |

## 未覆盖 Story 列表（需补充测试用例）

- **US-PAY-012**（P1）：支付失败重试 — 缺少异常场景测试
- **US-PAY-018**（P1）：订单超时取消 — 缺少定时任务测试
- **US-NOTIF-007**（P2）：邮件通知 — 缺少 SMTP 集成测试
- **US-NOTIF-010**（P2）：推送通知 — 缺少移动端推送测试
```

**生成命令**：
```bash
npm run qa:coverage-report
```

---

### 2. test-execution-summary.md — 全局测试执行汇总

**作用**：汇总所有模块的最新测试执行结果

**数据来源**：
- `/docs/data/traceability-matrix.md`（测试状态：Pass/Fail）
- 各模块 QA 文档（`qa-modules/{domain}/QA.md`）

**格式**：
```markdown
# 全局测试执行汇总

> 测试轮次：R3（2025-11-06）
> 测试环境：Staging

## 按模块统计

| 模块 | 总用例数 | Pass | Fail | Blocked | 通过率 |
|------|---------|------|------|---------|--------|
| user-management | 35 | 35 | 0 | 0 | 100% ✅ |
| payment-system | 52 | 48 | 3 | 1 | 92% ⚠️ |
| notification | 28 | 26 | 2 | 0 | 93% ⚠️ |
| **总计** | **115** | **109** | **5** | **1** | **95%** |

## 失败用例列表（需处理）

| Test Case ID | Story ID | 失败原因 | 关联缺陷 | 负责人 |
|-------------|----------|---------|---------|--------|
| TC-PAY-012 | US-PAY-012 | 重试逻辑未生效 | BUG-PAY-005 | @dev-a |
| TC-PAY-018 | US-PAY-018 | 定时任务未触发 | BUG-PAY-006 | @dev-b |
| TC-PAY-023 | US-PAY-015 | 数据库死锁 | BUG-PAY-007 | @dev-c |
| TC-NOTIF-010 | US-NOTIF-010 | 推送超时 | BUG-NOTIF-003 | @dev-d |
| TC-NOTIF-015 | US-NOTIF-012 | 邮件格式错误 | BUG-NOTIF-004 | @dev-e |

## 阻塞用例列表（环境/依赖问题）

| Test Case ID | Story ID | 阻塞原因 | 预计解决时间 |
|-------------|----------|---------|-------------|
| TC-PAY-030 | US-PAY-020 | 依赖第三方支付网关未就绪 | 2025-11-08 |
```

**生成命令**：
```bash
npm run qa:generate-test-report
```

---

### 3. defect-summary.md — 全局缺陷汇总

**作用**：按模块、严重级别、状态汇总所有缺陷

**数据来源**：各模块 QA 文档（`qa-modules/{domain}/QA.md`）

**格式**：
```markdown
# 全局缺陷汇总

> 更新时间：2025-11-06 14:30:00

## 按严重级别统计

| 严重级别 | 总数 | Open | In Progress | Resolved | Closed | 状态 |
|---------|------|------|------------|---------|--------|------|
| P0（阻塞发布） | 2 | 0 | 2 | 0 | 0 | ❌ 阻塞 |
| P1（严重） | 8 | 1 | 5 | 2 | 0 | ⚠️ 关注 |
| P2（一般） | 15 | 3 | 7 | 3 | 2 | ✅ 可控 |
| **总计** | **25** | **4** | **14** | **5** | **2** | - |

## P0 缺陷列表（阻塞发布）

| 缺陷 ID | 模块 | 标题 | 影响 Story | 状态 | 负责人 | 预计修复时间 |
|---------|------|------|-----------|------|--------|------------|
| BUG-PAY-005 | payment-system | 支付失败重试逻辑未生效 | US-PAY-012 | In Progress | @dev-a | 2025-11-07 |
| BUG-PAY-006 | payment-system | 订单超时定时任务未触发 | US-PAY-018 | In Progress | @dev-b | 2025-11-08 |

## 按模块统计

| 模块 | P0 | P1 | P2 | 总计 | 状态 |
|------|----|----|----|----- |------|
| user-management | 0 | 2 | 5 | 7 | ✅ 无阻塞 |
| payment-system | 2 | 5 | 8 | 15 | ❌ 阻塞发布 |
| notification | 0 | 1 | 2 | 3 | ✅ 无阻塞 |
```

**生成命令**：
```bash
npm run qa:check-defect-blockers
```

---

### 4. performance-baseline.json — 性能基线数据

**作用**：记录各模块关键接口的性能基线，用于回归对比

**格式**：JSON

**示例**：
```json
{
  "baseline_version": "v1.0.0",
  "baseline_date": "2025-11-01",
  "modules": {
    "user-management": {
      "api_login": {
        "p50_response_time_ms": 150,
        "p95_response_time_ms": 300,
        "p99_response_time_ms": 500,
        "throughput_rps": 500
      },
      "api_register": {
        "p50_response_time_ms": 200,
        "p95_response_time_ms": 400,
        "p99_response_time_ms": 600,
        "throughput_rps": 200
      }
    },
    "payment-system": {
      "api_create_order": {
        "p50_response_time_ms": 300,
        "p95_response_time_ms": 800,
        "p99_response_time_ms": 1200,
        "throughput_rps": 100
      }
    }
  }
}
```

**用途**：
- 性能测试时与基线对比，识别性能退化
- 发布前验证性能 NFR 是否达标

**更新时机**：
- 初次发布时建立基线
- 每次大版本发布后更新基线

---

### 5. security-scan-summary.md — 安全扫描汇总

**作用**：汇总所有模块的安全扫描结果（依赖漏洞、代码扫描、渗透测试）

**格式**：
```markdown
# 全局安全扫描汇总

> 扫描时间：2025-11-06 02:00:00
> 扫描工具：OWASP ZAP, Trivy, npm audit

## 按严重级别统计

| 严重级别 | 依赖漏洞 | 代码漏洞 | 渗透测试发现 | 总计 | 状态 |
|---------|---------|---------|------------|------|------|
| Critical | 0 | 0 | 0 | 0 | ✅ 通过 |
| High | 2 | 1 | 0 | 3 | ⚠️ 需修复 |
| Medium | 5 | 2 | 1 | 8 | 📝 建议修复 |
| Low | 8 | 3 | 2 | 13 | 📝 可延后 |

## High 级别漏洞列表（需修复）

| 漏洞 ID | 类型 | 描述 | 影响模块 | CVE 编号 | 修复方式 | 负责人 |
|---------|------|------|---------|---------|---------|--------|
| VULN-001 | 依赖漏洞 | jsonwebtoken < 9.0.0 存在签名绕过 | user-management | CVE-2022-23529 | 升级到 9.0.0+ | @dev-a |
| VULN-002 | 依赖漏洞 | axios < 1.6.0 存在 SSRF 风险 | payment-system | CVE-2023-45857 | 升级到 1.6.0+ | @dev-b |
| VULN-003 | 代码漏洞 | SQL 注入风险（未使用参数化查询） | payment-system | - | 重构查询逻辑 | @dev-c |
```

**生成命令**：
```bash
npm run security:scan
```

---

### 6. release-gate-YYYYMMDD.md — 发布门禁报告

**作用**：发布前质量门禁检查，汇总所有阻塞性问题

**格式**：
```markdown
# 发布门禁报告 — v1.5.0

> 发布版本：v1.5.0
> 计划发布时间：2025-11-08 10:00:00
> 报告生成时间：2025-11-06 15:00:00

## 🚨 阻塞性问题（必须解决才能发布）

### P0 缺陷（2 个）
- ❌ **BUG-PAY-005**：支付失败重试逻辑未生效 → 预计 2025-11-07 修复
- ❌ **BUG-PAY-006**：订单超时定时任务未触发 → 预计 2025-11-08 修复

### NFR 未达标（1 项）
- ❌ **NFR-PAY-PERF-001**：订单创建 P95 响应时间 > 1s（当前 1.2s）

## ⚠️ 警告项（建议解决，可延后）

### P1 缺陷（1 个未关闭）
- ⚠️ **BUG-USER-003**：密码重置邮件延迟 > 5 分钟

### 安全漏洞（3 个 High 级别）
- ⚠️ **VULN-001**：jsonwebtoken < 9.0.0 存在签名绕过
- ⚠️ **VULN-002**：axios < 1.6.0 存在 SSRF 风险
- ⚠️ **VULN-003**：SQL 注入风险（未使用参数化查询）

## ✅ 通过项

- ✅ 需求覆盖率 91%（阈值：≥ 85%）
- ✅ 测试通过率 95%（阈值：≥ 90%）
- ✅ P0 缺陷全部修复中（无 Open 状态）
- ✅ 性能基线无退化（除 NFR-PAY-PERF-001）

## 📋 发布建议

**当前状态**：❌ **不建议发布**

**阻塞原因**：
1. 2 个 P0 缺陷未关闭
2. 1 项 NFR 未达标

**建议行动**：
1. 等待 BUG-PAY-005、BUG-PAY-006 修复并验证通过
2. 优化订单创建性能，使 P95 响应时间 < 1s
3. 预计最早发布时间：2025-11-09

**可接受风险**（如强行发布）：
- High 级别安全漏洞可通过 WAF 缓解，延后到 v1.5.1 修复
- P1 缺陷影响用户体验，但不阻塞核心功能
```

**生成命令**：
```bash
npm run qa:release-gate-report
```

---

## 🔗 与模块报告的协作关系

### 数据流：模块报告 → 全局报告

1. **模块级测试执行** → 更新 `qa-modules/{domain}/QA.md`
2. **自动化脚本扫描** → 聚合到 `data/qa-reports/test-execution-summary.md`
3. **CI 定期执行** → 每日生成 `test-execution-YYYYMMDD.json`

### 工作流示例：测试执行 → 发布决策

1. **QA 专家**执行测试，更新各模块 QA 文档（`qa-modules/{domain}/QA.md`）
2. **自动化脚本**每日聚合：`npm run qa:aggregate-reports`
   - 生成 `coverage-summary.md`
   - 生成 `test-execution-summary.md`
   - 生成 `defect-summary.md`
3. **发布前**：运行 `npm run qa:release-gate-report`
   - 生成 `release-gate-YYYYMMDD.md`
   - 检查 P0 缺陷、NFR 达标率、安全漏洞
4. **QA 专家**基于 `release-gate-YYYYMMDD.md` 给出发布建议（Go/No-Go）

---

## 🛠️ 自动化脚本

### 1. 覆盖率报告生成
```bash
npm run qa:coverage-report
```
**输出**：`coverage-summary.md`

### 2. 测试执行报告生成
```bash
npm run qa:generate-test-report
```
**输出**：`test-execution-summary.md`、`test-execution-YYYYMMDD.json`

### 3. 缺陷阻塞检查
```bash
npm run qa:check-defect-blockers
```
**输出**：`defect-summary.md`（高亮 P0/P1 缺陷）

### 4. 发布门禁报告
```bash
npm run qa:release-gate-report
```
**输出**：`release-gate-YYYYMMDD.md`

### 5. 报告聚合（每日自动）
```bash
npm run qa:aggregate-reports
```
**执行操作**：
- 扫描所有模块 QA 文档
- 生成/更新 `coverage-summary.md`、`test-execution-summary.md`、`defect-summary.md`
- 更新 `coverage-history.json`、`defect-trends.json`

---

## 📚 相关资源

- [QA-TESTING-EXPERT.playbook.md](../../AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md) — 详细操作手册
- [STRUCTURE-GUIDE.md](../qa-modules/STRUCTURE-GUIDE.md) — 模块内部结构指南
- [traceability-matrix.md](../traceability-matrix.md) — 全局追溯矩阵
- [data/README.md](README.md) — 全局数据目录说明

---

> 本目录遵循"汇总优先"原则：模块报告是数据源，全局报告是聚合视图。发布决策依赖全局报告，日常开发依赖模块报告。
