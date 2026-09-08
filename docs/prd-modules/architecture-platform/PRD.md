# 息壤双能力包与架构落地 - PRD 模块

> 所属主 PRD：[PRD.md](../../PRD.md)；负责人：@template-maintainers；版本：v1.0；最后更新：2026-09-08；状态：已确认。依据用户确认的三个目标及自动实施授权。

## 1. 模块概述

息壤同时提供模型作业流程和应用架构规划、初始化、升级能力。项目维护者可只采用作业流程，也可按应用选择技术栈和可复用模块。模板维护者升级已安装资产时，必须保留项目决策和定制。

## 2. 范围与约束

范围：两个独立能力包、共同更新引擎、目录标准、应用/存储/目标矩阵、配置校验、初始化/接管/升级计划、shadcn 公共 UI 和 DataTable、技术栈骨架、契约/迁移/可观测性/资源及插件校验/交付模块、可执行架构检查、使用文档和隔离消费者验收。

技术选型由项目决定；Go/Node、PostgreSQL/SQLite 可按职责同时采用。支持既有目录映射，不自动搬迁业务文件。业务源码、真实治理文档、RULES.md、项目配置和部署凭据属于项目。只更新已选择的模块，不默认安装整个技术目录。

非范围：修改三青鸟或小懒实际仓库、执行生产迁移、启动生产部署、实现项目业务 CRUD/授权、提供各平台签名证书、宣称跨平台原生构建已在本机验证。构建、依赖安装、迁移执行和部署必须有明确命令与结果边界。

## 3. 用户故事与验收

| Story ID | 验收标准（Given-When-Then） | Task ID | Test Case ID |
| --- | --- | --- | --- |
| US-ARCHPLAT-001 | AC-ARCHPLAT-001-01：Given 仅采用作业包，When 安装/升级，Then 不生成任何 apps 业务骨架；作业规范只引用独立技术标准 | TASK-ARCHPLAT-001 | TC-ARCHPLAT-001 |
| US-ARCHPLAT-002 | AC-ARCHPLAT-002-01：Given 多应用及多存储配置，When 校验/规划，Then 精确映射每个应用、存储、平台、版本和目录；未知模块、重复路径和不兼容组合明确失败 | TASK-ARCHPLAT-002 | TC-ARCHPLAT-002 |
| US-ARCHPLAT-003 | AC-ARCHPLAT-003-01：Given 空项目，When 应用冻结的初始化计划，Then 生成所选可启动骨架、配置、依赖清单、标准和基线；再次规划零差异 | TASK-ARCHPLAT-003 | TC-ARCHPLAT-003 |
| US-ARCHPLAT-004 | AC-ARCHPLAT-004-01：Given 既有 apps/server 与 packages/database，When 检测并接管，Then 保留实际路径和项目源码，未证明的同路径内容冲突不得覆盖 | TASK-ARCHPLAT-003 | TC-ARCHPLAT-004 |
| US-ARCHPLAT-005 | AC-ARCHPLAT-005-01：Given 选中 React/shadcn，When 初始化并运行示例，Then 基础控件使用 shadcn，唯一 DataTable 支持翻页、多选、CRUD 回调、导出、筛选、排序、列显隐及加载/空/错误状态；业务代码使用原生交互控件或自行表格会被检查拒绝 | TASK-ARCHPLAT-004 | TC-ARCHPLAT-005 |
| US-ARCHPLAT-006 | AC-ARCHPLAT-006-01：Given 已安装基线、本地修改和新模板，When 更新，Then 覆盖文件检测本地漂移，更新文件三方合并保留定制，重叠修改失败，追加按稳定标识去重，初始化/项目所有权策略保护已有内容 | TASK-ARCHPLAT-005 | TC-ARCHPLAT-006 |
| US-ARCHPLAT-007 | AC-ARCHPLAT-007-01：Given 冻结计划及可校验基线，When 源/目标/锁漂移、路径逃逸、基线损坏或中断，Then 写入前阻断不一致；中断通过逐项哈希核验恢复；只有验证和收敛成功才更新安装状态 | TASK-ARCHPLAT-005 | TC-ARCHPLAT-007 |
| US-ARCHPLAT-008 | AC-ARCHPLAT-008-01：Given 已采用可选模块，When 初始化/检查，Then 契约漂移、迁移校验和变化、资源摘要错误、无效插件权限和私有构建禁用地址均能检测；缺少真实目标命令不得伪成功 | TASK-ARCHPLAT-006 | TC-ARCHPLAT-008 |
| US-ARCHPLAT-009 | AC-ARCHPLAT-009-01：Given 旧版模板消费者及安装模块，When template sync/update，Then 固定来源、作业包与已选架构资产按策略更新，未选模块不生成应用；相关回归及二次收敛通过 | TASK-ARCHPLAT-005 | TC-ARCHPLAT-009 |

## 4. 非功能需求（NFR）

离线规划不联网、不写目标；有冲突时业务目标零写入；重复成功计划零差异；受管内容采用 SHA-256 校验；所有路径禁止父级逃逸和符号链接；配置不保存密钥。运行态与日志位于容器 tmp，版本锁和可重建基线随项目版本管理。

## 5. 依赖与风险

依赖现有生命周期、固定上游同步、模板 manifest 和 Node 测试运行器。shadcn/TanStack、React/Vite/Next/Tauri 为所选模块依赖，不要求只用作业包的项目安装。

旧项目无可信历史基线时不能推断未修改，输出接管分析及显式基线接管命令。复杂原生和数据库生产环境由项目验证，模板只承诺通过明示的本地骨架/逻辑测试。

## 6. 里程碑与 Gate

PRD → ARCH → TASK → TDD → QA → 源仓库合并。架构变更需定向负向测试、全量模板回归、隔离消费者初始化/升级与生成 UI 验证。

## 7. 追溯矩阵与验证

对应 [全局追溯矩阵](../../data/traceability-matrix.md) TC-ARCHPLAT-001 至 009。真实测试结果由 QA 阶段填写。

## 8. 用户体验设计

CLI 输出计划中的新增、覆盖、更新、追加、跳过和冲突及原因。错误有非零退出码和下一动作。DataTable 采用语义 Token、键盘可用的控件与带标签操作；窄屏容器横向滚动，分页和筛选工具栏换行。删除操作确认后调用项目回调，未提供回调不显示虚假按钮；异步失败保留上下文并展示错误。

## 9. 开放问题与变更记录

无阻塞问题。2026-09-08：将初始 UI 约定需求扩展为用户确认的双能力包、架构初始化与所有权升级整体方案。
