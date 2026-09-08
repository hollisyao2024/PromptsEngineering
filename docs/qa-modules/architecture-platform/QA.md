# 双能力包与架构落地 QA

> 模块：architecture-platform；日期：2026-09-09；状态：测试 Passed，交付以本机 QA receipt 和合并门禁为准；负责人：@template-maintainers。

## 1. 范围与输入

验证 [PRD](../../prd-modules/architecture-platform/PRD.md)、[ARCH](../../arch-modules/architecture-platform/ARCH.md)、[TASK](../../task-modules/architecture-platform/TASK.md) 的 US-ARCHPLAT-001～009。模板源版本 3.0.0。消费者都在容器 tmp 内初始化；三青鸟、小懒实际仓库没有写入。

## 2. 验收追踪与执行

| TC / AC 后缀 | 范围 | 证据 | 结果 |
| --- | --- | --- | --- |
| 001 / 001-01 | 只安装作业包、架构目录显式获取且不自动生成应用 | upgrades.test.js：agent-only、inert kit、二次收敛 | Pass |
| 002 / 002-01 | 多应用、多存储、目标及目录；未知字段、路径重叠阻断 | project.test.js；Web/Next/Go/Node/Tauri 与共享 UI 样本 | Pass |
| 003 / 003-01 | 初始化具体文件、安装依赖、构建与再次零差异 | 三个隔离组合，Vite/Next 构建、Node HTTP、Go test/build、Tauri cargo check | Pass |
| 004 / 004-01 | 既有目录和别名检测、显式接管保护 | project.test.js、engine.test.js；真实 2.2.1 消费者接管 | Pass |
| 005 / 005-01 | 公共表格、基础控件、业务源码检查 | 24 个 shadcn 原子、25 个 Registry 项闭包检查；每个前端样本 8 项 DOM 测试；3 条真实浏览器旅程；原生 button 和重命名 Table 导入负向检查 | Pass |
| 006 / 006-01 | 所有权策略和定制保护 | 覆盖漂移、文本/JSON 三方合并、迁移追加、受管块、初始化保护及幂等 | Pass |
| 007 / 007-01 | 冻结计划和异常恢复 | 源/目标/锁漂移、基线损坏、路径/链接、部分写入恢复、用户改动阻断、提交前锁复验 | Pass |
| 008 / 008-01 | 工程模块 | SQLite/PG 真实迁移和回滚；契约、脱敏、资源、插件、私有产物负向检查；发布并发和外部指针保护 | Pass |
| 009 / 009-01 | 旧模板与统一升级 | 固定来源回归；2.2.1 原始安装器生成消费者后验证缺失基线阻断、显式接管、项目规则/源码保留及收敛 | Pass |

自动化入口：`pnpm test`（400 项，0 失败、0 跳过）；各生成前端的 `pnpm test`、`pnpm build`；Node 样本 `pnpm test`；Go 样本 `go test ./...` / `go build .`；桌面样本 `pnpm build:web` 和 `cargo check --offline --manifest-path src-tauri/Cargo.toml`。

## 3. 环境与组合

macOS arm64，Node.js 26.7.0，pnpm 10.33.0；独立安装每个样本及共享包依赖，不链接其他 worktree 的 node_modules。

- repo 样本：React/Vite + Node + SQLite + contracts/observability。
- matrix 样本：Next + Go + Tauri，Postgres 与 SQLite，资源/插件模块。
- shared 样本：Vite 与 Next 共用 packages/ui，另有全新 Tauri 骨架；共享 React 运行时/类型、工具函数别名、Tailwind 扫描与原生图标均实际验证。
- legacy-consumer：由 main 既有 2.2.1 快照的原始安装器初始化，验证 3.0 接管流程。

PG 使用带专用标签、仅绑定 127.0.0.1 的一次性 postgres:16-alpine 容器，完成后已停止并自动删除；未访问项目生产库。

## 4. 浏览器与 UI 覆盖摘要

| Story | 浏览器旅程 | 覆盖维度 | 自动交互测试 | 性能 / 安全 |
| --- | --- | --- | --- | --- |
| US-ARCHPLAT-005 | 3 | 选中 1/11 跨页保留、末页禁用；搜索空态及清除恢复；列显隐且记录数保持 | 8：含异步 CRUD 回调、失败保留弹窗、防重复、导出转义、受控服务端、分组列 | 生产构建；CSV 公式文本转义；真实权限由项目回调和后端负责 |
| US-ARCHPLAT-001～004、006～009 | CLI/文件系统/HTTP/DB 集成 | 初次写入、重复执行、故障阻断与恢复 | 包含于 400 项源码回归和隔离样本 | 路径、所有权、日志脱敏、迁移历史与事务检查 |

浏览器使用 CUA 在隔离 localhost 样本操作并核对可访问性树和截图；这三条是实际浏览器验收，不计作 Playwright 自动化测试。空态清除后恢复 24 条、选中状态按稳定 ID 保留，列显隐不改变数据总数。大数据量性能、跨屏幕阅读器认证、原生签名/公证和 Windows/Linux 二进制构建不属于本机已验证结论。

## 5. 语义审查

Review-Class: REQUIRED。Domain-Hit: 共享基础库、文件写入、事务/并发、迁移、配置协议、跨模块初始化。

- 所有目标先规划，冲突先于写入；记录原子逐文件 journal，不承诺整个目录一次原子替换。
- 本地改动保留并参与三方合并；覆盖漂移和基线未知需要明确处理。接管保留旧内容，不等同于已替换全部旧协议。
- 写入完成与依赖安装/构建是分离结果；版本锁记录文件基线，依赖失败仍要求后续补齐验证。
- 中断不盲目重放；本机 writer/recovery 锁、版本锁复验和 before/after 校验保护恢复。
- 迁移默认预检；写库必须 --apply，PG 事务失败回滚，非事务 running 状态阻断重试。
- 发布指针仅在本次版本仍占有时回退；不执行实际生产部署。
- Codex review skipped by policy。没有创建、修改或依赖 GitHub Actions。

## 6. 缺陷与结论

本轮发现并关闭的生成问题见 [defect-log.md](defect-log.md)。本模块 9 项 AC 均有对应验证，无遗留阻断缺陷；Go（模板源码交付）。实际项目采用后仍应补业务授权、数据接口和各平台发布配置。

外部证据：容器 `tmp/architecture-platform-validation/` 的 full-test-final.log、postgres-live.json、legacy-upgrade.json、architecture-negative.json 及隔离项目；浏览器摘要 `tmp/test-results/architecture-platform/browser-smoke.json`。本机交付 receipt 位于 worktree-sessions，具体 commit 由 receipt/PR 记录，避免在受测提交内写入自身 SHA。
