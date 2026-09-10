# 统一文件存储 - PRD

主纲：[PRD](../../PRD.md)。状态：已确认。依据：用户确认四种存储适配、多存储与按需初始化方案并授权全部实施。

## 1. 模块概述

模板维护者提供可升级的实现，项目维护者选择语言与存储，业务开发者通过公共文件服务操作文件。多端 Monorepo 共用文件协议，国内云保留原生适配能力。

## 2. 范围与约束

Node 与 Go 的 local/S3/OSS/COS 适配、按需依赖与配置、多存储路由、上传/读/删/head/分页列举、短期上传与下载会话、持久化元数据端口及 Node Prisma 实现、客户端上传工具和 shadcn 上传组件、能力声明、使用升级文档与验证属于本轮。

项目注入身份、租户、授权策略和凭证。模板不创建收费云资源、不读取其他项目凭据、不执行实际项目迁移、不自动迁移历史文件。媒体处理通过扩展入口接入；生产媒体任务、CDN、移动原生发行和完整身份系统不属于本轮。真实云测试显式启用，缺配置报告未验证。

## 3. 用户故事与验收

| Story | Given / When / Then | Test |
| --- | --- | --- |
| US-STORAGE-001 | AC-STORAGE-001-01：Given 旧配置或选定存储配置，When 初始化/更新，Then 旧项目不增加依赖、选定项目只安装必要 SDK，非法引用及前端导入服务端包拒绝 | TC-STORAGE-001 |
| US-STORAGE-002 | AC-STORAGE-002-01：Given Node/Go 适配器，When 上传/读/删/head/分页列举，Then 统一结果和错误、二进制不损坏、路径逃逸及符号链接拒绝 | TC-STORAGE-002 |
| US-STORAGE-003 | AC-STORAGE-003-01：Given 多存储及历史文件，When 改默认存储，Then 新文件采用新默认值，旧文件仍按记录定位，未知存储不回退 | TC-STORAGE-003 |
| US-STORAGE-004 | AC-STORAGE-004-01：Given 授权主体，When 创建/完成上传会话或下载，Then 绑定唯一对象、归属、类型、大小与有效期，完成时核对对象，未授权/过期/不匹配拒绝，无长期密钥进入公开响应 | TC-STORAGE-004 |
| US-STORAGE-005 | AC-STORAGE-005-01：Given PG/SQLite 元数据库，When 创建/完成/删除文件，Then 状态可恢复，签名 URL 不作为持久定位依据，不宣称对象与数据库原子事务 | TC-STORAGE-005 |
| US-STORAGE-006 | AC-STORAGE-006-01：Given 上传组件，When 选择/上传/取消/重试，Then 使用 shadcn、显示进度和可访问状态，取消不误报成功，服务端 SDK 不进入浏览器 | TC-STORAGE-006 |
| US-STORAGE-007 | AC-STORAGE-007-01：Given 能力差异或缺少云测试凭据，When 调用，Then 明确 unsupported/未验证，SDK 合约与真实云结果分别报告 | TC-STORAGE-007 |
| US-STORAGE-008 | AC-STORAGE-008-01：Given 有定制的消费者，When 更新，Then 公共实现三方合并，业务配置/Schema 保留、迁移只追加、重复计划收敛 | TC-STORAGE-008 |

## 4. 非功能需求

所有负向验证明确失败；列表、文件大小及会话有效期有上限；内容使用流或有界读取。凭据和签名不写日志。固定 SDK 版本并审计依赖、编译实际消费者。测试覆盖路径边界、错误脱敏、授权、状态并发和取消，不将本地吞吐外推云容量。

## 5. 依赖与风险

依赖架构生成器、所有权升级、workspace、shadcn 和 Prisma。SDK 签名/端点差异、双写和过期签名重放通过专用适配、唯一对象键、完成校验和状态机处理。无云账号时交付 opt-in 联调脚本并保留未验证状态。

## 6. 里程碑与 Gate

PRD → ARCH → TASK → TDD → QA → PR 合并。代码、生成器、消费者及升级回归通过；稳定里程碑沿用主状态文件，运行证据在任务目录保存。

## 7. 追溯矩阵与验证

追溯见 [矩阵](../../data/traceability-matrix.md)，交互见 [UX](ux-specifications.md)。身份与业务列表由项目组合，无阻塞选择问题。
