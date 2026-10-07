# 开源组件 QA

状态：Passed / Go。负责人：模板维护者。版本：3.3.0。日期：2026-09-09。受测提交以本地 QA receipt 为准，合并状态由交付门禁确认。

US-OSSKIT-009（业务测试驱动脚手架，可选 `e2e` 模块）为后续增量：架构包 3.6.0、源发布 3.10.0，验证日期 2026-10-07，验收见 §4 第 009 行与 §8；其余内容仍是 3.3.0 的验收记录。

## 1. 验收范围

依据 [PRD](../../prd-modules/open-source-components/PRD.md)、[ARCH](../../arch-modules/open-source-components/ARCH.md)、[TASK](../../task-modules/open-source-components/TASK.md)。全部推荐组件均验证生成与真实消费；备选不标为可初始化实现。文件范围见 [文件 QA](../file-storage/QA.md)。仅更新息壤源码，未更新实际业务项目、云资源或生产数据库。US-OSSKIT-009 的真实驱动取证全部在临时目录与临时 Git 仓库完成，未启动任何实际项目的服务。

## 2. 风险与策略

优先级、缺陷和 NFR 分别见 [priority-matrix](priority-matrix.md)、[defect-log](defect-log.md)、[nfr-tracking](nfr-tracking.md)。高风险覆盖认证/权限、写删/事务/并发、公开协议、Schema、第三方 SDK 与共享更新引擎。执行源码单元、隔离 DB/Redis 集成、Chrome 生产构建旅程、k6、Semgrep 和依赖审计。

## 3. 环境与入口

macOS arm64、Node 26.7、pnpm 10.18.3、Go 1.26.4、Chrome/Playwright 1.63；SQLite better-sqlite3、PostgreSQL 18.6-bookworm 和 Redis 8.8.0-alpine 一次性 loopback 容器。消费者各有独立 node_modules；模板源没有安装应用依赖。版本明细见 architecture/dependencies.json 与 dependency-audit.json。

- 源回归：`pnpm test`，完整结果以 TDD/QA 最终日志为准。
- DB：`XIRANG_CONSUMER=<隔离项目> XIRANG_TEST_DATABASE_URL=<隔离连接> node --test architecture/tests/open-source.integration.mjs`。PG/SQLite 各 5 项。
- 队列：同一消费者环境运行 `architecture/tests/jobs.integration.mjs`；pg-boss 2 项（含同库事务），BullMQ Redis/PG 各 1 项。
- 组件：生成项目的 admin `pnpm test`，16 个文件、38 项测试；类型检查覆盖全部选中包。
- 浏览器：`XIRANG_CONSUMER=<完整 SQLite 消费者> XIRANG_TEST_TOOLS=<独立 Playwright 工具目录> node e2e/tests/open-source-components.e2e.mjs`。入口自动生成带标记的临时 QA 页面、生产构建，并启动随机 loopback 端口和真实 Better Auth/Prisma/文件服务；拒绝覆盖同名项目文件。
- 旧版：`XIRANG_LEGACY_SOURCE=<原始 3.2.0 快照> node --test architecture/tests/open-source-upgrade.integration.mjs`；保留真实 Schema、SQL、UI 和业务定制，显式新增能力与二次零差异。

浏览器和 k6 的结果在容器 `tmp/test-results/open-source-components/`；其余证据在 `tmp/storage-adapters/evidence/`。测试数据全为合成，凭据只在进程或权限 0600 的临时文件，不写入仓库；容器在验证后销毁。

## 4. 验收追踪与功能用例

| Story / TC 后缀 | 成功、边界、错误恢复 | 证据 | 状态 |
| --- | --- | --- | --- |
| 001 | 按需闭包、错误语言/后端拒绝、scoped 采用补齐应用与 DB、新选型显式采用 | open-source/storage/生成器测试与 architecture check | Pass |
| 002 | PG/SQLite 会话/组织、错密码重试、跨主体拒绝、撤销会话；CASL 读与条件写入/拒绝全部 | 两种 DB 集成 + Chrome 真实登录/组织/退出 | Pass |
| 003 | 校验负载/ID、重试、稳定 ID 去重、取消、持久重新打开；Prisma 投递提交/回滚 | 三类队列真实集成 + JobStatus 组件 | Pass |
| 004 | 上传进度/移除/失败、文件格式与大小拒绝、编辑 JSON、图表替代文字/注入拒绝、拖拽/画布按钮 | 组件测试 + Chrome，文件服务真写读一致 | Pass |
| 005 | 1000 行 DOM 有界、筛选/排序/多选复用、导出 1 行、空搜索清除恢复 | 虚拟表格与公共 DataTable 测试 + Chrome | Pass |
| 006 | 国际化实例隔离、Pino 请求上下文/递归脱敏、OTel 显式导出和退出 flush | 两种消费者各 5 项中的相关断言 | Pass |
| 007 | MSW 未默认启用、Node 拦截真实 fetch、浏览器入口独立 | MSW 集成、类型及公开包边界检查 | Pass |
| 008 | 原始 3.2 升级、定制和迁移不丢、双向采用作业/架构、根文件分 scope 更新、零差异 | 旧版集成 + root upgrades 5/5 + 生成器测试 | Pass |
| 009 | 每个 UI 应用一个 project 与 webServer、报告路径被忽略、可粘贴套件片段与 P1 契约一致、二次 plan 零变更、后加应用只补自己的示例用例；无 UI 应用、应用声明 `e2e`、带 `options`、v1 配置、`E2E_BASE_PORT` 非法、陈旧服务器占端口均明确拒绝；真实 JUnit 的失败、抛错、跳过与含 `]]>` 的形态判定正确；真实驱动经 `qa paths`、`qa run`、`qa verify` 放行一次、故意改坏后阻断一次、恢复后再放行 | `architecture/__tests__/e2e-driver.test.js` 8 项、`infra/scripts/qa-tools/__tests__/business-real-driver.test.js` 9 项、真实 Playwright 1.62.1 + Chrome 运行日志（§8） | Pass |

每个后缀映射 US-OSSKIT-xxx / AC-OSSKIT-xxx-01 / TC-OSSKIT-xxx；009 有四条 AC，AC-OSSKIT-009-01～04 依次对应 TC-OSSKIT-009～012（生成与元数据、契约、边界、真实驱动取证）。浏览器包含四组连续旅程，并非把每个断言虚报为独立测试；非 UI 能力使用 CLI/协议/数据库完整路径，不虚构浏览器用例数。

## 5. 非功能与安全

3 VU、10 秒的已认证文件列表 smoke：537 请求，p95 8.32ms，最大 21.35ms，HTTP 错误率 0，1074 项校验通过。500/1500ms 为本机 smoke 的 p95/p99 预算，不推导云容量或生产 SLO。

Semgrep 1.176.1 定向规则扫描 47 个匹配语言文件，0 finding / 0 parse error，针对动态执行、shell 与原始 SQL；其范围不代表全面 SAST。完整 Node/UI 消费者 pnpm audit 为 0 漏洞，825 个依赖；Go 功能/race/构建另行验证，不把 npm 审计称为 Go 漏洞审计。

所有高级能力一起静态引入的验证页 JS 约 1.67 MB、gzip 515 KB；这是全能力测试页。实际项目应按路由动态引入编辑器、图表和画布，默认 DataTable 配置不安装这些模块。可访问性验证语义、标签、键盘按钮、错误和窄屏操作，未声称通过所有辅助技术认证。

## 6. 缺陷与语义审查

发现并关闭的问题见 defect-log.md。Review-Class: REQUIRED。Domain-Hit: 身份授权、数据库写删与 Schema、事务/并发、SDK、共享 UI 与文件更新器。

- 认证主体来自服务端会话，组织和权限不能依赖客户端状态；CASL 默认拒绝。
- 队列普通启动不迁移；pg-boss 同库投递参与事务，Redis/跨库使用项目 Outbox，不声称 exactly-once。
- 根文件只从可信模板 baseline 保留另一能力的贡献，项目定制仍参与三方合并；不从当前项目内容吸收新的模板基线。初次选择必须显式 architecture init/update。
- 词条、策略、处理器、业务 Schema/接线仅初始化；已发布 SQL 只追加。
- 浏览器禁止服务端 SDK/数据库导入；高级 UI 保留 shadcn 与唯一 DataTable。
- Codex review skipped by policy。交付门禁本地执行，不创建或依赖 GitHub CI。

## 7. 发布建议

功能验收 Go。最终提交仍须全量回归、QA receipt、PR 合并、main 双 SHA 一致和 completion guard（本段沿用 3.3.0 的发布建议；US-OSSKIT-009 随 3.10.0 增量交付，回归范围按 `docs/CONVENTIONS.md` 的测试范围规则界定为定向回归，验证边界见 §8）。真实云、外部 OAuth/邮件/企业 SSO、原生回调、触摸设备和生产负载由实际项目继续验收；这些项目在目录中明确标记，不能当作本轮测试通过。

## 8. 业务测试驱动脚手架（US-OSSKIT-009）真实驱动验证

环境：macOS arm64、Node v24.19.0、pnpm 11.22.0、`@playwright/test` 1.62.1（离线从 pnpm store 安装，未下载浏览器）、系统 Google Chrome 154.0.8037.98（`E2E_BROWSER_CHANNEL=chrome`）。与 §3 中 3.3.0 验收所用的 Node、pnpm、Playwright 版本不同，两者互不替代。

已验证：

- 生成物：生成的 `tsconfig.json` 下 `tsc --noEmit` 通过，故意写错类型的反例会报错；webServer 命令经 pnpm 透传 `--port <n> --strictPort`（react-vite、tauri 的 `dev:web`）与 `-p <n>`（react-next），验证时设 `E2E_BASE_PORT=4400`，三个应用依次取 4400、4401、4402；`E2E_BASE_PORT` 取 `abc`、`80`、`65535`、`1.5` 时报错退出；`E2E_SKIP_WEBSERVER=1` 直接测已在运行的服务；`reuseExistingServer:false` 遇到陈旧服务器报端口已占用；`retries` 为 0。
- 真实 JUnit：通过与失败两份报告固化为夹具（`infra/scripts/qa-tools/__tests__/fixtures/business-testing/playwright/`），含断言失败、抛错、跳过与含 `]]>` 的错误信息；`business-real-driver.test.js` 断言 P1 的解析、AC/TC 绑定、聚合与门禁判定，并用 `qa run`、`qa verify` 回放两份报告。
- 闭环：临时 Git 仓库（本地裸 origin）按 README 里的片段配置套件，`qa paths` 通过；页面正常时 `qa run` 退出 0、`BUSINESS_GATE=PASS` 并签发回执；admin 首页改为空白后 `qa run` 退出 1，`BUSINESS_GATE=BLOCKED`（`AC_NOT_PROVEN`、`PATH_COVERAGE_GAP`），不签发回执；恢复后再次放行。

边界与未验证项：

1. 开发服务器使用模仿 vite、next 端口参数处理的替身；未启动真实 react-vite、react-next 开发服务器，真实 vite、next 对 `--port`、`--strictPort`、`-p` 的处理未验证。
2. 只验证了 `@playwright/test` 1.62.1。npm 最新为 1.63.0，本机 store 只有 `playwright-core@1.63.0`，没有用它运行生成的配置与 JUnit 报告器，所以固定 1.62.1；升级须重跑本节的真实驱动取证。
3. Tauri 只覆盖 web 层（`dev:web`），不启动原生壳；iOS、Android 与原生桌面驱动不由模板提供，也未验证。
4. 闭环中的 `qa verify` 运行在临时仓库的夹具任务状态上，不是息壤源自身的门禁（模板源跳过业务验收门禁）。
5. 通过报告与 Playwright 原始输出逐字节一致；失败报告相对原始输出只做两处脱敏（本机绝对路径前缀换为 `/workspace`，三处 CDATA 标题行的行尾空格删除以通过 `git diff --check`），其余字节不变。
6. 浏览器获取（`playwright install`）按设计留给项目，模板与本次验证都没有执行。

无未关闭缺陷。运行日志与 sha256 索引保存在任务证据目录（容器 `tmp`，不入库）；入库的永久证据是上述夹具与两个测试文件。
