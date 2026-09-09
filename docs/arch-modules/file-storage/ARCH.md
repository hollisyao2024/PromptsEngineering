# 统一文件存储架构

需求：[PRD](../../prd-modules/file-storage/PRD.md)。决策：[ADR-029](../../adr/029-arch-file-storage-adapters.md)。覆盖 US-STORAGE-001～008。

## 1. 组件与选择

architecture.config.json 新增可选 fileStorage；省略时保持旧行为。字段包含 path（默认 packages/storage）、runtime（node/go）、consumers、defaultStore、stores（id/provider/envPrefix）、可选 metadata.datastore 与 uploadApplications。只允许同一服务端运行语言的消费者，异语言通过文件 HTTP 协议访问。Node 支持现有 JS/TS 应用；Prisma 元数据要求 v2 Node TS。

| 组件 | 实际位置 | 职责 |
| --- | --- | --- |
| 存储库 | 配置 path | 公共 Provider、配置、路由、错误、能力、文件服务、元数据端口、HTTP 适配 |
| 适配器 | 库内 providers | local、AWS SDK v3、ali-oss、COS 官方 SDK；Go 使用对应官方 Go SDK |
| 浏览器入口 | Node 包 ./client，Go 项目的独立客户端文件 | 纯公开 DTO 和上传传输，不导入服务端模块 |
| 上传组件 | 已选择应用/共享 UI 的 advanced 目录 | shadcn 组合，进度/取消/重试，服务端会话由项目注入 |
| 元数据 | Prisma 独立 model 文件或服务端私有目录 | 文件定位、主体、状态、版本；签名 URL 不持久化 |

配置只记录环境变量前缀，不写凭据/真实桶。SDK 依赖按 provider 闭包生成。Node 包通过明确 exports 区隔浏览器入口；检查器阻断 SDK、数据库、服务端 storage 导入浏览器。Go 使用独立 go.mod 及应用 replace，不把 Go 库变成 npm 包。

## 2. 运行与接口

业务授权 → 文件服务 → 元数据仓库 + storeId 路由 → Provider。公共 Provider 提供 put/get/delete/head/list、签名上传/下载和能力声明；不支持的能力显式报错。分页游标不解释为跨服务商通用游标。内容有大小上限、流式传输和取消，不通过 ETag 假定全厂商 MD5。

HTTP 适配提供会话创建、上传代理、完成、取消、文件元数据/列表、下载、删除。每次操作由注入的授权函数产生主体，主体 ID 不信任请求体。浏览器仅获得受限签名 URL 或同源代理路径，长期密钥不进入公开 DTO。

上传对象先写隔离暂存键，完成时校验大小/类型并流式复制到独立最终键，成功后标记 ready。这样未过期的上传 URL 重放只能改变暂存对象。元数据库以版本比较保护状态；中断的完成/删除通过明确恢复入口收敛。未 ready 的文件不得下载。签名 PUT 绑定声明 Content-Length/Content-Type，大小在完成时再次强制核对，暂存区需独立生命周期清理，不假称云端提前拒绝所有超大文件。

## 3. 数据与一致性

FileObject：id、ownerId、storeId、objectKey、state、version、record（版本化元数据 JSON）、createdAt、updatedAt；索引 ownerId/id、state/updatedAt，storeId/objectKey 唯一。record 包含名称、类型、大小、暂存键、最终键、有效期、恢复信息；无凭据或签名 URL。Node Prisma 适配针对该模型；Go/无数据库 Node 可使用持久化文件仓库，跨进程冲突拒绝，不把进程内内存作为默认持久化。

选定 Prisma 时新增独立 file-storage.prisma（init-if-missing）及新 SQL 迁移（append），prisma.config.ts 切换目录 schema；原业务 schema 原样保留，PG/SQLite 各有 SQL。init/update 不迁移数据库。只改默认存储影响新记录，移除仍被历史记录引用的 store 不自动迁移或回退。

文件与数据库没有分布式原子事务。使用状态机和唯一对象键保证重试可核验，删除先标 deleting、成功后标 deleted；失败保留恢复状态。恢复需重新校验主体和记录版本，日志只记录错误码/文件 ID，不包含 SDK 原始错误和签名。

## 4. 安全、扩展与运维

本地存储目录必须为服务进程私有持久化目录，拒绝路径逃逸/符号链接，原子文件替换与显式锁保护可见状态。云配置校验 HTTPS、地域和桶，内网端点与客户端公开端点分别处理，不能把内网签名 URL 交给公网客户端。默认短期凭据可注入动态提供器，SDK 不在日志输出凭据。

媒体处理及供应商专有功能通过服务端扩展入口注册并声明能力，不默认启用外部任务。首版基础上传会话使用单对象上传；分片/断点等能力只在实际实现后声明，不以 SDK 有方法冒充公共协议已支持。测试报告列出合约、真实服务、性能与平台的独立证据。

## 5. 所有权与验证

通用实现 update；package.json 与 go.mod 结构化/文本三方合并；环境、业务接线示例、Schema init-if-missing；SQL append。取消选型不会偷偷卸载或删除历史文件，路径/运行语言/已有 store provider 变更需要显式迁移。升级用已有引擎冻结计划和恢复，不增加第二套 updater。

验证：配置负例与旧配置回归；四 Provider 合约、签名参数与取消；Node/Go 真编译与本地文件旅程；Prisma PG/SQLite；上传组件；消费者初始化/更新/定制保护；opt-in 真云测试。真实 OSS/COS 无配置时标未验证，不能拿 HTTP fixture 代替。
