# 统一文件存储

业务调用文件服务；适配器处理 local、S3、阿里云 OSS 和腾讯云 COS 差异。Node 与 Go 都有实现，选择一种服务运行时；不同语言/前端通过 HTTP 协议消费，不跨语言导入服务器包。

## 1. 选择与生成

将以下 fileStorage 合并入已存在的架构配置：

```json
{
  "fileStorage": {
    "path":"packages/storage",
    "runtime":"node",
    "consumers":["api"],
    "defaultStore":"private",
    "stores":[
      {"id":"private","provider":"local","envPrefix":"PRIVATE_FILES"},
      {"id":"media","provider":"aliyun-oss","envPrefix":"MEDIA"}
    ],
    "metadata":{"datastore":"main"},
    "uploadApplications":["admin"]
  }
}
```

metadata 选项用于 Node v2 + Prisma；省略时使用私有目录的持久化元数据文件。Go 提供持久化文件 Repository 和可注入 Repository 接口，不安装 Prisma/Node。消费者必须是同运行时服务器；uploadApplications 中的 shadcn 应用需选择 uploads 与 data-table。

初始化生成 packages/storage、对应 SDK 依赖、环境示例与测试，以及 apps/<api>/src/file-storage.ts 或 Go file_storage.go 接线示例。上传应用获得 src/lib/file-client.ts 和 examples/file-upload.tsx。路径允许映射，业务文件不覆盖。Go 存储要求 Go 1.26+（使用 os.Root），实际依赖在项目执行 go mod tidy；模板源不下载 Go/npm 依赖。

| provider | Node SDK | Go SDK | 公开能力 |
| --- | --- | --- | --- |
| local | Node 标准库 | Go 标准库 | put/get/head/delete/list，私有代理上传下载 |
| s3 | AWS SDK JS v3 | AWS SDK Go v2 | 上述操作及短期签名 |
| aliyun-oss | ali-oss 原生 SDK | OSS Go SDK v2 | 原生 OSS 签名、对象与列表 API |
| tencent-cos | COS Node SDK | COS Go SDK v5 | 原生 COS 签名、对象与列表 API |

阿里云使用原生适配。S3 兼容接口可通过 s3 provider 显式选择，但兼容子集、寻址与媒体处理不能从 AWS 支持推断：[阿里云 AWS SDK 接入](https://help.aliyun.com/zh/oss/developer-reference/use-aws-sdks-to-access-oss)、[兼容说明](https://www.alibabacloud.com/help/en/oss/developer-reference/compatibility-with-amazon-s3)、[腾讯 COS Node](https://cloud.tencent.com/document/product/436/8629)。

## 2. 运行配置

每个 local profile 使用 <PREFIX>_DIRECTORY，必须是专用、规范化的私有绝对路径；默认 Node 模块内 .data/<store>。Go 的 NewConfiguredStorage(dataRoot,env) 显式传 dataRoot。符号链接、目录越界与非私有根权限会拒绝。macOS /var 常为系统符号链接，应传 realpath 后的路径。

云 profile 读取 <PREFIX>_BUCKET、REGION、ENDPOINT、PUBLIC_ENDPOINT、ACCESS_KEY_ID、SECRET_ACCESS_KEY、SESSION_TOKEN 和可选 CREDENTIAL_EXPIRATION；不在 architecture.config.json 保存凭据。S3 可选 FORCE_PATH_STYLE。COS 自定义 endpoint 使用完整桶域名；OSS region 可用 cn-hangzhou，SDK 转为原生区域形式。

ENDPOINT 用于服务器，PUBLIC_ENDPOINT 用于客户端可达的签名地址；使用已知内网端点时必须配置公网地址。默认要求 HTTPS；allowHTTP 仅允许显式 localhost 协议夹具。生产 CORS 需只允许真实应用 Origin、PUT 与所需 Content-Type 请求头。

createS3Provider/createAliyunOSSProvider/createTencentCOSProvider 支持异步 credentials 回调，项目可以接入 STS/工作负载凭据；每次操作重新获取，签名时长不超过凭据剩余有效期。直接构造 S3 provider 且不传 credentials 时使用 AWS 默认链；生成环境示例采用显式前缀变量。不要把服务器长期密钥交给浏览器。

## 3. 服务接线与协议

Node 的 createProjectFiles 接受项目 authenticate(request) 回调；使用 Prisma 时还需 database，连接生命周期由应用管理。Better Auth 可通过 auth.api.getSession({headers:fromNodeHeaders(request.headers)}) 解析用户，再返回 {id:session.user.id}。在业务解析上传请求体之前执行 files.handler(request,response)，返回 true 表示已处理。

Go 的 NewProjectFiles 接收 authenticate 回调，返回 handler 与 cleanup；挂载 /files 和 /files/，应用停止时调用 cleanup。前端 createFileClient 只包含浏览器代码，可设置 headers 或 credentials:"include"；跨域 Cookie 同时要求服务端 allowCredentials 与精确 trustedOrigins。

| 路径（默认 /files 前缀） | 方法 | 行为 |
| --- | --- | --- |
| /uploads | POST | name/size/contentType/可选 storeId，建立有归属的会话 |
| /uploads/:id/content | PUT | 本地/代理流上传，校验大小与类型 |
| /uploads/:id/complete | POST | 核对临时对象，复制到独立最终键，再标记 ready |
| /uploads/:id/recover | POST | 过期工作租约的恢复，不抢占有效租约 |
| /uploads/:id | DELETE | 取消待上传会话并清理暂存 |
| / | GET | 当前用户 ready 文件分页，返回 cursor |
| /:id | GET / DELETE | 文件信息 / 删除，检查归属 |
| /:id/download | GET | 短期下载位置 |
| /:id/content | GET | 授权代理下载，attachment 与 nosniff |

跨用户文件返回 NOT_FOUND。公开 DTO 不含 storeId、对象键或凭据；签名 URL 只作为短期传输值，不用于持久定位。默认单文件 32 MiB，公共适配上限 1 GiB、页面 200 条、签名/会话 1 小时；按业务调整 FileService 的默认限制。

## 4. 一致性与恢复

元数据记录 storeId、临时键、最终键、ownerId、状态、version、租约与有效期。更换默认存储只影响新文件，旧文件仍查原 storeId；移除 provider 或迁移目录/运行时需要项目迁移，未知存储不回退。

上传会话使用 pending → uploading/completing → ready；删除使用 ready → deleting → deleted。版本 CAS 防止并发转正；恢复先抢占过期租约。签名上传只能改临时键，完成文件位于独立随机键，旧签名重放不能覆盖已就绪文件。

对象存储与数据库没有原子事务。失败可能留下临时对象或 completing/deleting 状态；项目维护任务按已知会话 ID 调用 recover/cancel/delete，并为 uploads/ 暂存前缀配置合适生命周期。模板不提供自动删除历史数据的定时任务。清理失败需保留状态和重试，不能通过丢弃元数据宣称删除成功。

文件元数据库适合单机部署；多副本应使用 Prisma PG 等共享 Repository 或项目实现，避免把进程文件锁当分布式锁。私有锁不盲目清理崩溃进程的未知锁文件，应先核对进程和操作结果。

## 5. 能力与升级

capabilities 明确声明 directUpload、multipart、resumable 与 extensions。本版 multipart/resumable 均为 false；SDK 自身支持分片，不等于公共协议已经实现。媒体操作通过 runStorageExtension/RunStorageExtension 交给项目明确声明的原生适配，未声明时返回 UNSUPPORTED。

公共接口和适配器三方更新，包清单结构合并；环境示例/业务接线/Prisma 模型仅初始化，SQL 只追加。FileObject 不自动与业务用户表建立外键，ownerId 由项目身份端口提供；既有数据库迁移不重写。

## 6. 验证

Node 生成包运行 pnpm build && pnpm test；Go 模块运行 go test -race ./...。默认验证本地文件、HTTP 归属、原生 SDK 签名、短期凭据和协议夹具。源消费测试验证 Prisma PG/SQLite CAS。

真实云需显式指定 XIRANG_LIVE_STORAGE_PROVIDER=s3|aliyun-oss|tencent-cos 与 LIVE_*，使用测试桶；Node 的 tests/live-cloud.test.mjs、Go 的 TestLive* 创建 xirang-integration/<uuid> 对象并清理。缺环境时输出 skipped/unverified。没有真实云测试结果时，不能宣称某个地区、账号策略、CORS、加密方式或分片协议已通过验收。

上传签名绑定 Content-Type 和声明的 Content-Length；浏览器发送 Blob 时自动提供长度，不手动设置禁止的请求头。服务端完成阶段再次核对大小与类型。签名 URL 在到期前可重放暂存上传，但不能修改已转正文件。
