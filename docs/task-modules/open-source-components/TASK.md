# 开源公共能力任务

依据：[PRD](../../prd-modules/open-source-components/PRD.md)、[ARCH](../../arch-modules/open-source-components/ARCH.md)。Owner：模板维护者。状态：实现与功能验证通过；交付门禁进行中。

| Task | Story | 交付与验证单元 | 依赖 |
| --- | --- | --- | --- |
| TASK-OSSKIT-001 | US-OSSKIT-001,008 | 配置/catalog/依赖闭包/所有权与 RED 测试 | 现有生成器 |
| TASK-OSSKIT-002 | US-OSSKIT-002 | Better Auth/CASL/Prisma Schema/迁移/客户端隔离及真 DB 测试 | 001 |
| TASK-OSSKIT-003 | US-OSSKIT-003 | pg-boss/BullMQ、迁移、事务/恢复与真 PG/Redis 测试 | 001 |
| TASK-OSSKIT-004 | US-OSSKIT-004,005 | Uppy/Tiptap/Chart/Virtual/Sortable/Flow 与 shadcn 组合测试 | 001、文件存储 |
| TASK-OSSKIT-005 | US-OSSKIT-006,007 | i18next/Pino/OTel/MSW 与隔离/脱敏/生命周期测试 | 001 |
| TASK-OSSKIT-006 | US-OSSKIT-001～008 | 实际消费者组合、审计、升级回归、状态目录与指南 | 002～005 |
| TASK-OSSKIT-007 | US-OSSKIT-008 | 全量回归、QA、PR 合并与 completion guard | 006、文件存储验收 |

关键路径：配置 → 后端/交互/工程模块 → 消费者组合验证 → 交付。DB Expand 使用独立模型与只追加迁移；Migrate 只在隔离实例显式执行；无生产 Backfill/Contract，不清空业务库。认证和队列不同 schema 独立配置；投递与外部副作用以幂等和恢复验证。

部署与外部账号由项目配置，模板不创建云资源或 GitHub workflow。每项以实际测试结束更新状态，历史研究证据仅作为输入，不能替代生成消费者的新验证。

功能验证详见 [QA](../../qa-modules/open-source-components/QA.md)。提交/合并/清理的唯一状态保存在本机 task/session，最终完成以 main 与 completion guard 为准。
