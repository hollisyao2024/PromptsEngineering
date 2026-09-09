# 双能力包与架构落地 - TASK

> 总纲：[TASK.md](../../TASK.md)；输入：[PRD](../../prd-modules/architecture-platform/PRD.md)、[ARCH](../../arch-modules/architecture-platform/ARCH.md)；2026-09-08；负责人：@template-maintainers。

## 1. WBS 与依赖

| Task ID | 内容 | 依赖 | 可观察完成条件 | Story |
| --- | --- | --- | --- | --- |
| TASK-ARCHPLAT-001 | 包边界、目录标准和文档入口 | 无 | 两包 manifest 可独立解析，旧命令入口兼容 | US-ARCHPLAT-001 |
| TASK-ARCHPLAT-002 | 应用/存储/目标 schema、检测与校验 | 001 | 多栈多目录样本与不兼容负向测试通过 | US-ARCHPLAT-002 |
| TASK-ARCHPLAT-003 | 按所选栈初始化及接管 | 002、005 | 空项目可生成，旧项目不搬迁，二次零差异 | US-ARCHPLAT-003~004 |
| TASK-ARCHPLAT-004 | shadcn UI 和唯一 DataTable | 001、003 | 真实交互测试、类型与构建通过；统一目录/原生控件检查 | US-ARCHPLAT-005 |
| TASK-ARCHPLAT-005 | 三方所有权计划、版本锁、恢复及 updater 集成 | 001 | 冲突零写、漂移/损坏阻断、幂等、恢复、旧命令兼容测试通过 | US-ARCHPLAT-006~007、009 |
| TASK-ARCHPLAT-006 | 可选公共模块、架构检查和交付样本 | 003 | 契约/迁移/脱敏/资源/插件/私有产物检查及负向测试通过 | US-ARCHPLAT-008 |

## 2. 执行与验证

先定义定向失败测试，再实现共享引擎与配置；依赖安装只在独立样本执行。所有 schema 为文件协议，不涉及模板生产数据库迁移。生成的数据库迁移文件只追加，数据库执行由项目独立触发。

TC-ARCHPLAT-001~009 由引擎单元/集成、architecture 消费者测试、生成 UI 行为测试和完整 setup 回归覆盖。完成后执行 tdd sync → tdd push → qa plan → qa verify → qa merge → 主干/远端一致性及 completion guard。

## 3. 资源、风险与交付

单工作树顺序实施；不委托子任务，不修改参考消费者。风险集中在通用文件写入和兼容合并，采用完整预检、内容摘要和恢复日志控制；原生发布需要对应主机工具链，配置/逻辑检查不替代原生发行验证。

交付：代码、标准、注册资产、操作手册、模板与生成项目测试证据、合并后的主干 commit。

完成记录：TASK-ARCHPLAT-001～006 已实施并通过本轮 QA，验证详情见 [模块 QA](../../qa-modules/architecture-platform/QA.md)；合并状态以本机回执和 Git 历史为准。

## 4. 公共 UI 3.1 实施计划

状态：TDD 通过，待浏览器 QA（2026-09-09）；负责人：@template-maintainers；单工作树顺序实施。

| Task ID | Story | 交付物与验收 | 依赖 | 估算 |
| --- | --- | --- | --- | --- |
| TASK-ARCHPLAT-007 | US-ARCHPLAT-010 | FormField/Section、FormDialog/Sheet、可选 RHF；标签、校验、失败保留、dirty 关闭与重复提交测试 | 009、010 的基础闭包 | 1 人天 |
| TASK-ARCHPLAT-008 | US-ARCHPLAT-011、012 | 单选/多选/异步选择、日期/范围、预设；竞态、边界与筛选回归 | 009、010 的基础闭包 | 2 人天 |
| TASK-ARCHPLAT-009 | US-ARCHPLAT-013 | 公共确认、异步按钮、状态与通知；DataTable 接入且旧 Props 保持有效 | 010 的基础闭包 | 1 人天 |
| TASK-ARCHPLAT-010 | US-ARCHPLAT-014 | 按需初始化、共享路径、固定依赖、registry、旧版升级和 Vite/Next/共享/Tauri Web 验证 | 先交付闭包，最后集成 007～009 | 2 人天 |

关键路径：配置/依赖闭包 RED → 010 基础 → 009 反馈 → 007/008 公共交互 → DataTable 集成 → 010 消费者矩阵 → QA 合并。测试先于实现；每个阶段以相应可观察断言通过为里程碑，不仅检查文件存在。

DB（Expand/Migrate/Contract、Backfill/对账/回滚）：不适用，无数据库及生产写入。部署/CI：不适用，不创建或触发 GitHub workflow；依赖安装与浏览器只针对隔离样本。版本回滚使用 Git 与既有所有权基线，不删除项目已安装资产。

风险与验证：旧 owner ID、utils 定制和三方合并用 3.0.1 消费者回归；共享依赖与别名用多应用真实类型/构建；异步防重与乱序用受控 Promise；日期以日历字符串跨时区测试；键盘、焦点与面板交互用 DOM 和真实浏览器验收。对应 TC-ARCHPLAT-010～014。

TDD 证据：412 项源码测试通过；完整 Vite/Next 27 项 DOM 用例通过，Tauri Web 与独立组件集测试/类型/构建通过；Node 22.22.2 和 UTC/夏威夷日期验证通过。3.0.1 消费者升级保留按钮、页面、工具函数与脚本定制，二次计划零差异。语义审查：Review-Class REQUIRED；Domain-Hit 共享基础库、异步并发和升级文件所有权；已检查请求取消/乱序、表单防重、受控面板焦点恢复、旧 owner ID 与组件保留。Codex review skipped by policy。
