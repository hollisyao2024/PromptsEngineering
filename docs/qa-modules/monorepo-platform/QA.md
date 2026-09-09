# 多端 Monorepo 与 Prisma QA

模块：monorepo-platform；日期：2026-09-09；负责人：@template-maintainers；被测变更：[PR #79](https://github.com/hollisyao2024/PromptsEngineering/pull/79)。状态：Passed / Go，最终提交以本机 QA receipt 为准。

## 1. 模块概述

验证 [PRD](../../prd-modules/monorepo-platform/PRD.md)、[ARCH](../../arch-modules/monorepo-platform/ARCH.md)、[TASK](../../task-modules/monorepo-platform/TASK.md) 的九项验收。作业规范和技术架构分别维护；模板源不安装全部应用依赖。全部安装、数据库写入和原生构建发生在隔离消费者，未修改三青鸟、小懒或生产环境。

## 2. 测试策略

macOS arm64、Node 26.7.0、pnpm 10.18.3；Prisma CLI/client/adapters 7.10.0；PostgreSQL 18.6-bookworm 一次性容器；SQLite 使用 better-sqlite3 12.11.1。每个消费者独立 node_modules 和根锁文件。浏览器为 Playwright 1.63.0 控制本机 Chrome，桌面为 Tauri 2.11 当前 macOS 原生构建。

源码入口 `pnpm test`；定向生成器 `node --test architecture/__tests__/monorepo*.test.js`。实际数据库入口 `architecture/tests/consumer.integration.mjs`，显式要求 XIRANG_CONSUMER / XIRANG_TEST_DATABASE_URL，限制 loopback 测试库与消费者内 SQLite 文件。旧版升级 `architecture/tests/upgrade.integration.mjs`，XIRANG_LEGACY_SOURCE 为原始 v3.1.0 的解包快照。

浏览器入口 `e2e/tests/monorepo-platform.e2e.mjs`，XIRANG_CONSUMER 指向已构建 SQLite 消费者，XIRANG_TEST_TOOLS 指向独立安装 @playwright/test 的验证工具目录。Fixture 自动启用生产授权规则并分配 loopback 临时端口、独立 qa-e2e.sqlite 和随机令牌。证据在容器 `tmp/monorepo-prisma-platform/` 与 `tmp/test-results/monorepo-platform/`，不写回模板源或保存密钥。

## 3. 测试用例

| Story / TC 后缀 | 完整路径、边界及恢复 | 层级与证据 | 结果 |
| --- | --- | --- | --- |
| 001 | 四组合共享一次生成、嵌套包、空 workspace、单根锁、YAML 保留及冲突 | monorepo 单元 / 实际 CLI init、type-check、build | Pass |
| 002 | PG/SQLite CRUD、真实事务、原子批删、并发版本检查、浏览器数据库导入阻断 | 每种数据库 9 项集成中的相关断言 | Pass |
| 003 | 首次/重复迁移、缺失/改动/失败账本、回滚历史及源文件保护 | 真实 _prisma_migrations + safety 单元 | Pass |
| 004 | OpenAPI 3.1/JSON Schema 2020-12、嵌套/元组/日期、生成过期、取消、身份切换缓存、双查询列表 | 契约及 API 集成 + browser + k6 | Pass |
| 005 | 新增修改删除、跨页/筛选/多列排序、列显隐/多选/导出、401 保留重试、409 冲突、空状态 | API/DB 集成 + browser 四条任务旅程、身份/请求旅程 | Pass |
| 006 | 宽屏导航/主题、窄屏与键盘焦点、接口故障重试、Browser 不支持降级；原生 API/保存文件 | browser 三条布局旅程 + integration + 原生 CUA | Pass |
| 007 | 非法 profile/生产无令牌、CORS、64 KiB 输入、DTO 输出校验与日志脱敏 | API 负例 / SAST / 依赖审计 | Pass |
| 008 | admin-api/fullstack/web-desktop/local-private 均真实生成安装，共享模块无重复 | 四蓝图 CLI/包生成/消费者构建与类型检查 | Pass |
| 009 | v3.1.0 SQL/UI/业务/自定义脚本保留，二次零差异、冻结计划漂移阻断和 journal 恢复 | 原始源码快照升级 + 源回归所有权测试 | Pass |

US/TC-MONOPLAT 各编号对应 AC-MONOPLAT-<编号>-01，追溯状态见全局矩阵。非 UI Story 采用 CLI、文件系统和真实数据库端到端验证，不伪造浏览器用例数。

### 浏览器与原生覆盖

| 用例 | 验证 |
| --- | --- |
| happy-crud-selection-export | 输入、创建、编辑版本递增、选中导出内容、确认批删及数据库数量一致 |
| error-auth-retains-form-and-retries | 实际 POST 去除令牌得到 401，输入保持、数据库未写、恢复令牌后保存 |
| boundary-auth-scope-and-late-query | 错误令牌不显示旧缓存；恢复身份重新加载；旧搜索已进入网络后延迟，后续结果不被覆盖 |
| boundary-page-sort-filter-and-empty | 17 行分页末页 7 行、禁用下一页、排序、状态筛选 8 行、隐藏列、空搜索与清除 |
| narrow-theme-navigation-and-keyboard | 320px 不发生页面横向溢出、主题、Sheet Esc 焦点恢复、空表单 Esc 返回 |
| wide-navigation-and-shared-theme | 1280px 侧栏、导航锚点、共享主题、列表数据保持 |
| error-state-recovers-after-api-restored | 网络失败显示错误、隐藏旧行，恢复 API 后重试成功 |
| error-concurrent-edit-is-preserved | 编辑中外部版本递增，保存 409 且保留输入，放弃后显示最新数据 |

原生 `.app` 和 `.dmg` 均实际生成；启动 tauri://localhost，显示合成任务 `Native host verification`，经 dialog/fs 插件保存 CSV 并核验 144 字节及内容。CUA 只设置临时测试令牌，应用已退出。未执行 Windows/Linux 二进制构建、签名公证、OS 通知权限或真人辅助技术认证；桌面默认在线 API，不宣称实现离线同步。

## 4. 缺陷列表

完整复现与修复见 [defect-log.md](defect-log.md)。

## 5. 测试执行记录

2026-09-09：源回归 420 项；双数据库各 9 项；旧版升级 1 项；浏览器/性能和原生证据见上述可重复入口与容器结果目录。最终执行通过后，QA receipt 绑定受测提交。

## 6. 测试指标

1,000 行/20 次单并发服务查询中每次列表严格两次 Prisma 查询，没有随页大小增长的 N+1。SQLite 与容器 PG 的本机 p95 在各自 integration 日志，不用这组结果比较数据库优劣或推断生产容量。

k6 使用 5 VU/10 秒、1,000 条合成数据，覆盖 health 与分页列表；952 请求，列表 p95 8.37ms，HTTP 与数据校验错误率 0。500ms/1,500ms 仅为本轮本机 smoke 的 p95/p99 预算，不是实际项目生产 SLO；精确复跑结果以 k6.json 为准。

Semgrep 1.176.1 用仓库定向规则扫描 25 个文件，0 finding / 0 parse error；检测动态执行、shell 子进程和请求原始 SQL。它与所有权、边界、授权和事务负例结合，不代表全面安全审计。消费者 pnpm audit 的 3 high / 1 moderate 间接工具链告警，通过兼容固定覆盖修复为 0。版本与范围见 dependency-audit.json。

公开只读仅为 development/test 示例行为；production 读写均需要令牌，写入/删除/导出服务器端校验。租户/角色/会话系统不在示例业务范围，不把静态测试令牌当成生产认证实现。

## 7. 语义审查与结论

Review-Class: REQUIRED。Domain-Hit: schema、写入删除、事务并发、权限、公开 API、缓存、共享包、YAML 更新器。Reason: 新增可执行数据及 Monorepo 架构，涉及跨包和更新所有权。

- Prisma 是新消费者唯一迁移账本，schema/业务/已发布迁移不被普通模板更新重写；引擎改变需另行项目迁移。
- 结构化更新保持本地自定义，冲突与冻结计划漂移先于写入；必要 updater YAML 工具代码经 npm SHA-512 和 74 个 JS 原文件逐项验证，保留 ISC 来源。
- API 校验请求和响应、有限分页/批量/导出、原子条件修改，公开包不得引用服务端模型；身份变化隔离查询缓存。
- 固定依赖覆盖经过 generate、真实迁移/契约及构建验证；未采用 Prisma RC，不无条件升级破坏兼容的主版本。
- Codex review skipped by policy。仓库 TDD/QA 与合并全在本地，不创建或依赖 GitHub CI。

发现的阻断问题均修复并复验，见 defect-log.md。功能及工程验收 Go；最终交付要求 PR 合并、main 双 SHA 一致及 completion guard 通过。
