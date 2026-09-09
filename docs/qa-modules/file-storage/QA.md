# 统一文件存储 QA

状态：Passed / Go。版本：3.3.0。日期：2026-09-09。负责人：模板维护者。提交以最终 QA receipt 为准。

## 1. 输入与范围

依据 [PRD](../../prd-modules/file-storage/PRD.md)、[ARCH](../../arch-modules/file-storage/ARCH.md)、[TASK](../../task-modules/file-storage/TASK.md)。Node/Go local、S3、OSS、COS、上传会话、多存储、持久化元数据、UI 和所有权升级。公共环境/浏览器/性能证据见 [整体组件 QA](../open-source-components/QA.md)。

## 2. 验收矩阵

| Story / TC 后缀 | 覆盖 | 状态 |
| --- | --- | --- |
| 001 | 只安装所选 SDK，Node/Go 隔离，错误配置/浏览器导入拒绝，旧配置保留 | Pass |
| 002 | Node 原生三 SDK HTTP 协议夹具，Go 三 SDK 编译与签名，本地二进制读写删/head/list，0 字节与错误长度/路径/symlink | Pass |
| 003 | 默认存储仅改变新记录，历史 storeId 稳定、未知 store 不回退，持久重开 | Pass |
| 004 | 主体绑定、未 ready 不下载、大小/MIME/TTL 限制、签名 Content-Length/Content-Type、短期凭据刷新、暂存重放不改最终文件 | Pass |
| 005 | Prisma PG/SQLite 真实元数据与 CAS，缺对象完成失败、活跃 lease 拒绝恢复、过期 lease 竞争恢复和重试、删除重试 | Pass |
| 006 | Uppy/shadcn 进度、移除与取消端口、超限/错误格式拒绝、实际浏览器上传后 DB+内容一致，退出身份后拒绝 | Pass |
| 007 | 未声明扩展 UNSUPPORTED、扩展输入上限、multipart/resumable=false；真实云测试缺凭据显式跳过 | Pass（真实云未验证） |
| 008 | 按需生成收敛、模板 sync 拒绝隐式新采用、Schema/SQL/业务保护，独立根文件贡献 | Pass |

每项映射 US-STORAGE-xxx / AC-STORAGE-xxx-01 / TC-STORAGE-xxx。源核心 3 项、生成器 5 项；Node 消费者 8 pass / 1 opt-in skip；Go `go test -race ./...` 与实际应用构建通过。三云 Go 的真实远端 roundtrip 入口亦保留 opt-in，不以签名测试冒充云服务联调。

## 3. 执行与安全边界

入口为 architecture/__tests__/storage*.test.js、生成 storage 的 Node tests/*.test.mjs 和 Go *_test.go、architecture/tests/open-source.integration.mjs、e2e/tests/open-source-components.e2e.mjs。真实云仅在 XIRANG_LIVE_STORAGE_PROVIDER 与 LIVE_* 配置下运行，用唯一合成前缀并 finally 清理。

对象二进制与元数据是双写。lease/CAS/独立最终 key 防止不确定写入后误删 ready 对象；恢复先抢版本，再清理未完成 key。云 bucket 临时前缀生命周期由项目配置。未实现分片/断点、CDN 或媒体转码；扩展端口需要项目显式注册。Node/Go SDK 差异与 HTTP 错误统一分类，签名与长期凭据不进入公开日志。

## 4. 语义审查与建议

Review-Class: REQUIRED。Domain-Hit: 授权、文件写删、路径、并发/双写、SDK/公开协议、Schema/更新引擎。审查涵盖所有权、CORS、过期、重放、错误脱敏、崩溃恢复与只追加迁移。Codex review skipped by policy。

无本轮功能阻断缺陷。真实云账户、生产路径/权限与凭据轮换、对象生命周期和容量必须由项目验收；交付状态仍由最终 PR/main/finish 门禁确认。缺陷、优先级与 NFR 见同目录文件。
