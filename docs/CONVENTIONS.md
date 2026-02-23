# 项目目录规范

本模板复制到任意项目后，请参考以下约定管理目录与文件。若现有仓库已有成熟规范，可在此基础上调整并保持 `AGENTS.md` 引用路径不变。

## 顶层结构
- `AGENTS.md`：多专家路由与流程约束（必须存在）。
- `AgentRoles/`：各阶段专家的运行时卡片；`AgentRoles/Handbooks/` 存放详细操作指南。
- `docs/`：所有产物文档、状态、数据资料的集中目录（详见下方）。
- `apps/`：所有可独立运行的应用（web、mobile、desktop、server 等），详见「项目目录结构（Monorepo）」章节。
- `packages/`：所有共享代码库（ui、core、api-client、database 等），详见「项目目录结构（Monorepo）」章节。
- `infra/`：部署与基础设施配置（Docker、k8s、Terraform、部署脚本），详见「项目目录结构（Monorepo）」章节。
- `tooling/`：内部构建工具（eslint、tsconfig 基础配置等）。
- `e2e/`：跨端端到端测试（Playwright / Cypress），详见「项目目录结构（Monorepo）」章节。
- `CHANGELOG.md`：主变更记录文件，仅保留最近 1~2 个主版本的条目。

## `docs/` 子结构与文档目录职责

### 核心产出文档（`docs/*-modules/`）

各专家的主要工作成果，是项目的核心知识资产。频繁访问和更新，结构化、模块化，作为其他阶段的输入依据。

- `docs/PRD.md`：产品需求文档（小项目时是单一 PRD.md，大项目时是主 PRD，作为总纲与索引）。
- `docs/prd-modules/`：按功能域拆分的详细 PRD，由 PRD 专家根据 `docs/prd-modules/MODULE-INVENTORY.md` 动态生成。
- `docs/ARCH.md`：架构文档（主架构文档，作为总纲与索引）。
- `docs/arch-modules/`：按功能域拆分的详细架构，由 ARCH 专家根据 `docs/arch-modules/MODULE-INVENTORY.md` 动态生成。
- `docs/TASK.md`：任务计划（主任务文档，作为总纲与索引，含 WBS/依赖/里程碑/风险）。
- `docs/task-modules/`：按功能域拆分的详细任务计划，由 TASK 专家根据 `docs/task-modules/MODULE-INVENTORY.md` 动态生成。
- `docs/QA.md`：测试计划与执行记录（主 QA 文档，作为总纲与索引）。
- `docs/qa-modules/`：按功能域拆分的详细测试计划，由 QA 专家根据 `docs/qa-modules/MODULE-INVENTORY.md` 动态生成。
- `docs/AGENT_STATE.md`：阶段状态勾选清单。
- `CHANGELOG.md`（项目根）：主变更记录，仅保存最近 1~2 个主版本条目。
- `docs/changelogs/`：历史分卷目录，存放归档的旧 CHANGELOG 文件，并包含 `README.md` 记录分卷规则与索引。
- `docs/adr/`：架构决策记录，命名格式为 `NNN-{stage}-{module}-{title}.md`。
- `docs/CONVENTIONS.md`：本文档，描述目录与约定。
- 可选扩展：`docs/security/`（威胁建模、安全评估）、`docs/ops/`（运维手册、SLO、值班指南）。

### 辅助支撑数据（`docs/data/`）

为核心文档提供支撑的辅助材料，低频访问或一次性生成，可删除或归档不影响核心知识。

- 模板文件 → `docs/data/templates/{prd|arch|task|qa|devops}/`
- QA 验证报告 → `docs/data/qa-reports/YYYY-MM-DD-<type>-<description>.md`
- 部署记录 → `docs/data/deployment-records/YYYY-MM-DD-vX.Y.Z-<env>.md`
- 追溯矩阵 → `docs/data/traceability-matrix.md`
- 变更请求（CR/SCR） → `docs/data/change-requests/`

### 决策规则

| 问题 | `*-modules/` | `data/` |
|------|-------------|---------|
| 某专家的主要工作成果？ | ✅ | ❌ |
| 被其他专家作为输入依据？ | ✅ | ❌ |
| 会持续更新/演进？ | ✅ | ❌ |
| 一次性生成的报告/记录？ | ❌ | ✅ |
| 模板/参考资料？ | ❌ | ✅ |
| 按时间序列归档？ | ❌ | ✅ |

**一句话总结**：`*-modules/` = 按功能组织的核心产出；`data/` = 按时间/类型组织的辅助数据。

## 命名与引用规则
- 目录与文件名采用 kebab-case 或 snake_case，避免空格与大写混用。
- 路径引用一律使用相对路径（例如 `./docs/PRD.md`），确保跨平台读取一致。

## Mermaid 图形文件规范

- **统一使用 `.md` 格式**存储所有 mermaid 图形文件，**禁止使用 `.mmd` 格式**（已于 2025-11-08 废弃）。

### 文件位置约定

| 文件类型 | 存放位置 | 维护者 | 示例 |
|---------|---------|--------|------|
| **全局依赖图** | `/docs/data/global-dependency-graph.md` | PRD 专家 | 跨模块 Story 依赖关系 |
| **组件依赖图** | `/docs/data/component-dependency-graph.md` | ARCH 专家 | 跨模块组件依赖关系 |
| **实体关系图** | `/docs/data/ERD.md` | ARCH 专家 | 全局数据模型 |
| **模块依赖图** | `/docs/prd-modules/{domain}/dependency-graph.md` | PRD 专家 | 模块内 Story 依赖关系 |
| **任务依赖矩阵** | `/docs/data/task-dependency-matrix.md` | TASK 专家 | 跨模块任务依赖关系 |
| **里程碑甘特图** | `/docs/data/milestone-gantt.md` | TASK 专家 | 项目时间线与里程碑 |

## Scripts 约定
- 脚本按用途分类，统一存放于 `infra/scripts/`：`infra/scripts/server/`（部署脚本）、`infra/scripts/qa-tools/`（QA 脚本）、`infra/scripts/tdd-tools/`（TDD 工具脚本）。
- Shell 脚本首行声明 `#!/usr/bin/env bash`（或所需解释器），并包含 `set -euo pipefail` 等安全选项。
- 每个脚本在开头给出 Usage 注释，说明参数与前置条件。

## Tests 约定

### 职责归属
- **TDD 专家编写并运行**：单元、集成、契约、降级测试
- **QA 专家编写并执行**：E2E、性能、安全测试
- **回归测试**：不单独编写代码，而是重新执行上述已有测试套件的子集（QA 在验收阶段执行）

### 目录与命名

| 测试类型 | 目录 | 命名规范 | 编写者 |
|---------|------|---------|--------|
| 单元测试 | 与源码 colocate | `*.test.ts(x)` | TDD |
| 集成测试 | `apps/*/tests/` | `*.integration.test.ts` | TDD |
| 契约测试 | `*/tests/contract/` | `*.consumer.pact.test.ts` / `*.provider.pact.test.ts` | TDD |
| 降级测试 | `apps/*/tests/resilience/` | `*.degradation.test.ts` | TDD |
| E2E 测试 | `e2e/tests/` | `*.e2e.spec.ts` | QA |
| 性能测试 | `perf/scenarios/` | `*.k6.ts` | QA |
| 安全测试 | `security/` + `apps/*/tests/security/` | `*.security.test.ts`（认证/授权） | QA |

## 数据库迁移文件规范

### 文件名格式
- **格式：** `YYYYMMDDHHmmss_description.sql`
- **时间戳：** 必须使用文件实际创建时的系统时间（14 位数字）
- **描述：** 使用英文，多个单词用下划线分隔，简洁明了

**示例：**
```
20251028174629_add_subscription_billing_cycle.sql
20251031222146_add_admin_role.sql
```

### 创建方法
- 推荐使用项目脚本：`./infra/scripts/tdd-tools/create-migration.sh add_user_roles --dir packages/database/prisma/migrations --dialect postgres`
- Supabase 项目：`supabase migration new add_user_roles`
- 严禁手动输入日期

### 数据库迁移幂等性原则
- **幂等性定义**：迁移脚本可以安全地被执行多次，最终结果保持一致。
- **保障机制**：使用 `IF NOT EXISTS` / `IF EXISTS` 条件判断；数据迁移前增加状态检查（`WHERE field IS NULL`）；用事务包裹每一步。
- **验证要求**：提交前至少在本地执行 3 次验证（正常执行 → 重复执行 → 回滚后再执行）。

### 数据字典同步
- 任何表结构变化必须触发数据视图生成流程，确保 `docs/data/ERD.md` 与 `docs/data/dictionary.md` 与模板保持一致。

## 环境变量文件规范

项目按三套环境管理配置，每套包含**模板文件**（可提交）和**实际文件**（含真实密钥，禁止提交）：

| 文件名 | 环境 | 类型 | Git 状态 |
|--------|------|------|----------|
| `.env.example` | dev | 模板 | ✅ 可提交 |
| `.env.local` | dev | 实际 | ❌ 禁止提交 |
| `.env.staging.example` | staging | 模板 | ✅ 可提交 |
| `.env.staging` | staging | 实际 | ❌ 禁止提交 |
| `.env.production.example` | production | 模板 | ✅ 可提交 |
| `.env.production` | production | 实际 | ❌ 禁止提交 |

**操作规则：**
- 本地开发：从 `.env.example` 复制为 `.env.local`，按需填写真实值
- 新增环境变量时：必须同步更新对应的 `*.example` 文件（写占位值，不含真实密钥）
- **禁止**将含真实密钥的 `.env.*`（非 `*.example`）文件写入 git
- `.gitignore` 必须遮盖所有实际环境变量文件

## 其他约定
- 机密文件保持 `.gitignore` 遮盖；若需本地存放，创建 `secret/README.md` 引导操作。

## 项目目录结构（Monorepo）

本项目采用 pnpm workspaces + Turborepo 的 Monorepo 架构。

```
项目根目录/
├── package.json              # 根 package.json（workspace 定义 + 全局 devDeps + CI 脚本）
├── apps/                     # 可独立运行的应用（不互相 import，只依赖 packages）
│   ├── web/                  # Web 前端（Next.js / React）
│   │   ├── src/              # 源代码（单测 colocate：Button.tsx + Button.test.tsx）
│   │   ├── tests/            # integration 测试
│   │   └── package.json
│   ├── desktop/              # 桌面客户端（Electron / Tauri）
│   │   ├── src/              # 共享 TS/JS 源代码（单测 colocate）
│   │   ├── src-tauri/        # Tauri: Rust 后端 + 平台构建配置
│   │   ├── resources/        # 平台特定资源（图标、安装器配置等）
│   │   │   ├── macos/        #   .icns, entitlements.plist
│   │   │   ├── windows/      #   .ico, NSIS/WiX 安装器配置
│   │   │   └── linux/        #   .desktop, AppImage 配置
│   │   ├── tests/            # integration 测试
│   │   └── package.json
│   ├── mobile/               # 移动端（React Native / Expo）
│   │   ├── src/              # 共享 TS/JS 源代码（单测 colocate）
│   │   ├── ios/              # Xcode 项目 + 原生模块
│   │   ├── android/          # Gradle 项目 + 原生模块
│   │   ├── tests/            # integration 测试
│   │   └── package.json
│   ├── server/               # 后端 API（Node / NestJS / Fastify）
│   │   ├── src/              # 源代码（单测 colocate）
│   │   ├── tests/            # 集成/契约/降级/安全测试
│   │   │   ├── *.integration.test.ts   # 集成测试（API endpoint + DB）
│   │   │   ├── contract/               # 契约测试（Provider 验证）
│   │   │   ├── resilience/             # 降级测试（Circuit Breaker/Retry/Fallback）
│   │   │   └── security/               # 认证/授权安全测试
│   │   └── package.json
│   ├── worker/               # 后台任务 / queue consumer
│   └── admin/                # 管理后台
│
├── packages/                 # 共享代码（被 apps 引用，不能反向依赖 apps）
│   ├── core/                 # 核心业务逻辑（纯 TS，零框架依赖）
│   ├── domain/               # 领域模型（数据结构、业务规则）
│   ├── ui/                   # 跨端 UI 组件库
│   ├── ai/                   # AI 相关封装
│   ├── auth/                 # 鉴权逻辑
│   ├── billing/              # 计费逻辑
│   ├── analytics/            # 数据分析
│   ├── api-client/           # 前端统一 API 调用封装
│   │   ├── tests/
│   │   │   └── contract/     # 契约测试（Consumer 端）
│   ├── database/             # 数据库层（Prisma / Drizzle + 迁移 + 数据访问）
│   │   ├── prisma/           # ORM schema（Prisma；若用 Drizzle 则为 drizzle/）
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── src/
│   │   │   ├── client.ts     # 统一 DB 连接实例（整个 Monorepo 唯一入口）
│   │   │   ├── config.ts     # 连接配置
│   │   │   ├── models/       # ORM 模型扩展（computed 字段、复杂 query builder）
│   │   │   │   ├── user.ts
│   │   │   │   ├── organization.ts
│   │   │   │   └── ...
│   │   │   ├── repositories/ # 数据访问层（强烈推荐：解耦 ORM，便于测试与替换）
│   │   │   │   ├── user.repo.ts
│   │   │   │   ├── org.repo.ts
│   │   │   │   └── ...
│   │   │   ├── services/     # DB 数据服务（事务、分页等）
│   │   │   │   ├── transaction.ts
│   │   │   │   └── pagination.ts
│   │   │   ├── types.ts      # 数据库相关类型定义
│   │   │   └── index.ts      # 统一导出（re-export client、repositories、types 等）
│   │   ├── scripts/          # 操作脚本（migrate / reset / generate 的封装）
│   │   │   ├── migrate.ts
│   │   │   ├── reset.ts
│   │   │   └── generate.ts
│   │   ├── .env.example
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── sdk/                  # 对外 SDK
│   ├── hooks/                # 共享 React hooks
│   ├── utils/                # 工具函数
│   ├── types/                # 全局 TypeScript 类型
│   └── config/               # 共享配置（ESLint / TS / Tailwind）
│
├── infra/                    # 部署与基础设施配置
│   ├── docker/
│   ├── k8s/
│   ├── terraform/
│   └── scripts/              # 自动化脚本
│       ├── server/           # 服务器部署脚本（deploy.sh、frontend-dev-pm2.sh 等）
│       ├── qa-tools/         # QA 脚本（generate-qa.js、qa-verify.js、qa-merge.js）
│       ├── tdd-tools/        # TDD 工具脚本（create-migration.sh 等）
│       ├── arch-tools/       # ARCH 工具脚本
│       ├── prd-tools/        # PRD 工具脚本
│       ├── task-tools/       # TASK 工具脚本
│       └── cron/             # 定时任务脚本和列表
│
├── tooling/                  # 内部构建工具（不发布到 registry）
│   ├── eslint/
│   ├── tsconfig/
│   └── commitlint/
│
├── e2e/                      # E2E 测试（Playwright），QA 专家编写
│   ├── tests/                #   测试脚本（*.e2e.spec.ts）
│   ├── pages/                #   Page Object Model
│   ├── fixtures/             #   自定义 Fixtures
│   └── playwright.config.ts
│
├── pacts/                    # 契约测试输出（Pact JSON，自动生成，已 .gitignore）
│
├── perf/                     # 性能测试（k6），QA 专家编写
│   ├── scenarios/            #   按场景命名的 k6 脚本（*.k6.ts）
│   ├── thresholds.ts         #   共享阈值配置
│   └── k6.config.ts          #   k6 运行配置
│
├── security/                 # 安全测试，QA 专家维护
│   ├── zap/                  #   OWASP ZAP DAST 扫描配置
│   │   ├── zap-baseline.conf #     Baseline 扫描配置
│   │   ├── zap-api-scan.conf #     API 扫描配置
│   │   └── zap-rules.tsv     #     误报过滤规则
│   ├── semgrep/              #   SAST 自定义规则
│   │   └── .semgrep.yml
│   └── checklists/           #   手工渗透测试清单
│       └── owasp-top10.md
│
├── turbo.json                # Turborepo 构建管道配置
└── pnpm-workspace.yaml       # 声明 apps/* packages/* tooling/* 为 workspace
```

**核心原则：**
- `apps/*`：独立可启动，不互相引用，只依赖 `packages/*`
- `packages/*`：沉淀共享逻辑，不依赖任何 `apps/*`
- `packages/database`：整个 Monorepo 唯一 DB 入口，只有 `server` 引用；禁止在 `server` 中直接写 `prisma.user.findMany()`，必须通过 `repositories/` 访问
- `packages/api-client`：web / mobile / desktop 共用，统一管理后端接口调用
- `packages/core` 与 `packages/domain`：纯 TS，无框架依赖，可在全端复用
- `infra/scripts/`：所有自动化脚本统一存放；`server/`（部署）、`qa-tools/`（QA）、`tdd-tools/`（TDD 工具）、`arch-tools/`（ARCH 工具）、`prd-tools/`（PRD 工具）、`task-tools/`（TASK 工具）、`cron/`（定时任务）
- **测试目录结构**：单测 colocate 在源码旁；集成/契约/降级测试在 `apps/*/tests/`（TDD 编写）；E2E 在 `e2e/`、性能在 `perf/`、安全在 `security/`（QA 编写）；`pacts/` 为契约测试自动输出（.gitignore）
- **package.json 层级**：根目录必须有 `package.json`（workspace 定义 + 全局 devDeps）；每个 `apps/*` 和 `packages/*` 都有自己的 `package.json`（独立 workspace 包）
- **依赖管理**：应用运行依赖（react、next 等）写在各自 `apps/*/package.json`，禁止提升到根目录；全局工具类（eslint、turbo、typescript）写在根 `devDependencies`

### Database 层级设计（`packages/database`）

| 层 | 目录 | 职责 | 规则 |
|---|------|------|------|
| **Schema** | `prisma/`（或 `drizzle/`） | schema 定义、迁移文件、seed 数据 | 只放 schema 和 DDL，不放业务逻辑 |
| **Client** | `src/client.ts` | 统一创建数据库实例 | 整个 Monorepo 唯一 DB 入口；所有 app 通过此文件获取 db 实例 |
| **Repository** | `src/repositories/` | 数据访问抽象（DDD / Clean Architecture） | 禁止在 app 中直接调用 `prisma.user.findMany()`，必须通过 `userRepository.findByEmail(email)`；便于解耦 ORM、测试 mock、未来替换 |
| **Model** | `src/models/` | ORM 模型扩展（可选） | computed 字段、复杂 query builder、domain 映射 |
| **Service** | `src/services/` | DB 级数据服务 | 事务编排、分页封装等与 DB 强相关的通用逻辑 |
| **Scripts** | `scripts/` | 操作脚本 | 对 `prisma migrate deploy`、`prisma db reset` 等 CLI 命令的封装（可加环境检查、日志、确认提示）；与 `prisma/migrations/`（自动生成的 DDL）不同 |
