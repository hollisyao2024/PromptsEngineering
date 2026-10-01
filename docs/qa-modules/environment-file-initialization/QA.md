# 环境文件初始化兼容回归

本轮由 [架构平台 QA](../architecture-platform/QA.md) 对既有模块进行兼容回归，不扩展原有业务验收范围。

`pnpm test` 全仓 400 项通过，包含原有 setup、任务、worktree、TDD/QA 和配置用例。真实 2.2.1 消费者接管后 project-owned 哨兵保持原样，二次规划零差异。证据统一见架构平台报告及容器 tmp/architecture-platform-validation/full-test-final.log。

对应 [PRD](../../prd-modules/environment-file-initialization/PRD.md)、[ARCH](../../arch-modules/environment-file-initialization/ARCH.md)、[TASK](../../task-modules/environment-file-initialization/TASK.md)。

## 主 repo 补齐验收策略

| 用例 | 验收映射 | 验证方式 |
| --- | --- | --- |
| TC-ENVINIT-005 | AC-ENVINIT-004-01 | 真实 linked worktree 从主 repo 解析六文件目标；缺失补建、已有六文件逐字节保留（含空文件）；主 repo example 优先；开发 worktree 不创建实际环境文件 |
| TC-ENVINIT-006 | AC-ENVINIT-004-02 | dry-run 不写环境文件或 Git exclude；二次初始化六文件 unchanged；完整 sync 的 dry-run、apply 与再次同步收敛 |

定向入口为 `infra/scripts/setup/__tests__/environment-main-repo.test.js`；调用方回归复用 `template-sync.test.js`，兼容检查包括 `update-template.test.js` 与 `template-surface.test.js`。缺失 example source 的失败测试验证环境写入前阻断；非 Git 显式目标测试防止回落模板源。执行日志、受测提交及结果存于任务证据和本机 QA 回执，不在规划文档镜像运行历史。
