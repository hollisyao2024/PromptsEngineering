# 架构按需获取 TASK

状态：实现与 QA 验收通过，交付状态以主分支门禁为准。负责人：模板维护者。日期：2026-09-10。依据：[PRD](../../prd-modules/architecture-on-demand/PRD.md)、[ARCH](../../arch-modules/architecture-on-demand/ARCH.md)。

## WBS 与依赖

| Task | Story | 交付物与验收 | 依赖 | 估算 |
| --- | --- | --- | --- | --- |
| TASK-LAZYARCH-001 | 001/002/006 | RED：轻量清单、未选源码缺席、agent scope 隔离与普通更新闭包 | 已确认治理 | 0.5 日 |
| TASK-LAZYARCH-002 | 003/004 | 固定来源描述、缓存协议、CLI 转发、匿名凭据隔离和负例 | 001 | 1 日 |
| TASK-LAZYARCH-003 | 005 | 旧 runtime remove、基线无引用回收、中断恢复与定制保护 | 001 | 0.5 日 |
| TASK-LAZYARCH-004 | 001~006 | 同步/初始化/更新接入、轻量文档、原始 3.3 升级与真实消费者 | 002/003 | 1 日 |
| TASK-LAZYARCH-005 | 001~006 | 源回归、语义审查、QA、PR 合并、主分支与任务收尾 | 004 | 0.5 日 |

关键路径：001 → 002/003 → 004 → 005。每项 Owner 均为模板维护者，按依赖顺序执行，不新增后台任务或代理。验收映射 TC-LAZYARCH-001~006。

数据库 Expand/Migrate/Contract、Backfill、双写观察、对账、回滚：不涉及业务数据库；版本化文件更新继续使用现有冻结计划和恢复日志。基础设施仅容器 cache/tmp 与隔离测试目录，无外部服务、CI 或发布部署变更。

风险：旧模板源码的本地修改需明确冲突；清理基线必须检查全 lock 引用；缓存缺失不能误用 main 新版本；轻量入口必须覆盖 standalone 和已有工作流两种模式。全部通过后才进入 QA 和交付门禁；运行状态由 task/worktree session 记录。

实现证据：001~004 已完成。源测试 447/447、原始 3.3 惰性工具包/已采用 workspace 升级 2/2、实际 Web 组件 20/20 及类型/构建/check 通过。新断点恢复用例先复现指针与 lock 不一致，再验证无需下载即可恢复；macOS 路径别名的旧日志保持可识别。Semgrep 定向扫描 10 个文件，0 finding / 0 parse error。005 的最终交付由 QA receipt、合并和主分支 completion guard 确认，运行日志留在容器 tmp。

Review-Class: REQUIRED。Domain-Hit: 文件写入/删除、缓存/并发、匿名远端获取、共享更新引擎。语义审查：移除只针对旧 lock 已登记且未修改的文件；基线必须失去全部引用并在新 lock 持久化后才删除；缓存固定身份/提交/摘要并在项目写入前准备；resume 使用冻结日志，不在中断时重新选源。Codex review skipped by policy。未修改业务认证、数据库 Schema、生产迁移或 GitHub CI。
