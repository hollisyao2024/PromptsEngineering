# 模板命令面兼容回归

本轮由 [架构平台 QA](../architecture-platform/QA.md) 对既有模块进行兼容回归，不扩展原有业务验收范围。

`pnpm test` 全仓 400 项通过，包含原有 setup、任务、worktree、TDD/QA 和配置用例。真实 2.2.1 消费者接管后 project-owned 哨兵保持原样，二次规划零差异。证据统一见架构平台报告及容器 tmp/architecture-platform-validation/full-test-final.log。

对应 [PRD](../../prd-modules/template-command-surface/PRD.md)、[ARCH](../../arch-modules/template-command-surface/ARCH.md)、[TASK](../../task-modules/template-command-surface/TASK.md)。

## 核查任务记录与权限边界（2026-09-18）

范围：US-CMDSURF-010 / TASK-CMDSURF-037～039。验证普通只读请求的记录边界、只读路径命令、拒绝归因与模板传播；不改变宿主权限或平台审批机制。

| 用例 | 验证内容 | 结果 |
| --- | --- | --- |
| TC-CMDSURF-028 | 单会话只读请求不按步骤数量创建或恢复任务；六个专家引用中央规则；mutation 保留任务与交付门禁 | Pass |
| TC-CMDSURF-029 | 真 CLI 子进程覆盖缺失目录、重复查询、linked worktree、定制路径、现有状态/锁哨兵和非法输入；不创建状态或改写锁 | Pass |
| TC-CMDSURF-030 | 仅有 blocked by policy 时不猜测拒绝来源；继续独立只读核查，禁止同一动作换工具重试；权限示例不自动启用 writable_roots | Pass |

测试执行：

- RED：三个路径 CLI 集成用例在实现前均因未知 `paths` 命令失败；规则契约也先验证失败。
- GREEN：`agent-task.test.js` 与 `template-surface.test.js` 合计 47/47 通过。
- Windows 全量 480/510；在原主干 `2759fcf6dd0a7f3fdc1610f4398fb50d1981eff7` 重跑对应文件，得到同一组 30 个失败，无新增失败，涉及符号链接、路径大小写、POSIX 工具等环境差异。
- Linux 首轮 508/510；两个 worktree 清理用例因镜像缺少 `lsof` 无法检查进程而阻断。补齐镜像依赖后，Node 24.19.0 / pnpm 10.18.3 完整 `pnpm test` 为 510/510，零失败、零跳过，退出码 0；测试期间容器断网，候选源码哈希已核对。
- 模板副本 dry-run → apply → 二次 dry-run 收敛；12 个运行文件与源逐字节一致，项目自有 `RULES.md` 哨兵不变。
- 模板源 lint/type-check 为显式占位命令，不将其计作代码质量覆盖；本轮以真实 Node 回归、契约、语义审查和 diff 检查为证据。

安全与适用性：`task paths` 只解析路径，明确输出 `PERMISSION_STATUS=NOT_EVALUATED`；不存在配置扩权、替代状态文件、拒绝后重放或绕过 mutation 门禁。属于内部 CLI 与文档变更，浏览器 UI、业务性能及真实项目平台权限不在本轮验收范围。高风险域为共享 CLI 与权限指引；语义审查通过，`Codex review skipped by policy`。

结论：本轮验收通过 / Go；QA SHA 回执与合并结果记录在任务及 worktree 运行态，不写入稳定阶段状态。日志归档于容器 `tmp/qa-reports/task-record-policy-boundary/`，包括初始失败、基线对比、候选源码哈希、全量结果和传播日志。

## 开发目录可保留本地内容（US-CMDSURF-011）

TC-CMDSURF-031～033：真实 bare origin、main 与 linked worktree 集成测试验证固定 head squash 后主干只含已提交交付文件；功能目录 staged、unstaged、untracked 内容及索引均不变。负向覆盖目标主干修改与未隔离目录；清理断言不调用后台 worker、补偿器或前置 session 清理，并保留 QA head 封印。committed-only 覆盖显式参数和自动提交分支短路。

RED 为四个新用例按预期失败；首轮定向 5/5 通过，最终定向回归 66/66。Linux Node 24.19.0 / pnpm 10.18.3 完整回归 514/514，零失败、零跳过；运行前候选 patch 与工作区逐字节匹配。模板副本 dry-run/apply/convergence 通过，6 个增量运行文件逐字节一致，项目 RULES 哨兵不变。语义复核确认只合并 QA head、保留索引与文件、无自动清理 worker；Codex review skipped by policy。QA 结论 Go；实际 PR、SHA 和生命周期结果保存在任务运行态。合并通过不代表保留目录已被安全回收；completion guard 的独立状态必须如实报告。
