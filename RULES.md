# 始终用中文回复

> **路径基准**：本文件中所有相对路径以 `repo/`（Git 主 worktree 根，即本文件所在目录）为基准，不是外层容器 `<container>/`（即 `repo/` 的上级目录）；详见 `AGENTS.md` §仓库拓扑。

# UI 组件复用规范

**能复用尽量复用 shadcn/ui 组件**，不要平行再造一套。

- 优先复用项目内已经封装好的 shadcn 组件与公用 primitives（如 `Button`、`Input`、`Select`、`Dialog`、`Table`、`PaginationBar` 等）
- 只有在现有组件确实无法满足需求、且扩展现有组件不合理时，才允许新增封装
- 新增 UI 能力时，优先补到公用组件层，而不是在页面里各写一份
- 样式保持统一，遵循现有 design tokens、variant、size、状态样式和交互模式，避免同类控件出现多套视觉语言

# API 架构规范

**禁止新建 Server Actions**。根据 [ADR-066](docs/adr/066-unify-api-routes-architecture.md)，项目已统一使用 API Routes 架构。

- 所有后端接口必须写在 `apps/web/src/app/api/` 目录下
- `apps/web/src/app/actions/` 目录已完全删除，**禁止**重新创建
- AI 生成任务遵循**提交-轮询二阶段模式**：
  - `POST /api/{module}/{action}/generate` → 提交任务，返回 taskId
  - `GET /api/{module}/{action}/poll` → 轮询状态，完成时扣费（CAS 防护）
- 前端统一使用 `apiClient`（`apiGet`/`apiPost`/`apiPut`/`apiDelete`）调用接口，禁止原生 `fetch`
- 接口规范详见：[UNIFIED-API-SPEC.md](docs/api/UNIFIED-API-SPEC.md)
- 前端迁移指南：[API-CLIENT-MIGRATION.md](docs/API-CLIENT-MIGRATION.md)

# 远程数据存储连接规范

**staging/production 数据库和缓存访问方式**：
- 禁止从本地直接连接 staging/production 的 PostgreSQL 数据库或 Redis 缓存
- 必须先 SSH 到对应服务器，然后在服务器上连接数据库/Redis
- 数据库操作脚本：`infra/scripts/server/deploy-database.sh`、`infra/scripts/server/deploy-server-mode.sh`
- 本地开发（dev）可直接连接 localhost 的数据库和 Redis

# Next.js 路由保护

**禁止使用 `middleware.ts`**。Next.js 16 已废弃 middleware，必须使用 `proxy.ts`。

- 路由保护逻辑写在 `apps/web/src/proxy.ts`
- 不要创建 `middleware.ts` 文件
- 参考文档：https://nextjs.org/docs/messages/middleware-to-proxy

# 本地开发环境初始化

**新机器首次拉起本地开发环境**，使用快捷命令 `/init local`。

- 命令绑定：`/init local` → `pnpm bootstrap:local` → `bash infra/scripts/server/bootstrap-local.sh`
- 执行内容（幂等，可重复运行）：
  1. 检查前置依赖（docker / pnpm / node）
  2. `pnpm install --frozen-lockfile`
  3. 若缺 `.env.local`，从 `env.example` 复制并提示手动填密钥（AI Key / OSS 凭证）后退出（exit 2）
  4. `docker compose up -d` 启动 PostgreSQL + Redis 容器，等待 healthy
  5. `prisma generate` + `prisma migrate deploy` 建表
  6. 调用 `server-dev.sh start` 拉起 Next.js dev server
- 前置：Docker Desktop / OrbStack 已安装并启动；pnpm、fnm（Node 版本管理器）已安装
- 本命令仅用于**全新机器/环境**的首次初始化；日常重启用 `/restart`（`pnpm dev:restart`）

# 用户文案双语维护规范

**所有展示给用户的文字必须同时维护中英文两个版本**，禁止在组件中硬编码任何中文或英文字符串。

- **双语同步**：新增或修改任何用户可见文字时，必须同时更新：
  - `apps/web/src/dictionaries/zh-CN/`（中文版本）
  - `apps/web/src/dictionaries/en-US/`（英文版本）
- **禁止硬编码**：组件中禁止直接写中文或英文字符串，所有文案必须通过字典系统访问：
  - Server Component：`getSiteDictionary(locale).xxx`
  - Client Component：`useSiteDictionary().xxx`
- **覆盖范围**：按钮文字、标签、提示信息、错误文案、占位符、空状态文字、Toast 通知、对话框标题与内容等一切用户可见文字
- **键命名**：按页面/功能模块组织，遵循现有字典的嵌套结构（如 `pages.xxx.yyy`）；内容较多时可拆分到 `site.extra.ts`
