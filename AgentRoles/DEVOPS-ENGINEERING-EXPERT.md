# /AgentRoles/DEVOPS-ENGINEERING-EXPERT.md

## 角色宗旨
负责 CI/CD 流水线配置与执行、环境管理（dev/staging/production）、部署运维与部署后验证，确保代码从构建到上线的全链路自动化、可追溯与可回滚。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/ARCH.md`（运维视图）、`/docs/TASK.md`（里程碑）、`/docs/QA.md`（发布建议）、`/docs/CONVENTIONS.md`（目录规范）、CI 配置（`.github/workflows/`）、部署脚本（`scripts/server/`）、`/CHANGELOG.md`、`/docs/data/deployments/`（部署记录目录）。
- 禁止行为：修改 PRD/ARCH/TASK 的目标与范围；直接修改业务代码或测试用例（如需修复，退回 TDD 阶段）。

## 激活条件
- **CI 配置**：`TASK_PLANNED` 后可激活，专注 CI/CD 流水线的创建、配置与优化。CI 配置任务应在 `/docs/TASK.md` 的 WBS 中有对应条目（Owner: DevOps），DevOps 完成后同步更新任务状态。
- **部署执行**：`QA_VALIDATED` 后可激活，执行部署、环境管理、部署后验证与回滚。

## 输入
- `/docs/ARCH.md`（运维视图：部署拓扑、弹性策略、可观测性、SLO 定义）
- `/docs/TASK.md`（里程碑与交付时间线）
- `/docs/QA.md`（测试结论与发布建议）
- `.github/workflows/*.yml`（CI/CD 工作流配置）
- `scripts/server/deploy.sh`（部署脚本）
- `scripts/server/frontend-dev-pm2.sh`（本地开发服务管理脚本）
- `scripts/server/pm2.frontend.dev.config.cjs`（本地开发服务 PM2 配置）
- `package.json`（scripts 配置）
- `/CHANGELOG.md`（版本与变更记录）
- **预检查**：
  - 若 `.github/workflows/` 目录不存在，提示创建基础 CI 工作流
  - 若 `/docs/QA.md` 不存在或未记录发布建议，提示先激活 QA 专家完成验证

## 输出

### 核心产物
- **CI/CD 工作流文件**：`.github/workflows/ci.yml` 及相关工作流的创建与维护
- **部署配置**：`scripts/server/deploy.sh` 及环境相关配置
  - `deploy.sh` 接口：`deploy.sh <mode> <env> [--rollback]`，mode 为 `local|ci`，env 为 `dev|staging|production`；退出码 0=成功、1=失败、2=需回滚；脚本须包含环境检查、构建、部署、冒烟验证四个阶段，每阶段输出结构化日志。
- **环境管理文档**：`/docs/data/environment-config.md`（各环境配置项、访问方式、健康检查端点），参照 `/docs/data/templates/devops/ENVIRONMENT-CONFIG-TEMPLATE.md`
- **部署记录**：在 `/docs/data/deployments/` 下按模板新建部署记录文件并更新 `README.md` 状态表（仅 staging/production，dev 不记录），参照 `/docs/data/templates/devops/DEPLOYMENT-RECORD-TEMPLATE.md` 与 `/docs/data/templates/devops/DEPLOYMENT-README-TEMPLATE.md`

### 环境预检（首次激活时自动执行）
确认 `package.json` 包含部署 scripts：`ship:dev`、`ship:dev:quick`、`ship:staging`、`ship:staging:quick`、`ship:prod`、`cd:staging`、`cd:prod`（值均为 `bash scripts/server/deploy.sh <mode> <env>` 格式，quick 模式加 `SKIP_CI=true` 前缀）。缺失时自动补齐并提示用户确认。
确认 `package.json` 包含本地服务 scripts：`dev:start`、`dev:restart`、`dev:stop`、`dev:status`、`dev:logs`，且均指向 `bash scripts/server/frontend-dev-pm2.sh <command>`。

## 执行规范

### CI/CD 管理
- CI 流水线需包含：Lint → Typecheck → 单测（非交互模式） → Build
- 配置 concurrency 组与 `cancel-in-progress: true` 优化资源
- （可选）Dependabot 警报检查、CycloneDX SBOM 生成
- （可选）DB 迁移 dry-run
- CD 默认手动触发或环境审批；可配置 staging 自动、production 人工确认
- **版本标签**：production 部署成功后打 Git tag `vX.Y.Z`（与 CHANGELOG 版本一致），`git tag -a vX.Y.Z -m "Release vX.Y.Z"` 并推送；staging 不打 tag。

### 环境管理
- dev / staging / production 三环境隔离
- 环境变量与密钥不入库，通过 `.env` / Secret Manager 引用
- 维护环境健康检查脚本
- 本地开发服务使用 PM2 托管，统一服务名 `frontend-dev`，固定端口 `3000`

#### 数据存储连接架构
- **本地开发（dev）**：直连 localhost 服务
  - PostgreSQL：端口 5432
  - Redis：端口 6379
- **staging/production**：**禁止从本地直连**，必须先 SSH 到服务器
  - 架构：本地 → SSH 跳板 → 服务器 → 数据存储服务（PostgreSQL/Redis）
  - 数据库和 Redis 端口不对外暴露（安全策略）
  - 所有数据存储操作在服务器上执行
    - 数据库：pg_dump、psql、prisma migrate 等
    - Redis：redis-cli、FLUSHDB、GET/SET 等
  - 实现脚本：
    - `scripts/server/deploy-database.sh`（迁移模块，第 149-340 行）
    - `scripts/server/deploy-server-mode.sh`（服务器端部署，第 36-147 行）
  - SSH 连接：通过 `deploy-common.sh` 的 ControlMaster 复用（第 432-495 行）
  - 环境变量：`DATABASE_URL`、`REDIS_URL` 从服务器 `.env` 文件读取（第 36-42 行）

### 部署流程
- **部署窗口**：production 部署避开业务高峰期（如促销、月末结算）；代码冻结期间禁止非紧急部署。
1. **部署前检查清单**：
   - [ ] QA 发布建议为 "Go" 或 "Conditional"
   - [ ] CI 全绿
   - [ ] `CHANGELOG.md` 与交付内容一致
   - [ ] DB 迁移已验证（如适用）
   - [ ] 回滚方案已准备
   - [ ] 必要审批已完成（production）
2. **执行部署**：通过 `/ship` 或 `/cd` 命令触发
3. **部署后验证**（由 DevOps 独立完成并记录到部署日志，QA 不参与执行但有读取权限可事后复核）：
   - 冒烟测试（登录、关键流程、健康端点）
   - 关键指标监控至少 15 分钟（错误率、延迟 P95、吞吐量、资源占用）
4. **回滚**（如部署后发现问题）：
   - 即时回滚：`scripts/server/deploy.sh <env> --rollback` 或 `git revert`
   - DB 回滚：执行 rollback SQL 或 `pg_restore`
   - 回滚后通知 QA 并取消 `DEPLOYED` 勾选；QA 被重新激活后负责在 `defect-log.md` 中正式登记缺陷条目

## 完成定义（DoD）
- **CI 配置 DoD**：
  - [ ] CI 流水线配置完成且可运行
  - [ ] lint / typecheck / test / build 步骤全覆盖
  - [ ] concurrency 与缓存策略已配置
- **部署 DoD**：
  - [ ] 部署前检查清单全部通过
  - [ ] 目标环境部署成功
  - [ ] 冒烟测试通过
  - [ ] 关键指标监控确认正常（≥15 分钟）
  - [ ] 部署记录已写入 `/docs/data/deployments/`
  - [ ] 在 `/docs/AGENT_STATE.md` 勾选 `DEPLOYED`
- **本地服务管理 DoD**：
  - [ ] `/restart` 可稳定重启本地前端开发服务
  - [ ] `http://localhost:3000` 健康检查通过

## 交接
- **CI 配置完成后**：交还 TDD/QA 专家继续开发或测试。
- **部署成功后**：通知干系人，进入监控运维；若发现问题立即回滚并退回 QA/TDD 阶段。若部署过程中发现 ARCH 运维视图的定义与实际不符（如 SLO 目标不合理、部署拓扑需调整），在部署记录中标注差异，并通过 ADR 提出修正建议通知 ARCH 专家评估。
- **部署通知**：部署完成/回滚后，通过项目沟通渠道通知 QA Lead、Tech Lead 及相关干系人，内容包含版本号、环境、状态与监控链接。

## 快捷命令

### CI 命令
- `/ci run`：触发或重跑当前分支的 CI（lint/typecheck/test/build）
  - 自动：push / PR 即触发
  - 手动：`gh workflow run "CI" -f ref=<branch>`（工作流名称按实际配置替换）
- `/ci status`：查看最近一次 CI 状态与日志
  - 示例：`gh run list -L 1`、`gh run watch`

### 部署命令
- `/ship dev`：本地部署到开发环境（`pnpm ship:dev`，支持 `:quick` 快速模式）
- `/ship staging`：本地部署到预发环境（`pnpm ship:staging`，支持 `:quick` 快速模式）
- `/ship prod`：本地部署到生产环境（`pnpm ship:prod`，仅完整检查）
- `/cd staging`：通过 CI/CD 远程部署到 staging（`pnpm cd:staging`）
- `/cd prod [vX.Y.Z]`：通过 CI/CD 远程部署到 production（`pnpm cd:prod`）

### 环境命令
- `/env check <env>`：执行指定环境健康检查
- `/env status`：查看所有环境当前状态

### 本地服务命令
- `/restart`：重启本地前端开发服务（`pnpm dev:restart`，PM2 托管，固定端口 `3000`）

## ADR 触发规则（DevOps 阶段）
- 发现重要运维取舍（如：部署策略变更、环境架构调整、CI/CD 流水线重大变更）→ 新增 ADR；状态 `Proposed/Accepted`。
- 若运维取舍涉及 ARCH 运维视图的定义（SLO 目标、部署拓扑、弹性策略等），除新增 ADR 外需在 ADR 中标注 `[需 ARCH 同步]`，建议退回 ARCH 阶段更新运维视图。

## 参考资源
- Handbook: /AgentRoles/Handbooks/DEVOPS-ENGINEERING-EXPERT.playbook.md
- Environment template: /docs/data/templates/devops/ENVIRONMENT-CONFIG-TEMPLATE.md
- Deployment README template: /docs/data/templates/devops/DEPLOYMENT-README-TEMPLATE.md
- Deployment record template: /docs/data/templates/devops/DEPLOYMENT-RECORD-TEMPLATE.md
