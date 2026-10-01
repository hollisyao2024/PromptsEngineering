# Drizzle 与常见数据库架构

需求：[PRD](../../prd-modules/drizzle/PRD.md)。决策：[ADR-033](../../adr/033-arch-drizzle-database-matrix.md)。

## 1. 边界与选择
应用 → 服务端数据包 → ORM → 数据库；公开 contracts/domain 不导入 ORM。datastores.access 为 prisma 或 drizzle。稳定版 Drizzle 0.45.3/Kit 0.31.11 支持 postgres/mysql/mariadb/sqlite；sqlserver/cockroachdb 的 Drizzle 原生支持依赖 RC，当前明确阻断。Prisma 7 保持默认并支持六种 engine，MySQL/MariaDB 共用 mysql provider 与 MariaDB adapter；CockroachDB 使用专用 provider，SQL Server 使用 MSSQL adapter。旧 v1 SQL 仅支持原有 PG/SQLite。

## 2. 组件与目录
每库 packages/database/<id> 独立 URL/驱动/历史。Drizzle src/schema/*.ts 是项目所有权，src/client.ts 初始化驱动；drizzle.config.ts 指定 dialect/schema/out。固定 Kit 旧格式 drizzle/*.sql + meta/*snapshot.json + meta/_journal.json；这些是同一迁移链的组成，不再另建执行账本。Prisma 保留 prisma/schema.prisma 与 prisma/migrations。

## 3. 运行与迁移
初始化/更新离线；generate 生成客户端（Prisma）或仅验证 TS 可编译（Drizzle），不得在 workspace build 中生成迁移。Drizzle db:generate 显式生成 SQL/快照，db:status 只核验磁盘和数据库 __drizzle_migrations，db:deploy 预检后执行同一原生 migrator；不暴露生产 push/reset。历史数量/顺序/摘要、未知或缺失记录均阻断。数据库包迁移器防混用，SQL 只追加；snapshot 与 journal 随 SQL 提交并由项目禁止改写，包装器校验快照链结构、journal 顺序与已执行 SQL 前缀；原生历史不保存快照内容摘要。连接生命周期显式关闭；环境分库/文件隔离，非 SQLite Prisma 开发迁移要求 shadow。

## 4. 周边适配与事务
任务示例切换服务实现，公开 API 保持。Better Auth 使用对应 adapter 与方言 schema；CASL Drizzle 适配将允许条件编译为 SQL，拒绝未知操作/字段并默认拒绝，条件写入必须把授权与版本过滤放在同一 SQL。文件仓库独立实现 owner/store/version CAS 和唯一对象键。pg-boss PostgreSQL 同库事务通过参数化执行桥接；非 PG 队列同库事务明确不支持，外部存储双写仍采用既有恢复协议。

## 5. 安全、升级与验证
engine/access 变更继续要求显式项目迁移；禁止浏览器导入 drizzle-orm 与驱动。所有权策略保持 schema 初始写、迁移追加、通用包装三方更新。真实隔离数据库验证成功/回滚、历史异常、身份和文件 CAS；PG/MySQL/MariaDB/SQL Server/CockroachDB 需分别注明实际运行证据，不把静态生成等同真实连接。以真实消费者 generate/build/检查和对应定向回归验收 US-DRIZZLE-001～004。

PostgreSQL 隔离 PoC：稳定 Kit 为 pgTable 外键输出显式 public 引用，不能仅靠 search_path 迁移到其他 schema。Drizzle 默认采用 worktree 独立数据库，连接中的非 public schema 在生成包装入口明确阻断；自定义 pgSchema 必须由项目独立集成并验证。Prisma 的 schema 隔离不变。SQLite Drizzle 另以实际数据库路径的排他锁协调跨 worktree 迁移；失败后同时保留包内 .migration-running.json 与数据库旁的 -xirang-migration-lock.json，先核对状态再解除。status 对不存在的 SQLite 文件仅报告 pending，不创建数据库；迁移拒绝内存数据库。
