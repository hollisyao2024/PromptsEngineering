# 文件存储实施任务

依据：[PRD](../../prd-modules/file-storage/PRD.md)、[ARCH](../../arch-modules/file-storage/ARCH.md)。状态：实现与功能验证通过；交付门禁进行中。Owner：模板维护者。预估按验证单元记录，运行状态在 task state 保存。

| Task | Story | 交付物 | 前置 | 状态 |
| --- | --- | --- | --- | --- |
| TASK-STORAGE-001 | US-STORAGE-001,008 | 配置、生成器、所有权与负向测试 | 既有架构包 | Verified |
| TASK-STORAGE-002 | US-STORAGE-002,003,007 | Node 四适配、配置、多存储、能力与 SDK 测试 | 001 | Verified |
| TASK-STORAGE-003 | US-STORAGE-004,005 | 元数据、暂存转正、恢复、HTTP、PG/SQLite 迁移 | 002 | Verified |
| TASK-STORAGE-004 | US-STORAGE-006 | 客户端、shadcn 上传组件与接线示例 | 003 | Verified |
| TASK-STORAGE-005 | US-STORAGE-001,002,003,004,007 | Go 四适配、同一文件协议、持久化端口及编译 | 001,003 | Verified |
| TASK-STORAGE-006 | US-STORAGE-001～008 | 消费者构建/升级、审计、云测试入口与指南 | 001～005 | Verified |
| TASK-STORAGE-007 | US-STORAGE-008 | QA、PR、合并和 completion guard | 006 | Verified |

关键路径：001 → 002 → 003 → 004/005 → 006 → 007。

## 数据库与交付

Expand：新增 FileObject 模型和 PG/SQLite SQL；Migrate：仅隔离消费者显式执行；Contract：无删除。Backfill：无历史自动迁移；双写观察：暂存/完成/删除负例；对账：head/大小/主体/storeId；回滚：保留可恢复状态、不 reset。业务 Schema 与既有 SQL 保留。

环境与持久化说明随指南交付。真实云资源与生产部署不执行；GitHub workflows 保持项目所有权，本地执行门禁。语义审查覆盖授权、路径、签名、并发和升级冲突；Codex review skipped by policy。

功能验证详见 [QA](../../qa-modules/file-storage/QA.md)。提交/合并/清理的唯一状态保存在本机 task/session，最终完成以 main 与 completion guard 为准。
