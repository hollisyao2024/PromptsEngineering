# QA-TESTING-EXPERT Playbook

> 角色定义、输入输出与 DoD 见 `/AgentRoles/QA-TESTING-EXPERT.md`。

## 工作环境与目录边界
遵循 `/docs/CONVENTIONS.md` 的命名与目录规范，仅在授权范围内操作。关键目录速查：
- `docs/QA.md`：QA 主文档（测试策略、用例概览、缺陷汇总、发布建议）
- `docs/qa-modules/{domain}/QA.md`：模块级 QA 文档（测试用例、执行记录、缺陷日志）
- `docs/data/traceability-matrix.md`：追溯矩阵（Story → AC → Test Case 映射）
- `docs/data/test-strategy-matrix.md`、`test-priority-matrix.md`、`test-risk-matrix.md`：全局测试矩阵
- `docs/data/qa-reports/`：全局质量报告归档
- `docs/data/templates/qa/`：QA 模板（QA-TEMPLATE-SMALL/LARGE、矩阵模板）
- `apps/web/tests/`：集成测试代码
- `e2e/`：端到端测试代码
- `apps/web/coverage/`、`apps/web/test-results/`：测试产物（已加入 .gitignore）

### 命令作用域规则
- `/qa plan`、`/qa verify`、`/qa merge` 裸命令默认 `session` 作用域（仅处理当前会话上下文）。
- 传入描述/参数或显式 `--project` 时，进入 `project` 作用域（允许全项目级操作）。
- `/qa merge` 在两种作用域下都只处理当前分支对应 PR，不会操作其他分支。

---

## QA 核心流程

### 第一步：测试计划（/qa plan）
1. **必须首先执行** `pnpm run qa:generate` 脚本（不得手动生成）
2. 脚本读取 PRD/ARCH/TASK，解析 Story → AC → Test Case 映射
3. 按项目规模生成/更新 QA 文档（单文件或主从结构）
4. 更新追溯矩阵（`docs/data/traceability-matrix.md`）
5. 记录会话上下文到 `/tmp/linghuiai-qa-plan-session.json`

### 第二步：测试执行
1. 按优先级执行测试套件（P0 → P1 → P2）
2. 记录每条用例的结果（通过/失败/阻塞）与环境信息
3. 发现缺陷时，完整填写复现步骤、影响分析、严重程度
4. P0 阻塞缺陷立即通知 TDD 修复
5. 更新追溯矩阵中的测试状态

### 第三步：验收检查（/qa verify）
1. **必须首先执行** `pnpm run qa:verify` 脚本（不得手动验证）
2. 脚本检查：QA 文档完整性、覆盖率、缺陷阻塞情况
3. 生成质量指标（通过率、覆盖率、缺陷密度）
4. 输出发布建议：Go / Conditional / No-Go

### 第四步：合并发布（/qa merge）
1. **必须首先执行** `pnpm run qa:merge` 脚本（不得手动合并）
2. 脚本包含 15 个关键步骤：工作区检查 → rebase → 门禁 → 合并 → 分支清理
3. **脚本成功后**立即依序执行：
   - 更新 `/docs/AGENT_STATE.md` 标记 `QA_VALIDATED`
   - `git add docs/AGENT_STATE.md && git commit && git push origin main`
   - 交接 DevOps 执行部署

### 回退触发
- 发布建议为 No-Go → 退回 TDD 修复，取消 `TDD_DONE`
- 部署后回滚 → 从部署记录中提取信息，在 `defect-log.md` 登记缺陷
- 范围偏差 → 记录回流建议并通知对应阶段

---

## 测试策略与覆盖
- **优先级**：P0（阻塞）> P1（严重）> P2（一般）；P0 通过率必须 100%
- **测试类型覆盖**：功能/集成/E2E/回归/契约/降级/性能/安全/无障碍
- **快速通道**：时间受限时，P0 用例 + 变更影响范围内回归用例
- **非功能验证**：性能基准对比、可靠性指标、安全扫描、WCAG 2.1 AA 合规
- **设计还原度**：对照 UX 规范验证间距、色彩、排版、响应式断点

---

## 常用命令与自动化

### QA 核心命令
```bash
# 测试计划
pnpm run qa:generate                    # session 模式
pnpm run qa:generate -- --project       # project 模式（全项目刷新）
pnpm run qa:generate -- --modules auth,billing  # 指定模块
pnpm run qa:generate -- --dry-run       # 预览（不写入文件）

# 验收检查
pnpm run qa:verify                      # session 模式
pnpm run qa:verify -- --project         # project 模式

# 合并发布
pnpm run qa:merge                       # session 模式
pnpm run qa:merge -- --dry-run          # 预览
pnpm run qa:merge -- --skip-checks      # 跳过门禁（慎用）
```

### 质量报告
```bash
pnpm run qa:coverage-report             # 覆盖率报告
pnpm run qa:generate-test-report        # 测试执行报告
pnpm run qa:check-defect-blockers       # P0 阻塞检查
pnpm run qa:lint                        # QA 文档质量检查
pnpm run qa:sync-prd-qa-ids            # PRD ↔ QA ID 同步
```

### 测试执行
```bash
cd apps/web
CI=1 pnpm test -- --runInBand --watchAll=false        # 全量单测
pnpm test tests/integration/ --runInBand               # 集成测试
pnpm playwright test                                   # E2E 测试
pnpm test -- --coverage                                # 带覆盖率
pnpm run test:clean                                    # 清理测试产物
```

> 测试结果目录（`test-results/`、`coverage/`、`playwright-report/`）已加入 `.gitignore`，严禁提交。

---

## QA 验收检查清单

### 质量门槛
- [ ] P0 通过率 = 100%
- [ ] 总通过率 ≥ 90%
- [ ] 需求覆盖率 ≥ 85%（Story → AC → Test Case 映射完整）
- [ ] P0 缺陷全部关闭
- [ ] P1~P2 缺陷有缓解方案或验证计划

### 文档完整性
- [ ] `/docs/QA.md` 包含测试策略、用例概览、缺陷汇总、发布建议
- [ ] 追溯矩阵（`traceability-matrix.md`）状态为最新（Pass/Fail/Blocked）
- [ ] 模块 QA 文档（如模块化）与主文档双向索引一致
- [ ] 缺陷报告字段完整（复现步骤、环境、严重程度、回流建议）

### 发布评估
- [ ] 发布建议已明确（Go / Conditional / No-Go）
- [ ] 前置条件或风险已列出
- [ ] CHANGELOG.md 与测试结论一致
- [ ] CI 状态为绿色

---

## 安全与合规
- 测试结果目录严禁提交 Git（`test-results/`、`coverage/`、`playwright-report/`）
- 测试数据使用脱敏/模拟数据，禁止使用真实用户信息
- 安全测试覆盖 OWASP Top 10（SQL 注入、XSS、CSRF 等）
- 无障碍测试验证 WCAG 2.1 AA 标准

---

## 与其他专家的协作

| 协作方 | 输入 | 输出 | 要点 |
|--------|------|------|------|
| TDD | TDD_DONE + PR + CI 绿色 | 缺陷记录 → 退回修复 | TDD 修复后 QA 重新验证原失败用例 + 回归套件 |
| ARCH | 架构约束 + NFR 指标 | NFR 验证结果 | 非功能测试覆盖 ARCH 定义的 SLO |
| PRD | 验收标准 + 用户故事 | 需求覆盖率 | 追溯矩阵确保每个 Story AC 都有测试覆盖 |
| DevOps | — | Go/Conditional/No-Go + AGENT_STATE | 发布建议为 Go 后执行 /qa merge，交接 DevOps 部署 |
