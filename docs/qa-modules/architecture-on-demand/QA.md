# 架构按需获取 QA

状态：Passed / Go。负责人：模板维护者。版本：3.4.0。日期：2026-09-10。PR：#81；被测运行源码提交 6b87c5ff57c14820bf34f7832340cce9f59685da，最终交付提交由本地 QA receipt 绑定。

## 1. 验收范围

依据 [PRD](../../prd-modules/architecture-on-demand/PRD.md)、[ARCH](../../arch-modules/architecture-on-demand/ARCH.md)、[TASK](../../task-modules/architecture-on-demand/TASK.md)。范围为作业包独立采用、轻量架构入口、所选生成、固定缓存、3.3 兼容缩减与更新边界。仅更新息壤源；实际业务项目、生产数据库、云资源不属于本轮交付。

## 2. 风险与策略

Review-Class: REQUIRED。Domain-Hit: 文件写入/删除、缓存/并发、匿名远端获取、共享更新引擎。执行源单元/集成、CLI 完整旅程、原始旧版升级、真实 Web 消费和定向 SAST。业务认证、数据库 Schema、公开业务 API 与生产延迟路径无变更，相关浏览器认证、k6、DAST 和生产迁移为 N/A。

优先级、NFR 与缺陷分别见 [priority-matrix](priority-matrix.md)、[nfr-tracking](nfr-tracking.md)、[defect-log](defect-log.md)。

## 3. 环境与隔离

macOS arm64、Node 26.7、pnpm 10.18.3、Git、Semgrep 1.176.1。Web 消费者有独立 node_modules；模板源无应用依赖。旧版快照来自原始 3.3 提交 e8496c7c224981e45047f36743578f09a7b67711。临时项目、缓存和运行日志位于容器 tmp；公开源码通过产品本身的匿名 Git 获取。

CLI E2E 成功后只清理自身唯一临时目录，失败保留夹具以供排查。正式结果在 tmp/test-results/architecture-on-demand/result.json；其余证据在 tmp/architecture-on-demand/evidence。项目数据和凭据不写入文档。

## 4. 验收追踪

| Story | AC | TC | 成功、边界、恢复覆盖 | 状态 |
| --- | --- | --- | --- | --- |
| US-LAZYARCH-001 | AC-LAZYARCH-001-01 | TC-LAZYARCH-001 | agent-only 不生成架构；已有 runtime 的 agent scope 不变；冲突不顺带写入 | Pass |
| US-LAZYARCH-002 | AC-LAZYARCH-002-01 | TC-LAZYARCH-002 | 7 个入口/metadata 文件；未选实现和应用缺席；重复同步零差异 | Pass |
| US-LAZYARCH-003 | AC-LAZYARCH-003-01 | TC-LAZYARCH-003 | 最小 Node/Web 生成与检查；冻结计划后才新增模块；依赖消费和二次规划 | Pass |
| US-LAZYARCH-004 | AC-LAZYARCH-004-01 | TC-LAZYARCH-004 | 缓存命中/丢失/损坏、匿名固定 SHA、网络失败、并发、指针中断恢复 | Pass |
| US-LAZYARCH-005 | AC-LAZYARCH-005-01 | TC-LAZYARCH-005 | 3.3 两类项目缩减；本地漂移阻断；定制/迁移保留、基线共享引用与断电恢复 | Pass |
| US-LAZYARCH-006 | AC-LAZYARCH-006-01 | TC-LAZYARCH-006 | 已采用清单更新；新增选型需显式采用；agent scope 隔离与恢复后收敛 | Pass |

每项至少覆盖成功、边界和错误恢复维度；本轮产品入口为 CLI，不将协议/文件断言虚报成浏览器用例。CLI E2E 是一条连续旅程，包含空缓存初始化、损坏阻断、恢复收敛三个阶段；旧版和恢复测试补充各 Story 的独立边界。

## 5. 可执行用例

- 源回归：pnpm test，447/447，包括 runtime/source-cache 的 14 项新增用例。
- 原始 3.3：XIRANG_LEGACY_SOURCE 指向旧版快照，运行 node --test architecture/tests/on-demand-upgrade.integration.mjs；两类完整安装均通过。
- 公开固定源：XIRANG_RELEASE_COMMIT 指向已推送的受测提交，运行 node --test e2e/tests/architecture-on-demand.e2e.mjs；缓存删除后真实匿名获取、生成 API、运行 API 测试、故意损坏缓存、确认项目零写入、恢复匹配源再收敛。
- Web：仅选择 react-vite + data-table，init 安装后运行应用 pnpm test、pnpm build 和已安装入口的 check/plan；20/20，类型和构建通过，plan 零差异。
- 安全：复用 security/semgrep/monorepo-platform.yml，扫描 10 个变更运行文件；3 条规则，0 finding、0 parse error。

## 6. 非功能结果与边界

原始 architecture 目录为 271 个模板文件、850098 字节。升级后保留 7 个受管文件；测试中的项目说明额外保留，实测目录合计 8 文件、50501 字节，约减少 94%。共享 tooling、业务源码、依赖、其他协议和缓存不计入此数字；不声称网络逐组件下载。

惰性工具包 baseline 总字节从 2871102 降至 2092263，已采用 workspace 从 3021129 降至 2372600。只清理失去全部引用的旧基线；其他 owner 引用与未知文件保留。数字为受测运行源码的隔离夹具结果，后续版本可变化。

缓存固定官方身份、commit、内容摘要；路径/符号链接/并发负例与匿名 HTTP 凭据隔离已有测试。真实冷缓存重建耗时 11155ms，来源摘要 cd0d616cfc7f59072f264e8c4f40d0c774122f9456f4744d4ca6cccec7775035；这是单次本机网络观测，不是性能 SLO。SAST 只覆盖所列定向规则，不代表完整漏洞审计。本轮没有新增依赖，SCA 沿既有版本验收；Web 构建有约 515 KB 的 chunk 提示，构建成功，路由拆包仍由实际应用按需求处理。

## 7. 兼容与恢复

standalone 与 agent 项目均可使用轻量入口。原始 3.3 的组件、业务 API、Prisma Schema、SQL、RULES 和未知说明保持原样；旧 runtime 的本地修改先冲突，恢复原基线后可完成缩减。减少已采用组件不等于自动卸载。

冻结 resume 不先读取不完整的新 pointer/lock，也不获取远端源码；写锁和日志保护继续生效。新 lock 已发布、基线清理未完成的恢复有测试；macOS 系统路径别名识别旧日志，出现多个候选日志则阻断。若首次升级的入口工具未写全，可从固定模板源执行 resume。

## 8. 执行证据

| 证据文件 | 结论 |
| --- | --- |
| full-regression-final.log | 447 Pass，0 Fail |
| upgrade-3.3-release.log | 原始旧版 2 Pass，0 Fail |
| web-init.log / web-test.log / web-build.log / web-runtime-check.log / web-convergence.log | 20 Pass，类型/构建/check 成功，零差异 |
| recovery-red.log / recovery-green.log | 指针中断先失败，修复后通过 |
| semgrep.json | 10 文件，0 finding / error |
| published-cli-e2e.log 与 test-results/architecture-on-demand/result.json | 连续 CLI 旅程 Pass：真实冷缓存、损坏零写入、恢复收敛 |

文档验证：PRD/TASK lint 全部通过；ARCH/QA lint 返回成功并保留历史结构提示。validateQaFile 核验本模块 6 个 Story / 6 个 TC、覆盖率 100%，0 error / warning，结果在 module-qa.json。

补充直接调用的旧业务入口 qa:sync-prd-qa-ids 仅识别标题形式的 Story，因此将本仓库表格 Story 计为 0；qa:check-defect-blockers 要求项目 docs/data/nfr-tracking.md。两者直接运行失败不能记作通过，也不作为模板源验收依据。仓库既有 template.role=source 在 qa plan/verify/merge 中明确使用源仓库路径；本轮沿该路径执行，并核验上述模块 NFR、缺陷与真实测试，没有调整检查器或伪造业务总表。

## 9. 缺陷与语义审查

已关闭缺陷见 defect-log；无未关闭 P0/P1。移除必须具备旧所有权与相同本地内容；baseline 只在新 lock 持久化且无引用后移除；缓存在项目写入前准备，官方获取不继承项目 Git 凭据；恢复不重新选源。Codex review skipped by policy。没有创建、修改或依赖 GitHub CI。

## 10. 发布建议

六项 AC 全部通过，发布建议 Go。源 447/447、旧版 2/2、Web 20/20、公开源码 CLI 旅程与 SAST 均通过。合并、主分支双 SHA 与 completion guard 完成前不将功能通过等同于交付完成。未发布或含本地改动的源码预览丢失缓存后，需要匹配的 --source；此限制已在使用文档说明。

## 11. 完成检查

必需 Story/AC/TC 均有追溯；功能、失败、恢复与兼容证据可复现。完整模块清单、全局矩阵和源说明同步维护。运行态只保留在 task/worktree session；稳定里程碑不追加每次执行日志。
