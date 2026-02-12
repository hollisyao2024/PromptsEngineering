# DEVOPS-ENGINEERING-EXPERT Playbook

> 角色定义、输入输出与 DoD 见 `/AgentRoles/DEVOPS-ENGINEERING-EXPERT.md`。

## §1. CI/CD 流水线管理

### CI 配置要求
- **必选步骤**（按此顺序）：
  1. Lint（ESLint / Biome）
  2. Typecheck（tsc --noEmit）
  3. 单测（非交互模式：Jest `CI=1 pnpm test -- --watchAll=false --runInBand`；Vitest `pnpm test`）
  4. Build（前端/后端构建）
- **可选步骤**：
  - Dependabot 警报检查
  - CycloneDX SBOM 生成
  - DB 迁移 dry-run（验证迁移脚本可执行但不提交）

### CI 优化策略
- 配置 concurrency 组（按分支名），启用 `cancel-in-progress: true`
- 依赖缓存：`actions/cache` 缓存 `node_modules` 或 pnpm store
- 并行化：独立步骤可用 matrix 或 parallel jobs

### CD 配置要求
- **默认策略**：手动触发或环境审批（staging 可自动，production 需人工确认）
- **触发方式**：
  - 本地部署：`/ship` 命令 → `pnpm ship:{env}`
  - 远程部署：`/cd` 命令 → `pnpm cd:{env}` → GitHub Actions
- **部署策略**（根据项目规模选择）：
  - 小型项目：直接部署（替换旧版本）
  - 中型项目：蓝绿部署（新旧版本切换）
  - 大型项目：金丝雀/滚动更新（逐步放量）
- **Feature Flag**：高风险功能可通过 feature flag 控制开关（按用户群/百分比），与金丝雀部署互补；上线后逐步开放并监控，确认稳定后移除 flag 避免技术债。

---

## §2. 环境管理

### 三环境隔离
| 环境 | 用途 | 部署命令 | 数据 | 访问控制 |
| ---- | ---- | -------- | ---- | -------- |
| dev | 本地开发/联调 | `/ship dev` | 模拟数据/种子数据 | 无限制 |
| staging | 预发验证/UAT | `/ship staging` 或 `/cd staging` | 脱敏生产数据副本 | 团队内部 |
| production | 线上服务 | `/ship prod` 或 `/cd prod` | 真实数据 | 严格权限 |

### 密钥与凭证管理
- **禁止**：硬编码在代码中、提交到 Git 仓库
- **本地**：`.env.local`（已加入 `.gitignore`）
- **CI/CD**：GitHub Secrets / 云服务 Secret Manager
- **轮换**：定期轮换敏感凭证，记录轮换时间

### 环境健康检查
- 维护健康检查脚本，覆盖：应用端点（`/api/health`）、数据库连通性、外部服务依赖
- `/env check <env>` 执行指定环境的完整健康检查
- `/env status` 查看所有环境概览

### 本地开发服务管理（PM2）
- 统一使用 PM2 托管本地前端开发服务，服务名 `frontend-dev`
- 配置文件：`scripts/server/pm2.frontend.dev.config.cjs`
- 管理脚本：`scripts/server/frontend-dev-pm2.sh`
- 默认固定端口 `3000`，环境变量：
  - `PORT=3000`
  - `APP_ENVIRONMENT=development`
  - `NODE_TLS_REJECT_UNAUTHORIZED=1`
- 命令入口：
  - 重启：`/restart`（执行 `pnpm dev:restart`）
  - 启动：`pnpm dev:start`
  - 停止：`pnpm dev:stop`
  - 状态：`pnpm dev:status`
  - 日志：`pnpm dev:logs`
- 验收标准：重启后 `http://localhost:3000` 返回 200；失败时查看 `/tmp/frontend-dev.log`

---

## §3. 部署流程

### 部署时数据库迁移
- 含 DB 变更的部署须在应用启动前执行迁移：纯 SQL 项目 `psql -f db/migrations/<name>.sql`；Prisma 项目 `pnpm prisma migrate deploy && pnpm prisma generate`。
- 迁移失败立即中止部署，执行 L2 回滚（见下方回滚流程），不启动新版本应用。
- 迁移脚本的编写规范与幂等性要求见 TDD 专家 §B.2~B.5（`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`）。

### 部署后验证
1. **冒烟测试**（部署后立即执行）：
   - 应用健康端点返回 200
   - 核心用户流程可用（登录/关键业务操作）
   - 外部服务连通性正常
2. **关键指标监控**（至少 15 分钟）：
   - 错误率（Error Rate）— 不超过基线
   - 延迟（Latency P50/P95/P99）— 符合 ARCH 定义的 SLO
   - 吞吐量（Requests/s）— 在预期范围内
   - 资源占用（CPU/Memory）— 无异常飙升
   - ARCH 运维视图对照：验证部署拓扑、SLO 指标（响应时间、可用性）与 `/docs/ARCH.md` 运维视图定义一致
3. **确认与记录**：
   - 在 `/docs/data/deployments/` 新建本次部署记录文件（`DEPLOY-{YYYYMMDD}-{SEQ}-{env}.md`）并更新 `README.md` 状态表
   - 在 `/docs/AGENT_STATE.md` 勾选 `DEPLOYED`

### 灰度/金丝雀部署验证
- 采用金丝雀部署时，按 5%→25%→100% 分阶段放量，每阶段完成冒烟测试 + 关键指标对比后再扩量。
- 任一阶段出现错误率飙升或 SLO 违反，立即暂停扩量并执行回滚。

### Staging→Production 升级
- staging 验证通过后，使用相同构建产物（tag/commit hash）部署 production：`/ship prod` 或 `/cd prod vX.Y.Z`，禁止重新构建以避免不一致。
- production 部署前须完成 Expert §部署前检查清单 全部项目，staging 冒烟通过不免除 production 检查。

### 回滚流程
当部署后发现严重问题时（回滚脚本规范见 TDD 专家 §B.4，`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`）：
1. **L1 即时回滚**（应用层）：`scripts/server/deploy.sh <env> --rollback` 或 `git revert <hash>`
2. **L2 数据库回滚**（如涉及迁移）：`psql -f db/migrations/rollback/<name>.sql` / `prisma migrate resolve --rolled-back` / `pg_restore <backup>`
3. **L3 回滚后处理**：通知 QA 并取消 `DEPLOYED` 勾选 → 在部署记录中记录回滚原因 → QA 被重新激活后从回滚记录中提取信息，在 `defect-log.md` 正式登记缺陷条目 → 退回 TDD/QA 修复后重新部署
4. **事后回顾**：production 回滚后 24 小时内完成事后分析（触发原因、影响范围、时间线、根因、改进措施），记录到部署记录的事后回顾段及 ADR。

---

## 与其他专家的协作

| 协作方 | 触发场景 | DevOps 职责 | 交接产物 |
|--------|---------|-------------|---------|
| TDD 专家 | TASK_PLANNED 后 CI 配置 | 配置 CI 流水线 → TDD 可用 `/ci run` | CI 工作流文件 |
| TDD 专家 | CI 配置问题 | 排查修复 CI 配置 | 修复后 CI 恢复绿色 |
| QA 专家 | QA_VALIDATED 后部署 | 执行部署 + 冒烟验证 | 部署记录写入 `/docs/data/deployments/` |
| QA 专家 | 部署后发现问题 | 执行回滚 | 回滚记录写入部署日志 + QA 登记缺陷 + 退回 TDD/QA |

## CI 工作流模板
创建新项目 CI 时，复制 `/docs/data/templates/devops/CI-WORKFLOW-TEMPLATE.yml` 到 `.github/workflows/ci.yml` 并按项目实际调整。
