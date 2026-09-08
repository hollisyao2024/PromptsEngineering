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
