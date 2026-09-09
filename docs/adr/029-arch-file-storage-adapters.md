# ADR-029：统一文件接口与云厂商原生适配

状态：Accepted。日期：2026-09-09。依据：用户明确确认并授权实施。

单一 AWS SDK 路径的依赖少，但 OSS/COS 专有签名、处理能力和协议差异仍需专用验证；每个业务直接引用厂商 SDK 则让权限、元数据和迁移分散。采用公共存储接口，AWS SDK v3 作为 S3 实现，OSS/COS 使用官方原生 SDK；只安装项目选中的依赖。

本地文件系统单独实现，元数据与二进制分离。Prisma 负责 Node PG/SQLite 元数据，Go 不依赖 Node Prisma。浏览器使用受限上传会话和统一 DTO。暂存键与最终键分离，避免签名重放覆盖已确认文件；双写使用版本化状态和恢复，不能宣称原子事务。

外部依据：[OSS AWS SDK 接入](https://help.aliyun.com/zh/oss/developer-reference/use-aws-sdks-to-access-oss)、[OSS 兼容边界](https://www.alibabacloud.com/help/en/oss/developer-reference/compatibility-with-amazon-s3)、[OSS Node SDK](https://help.aliyun.com/zh/oss/installation-7)、[COS Node SDK](https://cloud.tencent.com/document/product/436/8629)、[Prisma 多文件 schema](https://www.prisma.io/blog/organize-your-prisma-schema-with-multi-file-support)。版本以实际消费者兼容与审计为准。
