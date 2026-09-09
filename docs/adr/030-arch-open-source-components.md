# ADR-030：按能力选择开源组件与兼容组合

状态：Accepted。日期：2026-09-09。依据：用户确认 Prisma，并授权全部推荐组件实施。

模型作业协议保持在 agent 包，组件选择、生成、依赖与检查进入 architecture。每个模块有独立安装目录及服务器/浏览器边界；不通过根包预装全部依赖。完整版本、许可、官方来源和备选状态由 [组件目录](../../architecture/open-source-catalog.json) 维护。

| 领域 | 采用与依据 | 备选采用条件 |
| --- | --- | --- |
| 身份 | Better Auth + Prisma，同进程 Node TS 集成、会话与组织，PG/SQLite 可运行 | Auth.js 用于既有 OAuth 工程；Keycloak 用于独立企业 OIDC/SAML 服务和跨语言消费者 |
| 权限 | CASL/Prisma 将默认拒绝规则约束到实际模型查询与条件写入 | Casbin 适用于跨语言策略；Node 依赖审计问题需先解决 |
| 任务 | 现有 PG 优先 pg-boss；需要独立队列时显式选 BullMQ Redis 或 PG | Temporal 面向长流程补偿；Asynq 为 Go/Redis 候选，均不冒充本轮可初始化实现 |
| 文件 | 统一接口、AWS SDK S3、原生 OSS/COS、本地文件，按语言安装 | MinIO 专用客户端需重新审计；Unstorage 是 KV/cache，不替代文件服务 |
| UI | Uppy/Tiptap/Recharts/Virtual/dnd-kit/React Flow 负责行为，shadcn 负责公共交互 | 商业插件和大型独立产品不默认进入模板 |
| 工程 | i18next、Pino、OpenTelemetry 追踪、MSW 独立可选 | 生产日志/指标/追踪平台按项目环境选择 |

比较同时考虑公开许可、维护、Node/React/Prisma peer、运维成本、真实调用与失败恢复；不以版本号替代兼容验证。固定 Better Auth utils 0.4.2 精确 peer，隔离 Vitest 5 测试包；保留已有 TypeScript 6、TanStack Table 8 与 Prisma 7 稳定接口。所有推荐组合经过独立消费者验证，备选不自动安装。

身份、租户策略、译文、Mock 处理器和业务接线归项目，仅初始化；复用实现三方更新，包清单结构合并，迁移只追加。单模块采用也生成必要应用依赖和数据源配置。队列后端、身份数据库或存储 provider 的改变须显式项目迁移。

源码与使用细节见 [开源能力指南](../../architecture/guides/open-source-components.md)。真实云、邮件、SSO、原生回调和生产容量需实际项目验收，不由本地功能测试推断。

根 package.json 和 .gitignore 是两能力的共享接入点，保留已有可信 owner；按 baseline 合并各自贡献，项目修改仍走三方冲突检查。先采用作业或架构均可，agent-only 更新不移除 workspace 字段，architecture-only 更新不移除作业命令。
