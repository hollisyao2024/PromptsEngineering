# 业务测试自动化 QA

模块 ID：BIZTEST · 状态：Passed · 日期：2026-10-07 · 交付：以本次交付的 QA 回执与合并结果为准

[主 QA](../../QA.md) · [PRD](../../prd-modules/business-testing/PRD.md) · [ARCH](../../arch-modules/business-testing/ARCH.md) · [TASK](../../task-modules/business-testing/TASK.md)

## 1. 验收范围与风险

验证“PRD 原子 AC 表 → 页面状态与操作路径模型 → 带标识符的自动化测试 → 机器可校验的验收证据”这条链：原子 AC 解析、`qa paths` 路径模型校验、`qa run` 套件执行与结果绑定、`qa verify` 业务验收门禁、各专家与模板的指导同步，以及分发与闭环。功能默认关闭（`qa.business.enabled=false`），关闭时 `qa verify` 的输出、退出码与回执和接入前一致。

不在范围：真实浏览器或原生客户端驱动（模板只定义 JUnit XML、AC/TC 标识符与 `platform` 标签三项契约，驱动由项目自带；Web 端可选的 Playwright 脚手架及其真实驱动取证见 [开源公共能力 QA](../open-source-components/QA.md) 的 US-OSSKIT-009）；`qa plan` 骨架与断言质量、flaky 策略、变异抽样、手工验收记录、性能与安全专项（P2、P4 另行立项）；生产环境与真实网络。

高风险：共享 QA 门禁（阻断回执签发）、CLI 入口、文件写入与删除（报告副本与结果文件）、进程执行（项目配置的套件命令）、路径包含（符号链接与路径穿越）。Review-Class 为 REQUIRED；缓存、数据库、外部 API、schema、部署为 N/A。Codex review skipped by policy；语义核查结论记录在任务状态。

## 2. 环境与复现

Node v24.19.0、pnpm 10.18.3、git 2.50.1；macOS arm64（Darwin 25.5.0）。零 npm 依赖、不联网；集成用例在临时 git 仓库中运行（`git init --initial-branch=main`，本地固定测试身份），不触碰真实仓库、真实凭据或项目业务数据。

复现入口均为 `pnpm agent -- test --file <测试文件> -- node --test`；测试位于 `infra/scripts/qa-tools/__tests__/`，共享夹具位于其 `fixtures/business-testing/`。自检：在息壤源执行 `pnpm agent -- qa paths`，对本模块 PRD 应返回 `STATUS=OK`（1 个模块、22 条原子 AC、22 个用例、0 个转移、0 条路径）。长运行回归由 `task exec` 留证，日志位于任务 evidence。

## 3. 验收追踪与用例

| Story / AC | 用例 | 优先级 | 场景与预期 | 证据 | 状态 |
| --- | --- | --- | --- | --- | --- |
| US-BIZTEST-001 / AC-BIZTEST-001-01 | TC-BIZTEST-001 | P0 | 逐行解析原子 AC 表；缺列、非法 ID/Story/优先级/验证方式/端、空字段、重复 ID、Story 与 ID 不符均逐项报告 | business-spec | Pass |
| US-BIZTEST-001 / AC-BIZTEST-001-02 | TC-BIZTEST-002 | P0 | PRD 示例与模块模板附录的原子 AC 表合法，Given/When/Then 各占一列；用例编号统一为 `TC-{MODULE}-NNN`，不再出现 `QA-N`；追溯矩阵模板不得用文件路径代替用例编号；PATHS 模板是合法路径模型，改坏后 `qa paths` 阻断 | business-templates | Pass |
| US-BIZTEST-002 / AC-BIZTEST-002-01 | TC-BIZTEST-003 | P0 | 解析界面、状态、转移、路径四张表；缺表、ID 重复、引用未知对象被报告 | business-spec、qa-paths | Pass |
| US-BIZTEST-002 / AC-BIZTEST-002-02 | TC-BIZTEST-004 | P0 | 引用不存在的转移或 AC、相邻转移首尾状态不衔接、路径为空，均 BLOCKED 且退出码非零 | qa-paths | Pass |
| US-BIZTEST-002 / AC-BIZTEST-002-03 | TC-BIZTEST-005 | P0 | `all-transitions`、`all-states` 缺口及未被任何转移关联的 P0 自动化 AC，均 BLOCKED 并列出缺口 | qa-paths | Pass |
| US-BIZTEST-002 / AC-BIZTEST-002-04 | TC-BIZTEST-006 | P1 | 合法模型 `STATUS=OK`，输出 AC、转移、路径、用例的覆盖矩阵与计数 | qa-paths | Pass |
| US-BIZTEST-003 / AC-BIZTEST-003-01 | TC-BIZTEST-007 | P0 | 逐套运行并记录退出码与 SHA256；超时整树终止（SIGTERM 后 SIGKILL）、无法启动、缺报告、路径逃逸/符号链接/已跟踪文件/DOCTYPE、旧报告清理、中断、脏工作区均不被掩盖 | qa-run、business-config、business-results | Pass |
| US-BIZTEST-003 / AC-BIZTEST-003-02 | TC-BIZTEST-008 | P0 | 解析 JUnit 的 pass/fail/error/skipped 并按 AC/TC 标识绑定；无标识用例单独计数；规格外标识进入 `UNKNOWN_IDS`；拒绝 DOCTYPE 与外部实体 | business-results | Pass |
| US-BIZTEST-003 / AC-BIZTEST-003-03 | TC-BIZTEST-009 | P0 | `ac-results.json` 字段齐全、先写报告副本再原子写结果、写后回读校验、位于容器 tmp | business-results | Pass |
| US-BIZTEST-003 / AC-BIZTEST-003-04 | TC-BIZTEST-010 | P1 | 每条 AC 按端分别记录；声明的端没有套件时记为缺失 | business-results | Pass |
| US-BIZTEST-004 / AC-BIZTEST-004-01 | TC-BIZTEST-011 | P0 | 无绑定用例、失败或仅有跳过，均 `AC_NOT_PROVEN`；`qa verify` 阻断且不签发回执 | qa-business-gate、qa-verify-business | Pass |
| US-BIZTEST-004 / AC-BIZTEST-004-02 | TC-BIZTEST-012 | P0 | 结果缺失、HEAD 漂移、脏工作区、配置漂移、报告被篡改、聚合不符，均阻断并提示重新 `qa run` | qa-business-gate、qa-verify-business、business-config | Pass |
| US-BIZTEST-004 / AC-BIZTEST-004-03 | TC-BIZTEST-013 | P0 | 默认关闭时输出、退出码与回执同接入前，不读取结果目录；模板源仓库跳过；`enabled` 非布尔或 `qa.business` 下出现未知键（如拼错的 `enable`）时按开启处理并 `CONFIG_INVALID` 阻断，不静默跳过 | qa-verify-business、qa-business-gate、business-config | Pass |
| US-BIZTEST-004 / AC-BIZTEST-004-04 | TC-BIZTEST-014 | P1 | 低于必需优先级与 `manual` 仅作风险披露；`requiredPriorities` 可配置 | qa-business-gate、business-config | Pass |
| US-BIZTEST-004 / AC-BIZTEST-004-05 | TC-BIZTEST-015 | P1 | 声明的每个端须各自通过且无失败，否则阻断 | qa-business-gate、business-results | Pass |
| US-BIZTEST-004 / AC-BIZTEST-004-06 | TC-BIZTEST-016 | P1 | 声明的覆盖准则须由通过的路径满足，否则 `PATH_COVERAGE_GAP` | qa-business-gate | Pass |
| US-BIZTEST-005 / AC-BIZTEST-005-01 | TC-BIZTEST-017 | P0 | 预言机规则（只来自 PRD AC、数据字典、UX 规范与 ARCH 契约，不以代码当前输出作期望值，歧义回流 PRD）在 QA 手册与四个角色文件中一致 | business-guidance | Pass |
| US-BIZTEST-005 / AC-BIZTEST-005-02 | TC-BIZTEST-018 | P0 | 手册章节含路径推导六步、三种覆盖准则、五种用例设计技术、优先级预算与数据驱动约定；与 `qa paths` 违规码、阻断码、风险码一致（防漂移） | business-guidance | Pass |
| US-BIZTEST-005 / AC-BIZTEST-005-03 | TC-BIZTEST-019 | P1 | 刷新只新增或提出差异，不覆盖已评审用例；`/qa plan` 措辞一致 | business-guidance | Pass |
| US-BIZTEST-005 / AC-BIZTEST-005-04 | TC-BIZTEST-020 | P0 | PRD、ARCH、QA、TDD 角色的命令表与完成定义，以及 CONVENTIONS、qa-tools README、QA 手册同步 | business-guidance | Pass |
| US-BIZTEST-006 / AC-BIZTEST-006-01 | TC-BIZTEST-021 | P0 | 闭环：基线全绿，逐个破坏后变红并给出对应错误码且不签发回执，恢复后重新变绿；伪造被识破；确定性；500 AC/2000 用例规模；安全；本仓 PRD 自检 | business-closed-loop | Pass |
| US-BIZTEST-006 / AC-BIZTEST-006-02 | TC-BIZTEST-022 | P0 | 新增模板自有文件均登记所有权策略；项目自有目录仅 MODULE-TEMPLATE 例外；应用到既有项目只新增模板文件并收敛 | business-templates、business-closed-loop | Pass |

边界：缺列、空字段、重复与非法 ID、未知引用、不衔接路径、空路径、覆盖缺口；无绑定、仅跳过、失败、无标识与规格外标识用例；超时、无法启动、缺报告、报告路径逃逸与符号链接、DOCTYPE 与外部实体；结果缺失、HEAD 漂移、脏工作区、配置漂移、报告被篡改；功能关闭与模板源仓库；开关键拼错。

## 4. 功能与兼容结果

| 验证 | 结果 | 范围 |
| --- | --- | --- |
| 业务测试 10 个文件 | 420 项 Pass | business-spec 55、qa-paths 29、business-config 52、business-results 122、qa-run 35、qa-business-gate 52、qa-verify-business 11、business-closed-loop 28、business-templates 14、business-guidance 22 |
| 接线与既有 qa 回归 | agent-cli 7、qa-verify 8、qa-verification-state 3，全部 Pass | `qa paths`/`qa run` 路由、门禁接入、回执签发 |
| 模板与协议守卫 | template-surface 49、agent-state-removed 4、multi-host-policy 4、rules-context-contract 3、workflow-continuation 9，全部 Pass | 篇幅上限、既有措辞、禁用 GitHub CI 口径、所有权清单 |
| 受影响范围回归 | 全部 Pass | qa-tools、agent-runner、setup、shared、tdd-tools 既有套件与模板分发守卫；命令、范围与退出码见任务证据中的 TEST_SCOPE_RESULT |
| 手工变异抽查 | 15 个变异体全部被现有用例杀死 | 判定恒放行、跳过 HEAD/哈希/重算/配置漂移检查、违规仍签发回执、脏树恒视为干净、忽略硬失败、接受 DOCTYPE、放行父目录/.git/绝对路径报告、键序与非确定输出 |
| 本仓自检 | `qa paths` 返回 `STATUS=OK` | 本模块 PRD 的 22 条原子 AC 与 22 个用例逐条可查 |
| 版本一致 | 模板 3.9.0 | package.json、agent/manifest.json 与 template.manifest.json 三处一致 |

各行为独立文件的实测数，420 仅指业务测试 10 个文件；变异抽查为手工执行，不属于模板分发的常规套件。变异抽查中曾存活的变异体已通过加强断言消除，复查后全部被杀死。

## 5. 非功能与安全

规模：500 条 AC、2000 个用例的校验、绑定与判定在 5 秒内完成；真实 `qa run` 与门禁在同等规模上放行，除套件自身耗时外同样不超过 5 秒。

安全：报告路径的绝对形式、盘符、UNC、`..` 逃逸、`.git` 目录、符号链接、已被 git 跟踪的文件与非常规文件，均在启动任何套件前阻断，也不会在别处写文件；读取报告时以 `O_NOFOLLOW` 打开并再次校验路径。报告拒绝 DOCTYPE 与外部实体（实体不展开、不读取目标文件），单个报告上限 64 MiB。门禁输出折叠空白与控制字符，字段超过 400 个码点截断，字段内的竖线替换为斜杠；环境变量的值不进入输出、结果与报告副本。PRD、PATHS 与报告里的命令注入样式文本只作数据，不被执行，也不改变判定。

可靠性：超时先 SIGTERM，5 秒宽限后 SIGKILL 整个进程组并确认进程组已空；SIGINT/SIGTERM/SIGHUP 转发给套件，重复信号直接 SIGKILL，中断时不写结果文件。配置、规格、HEAD 或报告路径任一非法，都在产生副作用前阻断；门禁内部异常折叠为 `GATE_ERROR` 阻断。同一状态重复运行输出逐字一致（除耗时与生成时间），用例、套件与 PRD 行序变化时聚合结果按规则稳定。

防篡改：结果文件绑定 HEAD、工作区洁净状态、配置摘要与各套件报告的 SHA256；改写聚合结果或替换报告副本都会被门禁识破。这提供防误改与防遗漏，不防同时伪造报告副本与结果记录，不宣称零信任。

## 6. 缺陷与限制

无未关闭缺陷；开发期间发现的问题均在红绿循环内修复，并由原用例固化。

限制：

1. 模板不提供界面或客户端驱动，契约为 JUnit XML、AC/TC 标识符与 `platform` 标签，驱动由项目自带；真实浏览器与原生客户端运行不在本次验收内。其后交付的 Web 端 `e2e` 模块（US-OSSKIT-009）已用真实 Playwright 对该契约做回归取证，见开源公共能力 QA；iOS、Android 与原生桌面驱动仍未验证。
2. 套件命令经 shell 执行，来自项目自己的 `agent.config.json`，信任边界即项目配置。
3. 模板源仓库跳过业务验收门禁，门禁只在启用该功能的实际项目生效。
4. 同一 worktree 禁止并行 `qa run`；交错运行时报告副本哈希重算不符，门禁 BLOCKED，重新执行 `qa run` 即恢复。
5. Windows 的整树终止走 `taskkill` 分支，仅做逻辑核对，未在 Windows 实机运行。
6. P2、P4（`qa plan` 骨架与断言质量、flaky 策略、变异抽样、手工验收记录、性能与安全专项）另行立项；P3 的 Web 端驱动脚手架已由架构包 `e2e` 模块交付（US-OSSKIT-009），其他端驱动未立项。

仓库级既有失败，本次前后一致、与本模块无关且未在此修复：`prd:lint`、`task:sync`、`sync-prd-arch-ids`、`qa:sync-prd-qa-ids`、`qa:check-defect-blockers`，以及 `qa:lint` 对 data-semantics 缺少 QA 报告的提示。

## 7. 发布建议

Go / PASS：6 个 Story、22 条 AC 全部有通过证据，16 条 P0 与 6 条 P1 均通过，无未关闭的 P0/P1 缺陷。模板 3.9.0。功能默认关闭，既有项目升级后行为不变；启用须补原子 AC 表、`PATHS.md` 与 `qa.business.suites`，并先执行 `qa paths` 与 `qa run`。模板源的 `qa verify` 不执行该门禁，最终交付仍以本机 QA 回执、PR 合并、主干同步与 completion guard 为准。

## 8. 证据摘要

回归日志由 `task exec` 写入任务 evidence，随任务关闭而清理。可复核性来自可重复执行的测试命令、绑定交付 HEAD 的 TEST_SCOPE_RESULT，以及本机 `qa verify` 签发的 BASE/HEAD 回执。

## 9. 覆盖摘要

| Story | 实际覆盖 | 性能与规模 | 安全与边界 |
| --- | --- | --- | --- |
| US-BIZTEST-001 | 原子 AC 解析 55 项；模板、示例与追溯矩阵模板合规 14 项 | N/A | 缺列、非法值、重复与 Story 不符逐项报告 |
| US-BIZTEST-002 | 路径模型 29 项；覆盖矩阵与二十类违规码 | N/A | 未知引用、不衔接、空路径、覆盖缺口阻断 |
| US-BIZTEST-003 | 配置 49 项、结果与绑定 122 项、套件执行 35 项 | 500 AC/2000 用例 5 秒内 | 路径逃逸、符号链接、DOCTYPE、超时整树终止、中断、脏工作区 |
| US-BIZTEST-004 | 门禁 51 项、接线 10 项；十四类阻断码与风险披露 | 同等规模放行 | 关闭时零影响、阻断不签发回执、篡改与漂移识别 |
| US-BIZTEST-005 | 指导同步 22 项；违规码、阻断码、风险码防漂移 | N/A | 预言机规则一致，歧义回流 PRD |
| US-BIZTEST-006 | 闭环 28 项；清单登记与升级收敛 | 规模用例 | 伪造识破、确定性、注入文本只作数据、环境变量不泄漏 |

需求覆盖 6/6、必需 AC 22/22、P0 通过率 100%（16/16）、P1 通过率 100%（6/6）。本次没有新增 UI、真实浏览器或原生客户端、生产负载与正式 SAST/DAST 工具选型，对应范围未运行；不把未运行项计为通过。
