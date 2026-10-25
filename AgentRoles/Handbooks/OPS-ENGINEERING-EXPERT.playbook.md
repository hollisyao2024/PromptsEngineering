# OPS-ENGINEERING-EXPERT Playbook

> 角色定义、输入输出与 DoD 见 `/AgentRoles/OPS-ENGINEERING-EXPERT.md`。
> **路径基准**：本文件中所有相对路径以 `repo/`（Git 主 worktree 根）为基准；详见 `/docs/CONVENTIONS.md` §路径与仓库拓扑。

## §1. CI/CD 流水线管理

### CI 配置建议（项目可选）
- CI 由实际项目按需维护，不是本地 TDD/QA/合并门禁；模板不创建、修改或依赖 `.github/workflows`。
- **常见步骤**（项目启用 CI 时建议按此顺序）：
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
  - 本地部署：`/ship <env>` → `pnpm agent -- ship <env>`，实际命令来自 `agent.config.json ops.commands.ship`
  - 远程部署：`/cd <env>` → `pnpm agent -- cd <env>`，实际命令来自 `agent.config.json ops.commands.cd`
  - 两者均需 `ops.deployEnabled=true`（或 `AGENT_OPS_DEPLOY_ENABLED=true`）
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
- `/env check <env>` 执行指定环境的完整健康检查，实际命令来自 `agent.config.json ops.commands.envCheck` 或 `ops.healthCheck.<env>`
- `/env status` 查看所有环境概览，实际命令来自 `agent.config.json ops.commands.envStatus`
- 未配置对应命令时输出 `STATUS=BLOCKED`；健康检查由 OPS 执行，QA 只读取结果作为发布建议输入

### 本地开发服务管理
- 管理脚本：`infra/scripts/ops-tools/ops-run.js`
- 命令接口：`ops-run.js --action=dev-<start|restart|stop|status|logs>`
- 统一入口：`pnpm agent -- dev <start|restart|stop|status|logs>`；模板默认 `devServer.commands.<action>` 调用项目自有 `pnpm dev:<action>`，这些脚本须是真实服务命令，不得回调 `ops-run.js`
- **配置约定**：实际命令写在 `agent.config.json devServer.commands`，必要时通过环境变量提供端口、服务名和日志路径
- 验收标准：重启后健康检查端点返回 200；失败时查看日志文件排查

### 客户端开发与构建

- 客户端开发（`/dev app`）与发行构建（`/build app`）及其 `/private` 入口的路由见 `docs/CONVENTIONS.md` §客户端与服务端快捷命令，平台矩阵与配置键见 OPS 专家 §快捷命令规格。
- 显式 profile 没有精确命令时必须阻断，禁止回退 default；构建成功不得替代运行态验收。

---

## §3. 部署流程

### 部署时数据库迁移
- 含 DB 变更的部署须在应用启动前执行迁移：纯 SQL 项目 `psql -f <migrations-dir>/<name>.sql`；Prisma 项目 `pnpm prisma migrate deploy && pnpm prisma generate`。
- 迁移失败立即中止部署，执行 L2 回滚（见下方回滚流程），不启动新版本应用。
- 迁移脚本的编写规范与幂等性要求见 TDD 专家 §B.2~B.5（`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`）。

### 部署前检查清单
- [ ] QA 发布建议为 "Go" 或 "Conditional"
- [ ] 本地 QA 回执有效（项目启用 CI 时 CI 通过）
- [ ] `CHANGELOG.md` 与交付内容一致
- [ ] 部署目标为已合并提交的固定 tag 或 SHA
- [ ] DB 迁移已验证（如适用）
- [ ] 回滚方案已准备
- [ ] 必要审批已完成（production）
- **部署窗口**：production 部署避开业务高峰期；代码冻结期间禁止非紧急部署。

### 部署防回退与跨电脑租约

`ops.rollbackGuard` 默认关闭（`enabled:false`）；开启后只作用于 `ship` 且环境列入 `environments`（默认 `staging`、`production`）的调用，实现位于 `infra/scripts/ops-tools/deploy-guard*.js`，与项目部署脚本无关。scope 为环境名，private profile 为 `private-<env>`。协调状态放在项目 `remote`（默认 `origin`）的自定义 ref：`refs/xirang/deploy/<scope>` 指向上次部署成功的提交，`refs/xirang/deploy-lock/<scope>` 是租约（无父提交，消息为持有者 JSON：host、user、pid、createdAt、ttlSeconds、targetSha、nonce）。

- 目标：`--sha`/`--source` 解析为固定提交，未提供时取 `<remote>/<baseBranch>`；ship 命令必须声明 `{source_args}`，执行时改写为 `--sha=<固定SHA>` 并注入 `AGENT_DEPLOY_SHA`，未声明则 `STATUS=BLOCKED`。
- 判定：一次 `fetch --prune --no-tags` 同时取分支与两类 ref 的快照；浅克隆、远端不可读为 `UNREADABLE`，目标不可解析为 `DEPLOY_TARGET_UNKNOWN`。无基线 `NO_BASELINE` 与目标包含已部署提交 `PASS` 放行；目标是已部署提交的祖先 `ROLLBACK`、两者分叉 `DIVERGED` 默认阻断，仅 `DEPLOY_ALLOW_ROLLBACK=1` 可显式放行并输出 `DEPLOY_ROLLBACK_OVERRIDE=1`；已部署提交在本地不存在 `UNKNOWN`、`UNREADABLE` 一律 fail-closed，不可覆盖。
- 线上回读：`readDeployedCommand` 可选，须只读且只输出 40 位 SHA；配置后 ref 与线上值分别判定取更严重者，二者不一致输出 `DEPLOYED_STATE_DRIFT`，命令失败或输出非法为 `UNREADABLE`；部署后回读必须等于目标，否则 `DEPLOYED_STATE_MISMATCH` 且不推进 ref。
- 租约：每次 ref 写入都是 `git push --porcelain --no-verify --force-with-lease=<ref>:<期望值>`，期望为空表示 ref 必须不存在，由远端原子 CAS。流程为抢锁 → 二次快照确认锁归属并重新判定 → 执行部署 → 回读校验 → 以二次快照值为 lease 推进 deploy ref → 释放锁。远端读取（快照 fetch、`ls-remote`）与 lease 推送按 `remoteRetryDelaysMs`（默认 `[2000,5000,10000,20000,30000]`，约 67 秒，覆盖代理成段故障；至多 10 项、每项 0–60000 毫秒）有界退避重试；推送结果不明时先用 `ls-remote` 核实，远端已等于目标即成功，仍等于 lease 期望值或不可读才在同一 lease 下重推（已生效的推送重推只会被 lease 拒绝，不会重复写入），为其他值即视为被拒；首次即被远端拒绝不重试。推进 deploy ref 时被拒为 `DEPLOY_REF_CAS_FAILED`；重试耗尽仍不明为 `DEPLOY_REF_ADVANCE_UNKNOWN`，此时部署已成功、锁照常释放，远端可达后用同一 `--sha` 重跑 ship 补记，期间线上回读仍阻断回退。锁被占用为 `DEPLOY_LOCKED`，输出 `DEPLOY_LOCK_HOLDER`，超过 `lockTtlSeconds`（默认 3600）另输出 `LOCK_STALE=1`，但不自动夺锁；确认持有者已终止后执行输出的 `MANUAL_RELEASE_COMMAND`（`pnpm agent -- [private] ship <env> --release-lock=<锁提交SHA>`），仅当远端锁仍等于该 SHA 时删除。部署失败也释放锁；锁丢失（`DEPLOY_LOCK_LOST`）时不碰他人锁；释放失败不改变部署结果，输出 `DEPLOY_LOCK_RELEASE=FAILED` 与手动释放命令。
- `--dry-run` 只读：取快照、判定、报告锁，不抢锁、不写 ref；回读命令只在 dry-run 预检和真实部署内执行。结果写入运行目录 `result.json` 的 `deploy_guard`。

### 部署后验证
1. **冒烟测试**（部署后立即执行）：
   - `/env check <env>` 通过，应用健康端点返回 200
   - 核心用户流程可用（登录/关键业务操作）
   - 外部服务连通性正常
2. **关键指标监控**（至少 15 分钟）：
   - 错误率（Error Rate）— 不超过基线
   - 延迟（Latency P50/P95/P99）— 符合 ARCH 定义的 SLO
   - 吞吐量（Requests/s）— 在预期范围内
   - 资源占用（CPU/Memory）— 无异常飙升
   - ARCH 运维视图对照：验证部署拓扑、SLO 指标与 `/docs/ARCH.md` 定义一致
3. **确认与记录**：
   - 常规部署只在 `/docs/data/deployments/LOG-{YYYY-MM}.md` 追加一行，并更新 `README.md` 当前状态表
   - 失败或重试、回滚、热修复、事故、人工迁移才新建 `DEPLOY-*.md`（≤60 行）并在台账行链接
   - 在台账行和任务 state 中记录 `DEPLOYED` 证据

### 灰度/金丝雀部署验证
- 采用金丝雀部署时，按 5%→25%→100% 分阶段放量，每阶段完成冒烟测试 + 关键指标对比后再扩量。
- 任一阶段出现错误率飙升或 SLO 违反，立即暂停扩量并执行回滚。

### Staging→Production 升级
- staging 验证通过后，使用相同构建产物（tag/commit hash）部署 production：`/ship prod` 或 `/cd prod`，配合 `--sha=<固定SHA>` 或 `--source=<tag>`，禁止重新构建以避免不一致。
- production 部署前须完成部署前检查清单全部项目，staging 冒烟通过不免除 production 检查。

### 版本与标签
- 版本号、`CHANGELOG.md` 与 Git tag 在 `qa merge` 合并阶段生成：tag 仅在 `release.createTag=true`（未传 `--no-tag`）或显式 `--tag` 时创建，前缀为 `release.tagPrefix`。
- OPS 负责 `release.*`（`bumpVersion`、`versionFile`、`versionSyncFiles`、`updateChangelog`、`changelogFile`、`createTag`、`tagPrefix`）与项目发布策略一致；QA 只校验合并门禁，不决定发布元数据策略。

### 回滚流程
当部署后发现严重问题时（回滚脚本规范见 TDD 专家 §B.4，`/AgentRoles/TDD-PROGRAMMING-EXPERT.md`）：
1. **L1 即时回滚**（应用层）：执行目标项目自有回滚命令（可在 `agent.config.json ops.commands.rollback` 登记，模板不提供执行入口），或以上一个已部署的固定 SHA 重新部署（启用 rollbackGuard 时需 `DEPLOY_ALLOW_ROLLBACK=1`），或 `git revert <hash>` 后走正常交付链
2. **L2 数据库回滚**（如涉及迁移）：`psql -f <migrations-dir>/rollback/<name>.sql` / `prisma migrate resolve --rolled-back` / `pg_restore <backup>`
3. **L3 回滚后处理**：OPS 取消 `DEPLOYED` 勾选 → 在部署记录中记录回滚原因 → 通知 QA → QA 被重新激活后从回滚记录中提取信息，在 `defect-log.md` 正式登记缺陷条目 → 退回 TDD/QA 修复后重新部署
4. **事后回顾**：production 回滚后 24 小时内完成事后分析（触发原因、影响范围、时间线、根因、改进措施），记录到部署记录的事后回顾段及 ADR。

---

## §4. 数据存储连接架构

- **本地开发（dev）**：直连 localhost 服务
  - PostgreSQL：端口 5432
  - Redis：端口 6379
- **staging/production**：**禁止从本地直连**，必须先 SSH 到服务器
  - 架构：本地 → SSH 跳板 → 服务器 → 数据存储服务（PostgreSQL/Redis）
  - 数据库和 Redis 端口不对外暴露（安全策略）
  - 所有数据存储操作在服务器上执行
    - 数据库：pg_dump、psql、prisma migrate 等
    - Redis：redis-cli、FLUSHDB、GET/SET 等
  - 实现脚本：目标项目自有脚本，通过 `agent.config.json ops.commands.*` 显式声明
  - SSH 连接：由目标项目自有脚本负责，模板不默认假设服务器拓扑
  - 环境变量：`DATABASE_URL`、`REDIS_URL` 从服务器 `.env` 文件读取

---

## §5. 脚本路径参考

优先使用 `pnpm agent -- <domain> <action>` 稳定入口；下表 package alias 仅为已有项目的兼容入口。

| 可选 package alias | 实际脚本路径 | 备注 |
|---------|------------|------|
| `ship:dev` | `node infra/scripts/ops-tools/ops-run.js --action=ship --env=dev` | 需 `ops.deployEnabled=true` |
| `ship:dev:quick` | `node infra/scripts/ops-tools/ops-run.js --action=ship --env=dev --quick` | 快速模式由项目命令自行解释 |
| `ship:staging` | `node infra/scripts/ops-tools/ops-run.js --action=ship --env=staging` | |
| `ship:staging:quick` | `node infra/scripts/ops-tools/ops-run.js --action=ship --env=staging --quick` | |
| `ship:prod` | `node infra/scripts/ops-tools/ops-run.js --action=ship --env=production` | |
| `cd:staging` | `node infra/scripts/ops-tools/ops-run.js --action=cd --env=staging` | |
| `cd:prod` | `node infra/scripts/ops-tools/ops-run.js --action=cd --env=production` | |
| `ci:run` | `node infra/scripts/ops-tools/ops-run.js --action=ci-run` | |
| `ci:status` | `node infra/scripts/ops-tools/ops-run.js --action=ci-status` | |
| `env:check` | `node infra/scripts/ops-tools/ops-run.js --action=env-check --env=<env>` | |
| `env:status` | `node infra/scripts/ops-tools/ops-run.js --action=env-status` | |

`/private`、`/dev app`、`/build app`、`/build <env>` 等快捷入口不在此表登记，见 `docs/CONVENTIONS.md` §客户端与服务端快捷命令。

`ops-run.js` 只负责统一协议、配置读取、结构化输出和阻塞提示；实际客户端、构建与部署脚本须由目标项目在 `agent.config.json` 中声明。项目配置仍使用更名前的运维配置节或部署开关环境变量时，`ops-run.js` 输出 `STATUS=BLOCKED` 与迁移提示，按提示改为 `ops` 节与 `AGENT_OPS_DEPLOY_ENABLED` 后重试。项目自有脚本从 `AGENT_OPS_ACTION` 读取当前动作，`AGENT_OPS_CALL_STACK` 记录嵌套调用链；重入同一快捷命令即 `STATUS=BLOCKED`。多 profile 命令必须精确配置；用户使用 `/private ...` 语法，内部 target 仅用于 dispatcher 调度，不得作为用户快捷命令公开。

---

## 与其他专家的协作

| 协作方 | 触发场景 | OPS 职责 | 交接产物 |
|--------|---------|-------------|---------|
| TDD 专家 | TASK_PLANNED 后 CI 配置（项目启用 CI 时） | 配置 CI 流水线 → 可用 `/ci run`、`/ci status` | CI 工作流文件 |
| TDD 专家 | CI 配置问题 | 排查修复 CI 配置 | 修复后 CI 恢复通过 |
| QA 专家 | QA_VALIDATED 且 `qa merge` 完成后部署 | 执行部署 + 冒烟验证 + `/env check` | 部署记录写入 `/docs/data/deployments/` |
| QA 专家 | 部署后发现问题 | 执行回滚并通知 QA | 回滚记录写入部署日志 → QA 按缺陷流程登记 → 退回 TDD/QA |

## CI 工作流模板
项目决定启用 CI 时，复制 `/docs/data/templates/ops/CI-WORKFLOW-TEMPLATE.yml` 到 `.github/workflows/ci.yml` 并按项目实际调整。
