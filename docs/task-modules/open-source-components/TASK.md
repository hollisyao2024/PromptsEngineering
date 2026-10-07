# 开源公共能力任务

依据：[PRD](../../prd-modules/open-source-components/PRD.md)、[ARCH](../../arch-modules/open-source-components/ARCH.md)。Owner：模板维护者。状态：3.3 功能验收通过 / Go，见 [QA](../../qa-modules/open-source-components/QA.md)。外部身份服务、原生回调和生产负载仍由实际项目验证；本次仅校正已完成模块的状态入口。US-OSSKIT-009（业务测试驱动脚手架 `e2e`，[ADR-039](../../adr/039-arch-e2e-driver-scaffold.md)）由 TASK-OSSKIT-008～011 承担，随 3.10.0 交付，验收记录见 [QA](../../qa-modules/open-source-components/QA.md) 第 4、8 节。

| Task | Story | 交付与验证单元 | 依赖 |
| --- | --- | --- | --- |
| TASK-OSSKIT-001 | US-OSSKIT-001,008 | 配置/catalog/依赖闭包/所有权与 RED 测试 | 现有生成器 |
| TASK-OSSKIT-002 | US-OSSKIT-002 | Better Auth/CASL/Prisma Schema/迁移/客户端隔离及真 DB 测试 | 001 |
| TASK-OSSKIT-003 | US-OSSKIT-003 | pg-boss/BullMQ、迁移、事务/恢复与真 PG/Redis 测试 | 001 |
| TASK-OSSKIT-004 | US-OSSKIT-004,005 | Uppy/Tiptap/Chart/Virtual/Sortable/Flow 与 shadcn 组合测试 | 001、文件存储 |
| TASK-OSSKIT-005 | US-OSSKIT-006,007 | i18next/Pino/OTel/MSW 与隔离/脱敏/生命周期测试 | 001 |
| TASK-OSSKIT-006 | US-OSSKIT-001～008 | 实际消费者组合、审计、升级回归、状态目录与指南 | 002～005 |
| TASK-OSSKIT-007 | US-OSSKIT-008 | 全量回归、QA、PR 合并与 completion guard | 006、文件存储验收 |
| TASK-OSSKIT-008 | US-OSSKIT-009 | RED：e2e 的生成与所有权、契约集成、边界拒绝与元数据一致性失败测试，确认因缺失 e2e 能力而失败 | 现有生成器、001 |
| TASK-OSSKIT-009 | US-OSSKIT-009 | e2e 模板与生成器：校验、`playwright.config.ts`、`src/apps.ts`、示例用例、README、`workspace-check` 私有根；schema、manifest、依赖、审计、catalog、指南与示例配置同步 | 008 |
| TASK-OSSKIT-010 | US-OSSKIT-009 | 真实驱动取证：真实 Playwright 1.62.1 与系统 Chrome 运行生成物，生成包离线 `tsc --noEmit`，脱敏 JUnit 夹具与解析回归，临时仓库 `qa paths`、`qa run`、`qa verify` 放行与阻断各一次 | 009 |
| TASK-OSSKIT-011 | US-OSSKIT-009 | 文档与发布：业务测试自动化与 QA 手册改指向本模块、CHANGELOG、版本 3.10.0 与 3.6.0、追溯矩阵、QA 与索引回填，回归、PR 合并与 completion guard | 010 |

关键路径：配置 → 后端/交互/工程模块 → 消费者组合验证 → 交付。DB Expand 使用独立模型与只追加迁移；Migrate 只在隔离实例显式执行；无生产 Backfill/Contract，不清空业务库。认证和队列不同 schema 独立配置；投递与外部副作用以幂等和恢复验证。

US-OSSKIT-009 关键路径（串行，无可并行项）：RED（008）→ 模板与生成器（009）→ 真实驱动取证（010）→ 文档与发布（011）；009 内部先做 schema、manifest 与校验，再做模板与元数据。该路径只依赖既有生成器和业务测试自动化契约，不改变 001～007 的产物。DB 任务不适用：不涉及 schema 与迁移，无 Expand、Migrate、Contract 与 Backfill。DevOps 任务不适用：不创建或修改 workflow，浏览器由项目显式获取，模板不下载。规划风险：真实 react-vite、react-next 开发服务器对端口参数的处理未用真实依赖验证，由 QA 披露；Playwright 1.63.0 未运行，本机 store 只有其 `playwright-core`，无法离线验证 `@playwright/test`；真实驱动取证依赖本机 pnpm store 中的 Playwright 1.62.1、typescript 6.0.3、@types/node 22.20.1 与系统 Chrome，不下载，缺失时在 QA 如实披露，不以跳过代替证据。

部署与外部账号由项目配置，模板不创建云资源或 GitHub workflow。每项以实际测试结束更新状态，历史研究证据仅作为输入，不能替代生成消费者的新验证。

功能验证详见 [QA](../../qa-modules/open-source-components/QA.md)。提交/合并/清理的唯一状态保存在本机 task/session，最终完成以 main 与 completion guard 为准。
