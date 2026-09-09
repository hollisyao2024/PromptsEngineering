# 多端 Monorepo 与 Prisma - PRD

状态：已确认；依据：2026-09-09 用户确认整体方案并授权全自动实施。主纲：[PRD](../../PRD.md)。

## 1. 模块概述

模板维护者发布可复用实现；项目维护者选择一个多端业务项目的应用组合；开发者在独立 worktree 中开发；应用用户通过公共表格完成真实数据操作。息壤保留独立作业包、独立架构包、统一所有权引擎。新 Node TypeScript 项目默认 Prisma，实际数据库仍按职责选型。

## 2. 范围与约束

范围包含完整 pnpm workspace、独立 Node TypeScript 实现、PostgreSQL/SQLite Prisma 数据包、迁移保护与开发隔离、OpenAPI 契约及运行时校验、API 客户端、React 查询适配、任务管理示例、应用布局、平台接口、配置与观测、四种组合蓝图、升级和恢复验证。模板保留维护的组件源码和依赖版本，不预装所有技术栈；第三方依赖只在选定消费者与隔离验证样本安装。

项目可扩展身份提供方、租户规则、移动框架、离线同步、队列、搜索等；这些没有本轮业务规格，不植入特定产品模型。真实生产部署、生产数据库变更、签名证书及其他实际仓库不在范围内。桌面默认在线业务，本地能力通过宿主接口；不承诺透明 PostgreSQL/SQLite 转换或自动双向同步。

## 3. 用户故事与验收

| Story | Given / When / Then 验收 | Test |
| --- | --- | --- |
| US-MONOPLAT-001 | AC-MONOPLAT-001-01：Given 多应用及嵌套共享包，When 初始化 workspace，Then 单一依赖锁、workspace 引用、公共导出及生成顺序有效；重复计划零差异；既有 YAML 非受管字段保留 | TC-MONOPLAT-001 |
| US-MONOPLAT-002 | AC-MONOPLAT-002-01：Given Node TS 消费者及 PostgreSQL/SQLite 存储，When 生成并构建，Then 独立 Prisma Schema/Client/连接配置可用，事务成功与回滚均有真实数据库验证；浏览器导入数据库被拒绝 | TC-MONOPLAT-002 |
| US-MONOPLAT-003 | AC-MONOPLAT-003-01：Given 迁移历史与目标环境，When 校验/执行，Then 缺失、变更、未完成历史阻断；每库只有一个迁移实现；模板 init/update 不连接数据库；不同 worktree 的开发库标识及文件路径不同 | TC-MONOPLAT-003 |
| US-MONOPLAT-004 | AC-MONOPLAT-004-01：Given 公开 API 契约，When 生成客户端与调用 API，Then 嵌套结构/分页/错误有类型和运行时校验，错误输入拒绝、过期响应不会覆盖新查询；Prisma 内部类型不进入浏览器契约 | TC-MONOPLAT-004 |
| US-MONOPLAT-005 | AC-MONOPLAT-005-01：Given 任务管理示例及数据库，When 翻页/筛选/多列排序/多选/新增/修改/删除/导出，Then 公共 DataTable 与真实 API 一致，排序稳定、操作范围明确、未授权写入拒绝、提交失败保留输入 | TC-MONOPLAT-005 |
| US-MONOPLAT-006 | AC-MONOPLAT-006-01：Given 多端应用，When 使用共享布局/主题/错误边界/平台端口，Then 无业务原生交互控件、键盘可用、移动窄屏可操作；浏览器与 Tauri 适配隔离；缺少能力返回明确不支持 | TC-MONOPLAT-006 |
| US-MONOPLAT-007 | AC-MONOPLAT-007-01：Given 环境配置与请求，When 缺字段/错误配置/请求失败，Then 显式校验、统一错误与请求标识、日志脱敏有效且无隐式 profile 回退 | TC-MONOPLAT-007 |
| US-MONOPLAT-008 | AC-MONOPLAT-008-01：Given 管理后台/多端 Web/Web 桌面协同/轻量本地四种蓝图，When 展开配置并初始化，Then 所选应用与共享模块完整、无重复公共源码；项目后续选择不随蓝图升级被覆盖 | TC-MONOPLAT-008 |
| US-MONOPLAT-009 | AC-MONOPLAT-009-01：Given 3.1 消费者和本地定制，When 更新/恢复，Then 旧配置有效、业务 Schema/API/迁移保持项目所有权、公共实现三方更新、锁由包管理器产生、冲突零写与恢复收敛通过 | TC-MONOPLAT-009 |

## 4. 非功能需求

所有负向门禁退出码非零。固定版本与模板基线可重建；禁用无范围的依赖生命周期脚本，必要原生构建单独验证。数据库样本只含合成任务，不记录凭据和个人数据。API 输入限制页大小、排序/筛选字段和批量 ID 数量；计数与数据页合计查询次数不随每页行数增长。性能样本报告数据规模、版本、并发、p95、内存，不能外推真实生产容量。

## 5. 依赖与风险

需 PoC：Prisma 7.10 与当前 TypeScript/Node/SQLite 原生驱动兼容性；pnpm workspace 更新保留定制；Tauri 宿主实际工具链。不同平台原生构建结果独立报告，不以 Web 构建代替发行验证。依赖顺序：workspace → 数据/契约 → API → 客户端/query → 真实 UI → 蓝图/升级验收。

## 6. 里程碑与 Gate

交互见 [UX](ux-specifications.md)。沿用现有 shadcn 语义 Token、表单和表格组件；身份由服务端注入，示例的本地授权配置不能宣称是生产身份系统。错误与空状态可恢复，删除前确认、导出和批量操作显示范围。三条自动化旅程覆盖读取、写入失败恢复、窄屏导航；真人可用性研究不作为模板运行验证证据。

## 7. 追溯矩阵与验证

用户已确认的技术与范围作为实施依据，无需要重新选择的阻塞项。模型/权限/移动/同步由实际项目需求决定。追溯见 [矩阵](../../data/traceability-matrix.md)，阶段 PRD → ARCH → TASK → TDD → QA → 合并。
