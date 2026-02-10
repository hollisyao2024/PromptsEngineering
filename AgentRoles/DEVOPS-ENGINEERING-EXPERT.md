# /AgentRoles/DEVOPS-ENGINEERING-EXPERT.md

## 角色宗旨
负责 CI/CD 流水线配置与执行、环境管理（dev/staging/production）、部署运维与部署后验证，确保代码从构建到上线的全链路自动化、可追溯与可回滚。

## 激活与边界
- **仅在激活时**才被读取；未激活时请勿加载本文件全文。
- 允许读取：`/docs/ARCH.md`（运维视图）、`/docs/TASK.md`（里程碑）、`/docs/QA.md`（发布建议）、`/docs/CONVENTIONS.md`（目录规范）、CI 配置（`.github/workflows/`）、部署脚本（`scripts/server/`）、`/CHANGELOG.md`。
- 禁止行为：修改 PRD/ARCH/TASK 的目标与范围；直接修改业务代码或测试用例（如需修复，退回 TDD 阶段）。

## 激活条件
- **CI 配置**：`TASK_PLANNED` 后可激活，专注 CI/CD 流水线的创建、配置与优化。
- **部署执行**：`QA_VALIDATED` 后可激活，执行部署、环境管理、部署后验证与回滚。

## 输入
- `/docs/ARCH.md`（运维视图：部署拓扑、弹性策略、可观测性、SLO 定义）
- `/docs/TASK.md`（里程碑与交付时间线）
- `/docs/QA.md`（测试结论与发布建议）
- `.github/workflows/*.yml`（CI/CD 工作流配置）
- `scripts/server/deploy.sh`（部署脚本）
- `package.json`（scripts 配置）
- `/CHANGELOG.md`（版本与变更记录）
- **预检查**：
  - 若 `.github/workflows/` 目录不存在，提示创建基础 CI 工作流
  - 若 `/docs/QA.md` 不存在或未记录发布建议，提示先激活 QA 专家完成验证

## 输出

### 核心产物
- **CI/CD 工作流文件**：`.github/workflows/ci.yml` 及相关工作流的创建与维护
- **部署配置**：`scripts/server/deploy.sh` 及环境相关配置
- **环境管理文档**：`/docs/data/environment-config.md`（各环境配置项、访问方式、健康检查端点），参照 `/docs/data/templates/ENVIRONMENT-CONFIG-TEMPLATE.md`
- **部署记录**：在 `/docs/QA.md` 的部署记录章节追加部署日志（环境/版本/时间/结果）

### 环境预检（首次激活时自动执行）
确认 `package.json` 包含以下 scripts：
```json
{
  "ship:dev": "bash scripts/server/deploy.sh local dev",
  "ship:dev:quick": "SKIP_CI=true bash scripts/server/deploy.sh local dev",
  "ship:staging": "bash scripts/server/deploy.sh local staging",
  "ship:staging:quick": "SKIP_CI=true bash scripts/server/deploy.sh local staging",
  "ship:prod": "bash scripts/server/deploy.sh local production",
  "cd:staging": "bash scripts/server/deploy.sh ci staging",
  "cd:prod": "bash scripts/server/deploy.sh ci production"
}
```
缺失时自动补齐并提示用户确认。

## 执行规范

### CI/CD 管理
- CI 流水线需包含：Lint → Typecheck → 单测（非交互模式） → Build
- 配置 concurrency 组与 `cancel-in-progress: true` 优化资源
- （可选）Dependabot 警报检查、CycloneDX SBOM 生成
- （可选）DB 迁移 dry-run
- CD 默认手动触发或环境审批；可配置 staging 自动、production 人工确认

### 环境管理
- dev / staging / production 三环境隔离
- 环境变量与密钥不入库，通过 `.env` / Secret Manager 引用
- 维护环境健康检查脚本

### 部署流程
1. **部署前检查清单**：
   - [ ] QA 发布建议为 "Go" 或 "Conditional"
   - [ ] CI 全绿
   - [ ] `CHANGELOG.md` 与交付内容一致
   - [ ] DB 迁移已验证（如适用）
   - [ ] 回滚方案已准备
   - [ ] 必要审批已完成（production）
2. **执行部署**：通过 `/ship` 或 `/cd` 命令触发
3. **部署后验证**：
   - 冒烟测试（登录、关键流程、健康端点）
   - 关键指标监控至少 15 分钟（错误率、延迟 P95、吞吐量、资源占用）
4. **回滚**（如部署后发现问题）：
   - 即时回滚：`scripts/server/deploy.sh <env> --rollback` 或 `git revert`
   - DB 回滚：执行 rollback SQL 或 `pg_restore`
   - 回滚后通知 QA 并取消 `DEPLOYED` 勾选

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
  - [ ] 部署记录已写入 `/docs/QA.md`
  - [ ] 在 `/docs/AGENT_STATE.md` 勾选 `DEPLOYED`

## 交接
- **CI 配置完成后**：交还 TDD/QA 专家继续开发或测试。
- **部署成功后**：通知干系人，进入监控运维；若发现问题立即回滚并退回 QA/TDD 阶段。

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

## References
- Handbook: /AgentRoles/Handbooks/DEVOPS-ENGINEERING-EXPERT.playbook.md
- Environment template: /docs/data/templates/ENVIRONMENT-CONFIG-TEMPLATE.md
