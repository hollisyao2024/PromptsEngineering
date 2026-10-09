# Changelog

 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [Unreleased]

- 取消“回灌模板”命令，统一为“回灌息壤模板”：`pnpm agent -- template backfill` 不再接受 `<source>` 位置参数与 `--source/--target/--template`，移除 `template.sourceRepo` 配置项与 `AGENT_TEMPLATE_SOURCE_REPO` 环境变量，目标固定为官方息壤源 `main`。命令匿名 required fetch 官方 `main`，在项目容器 `cache/xirang/backfill-source/repo` 的可重建克隆中运行其自身的 `task start` 与 `worktree new` 创建新任务 worktree 并复制 template-owned 差异，输出 `TASK_ID`、`NEXT_CWD`、`BACKFILL_BRANCH`，再按息壤源的 `tdd sync → tdd push → qa plan → qa verify → qa merge` 合并；`template.role=source` 时阻断。新增 `infra/scripts/setup/__tests__/backfill-template.test.js`。

## [v3.11.14] - 2026-10-10

- 修复 QA 会话模块推断误报：`inferSessionModules`（`qa plan`、`qa verify` 共用）在改动命中 `docs/{prd|arch|task|qa}-modules/<模块>/` 时只返回这些模块，不再叠加路径名与分支名推测；按名匹配跳过仓库根文件以及 `infra/`、`agent/`、`AgentRoles/`、`tooling/`、`architecture/`、`.xirang/`、`.github/`、`.claude/`、`.codex/` 下的模板与工具链路径。此前 `agent.config.json` 会带出 `agent` 模块，`routes/admin/auth.ts` 会带出 `auth` 模块。
- `qa-lint` 新增 TC 引用写法检查：主/模块 QA、主 PRD、模块 PRD 与追溯矩阵中的区间（`TC-X-001~005`、`TC-X-035-A~E`）与子编号（`TC-X-035-A`、`TC-X-023-05`）输出 `TC_ID_NONCANONICAL=<文件>:<行> <写法>`，只计为警告，退出码不变；业务测试链路仍以 `TC_INVALID` 严格拒绝。PRD/QA 专家、QA 手册、追溯矩阵模板与 qa-tools README 写明 TC 引用须逐个列出完整 `TC-{模块}-NNN` 并以逗号分隔。新增 7 项定向测试。

## [v3.11.13] - 2026-10-10

- 修正 v3.11.10 发布说明第③项：`generate-codemap.js` 的 `session` 作用域实际行为是 map 始终全量、只追加 `SESSION_CHANGED_FILES=` 报告行，原描述写反。

## [v3.11.12] - 2026-10-10

- 修复 `DESIGN.md` 漂移检查跟随符号链接的问题：根 `DESIGN.md` 改经 `safePath` 解析，是符号链接时不跟随、不读取，以 `DESIGN_DRIFT_INVALID_DESIGN` 告警，检查不抛错，门禁结果不变；文件不存在或项目没有 shadcn 应用时仍静默跳过。TDD 与 QA 手册补充说明：`tdd sync`、`qa verify` 在 stderr 输出的 `ARCHITECTURE_WARNING=<name>|<code>|<reason>` 不阻断，执行器把告警报告给用户，不自行修改项目的 `DESIGN.md` 或 `styles.css`。

## [v3.11.11] - 2026-10-10

- 原地接管 Claude Desktop worktree：在 `<repo>/.claude/worktrees/<name>` 中执行 `worktree new` 不再新建 worktree，而是在工作区干净、required fetch 通过后接管当前目录，无自有提交时重置到远端 base SHA，有自有提交且落后时阻断（不自动 rebase），分支改为规范名，session 记录 `provenance.origin=claude-desktop` 与原分支，输出 `STATUS=ADOPTED`。
- 合并后清理（`qa merge`、封印补偿器、`worktree audit`、finish guard、`worktree remove|cancel`、分支对账）按 session 计算删除边界：仅带匹配 provenance 的 Desktop 精确子目录可删，未接管或伪造封印的 Desktop worktree 保持跳过；`.gitignore` 与模板追加片段忽略 `.claude/worktrees/`。接管在锁内复检并在释放前写入带 provenance 的 session，写入前失败会回滚重置与改名（输出 `ADOPTION_ROLLBACK=`）。新增 14 项定向测试。

## [v3.11.10] - 2026-10-10

- 业务测试自动化全链路试跑（XiaoLan Admin 登录子域）暴露的模板缺陷修复，共 8 处脚本改动与 1 组文档修正：① `infra/scripts/shared/architecture-check.js` 以带 `code`/`nextAction` 的错误替代裸崩溃，`ARCHITECTURE_PACKAGE_MISSING`（声明了架构包但 `architecture/` 缺失）与 `ARCHITECTURE_CHECK_FAILED` 进入 `qa verify` 的 `REASON=` 映射与 `tdd sync` 的 `NEXT_ACTION=`；② `tdd sync` 新增 Base Sync Gate，先 `fetch --prune origin <base>`、再在需要时 `merge --no-edit origin/<base>`，输出 `BASE_SYNC=`，fetch 失败 `BASE_FETCH_FAILED`、冲突 `merge --abort` 后 `BASE_MERGE_CONFLICT` 阻断，避免 `qa verify` 因远端主干前进报 `STALE_QA_BASE`；③ `generate-codemap.js` 的 `session` 作用域不再把 `docs/data/CODEBASE_MAP.md` 覆盖为分支改动子集：map 始终按全量高价值文件生成，`session` 只额外输出当前分支改动文件数 `SESSION_CHANGED_FILES=`；④ `business-results.js` 测试名显式带 AC ID 时只绑定该 AC，不再按同 TC 扩散到其他 AC，避免未验证 AC 被标记为已证明；⑤ `agent-cli` 新增 `tdd review-gate` 路由，`tdd-review-gate.js` 支持 `--record required|optional --reason <text> [--task <id>]` 把模型侧语义审查结论作为 `REVIEW_DECISION=` 写入任务 evidence，`tdd push` 读取最近记录并在 PR 描述写入 `Model-Review:`；⑥ `qa paths` 对含 `auto` AC 但缺少 `docs/qa-modules/<域>/PATHS.md` 的域输出 `VIOLATION=PATHS_MISSING` 并退出 1，Playbook 违规码表同步；⑦ `agent-cli` 在派发前检查目标脚本存在，缺失时输出 `STATUS=BLOCKED`、`REASON=MISSING_SCRIPT` 与 `NEXT_ACTION=`，不再抛 `MODULE_NOT_FOUND` 堆栈；⑧ `architecture/scripts/monorepo.js` 的 v2 workspace 校验改为要求固定的 `pnpm@10+`（原来只接受 `pnpm@10.x`，pnpm@11 项目被误阻断），`architecture/guides/monorepo.md` 同步。文档修正：PRD 专家与 Playbook 的「模块 PRD 附录 A」改为 MODULE-TEMPLATE 的「§3.2 原子 AC 清单」，`MODULE-EXAMPLE.md` 标注编号对应；QA 专家与 Playbook 的 E2E 路径由 `e2e/tests/` 改为与架构包脚手架一致的 `packages/e2e/tests/<app>/`，定向命令改为 `pnpm --filter @project/e2e exec playwright test`；qa-tools / tdd-tools README 补充上述阻断码、`PATHS_MISSING`、`BASE_SYNC` 与 `--record`。
- 验证：新增 `infra/scripts/shared/__tests__/architecture-check.test.js`、`infra/scripts/tdd-tools/__tests__/tdd-review-gate.test.js`，扩展 qa-verify、monorepo、tdd-sync（真实 git 仓库夹具验证合并与冲突回滚）、generate-codemap、business-results、qa-paths、agent-cli、tdd-push-pr-summary 测试；定向范围为 `infra/scripts/{qa-tools,tdd-tools,agent-runner,shared}/__tests__` 与 `architecture/__tests__/monorepo.test.js`。未修复、仅记录的试跑发现：`qa verify` 串行门禁、`qa-test-scope` 要求 `exit_code:0`、`inferSessionModules` 按路径段推断、追溯矩阵生成 `TC-ADMIN-035-A..E` 子编号，另行处理。

## [v3.11.9] - 2026-10-10

- 修复（`infra/scripts/agent-runner/test-command-scope.js`）：`task exec` 此前只放行 `pnpm agent -- test --file <文件> -- <运行器>`，等价的 `node infra/scripts/agent-runner/agent-cli.js test --file <文件> -- <运行器>`（含 `agent-cli.js -- test --file` 写法）会递归检查嵌套运行器，因其后没有文件参数被判为 unbounded 而拦截。现在直接调用 agent-cli 的 `test --file` 与 pnpm 入口同等放行；没有 `--file` 或调用其他子命令时仍照常检查。
- 修复（`infra/scripts/qa-tools/qa-test-scope.js`）：`TEST_SCOPE_RESULT` 的 `environment`、`dependencies` 此前只接受非空字符串，写成对象会在 `qa verify` 按 `TEST_SCOPE_EVIDENCE` 阻断。现在也接受各叶值均非空的对象（嵌套对象、非空数组、数字与布尔叶值可用）；空字符串、空对象、空叶值、顶层数组或数字仍拒绝，错误信息写明两种可接受形状。

## [v3.11.8] - 2026-10-09

- 新增 `DESIGN.md` 与 `styles.css` 的漂移检查（ADR-040）：shadcn 应用的 `architecture check` 按实际生效取值比较颜色、圆角和正文字体族，只告警不阻断；`tdd sync` 与 `qa verify` 的架构门禁把告警输出为 `ARCHITECTURE_WARNING=<name>|<code>|<reason>`，通过条件不变。

## [v3.11.7] - 2026-10-09

- 修正模板回归测试的项目兼容性：权限测试允许项目追加规则，同时继续检查模板必需规则；业务验收关闭场景的完整输出快照纳入统一 CLI 结果块，保持回执与门禁断言。

## [v3.11.6] - 2026-10-09

- 回灌 GitHub 自动代理支持：显式环境变量和 Git 配置优先，macOS 每次读取已启用的 HTTP(S) 系统代理，无代理时直连；代理失败不自动改走直连。REST API、Git、CLI 及匿名模板拉取共用解析器，保留 API 优先和匿名凭据隔离，整体构建与部署不注入自动发现的代理。

## [v3.11.5] - 2026-10-09

- GitHub 后端优先使用项目 `GH_TOKEN` 调用 REST API：即使已安装 `gh`，PR 创建、查询与合并仍选 API，且不执行 CLI 可用性探测。无令牌时保留已有 CLI 兼容路径；API 请求失败不切换 CLI，QA 原有固定 SHA 本地合并门禁不变。
- 同步共享约定和命令提示；新增后端选择、零 CLI 探测、非法远端阻断测试，并验证 PR 消费者及令牌加载，36 项定向测试通过。

## [v3.11.4] - 2026-10-09

- 修复（`tooling/xirang/engine.js`，`merge-json`）：项目删除了一个 `merge-json` 策略的文件、上游未变时，`decide()` 把 `mergeJsonValue()` 返回的 `undefined` 当作文件内容序列化，写出只有 `undefined` 一行的文件，而且每次应用都再写一次，不收敛。现在合并结果为 `undefined` 时返回 `null`：文件保持不存在，计划里没有该文件的变更，重复应用逐字节收敛。`merge-yaml` 走的是另一条就地补丁路径，项目删除文件而上游不变时会按集合重建该文件（语义不同，不是写出 `undefined`），本次没有动，见下面「未处理」。
- 修复（`qa verify`，v3.11.0 条目「未处理的试验缺陷」③，试验报告 #4）：`captureQaVerificationIdentity` 里签发回执前的 `git fetch --prune origin` 失败时，现在对同一条命令重试一次（`QA_FETCH_ATTEMPTS = 2`）：第二次成功照常签发回执；两次都失败即停止，输出 `STATUS=FAILED`、`REASON=QA_FETCH_FAILED`，不签发回执、不做第三次，也不读取 `rev-parse`。仍是 fail-closed，只是把代理偶发 SSL 错误这类一次性失败吸收掉。
- 收口（试验缺陷 ①④⑤ 是同一缺口的三个表现，试验报告 #1/#4/#5）：`qa verify` 与 `qa plan` 两个老脚本此前从未输出过 `STATUS`/`SUMMARY`/`NEXT_ACTION`，失败时是 `❌ …` 加 `process.exit(1)`、原始 git 报错或带栈的 `Error`。现在两者结尾统一输出 `STATUS=OK|BLOCKED|FAILED`、`SUMMARY=`、`NEXT_ACTION=` 三行，非 OK 时在 `STATUS` 之后另给 `REASON=<code>`，退出码非零；实现放在新文件 `infra/scripts/shared/result-block.js`（`RESULT_STATUSES`、`oneLine`、`resultBlockLines`、`resultExitCode`），`qa-run.js`、`qa-paths.js` 各自的 `oneLine` 副本改为引用它。`qa verify` 的代码：`QA_BRANCH_REQUIRED`、`STALE_QA_BASE`、`HEAD_NOT_PUSHED`、`TEST_SCOPE_EVIDENCE`、`QA_VERDICT_NO_GO`、`BUSINESS_GATE_BLOCKED` 为 `BLOCKED`，`QA_FETCH_FAILED` 与 `UNEXPECTED_ERROR` 为 `FAILED`（后者仍把堆栈写到 stderr）；`QA_RECEIPT=`、`BASE_SHA=`、`HEAD_SHA=` 等既有键值行不变，结果块追加在其后。`qa plan` 的代码：`PRD_MISSING`、`NO_MODULES`、`MODULE_STORIES_EMPTY`、`MODULE_SET_MISMATCH` 为 `BLOCKED`，最后一种另逐项输出 `MODULE_SET_MISMATCH=<missingArch|extraArch|missingTask|extraTask>|<module>`；未预期异常为 `FAILED`、`REASON=UNEXPECTED_ERROR`；模板源仍直接 `STATUS=OK`。取舍：① 的「PRD/ARCH/TASK 三套模块目录集合必须一致」保留不放宽——这是治理流程的设计，放宽与否是产品口径——只把退出方式换成可解析的结果块，让执行器能按 `NEXT_ACTION` 行动。
- 加固（试验缺陷 ⑤ 的另一半，试验报告 #7）：`TEST_SCOPE_RESULT.checks[].evidence` 原先只要是非空字符串就通过。现在当它写成 `evidence/<名>.log sha256=<hex>`（`task exec` 输出的 `LOG_PATH`/`LOG_SHA256` 就是这个形状）时，`qa verify` 核对 `<容器 tmp>/agent-task-runs/<task>/evidence/<名>.log` 存在且 sha256 一致，缺失或不符按 `TEST_SCOPE_EVIDENCE` 阻断；其他写法仍只做结构校验，已有任务记录不受影响，不需要迁移。没有做：核对日志里的退出码是否属实、与 `ac-results.json` 绑定。
- 补齐（试验缺陷 ⑥ 后半与 v3.11.0 审查遗留）：`pnpm agent -- test --file <文件> -- <运行器>` 对与 `qa.business.suites` 登记命令逐词一致的运行器放行——只校验文件，并把文件原样追加到命令末尾，所以登记的套件命令须能接受末尾的文件参数；未登记命令仍只接受既有的文件级运行器。`test-command-scope.js` 导出 `isRegisteredSuiteCommand`，`task exec` 与 `test --file` 共用同一判定。`docs/CONVENTIONS.md` §8 的 `task exec` 拦截句补上「与 `qa.business.suites` 已登记命令逐词一致的命令直接放行」（接在「才放行」之后，已固定的子串不动）。`agent-task.js` 的 `registeredSuiteCommandsOf` 复用 `runtimeContext` 已加载的 config，不再每次 `task exec` 多调一次 `loadConfig`。`business-spec.js` 第 144、262 行与其测试里嵌着不可见 U+FEFF 的去 BOM 正则改为 `﻿` 转义，行为不变。
- 未处理（仅记录）：试验缺陷 ②（试验报告 #3，`inferSessionModules` 把 template-sync 提交带来的 `agent/manifest.json` 之类路径按路径段算作同名模块）本次没有改：哪些路径段该计入是产品口径，结果无害且 `--modules` 可显式指定，等用户定口径再做。上面的 `merge-yaml` 删除语义、审查遗留的「回执 `business` 摘要没有读取方」与「`qa-verify.test.js` 的 Story 表夹具建在真实 `docs/*-modules/` 下」也未动。
- 测试：先红后绿，按步骤逐个进行。`xirang-engine.test.js` 新增 1 例（删除的 `merge-json` 文件保持不存在且重复收敛；改前实际得到 `undefined\n`），21 → 22；`qa-verify.test.js` 新增 5 例（fetch 首次失败二次成功→签回执且 fetch 恰 2 次；两次失败→`QA_FETCH_FAILED` 且无第三次、无 `rev-parse`；已知错误映射为 `BLOCKED` 代码、未知错误为 `FAILED`；判定与业务门禁各有代码、OK 时带回执；身份错误带稳定代码），9 → 14；`generate-qa.test.js` 新增 2 例（模块集合不一致→可解析原因与逐模块行；缺根 PRD→可解析原因），25 → 27；`qa-test-scope.test.js` 新增 1 例（带 sha256 的日志引用必须指向存在且一致的任务证据文件），10 → 11；`targeted-test.test.js` 新增 1 例（登记命令逐词一致的运行器放行并仍追加文件），2 → 3；新文件 `result-block.test.js` 3 例；`template-surface.test.js` 钉死 CONVENTIONS §8 的新句（用例数仍 55），`business-spec.test.js` 只改 BOM 转义（仍 64）。
- 文档：`infra/scripts/qa-tools/README.md`（§0 `/qa plan` 结果块与阻断码、§1 `qa verify` 结果块、阻断码清单与 `evidence` 的 sha256 核对、§7 `task exec` 段补 `test --file` 放行、回执段补结果块一段）、`AgentRoles/QA-TESTING-EXPERT.md`（`/qa plan`、`/qa verify` 两条各补结果块与代码）、`AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md`（`task exec` 与已登记套件命令一段补 `test --file` 与 `LOG_PATH`/`LOG_SHA256` 写法；新增小节「流程阻断码（结果块 `REASON=`）」，8 行表给出代码、状态、含义与处理，另一段说明 `qa plan` 代码；检查清单补「`qa verify` 结尾 `STATUS=OK` 且已输出 `QA_RECEIPT=`」一条）。`docs/CONVENTIONS.md` 只补上面那一句。
- 版本与下游影响：patch 级，源发布版本由 `tdd sync` 自动递增（预期 3.11.3 → 3.11.4），架构能力包版本不变（没有 `architecture/` 下的改动）。随作业包分发的改动都是 `overwrite`：`tooling/xirang/engine.js`、`infra/scripts/qa-tools`（`qa-verify.js`、`generate-qa.js`、`qa-run.js`、`qa-paths.js`、`qa-test-scope.js`、`business-spec.js`、`README.md` 与 4 个测试）、`infra/scripts/agent-runner`（`agent-task.js`、`targeted-test.js`、`test-command-scope.js` 与 1 个测试）、`infra/scripts/shared`（新文件 `result-block.js` 及其测试）、`infra/scripts/setup/__tests__` 的 2 个测试、`docs/CONVENTIONS.md` 与两份 QA 专家文档；无本地修改时随 `template sync` 刷新，本地改过的副本按 `overwrite conflict: local content changed` 阻断。`CHANGELOG.md` 是 `project-owned`，不分发。没有新增命令、配置键或依赖。实际项目需要注意：① `qa verify`、`qa plan` 的输出末尾多出结果块，退出码语义不变（成功 0、否则非零），只看退出码的脚本不受影响，解析输出的脚本可改为读 `STATUS=`/`REASON=`；② 把 `TEST_SCOPE_RESULT.checks[].evidence` 写成 `evidence/<名>.log sha256=<hex>` 的任务，现在会被真实核对，日志被清理或改动过的旧记录在重新 `qa verify` 时会按 `TEST_SCOPE_EVIDENCE` 阻断；③ 一次性的 fetch 失败不再让 `qa verify` 中止。`template sync` 从官方 `main` 上固定的提交取应用器，所以发布之后的第一次同步就已经用上修好的 `merge-json`；已经被旧引擎写出 `undefined` 的下游文件不会被自动清理，需手工删除（删除后新引擎不会再写回）。回退：revert 本次变更。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md`（18,970 B）不变，`docs/CONVENTIONS.md` 29,071 → 29,147 B（+76 B），两份必读基础规则合计 48,041 → 48,117 B。按需加载的文件：`AgentRoles/QA-TESTING-EXPERT.md` 21,191 → 21,697 B（+506 B），`AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md` 49,341 → 52,203 B（+2,862 B），`infra/scripts/qa-tools/README.md` 30,959 → 33,283 B（+2,324 B）；`AgentRoles/TDD-PROGRAMMING-EXPERT.md`（9,761 B）不变。脚本：`qa-verify.js` 23,269 → 27,640 B，`generate-qa.js` 31,547 → 34,119 B，`qa-test-scope.js` 5,032 → 6,372 B，`targeted-test.js` 3,441 → 4,102 B，`engine.js` 23,485 → 23,671 B，新文件 `result-block.js` 1,304 B。
- 验证方式与未覆盖（仅记录）：每一步先红后绿（上面「测试」里逐项写了改前的失败形态），`git diff --check` 无告警。回归按 `docs/CONVENTIONS.md` §8 做定向而不是全量：11 个被改的生产模块（`engine.js`、`qa-verify.js`、`generate-qa.js`、`qa-run.js`、`qa-paths.js`、`qa-test-scope.js`、`business-spec.js`、`result-block.js`、`targeted-test.js`、`test-command-scope.js`、`agent-task.js`）的自有测试 12 个，加按文件名检索到的直接消费者测试（`multi-host-git-simulation`、`business-closed-loop`、`business-templates`、`qa-business-gate`、`business-guidance`、`business-real-driver`、`business-results`、`template-consumer-compat`、`workflow-continuation`、`business-config`、`agent-cli`、`worktree-core`、`worktree-audit`、`governance-alignment`），再加直接 `require` `tooling/xirang/engine.js` 或处理 `tooling/xirang` 路径的测试（`infra/scripts/setup/__tests__` 下 5 个、`architecture/__tests__` 下 15 个），共 46 个测试文件（全仓 116 个），逐个以 `pnpm agent -- test --file <文件> -- node --test` 经 `task exec` 运行，另加 JS 语法、JSON 解析、`git diff --check <主干>..HEAD` 三项静态检查；日志与 sha256 留在任务证据里，`TEST_SCOPE_RESULT` 的 `evidence` 用的就是本次新增的 `evidence/<名>.log sha256=<hex>` 写法。本条定稿晚于开发期的测试，而 `template-surface.test.js` 读取本文件，所以定稿后单独重跑了它（55/55），正式的一轮在推送后的提交上运行。未运行：`pnpm test` 全仓聚合与其余 70 个测试文件（按 `infra/`、`tooling/`、`architecture/` 内的文件名引用关系查过两层，它们不引用这 11 个模块，也不引用直接引用这些模块的脚本；`tdd sync`、`tdd push`、`qa verify`、`qa merge` 等命令本身在本次交付链里真实运行）；`architecture check`（模板源没有 `architecture.config.json`，该检查只对实际项目有意义）；安全、性能与浏览器 E2E（不涉及）。没有做的：`QA_FETCH_FAILED` 只用注入的 fetch 失败验证过，没有复现真实代理 SSL 错误；结果块的 `REASON=` 代码只在单测与本次交付链里出现过，没有在实际项目里演练；`evidence` 的 sha256 核对只覆盖 `task exec` 的日志形状，`task exec` 之外的证据写法仍是结构校验。

## [v3.11.3] - 2026-10-09

- 更正：官方 lint（`@google/design.md`）的门禁口径。v3.10.4、v3.10.5 条目和 PRD 手册 §5（v3.10.5 起）写的是“以退出码为门禁，不以警告条数为门禁”，只对了一半。`@google/design.md@0.4.0` 的规则 `broken-ref` 同时覆盖两类问题：Token 引用无法解析（不带显式级别，按规则默认级别算错误，退出码 1），以及未知的组件子属性（实现里显式标为 `warning`，退出码仍为 0）。所以示例组件里多写一行 `minHeight: 44px`，退出码仍是 0，只在 `--format json` 的输出里多出一条 `broken-ref` 警告，单看退出码会放过它；一个下游界面项目的根 `DESIGN.md` 就带着这样一行。现在的口径是：退出码为 0，且 `--format json` 输出中规则 `broken-ref` 的条数为 0；`orphaned-tokens` 等其他规则仍不以条数作门禁。
- 做法与取舍：骨架 `docs/data/templates/prd/DESIGN-TEMPLATE.md` 的 `## Components` 节新增一行，列出 0.4.0 认可的 8 个组件子属性（`backgroundColor`、`textColor`、`typography`、`rounded`、`padding`、`size`、`height`、`width`），点名 `minHeight`、`borderColor` 两个常见误用，并说明这类约束写进正文（如 Accessibility 的触控目标），不写进 front matter；PRD 手册 §5 的门禁句改为上面的口径并指向骨架的清单，不重复清单。没有采用：在作业包里加运行官方 lint 的脚本或检查（作业包不带该依赖，ADR 037「不引入 `@google/design.md` 依赖」的决策不变）；只改手册不改骨架（有界面的项目从骨架起步，写 front matter 的当下就该看到清单，而手册只在 PRD 阶段点读）。
- 测试：`template-surface.test.js` 新增常量 `DESIGN_COMPONENT_SUB_TOKENS` 与 `assertComponentSubTokensAreRecognised`，新增 2 个用例——骨架列出的清单必须与常量逐项一致、示例组件只用清单内的属性、并写明未知子属性只报 `broken-ref` 警告而退出码仍为 0；向示例组件加一行 `minHeight` 必须被拒绝。既有的 PRD 手册用例补 4 条断言：门禁句要求用 `--format json` 核对 `broken-ref` 条数为 0、写明未知子属性只警告而退出码仍为 0、清单指向骨架、手册里不重复清单。常量不会随官方 lint 升级自动更新，升级后要对照官方输出的 `Valid sub-tokens` 核对（ADR 037 与测试注释都写了）。
- 文档：`docs/adr/037-arch-ui-design-contract.md` 文末「后续补充（2026-10-08）」新增“门禁口径更正（`broken-ref`）”一节并在头部摘要点出，`docs/adr/CHANGELOG.md` 加一行索引。v3.10.4、v3.10.5 的条目按原样保留（变更记录是历史），以本条为准。
- 版本与下游影响：patch 级，源发布版本由 `tdd sync` 自动递增。骨架与 PRD 手册是 `overwrite`，无本地修改时随 `template sync` 刷新，本地改过的副本按 `overwrite conflict: local content changed` 阻断；下游已建立的根 `DESIGN.md` 是项目所有，不会被改动。`infra/scripts/setup` 也是 `overwrite`，`template-surface.test.js` 随之分发；新增断言只读取骨架与 PRD 手册这两份 `overwrite` 文件，不依赖息壤源独有的路径。`CHANGELOG.md` 与 `docs/adr/**` 是 `project-owned`，不分发。没有新增命令、配置键或依赖。已带着 `minHeight` 之类未知子属性的下游 `DESIGN.md` 需自行处理：官方 lint 的退出码仍为 0，门禁要看 `broken-ref` 的条数。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（29,071 B）均不变，两份必读基础规则合计仍为 48,041 B，常驻加载没有增量；`AgentRoles/PRD-WRITER-EXPERT.md`（8,399 B）不变。按需加载的文件：骨架 `DESIGN-TEMPLATE.md` 2,892 → 3,248 B（+356 B，61 → 62 行，上限 80 行），`AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md` 7,875 → 8,104 B（+229 B）。`docs/adr/037-arch-ui-design-contract.md` 9,004 → 11,577 B、`docs/adr/CHANGELOG.md` 4,829 → 5,160 B 是源仓文档，不分发；`template-surface.test.js` 66,855 → 69,385 B。
- 验证方式与未覆盖（仅记录）：先红后绿——把当前主干（v3.11.2）导出的文档与新的 `template-surface.test.js` 放进一份临时副本运行，55 个用例里 2 个失败（骨架清单用例、扩充后的 PRD 手册用例；“向示例组件加 `minHeight` 必须被拒绝”不依赖骨架新增的那一行，本就通过），改后在工作树里 55/55 通过。官方 lint 用 `@google/design.md@0.4.0` 的离线副本实跑（只在解压目录里运行，没有装进本仓），对改后的骨架和两个改坏的副本各跑一次 `lint --format json`：骨架退出码 0、`broken-ref` 0 条（仍是 4 条 `orphaned-tokens` 警告）；示例组件加一行 `minHeight: 44px` 的副本退出码仍为 0、`broken-ref` 1 条（警告）；`backgroundColor` 引用不存在的 Token 的副本退出码 1、`broken-ref` 1 条（错误）。回归按 `docs/CONVENTIONS.md` §8 做定向而不是全量：按文件名检索读取被改文件的测试，逐个以 `agent-cli.js test --file <文件> -- node --test` 运行——`template-surface.test.js` 55/55，`business-guidance.test.js` 22/22（读取 PRD 手册），`update-template.test.js` 14/14（比对分发后的骨架），`template-consumer-compat.test.js` 1/1（把模板应用到临时项目后运行分发出去的 `template-surface.test.js`，确认新断言只读骨架与 PRD 手册，不依赖不分发的 `CHANGELOG.md` 与 ADR）；`git diff --check` 无告警，`AGENTS.md`、`docs/CONVENTIONS.md`、`AgentRoles/PRD-WRITER-EXPERT.md` 字节不变。本条定稿后又单独重跑了 `template-surface.test.js`（它读取本文件），55/55。未运行：`pnpm test` 全仓聚合（不属于 §8 的四类全量条件）；`agent-state-removed.test.js`（只扫本次未改的文件）、`source-version-sync.test.js` 与 `tdd-push-pr-summary.test.js`（只用夹具文本，不读本次改动的文件，本条目的版本搬移由 `tdd sync` 实跑）；安全、性能与浏览器 E2E（不涉及）。没有做的：作业包没有运行官方 lint 的脚本，“退出码为 0 且 `broken-ref` 为 0”仍是写给专家与下游项目的口径，没有自动检查在执行它；官方 lint 只验证了 0.4.0 一个版本、一台 macOS（Node v24.19.0），`--format json` 的输出形状（`findings[].rule`、`severity`）只在该版本上确认；`DESIGN_COMPONENT_SUB_TOKENS` 是手抄的 0.4.0 清单，官方 lint 升级后不会自动失效，要靠人对照核对；本次实测只覆盖骨架及其副本。

## [v3.11.2] - 2026-10-08

- 更正（仅文档）：v3.11.0 条目「未处理的试验缺陷」有两处说法与事实不符，已就地更正。③ 原写“`qa-verify.js` 在任何检查之前做联网 `git fetch --prune`”：该 fetch 在 `captureQaVerificationIdentity` 里，排在架构检查与文档检查之后、`TEST_SCOPE` 校验、业务门禁与签发回执之前，没有重试，失败时 fail-closed、不签发回执；“代理偶发 SSL 错误会让它中止”这一点不变。⑥ 原列为模板缺陷（本机没有 `gh` 时 `with-local-gh-token.js` 报 `spawnSync gh ENOENT`）：核实后该脚本是那个下游项目自己的，息壤源的历史里从未有过，模板的 `infra/scripts/shared/github-api.js` 在缺 `gh` 时回落到 `GH_TOKEN` 直连 REST API，所以移出清单，只保留核实结论。首段“9 处模板缺陷”相应改为“9 处问题，其中 8 处是模板缺陷、1 处核实后不属于模板”；①②④⑤ 及其后的补充说明原文不动。
- 历史记录：v3.11.0 的合并提交说明（f1e8f6a）仍把 ⑥ 与其余五项并列为“另 6 项缺陷”，主干历史不改写，以本文件为准。
- 版本与下游影响：patch 级，只改本文件（外加 `tdd sync` 生成的版本号与时间戳），没有改代码、配置、命令或依赖；`CHANGELOG.md` 是 `project-owned`，不分发，下一次 `template sync` 只带来版本号。
- 验证方式与未覆盖（仅记录）：更正依据是读代码和查历史，没有新增自动检查。通读 `infra/scripts/qa-tools/qa-verify.js` 的 `main()`、`captureQaVerificationIdentity` 与 `runGit`，确认调用顺序、没有重试和失败时的输出；更正前 `git log --all -S'with-local-gh-token'` 只命中 f1e8f6a（引入 v3.11.0 条目这段文字的提交），`--diff-filter=AD` 显示该文件从未在息壤源里被添加或删除；读 `infra/scripts/shared/github-api.js` 及其调用方 `tdd-push.js`、`qa-merge.js`。全仓检索这两处说法的其他出处（733 个已跟踪文本文件），只有 `CHANGELOG.md` 重复；`docs/adr/038-arch-business-test-automation.md` 的补充只写“三处缺口”，没有 ③/⑥ 与缺陷总数，未改。回归按 `docs/CONVENTIONS.md` §8 记为静态检查：`template-surface.test.js`（会读取本文件）、`source-version-sync.test.js` 与 `git diff --check`，不跑业务单测或全量。没有做的：没有复现代理 SSL 失败，③ 的输出格式取自代码，不是现场输出；没有逐个核对那个下游项目的其余自有脚本是否也直接调用 `gh`；①②④⑤ 没有重新核实。

## [v3.11.1] - 2026-10-08

- 修复：随模板分发的 `infra/scripts/agent-runner/__tests__/root-test-script-coverage.test.js` 在实际项目里不能用。该测试读取根 `package.json` 的 `scripts.test`，要求其通配符覆盖 `infra/scripts` 与 `architecture/__tests__` 下全部已跟踪单测，这是息壤源自己的约束；但 `infra/scripts/agent-runner` 是 `overwrite`，文件会原样分发，而实际项目通常没有 `scripts.test`（一个同步到 3.10.5 的下游项目即如此），`scripts.test.split` 抛出 `TypeError: Cannot read properties of undefined (reading 'split')`；项目若有自己的 `scripts.test`（例如 `vitest run`），则会把随模板分发的单测全部误报为“未覆盖”。
- 方案与取舍：该测试改为只在 `agent.config.json` 的 `template.role` 为 `source` 时运行，其余情形（实际项目，不论有无 `scripts.test`）带原因跳过，沿用 `business-templates.test.js`、`template-surface.test.js` 已有的“仅息壤源”门控；息壤源内的覆盖断言原样保留，另把“根 `package.json` 没有 `scripts.test`”从 `TypeError` 改成明确断言 `template source package.json must define scripts.test`。没有采用“不再分发”：`exclude` 不会清理下游已装的副本，`remove` 对本地改过的副本会冲突，还得为源仓独有的测试逐个登记规则，也偏离仓库“源专属测试在原地门控”的既有做法。只以“缺少 `scripts.test`”作为跳过条件也不够，上面第二种情形（项目自带 `scripts.test`）仍会失败，所以按 `template.role` 门控。
- 测试：新增 `root-test-script-coverage-distribution.test.js`，把该测试复制进临时项目根目录运行 6 个场景：3 个实际项目（无 `agent.config.json` 且无 scripts；已初始化配置但无 `scripts.test`；自带 `scripts.test` 为 `vitest run`）必须整体跳过且不出现 `TypeError`；3 个息壤源场景（覆盖完整时通过；存在未被 `scripts.test` 覆盖的已跟踪单测时失败并点名该文件；缺 `scripts.test` 时以明确信息失败）。`template-consumer-compat.test.js` 新增端到端回归：真实执行 `template-apply-engine.js --write` 应用到临时项目后，运行分发出去的该测试，要求 TAP 输出 `ok … # SKIP` 且退出码 0。新增的场景测试本身同样只在息壤源运行，实际项目跳过，不给下游增加耗时与失败面。
- 版本与下游影响：patch 级，只改测试文件与本文件，没有新增命令、配置键或依赖；`CHANGELOG.md` 是 `project-owned`，不分发。下一次 `template sync` 时，未被改动过的下游副本会就地更新为带门控的版本，无需任何操作；本地改过该文件的副本按 `overwrite conflict: local content changed` 阻断（fail-closed），需先处理冲突。新增的场景测试作为新文件随之分发，在下游表现为跳过。同步之前，会运行到该文件的下游项目可在自己的测试命令里暂时排除它。
- 验证方式与未覆盖（仅记录）：先红后绿——改实现前，新场景测试 6 个里有 4 个失败（3 个实际项目场景与息壤源缺 `scripts.test` 场景），2 个息壤源强制场景本就通过（防止过度跳过），`template-consumer-compat.test.js` 因分发出去的测试抛 `TypeError` 而失败；改后 `root-test-script-coverage.test.js` 1/1、场景测试 6/6、`template-consumer-compat.test.js` 1/1、同样读取真实息壤源应用计划的 `template-boundaries.test.js` 20/20 通过，`git diff --check` 无告警。回归按 `docs/CONVENTIONS.md` §8 做定向，没有跑全量。没有逐个排查其他分发测试在实际项目环境下的表现（静态检索只发现这一处读取根 `package.json`），也没有为“所有分发测试在最小下游项目里都能运行”增加通用门禁，可作后续考虑。

## [v3.11.0] - 2026-10-08

- 起因与范围：2026-10-08 在一个真实下游项目里（试验后已清理）启用业务测试，用真实 Playwright 与本机 Chrome 跑通 `qa paths` → `qa run` → `qa verify`：通过 1 次、签发回执；AC 失败、缺用例、被跳过、路径缺口、脏工作区 5 类反例都按预期阻断且没有回执。试验同时暴露 9 处问题，其中 8 处是模板缺陷、1 处核实后不属于模板，本次只处理经批准的 3 处：`qa run` 对未被证明的必需优先级 AC 仍报 OK、`task exec` 拦下已登记的套件命令、QA 生成器不识别 AC 表；其余见下面「未处理的试验缺陷」。
- `qa run` 退出语义：原实现只要各套件正常完成就输出 `STATUS=OK`、退出码 0，必需优先级（默认 P0）的 `auto` AC 缺少通过的用例或被跳过时也一样，只有 `qa verify` 才阻断，所以 `qa run` 的“成功”不能作为进入 `qa verify` 的依据。现在套件都正常完成、但这类 AC 仍未被证明时输出 `STATUS=FAILED`、`REASON=AC_NOT_PROVEN`，逐条给出 `AC_OPEN=<AC>|<优先级>|<状态>|<原因>`，退出码 1；套件失败仍是 `REASON=SUITE_FAILED` 且优先。这两种 FAILED 都照常写结果文件，`qa verify` 复核的仍是同一份记录，判定与门禁共用 `judgeAc`；运行前就被拒绝的情形仍是 `BLOCKED` 且不写结果。`STATUS=OK` 现在才表示套件跑完且必需优先级的自动化 AC 全部被证明。
- 回执：业务门禁开启且通过时，`qa verify` 签发的回执可选携带 `business` 摘要（`gate`、`required_priorities`、`acs_proven`、`risk_count`、`config_digest`），供事后审计。`schema_version` 仍是 1，字段是可选加法：没有它的回执照常有效；`qa merge` 的复验只比较 `schema_version`、`verdict`、配置主干与功能分支名、两端 SHA 和 PR 引用，不读取 `business`，旧版脚本读到带摘要的回执也只会忽略它。门禁未开启、模板源跳过门禁时，回执与之前逐字段相同。
- `task exec`：聚合测试命令的拦截不区分来源，项目把 `pnpm test` 之类写进 `qa.business.suites` 后，`qa run` 能运行，同一条命令交给 `task exec` 却被拦。现在与某个已登记套件命令逐词完全相同的命令放行；只做逐词精确匹配，已登记命令里有任一词不匹配 `[\w@+,./:=-]+`（含引号、变量、管道、重定向、通配符）时这一条整体不参与匹配，`sh -c` 之类的包装、追加或删减参数的变体、业务配置无效时都照旧拦截，`mode=full` 决策路径不变。拦截时的报错末尾补了一句已登记套件命令的提示。
- QA 生成器与 `qa verify`：`qa:generate` 原先只认 Story 标题与行内提及，不认 9 列原子 AC 表，试验里 Story 数被行内提及虚增（1 → 7～8）、用例编号自造且前缀取自首个出现的 Story（与真实模块撞号）、`qa verify` 的 `prd-story-coverage` 显示 50%。现在 `business-spec.js` 导出 `parsePrdStories`，一次给出 Story 清单、Story 是否由表格定义、模块标识与 AC 行，`qa:generate` 与 `qa verify` 共用；模块 QA 文档的用例行取自 AC 表的 TC 列并按编号归并，用例总数是确数，没有十行上限、不再标“预估”、不再自编编号；尚未登记用例的 AC 与没有 AC 的 Story 单列在 `### 3.2 尚未登记用例的验收标准`。没有 Story 表与 AC 表的 PRD 仍用旧骨架，但 Story 提及去重，并能识别多段、含数字的模块标识（旧模式 `/US-([A-Z0-9]+)-(\d+)/` 匹配不了 `US-MODEL-CONFIG-001`），这些 PRD 的 Story 数与展示用的覆盖率可能随之变化。已知局限：首列列出非本模块 Story 的表格（如上游依赖表）会被算作本模块的 Story；只在标题或列表里定义 Story 的 PRD 退回提及计数。
- 文档：`infra/scripts/qa-tools/README.md`（§0 生成器、§7 `qa run` 状态语义、回执摘要、`task exec` 例外、脚本状态表）、`AgentRoles/QA-TESTING-EXPERT.md`（`/qa run` 条目与检查清单）、`AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md`（第 4、5 步、`task exec` 与已登记套件命令一段、`AC_NOT_PROVEN` 阻断码一行、生成器文档一条）同步新行为；`docs/adr/038-arch-business-test-automation.md` 文末新增「后续补充（2026-10-08）」并在头部标出第 6 条「回执结构不变」与取舍「本期不扩展回执结构」由该节更正，`docs/adr/CHANGELOG.md` 加一行索引。
- 版本与下游影响：minor 级，源发布版本显式定为 3.11.0（既有命令的退出状态会变、回执新增可选字段；`tdd sync` 保留已显式选定的更高版本），架构能力包不动。`infra/scripts/qa-tools`（`business-config.js`、`business-spec.js`、`generate-qa.js`、`qa-business-gate.js`、`qa-run.js`、`qa-verification-state.js`、`qa-verify.js`、`README.md` 与 9 个测试）、`infra/scripts/agent-runner`（`agent-task.js`、`test-command-scope.js` 与 2 个测试）、两份 QA 专家文档均为 `overwrite`，无本地修改时随 `template sync` 刷新；`CHANGELOG.md` 与 `docs/adr/**` 是 `project-owned`，不分发。没有新增命令、配置键或依赖。实际项目需要注意：① 登记了 `qa.business.suites` 的项目，不论是否开启 `qa.business.enabled`，在必需优先级 AC 未被证明时 `qa run` 现在退出码为 1，脚本里把 `qa run` 退出码只当作“套件跑完了”的需要调整；② 已有的手工维护模块 QA 文档仍由 `qa:generate` 保留，只有生成器自有内容会按新格式重写；③ `qa verify` 的 `prd-story-coverage` 分母变为 `parsePrdStories` 的 Story 清单，该检查只用于展示，不参与门禁。回退：revert 本次变更；已签发的带 `business` 摘要的回执在回退后仍可被读取。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（29,071 B）均不变，两份必读基础规则合计仍为 48,041 B，常驻加载没有增量。按需加载的文件：`AgentRoles/QA-TESTING-EXPERT.md` 20,988 → 21,191 B（+203 B），`AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md` 47,988 → 49,341 B（+1,353 B），`infra/scripts/qa-tools/README.md` 27,727 → 30,959 B（+3,232 B）；`AgentRoles/TDD-PROGRAMMING-EXPERT.md`（9,761 B）不变。`docs/adr/038-arch-business-test-automation.md` 3,680 → 8,804 B（源仓文档，不分发）。
- 验证方式与未覆盖（仅记录）：先红后绿——新增与改写的断言在改实现前有 44 个用例失败（分布在 11 个测试文件），改后全部通过；`git diff --check` 无告警。回归按 `docs/CONVENTIONS.md` §8 做定向而不是全量：对 9 个被改的生产模块做静态 `require` 闭包（含惰性 `require`，扫描 353 个 JS/MJS 文件），再按文件名检索读取被改文档、清单与版本文件的测试，在全部 126 个测试文件里选出 61 个（影响面界定出 55 个；分支并入上游 ee22bd8（#164）之后再加 6 个读取清单、版本文件或经 `tooling/xirang` 处理清单的 `infra/scripts/setup/__tests__` 测试），逐个以 `pnpm agent -- test --file <文件> -- node --test` 经 `task exec` 运行：950 个用例全部通过，0 失败、0 跳过，合计约 12 分钟，日志与哈希留在任务证据里。这一轮跑在并入后的终树上；并入前在旧基线上还跑过一轮 55 个文件（884 个用例，全部通过）。本条定稿晚于这一轮，而 `template-surface.test.js` 读取 `CHANGELOG.md`，所以定稿后单独重跑了它。未运行：`pnpm test` 全仓聚合与其余 65 个测试文件（它们既不加载被改模块、也不读被改文档与清单；检索命中但只用临时目录夹具的几个已逐个核对），不属于 §8 的四类全量条件，其中 `architecture/__tests__` 下 15 个引用 `tooling/xirang` 的夹具测试只按文件名检索确认它们不读取本次改动的路径，这是检索结论，不等同于逐行证明；真实下游项目复测（业务测试链路由 `business-closed-loop` 与 `business-real-driver` 的临时项目夹具覆盖）；`qa merge` 的网络路径（本次只给回执加可选字段，合并复验不读它，由模拟远端的单测覆盖）；安全、性能负载与浏览器 E2E（不涉及认证权限、数据写删、并发路径或界面）。
- 未处理的试验缺陷（尚未批准修复，仅记录）：① 新增业务域需 PRD、ARCH、TASK 三件齐全才能通过 `qa plan` 的模块一致性校验；② 会话模块推断会把 template-sync 提交带来的 agent、auth、admin 也算上（试验自身产物，无害）；③ `qa-verify.js` 里 `captureQaVerificationIdentity` 的联网 `git fetch --prune`（回执要绑定远端 SHA，这一步本身是设计内的）排在架构检查与文档检查之后、`TEST_SCOPE` 校验、业务门禁与签发回执之前（模板源仓库跳过文档检查、`TEST_SCOPE` 校验与业务门禁），没有重试；代理偶发 SSL 错误会让它中止，输出 `git fetch … failed (<退出码>): <git 的 stderr>` 和完整调用栈，fail-closed、不签发回执，偶发错误重跑通常即可；④ `qa-test-scope.js` 里 `TEST_SCOPE` 不匹配以带栈的 `Error` 抛出，不是结构化的 `STATUS`/`REASON`；⑤ `TEST_SCOPE_RESULT` 是自声明的结构校验，不与业务结果绑定。原先列为 ⑥ 的“本机没有 `gh` 二进制时 `with-local-gh-token.js` 报 `spawnSync gh ENOENT`，无法用 API 查 PR”，核实后不是模板缺陷：`with-local-gh-token.js` 是那个下游项目自己的脚本（`infra/scripts/github/with-local-gh-token.js`，直接 `spawnSync('gh', …)`），息壤源的历史里从未有过，也没有登记在该项目的模板 lock 与基线里；模板自己的 `infra/scripts/shared/github-api.js` 在 `gh` 不可用时回落到 `GH_TOKEN` 直连 REST API，`tdd push` 与 `qa merge` 共用这条回落。此外 `pnpm agent -- test --file … -- <runner>` 仍只接受已知的文件级运行器，不能包裹 `run-with-test-guards.js` 之类的登记套件命令（`task exec` 的拦截是本次处理的部分）；路径覆盖缺口（`PATH_COVERAGE_GAP`）仍只在 `qa verify` 阶段判定，`qa run` 不预告。`docs/CONVENTIONS.md` §8 仍写“`task exec` 在启动前拦截常见聚合测试命令，只有事先记录了匹配命令和触发依据的 `mode=full` 决策才放行”，没有提已登记套件命令这个例外：它是常驻加载的基础规则，`template-surface.test.js` 又逐字固定了这句话，本次不增加常驻字节，例外写在 `infra/scripts/qa-tools/README.md` §7、QA 手册与拦截时的报错信息里；需要时可在“才放行”之后追加一个分句（约 100 B），不改动已固定的子串。

## [v3.10.5] - 2026-10-08

- 修复：`merge-json` 的合并输出不再重排项目文件的键序。`tooling/xirang/engine.js` 原先用 `canonical()` 输出 `merge-json` 的合并结果，把项目文件每一层的键都按字典序重排；`.claude/settings.json`、`package.json` 的 `scripts`（`merge-package-scripts`）以及架构包里应用、模块、存储的 `package.json` 与 `tsconfig.json` 都走这条路径。在一个真实下游项目（shadcn 栈）的一次性副本上做 3.7.8 → 3.10.4 试验时，其 `package.json`（27 个脚本，`init:platform` 排在 `init:dev` 之前，不是字典序）被计划为 `updated`，内容只是这两行换了位置（3 增 3 删），上游并没有改任何脚本。顺序有意义的值受害更重：`exports` 的条件按声明顺序匹配，测试里 `types`、`import`、`default` 被旧引擎排成 `default`、`import`、`types`，`default` 会先匹配。
- 做法：新增 `orderLike` 与 `jsonLike`，合并结果按参照物（项目当前的文件；`--adopt` 时同样）的键序输出：已有的键保持项目的顺序，项目没有的新键按字典序追加；某个对象已有的键本身就是升序（pnpm、sort-package-json 排过序的映射）时，新键按字典序插入，仍保持有序；数组按下标对齐；没有参照物（新建文件）时与以前的 `canonical()` 输出相同。`xirang.lock.json`、plan id、journal、`append-json` 与新建文件仍用 `canonical()`；基线登记的是上游原文的哈希，所以计划哈希与基线不受影响。收敛仍然成立：第二次计划里基线等于上游，合并返回项目当前内容，按同一键序序列化，逐字节相同。已被旧版本排过序的文件保持现状，不会被还原。`merge-jsonc`（走文本 diff3）与 `merge-yaml`（就地补丁）本来就保序，没有改动。
- 修复：`template update` 与 `template sync` 打印的 `NEXT_ACTION` 不再不论状态都是同一句。此前 dry-run、写入、收敛三次输出的都是 `Review conflicts and plan; files without baseline require explicit adopt or a reviewed legacy baseline`，没有冲突时也让人去处理冲突与基线。`tooling/xirang/template.js` 新增纯函数 `nextAction(plan, write)`，按「有冲突、无变更、已写入、仅计划」依次判断：冲突时仍是原来那句，其余分别是 `No changes required; the target already matches this template`、`Review the applied changes, then run a convergence dry-run; it should report no changes`、`Review the plan, then rerun with --write to apply it`。`update-template.js` 只在输出里检查 `conflicts=` 与 `manual-sync=` 两个字样，新文案不含，门禁判定不变。
- 文档：PRD 手册 §5「用户体验设计（UX）」（`AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md`）增补两段，来自上面那次试验。存量项目（样式已存在）补建根 `DESIGN.md`：取值以样式表中实际生效的为准（同名属性后者覆盖前者，`@layer` 外的声明覆盖层内声明，`var()` 展开后再记录）；已有的硬编码色值、字号和偏离间距档位如实记为已知偏差并写入 Do's and Don'ts，不当作契约，也不在同一次变更里改样式；无法从代码判定的取值或意图标【待确认】，交项目负责人裁定。接入官方 lint（`@google/design.md`）：以退出码为门禁，不以警告条数为门禁，`orphaned-tokens` 对由样式表消费、没有组件引用的 Token（shadcn 风格）属结构性噪声，不为消除警告而虚构组件。该手册只在 PRD 阶段点读，专家文件、常驻规则与骨架不变。
- ADR-037 补充（文末「后续补充（2026-10-08）」新增「存量项目副本试验」，决策正文不变；`docs/adr/CHANGELOG.md` 加一行索引）：同一次试验里官方 lint 0.4.0 对补建的根 `DESIGN.md` 退出码 0、0 个错误、6 条 `orphaned-tokens` 警告；25 个颜色 Token 加 `--` 前缀后与样式表里实际生效的 CSS 自定义属性逐一同名且取值一致（25/25），圆角 8px、10px、12px 与正文 14px、行高 1.6、字体族也一致，再次印证「映射本身不难」；读取实际生效取值的两处新难点：样式表有两个 `:root` 块（后一块用 17 个十六进制值和 `--radius` 覆盖了前一块 `oklch` 里的 18 个名字，`--popover-foreground` 只在前一块定义），`body` 的 `font-family` 声明两次（`@layer base` 里的被未分层的覆盖）。这是一次性副本，不算「真正采用」，漂移检查的触发条件没有满足，仍不实现。
- 版本与下游影响：源发布按 patch 递增（由 `tdd sync` 自动完成，预期 3.10.4 → 3.10.5），架构能力包版本不变（没有 `architecture/` 下的改动）。没有新增命令、配置键与依赖。随作业包分发的改动：`tooling/xirang/engine.js` 与 `template.js`（`overwrite`，所有者 `xirang:engine`）、`infra/scripts/setup/__tests__` 下的 `xirang-engine.test.js` 与 `template-surface.test.js`（修改）和 `template-next-action.test.js`（新增）、`PRD-WRITER-EXPERT.playbook.md`（`overwrite`）；`CHANGELOG.md` 与 `docs/adr` 在 manifest 里是 `project-owned`，不分发。实际项目的 `template sync` 从官方 `main` 上固定的提交取应用器，所以发布之后的第一次同步就已经用上新引擎。下游可见的变化只有两处：合并出的 JSON 保持项目自己的键序（已被旧版本排过序的文件不会被还原，不产生新差异），以及 `NEXT_ACTION` 的文案；`update-template.js` 的冲突门禁只匹配 `conflicts=` 与 `manual-sync=`，门禁判定不变。回退：revert 本次变更。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（29,071 B）均不变，常驻加载没有增量；`PRD-WRITER-EXPERT.playbook.md` 由 7,128 B 增至 7,875 B（+747 B），只在 PRD 阶段点读时加载；专家文件、`README.md`、`architecture/`、`infra/templates/` 与 `docs/data/` 未改动。
- 验证：先红后绿。`xirang-engine` 新增 6 条（共 21 条），旧实现下 4 条先红（保持键序、`--adopt`、顺序有意义的键、`package.json` 脚本同步），另两条（已升序的对象保持升序、新建文件按规范序）在旧实现下本来成立，作为护栏，实现后 21/21；`template-next-action` 2 条，先红于缺少 `--write` 提示，实现后 2/2；`template-surface` 新增 1 条，先红 52/53，实现后 53/53。回归范围取加载 `engine.js` 或 `template.js` 的测试，加上读取本次改动文档（PRD 手册、本文件）的测试，共 36 个文件，逐个用 `pnpm agent -- test --file <文件> -- node --test` 运行，342 条全部通过，0 失败、0 取消、0 跳过，退出码均为 0：`infra/scripts/setup/__tests__` 12 个文件 180 条，其余基础设施 7 个文件 67 条（`agent-cli`、`cli-help`、`agent-state-removed`、`business-templates`、`business-guidance`、`source-version-sync`、`tdd-push-pr-summary`），`architecture/__tests__` 17 个文件 95 条。本文件编辑到最终形态后，读取它的 `template-surface`（53 条）、`source-version-sync`（6 条）、`tdd-push-pr-summary`（12 条）复跑，71 条通过。真实数据重放（一次性副本，未提交、未推送、未合并，真实仓库未改动）：3.7.8 → 3.10.4，`--scope agent` 无冲突，`package.json` 的计划由 `updated` 变为 `unchanged`，收敛 dry-run 为空；默认范围被 1 处既有的本地定制（架构能力包里的一个测试资产）阻断，与本次改动无关。
- 未覆盖与已知未处理（仅记录）：① 没有运行聚合的 `pnpm test`，不满足全量触发条件（影响范围已用加载关系界定）；② `release.test.js`、`storage-core.test.js`、`database-safety.test.mjs` 未运行，三者的源码里没有引用 `engine.js`；③ 加载引擎的升级类脚本未运行：`architecture/tests/` 下的 `upgrade.integration.mjs`、`open-source-upgrade.integration.mjs`、`on-demand-upgrade.integration.mjs`（经 `XIRANG_LEGACY_SOURCE` 传入解压好的 v3.1.0、v3.2.0、v3.3.0 源码快照）和 `e2e/tests/architecture-on-demand.e2e.mjs`（需要 `XIRANG_RELEASE_COMMIT`），它们的文件名不符合定向运行器的 `*.test.*` 规则（`upgrade.integration.mjs` 实测被拒，`STATUS=BLOCKED`），不绕过运行器，所以架构范围的 `merge-json` 路径（应用、模块、存储的 `package.json` 与 `tsconfig.json`）只在合成项目的测试上验证过，没有在旧版本升级或真实下游项目上重放；其余集成与 e2e 脚本（`consumer`、`jobs`、`open-source`、`drizzle*`、`prisma-database`、`monorepo-platform`、`open-source-components`）需要已生成的消费者项目、测试数据库或工具目录，源码里也没有调用 `planUpdate`、`applyPlan`、`createTemplatePlan`、`createArchitecturePlan`，未运行；④ 已知缺陷，本次改动之前就存在：项目删除了由 `merge-json` 管理的文件、且模板侧没有改动时，`planUpdate` 返回的 `after` 是文本 `undefined`，没有冲突，写入会把字面量 `undefined` 写进文件；旧引擎与新引擎输出相同，不在本次范围，另行处理；⑤ 只在一台 macOS（Node v24.19.0）上验证，没有其他平台，也没有 CI（门禁在本地执行）。

## [v3.10.4] - 2026-10-08

- 验证：v3.8.0 与 v3.8.1 的变更记录写明官方 `@google/design.md` lint 当时没有运行（下载未获授权）。本次经批准下载 `@google/design.md@0.4.0`，对骨架 `docs/data/templates/prd/DESIGN-TEMPLATE.md`（sha256 `ee4b7372…36ebc`，本次未改动）实跑。来源与完整性：npm 发布，发布者 google-wombot，仓库 google-labs-code/design.md，tarball 329,973 B，registry 登记的 sha512 与 sha1 同下载文件一致，包内没有 install 类脚本；只在解压目录里运行，没有装进本仓，也不新增依赖。结果：退出码 0，0 个错误，4 条 `orphaned-tokens` 警告（`foreground`、`destructive`、`border`、`ring`），1 条统计信息（7 个颜色、1 个字号层级、3 个圆角、5 个间距、1 个组件）。v3.8.0、v3.8.1 的两条旧记录是当时的状态，保持原样。
- 4 条警告为何保留：骨架只有一个示例组件，官方允许的组件子 Token 只有 `backgroundColor`、`textColor`、`typography`、`rounded`、`padding`、`size`、`height`、`width`，没有边框或焦点环属性，写成 `borderColor` 会被当作未知子 Token 而报警告（`border` 虽不再算孤立，警告总数不变）。警告可以消除（实测：另加分隔线、焦点环、正文、危险按钮 4 个示例组件，分别经 `backgroundColor` 或 `textColor` 引用 `border`、`ring`、`foreground`、`destructive`，得到 0 条警告、退出码 0），但这会让边框色和焦点环色以背景色的身份出现，还给骨架添上与示例无关的组件，所以没有改骨架。
- 负向对照（在骨架副本上逐项改动，退出码均为本次重跑实测）：引用不存在的 Token `{colors.nope}`、非法颜色值 `notacolor`、未闭合的 `oklch(.89 0 0`、非法单位 `6pt`（官方只允许 px、rem、em）各得 1 个错误、退出码 1；调换 `Colors` 与 `Typography` 的章节顺序、末尾追加重复的 `## Colors`、`#fcfcfc` 文字压在 `#ffffff` 背景上（对比度 1.03:1，低于 WCAG AA 的 4.5:1，同时说明去掉前导零的 `oklch(.99 0 0)` 被正确解析），退出码 0，各多 1 条警告（共 5 条）；给示例组件加未知子 Token `borderColor: "{colors.border}"`，退出码 0，报 1 条「不是可识别的组件子 Token」的警告，`border` 因被引用不再算孤立，警告总数仍是 4 条；去掉 front matter 时退出码 0，只有 1 条「没有找到 YAML 内容」的警告。
- 官方 lint 比本仓断言宽松的几处（均为实测；下游应以退出码作门禁，不以警告条数作门禁）：未加引号的 `{colors.primary}`（本仓 `assertComponentValuesAreStrings` 要求组件取值是字符串）、把 front matter 换成围栏 yaml 代码块（本仓要求文件以 front matter 开头）、把规范章节 `## Shapes` 降为 `### Shapes`（本仓比对完整的标题序列），退出码与结果都和原骨架相同；重复的 `## Colors` 只得到章节顺序警告，而包内 `dist/spec.md` 第 377 行写的是「Error; reject the file」。另有一处两边都没拦：无单位的 `fontSize: 16`，单独改这一处时官方 lint 退出码 0、结果与原骨架相同（写成 `16pt` 才报「单位非法」的错误），规范把 `fontSize` 定义为带单位的 Dimension，本仓断言也没有检查字号单位。骨架取值与 `architecture/components/shadcn/tokens.css` 是否一致，官方 lint 看不到，仍只由本仓测试检查。官方 lint 是 alpha，只验证了 0.4.0。
- ADR-037 补充（`docs/adr/037-arch-ui-design-contract.md` 文末新增「后续补充（2026-10-08）」，决策正文不变；`docs/adr/CHANGELOG.md` 加一行索引）：① 记入上面的验证结论；② 漂移检查仍不实现，触发条件为「出现第一个真正采用 `DESIGN.md` 的下游界面项目」或「QA 手工抓到一次 `DESIGN.md` 与 `styles.css` 不一致」，延后理由是源仓没有真实的 `DESIGN.md` 与 `styles.css`，规则缺少真实输入可验证，且检查随作业包分发后，误报会直接阻断下游项目的检查；骨架与 `tokens.css` 取值一致这一层已由 `template-surface.test.js` 里仅在息壤源运行的断言固定，不在延后范围；③ 触发后的设计输入：只覆盖 shadcn 栈，只比较归一化后的颜色、圆角和正文字体族，不比较暗色、间距与组件，先告警不阻断，夹具测试放在架构包；④ 更正此前「难点是 Token 名到 CSS 变量名的映射」的判断：官方 `export --format css-tailwind` 从骨架导出 18 个名字，其中 7 个颜色名和 3 个圆角名与 `@theme inline` 逐一同名；真正的难点是另 8 个名字（`--font-body`、`--text-body`、`--font-weight-body`、`--spacing-xs` 至 `--spacing-xl`）在 `tokens.css` 里没有对应项，`DESIGN.md` 没有暗色机制而 `tokens.css` 有 12 处 `.dark` 覆盖，颜色要先归一化（`oklch(.30 .08 260)` 导出为 `#142c55`），圆角要先展开 `calc(var(--radius) - 4px)`（`--radius: .625rem`）。`TASK-ARCHPLAT-012` 这一任务条目随 v3.10.1 清理源仓项目文档一并移除，ADR 与 v3.8.x 记录里的引用仅作历史，漂移检查的触发条件与设计输入改记在 ADR-037。
- 版本与下游影响：只改 `CHANGELOG.md`、`docs/adr/037-arch-ui-design-contract.md` 与 `docs/adr/CHANGELOG.md` 三个文件，在 manifest 里都是 `project-owned`（`docs/adr` 按目录前缀登记），不随 `template sync` 分发，实际项目不受影响；没有改动任何脚本、模板、测试、配置、`architecture/` 与骨架。源发布版本由 `tdd sync` 自动从 3.10.3 升到 3.10.4（patch），架构能力包版本不变。回退：revert 本次变更。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（29,071 B）均不变，常驻加载没有增量；专家、手册、`README.md`、`architecture/` 与 `infra/templates/` 也未改动。
- 验证方式与未覆盖（仅记录）：本次不改代码、模板、测试或配置，没有先红后绿，验证对象是文字与事实。事实核对：官方 lint 的解压包、骨架与全部变体在会话临时目录里重跑，共 16 次（骨架 1、变体 15），退出码 1 的 5 次（`{colors.nope}`、`notacolor`、未闭合的 `oklch(`、`6pt`、`16pt`），其余 11 次为 0（含骨架），上文的退出码与警告条数逐项对过；骨架 sha256 与基线一致，`AGENTS.md`、`docs/CONVENTIONS.md` 与 `architecture/` 经 `git diff --quiet` 确认相对基线没有改动。回归（本条目提交前实测）：`template-surface.test.js` 52 条全部通过（含只在息壤源运行的骨架与 `tokens.css` 同源断言，以及源仓自有文档不链接已删文档的扫描），`source-version-sync.test.js` 6 条全部通过（`[Unreleased]` 切分逻辑的消费者），`git diff --check` 无输出。未覆盖：① 没有运行聚合的 `pnpm test`：只改三份 project-owned 文档，不满足全量测试的触发条件；② 漂移检查没有实现，上文 18、10、8、12 处 `.dark`、`#142c55` 等数字是 2026-10-08 对 `tokens.css` 与官方导出结果的人工核对，没有测试固定，`tokens.css` 变动后可能过期；③ 官方 lint 只验证了 0.4.0，变体是手工挑选的，没有覆盖它的全部规则；④ 解压包与变体文件只在会话临时目录，不入库，复现需要重新下载 `@google/design.md@0.4.0` 并按上文描述手工改骨架副本；⑤ 只在一台 macOS（Node v24.19.0）上验证，没有其他平台，也没有 CI（本地门禁）。

## [v3.10.3] - 2026-10-08

- 清理：v3.10.1 删掉了源仓里某个项目的 PRD、ARCH、TASK、QA 文档，但测试文件的测试名前缀与注释里仍留着指向这些文档的 `US-`、`AC-`、`TC-`、`TASK-` 编号，要查只能到 `73f1201` 里翻。本次批量清理：63 个测试文件（`architecture/` 44、`infra/` 18、`e2e/` 1）共 518 行里的 830 处编号（测试名前缀 486 行、注释 32 行；v3.10.1 记为 828 处，本次按逐处匹配实测），涉及旧功能域 `CMDSURF`、`BIZTEST`、`ARCHPLAT`、`ENVINIT`、`OSSKIT`、`DATA`、`DRIZZLE`、`STORAGE`、`MONOPLAT`、`LAZYARCH`。只删编号片段与相邻分隔符，断言与测试逻辑不动，每个文件的行数不变。
- 保留：`CHANGELOG.md`、15 份 ADR 与 1 份变更请求共 17 个历史文件逐字节不变，里面的编号是当时决策的一部分，需要时到 `73f1201` 取回原文；`check-test-coverage` 与 `sync-prd-task-ids` 两个兼容测试里的 15 行合成示例编号（如 `US-DATA-REAL-002`）是被测工具的输入，不指向被删文档，也不改。
- 规则落点：「源仓是模板，不为自身编写 PRD/ARCH/TASK/QA 模块文档，确需新增先询问用户」写进 `docs/CONVENTIONS.md` §4「文档与阶段状态」的一段话（面向官方息壤源的条件句，实际项目不受此限），并让 `infra/scripts/setup/__tests__/template-surface.test.js` 里三条源仓边界用例（模块目录只含模板骨架、源仓不带总纲与派生文档、源仓自有文档不链接已删文档）的失败信息直接给出这条规则与出处：换电脑或换人开发时，被测试拦下的人能当场读到该怎么办，不必依赖某一台机器上的记录。
- 版本与下游影响：patch 级，源发布版本由 `tdd sync` 自动从 3.10.2 升到 3.10.3；改动里有 44 个 `architecture/` 下的测试文件，`tdd sync` 同时把架构能力包从 3.6.0 升到 3.6.1（只升版本号，`architecture/` 下没有其他非测试改动）。没有新增命令、配置键、依赖，也没有改任何生产脚本。实际项目跑 `template sync` 时，`infra/scripts/{qa-tools,setup,tdd-tools,agent-runner}` 下 18 个被改测试（`overwrite`）与 `docs/CONVENTIONS.md` 随作业包刷新：测试只是测试名与注释变了（`template-surface.test.js` 另多三条失败信息），断言逻辑不变，`CONVENTIONS.md` 多出一段只对官方息壤源生效的条件句；采用 shadcn 组件集或 storage 模块的项目跑 `architecture update` 时，`architecture/components/shadcn/tests` 的 15 个 `.test.tsx` 与 `architecture/modules/storage/node/tests` 的 2 个测试会复制进生成的项目（`update` 三方合并，差异只有测试名）；`architecture/__tests__`、`architecture/tests` 与 `e2e/tests` 共 28 个被改测试没有下发路径，只留在息壤源里，没有采用架构能力包的项目不受影响。要回滚，还原本次提交即可。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md` 18,970 B 不变，`docs/CONVENTIONS.md` 由 28,815 B 增至 29,071 B（+256 B，约 +0.9%），两份必读基础规则合计 47,785 → 48,041 B；实际项目同样加载这份文件，所以这 256 B 下游也要付出，已用一段条件句压到最小，换来的是换电脑或换人开发时能直接读到「源仓不为自身写 PRD/ARCH/TASK/QA 文档，要写先问」。专家文件、Handbook、`README.md` 不变；`infra/templates/` 与 `architecture/manifest.json` 只有版本号变化；`architecture/` 下其余只是 44 个测试文件的测试名与注释变短，不属于常驻上下文。
- 验证方式与未覆盖（仅记录）：改写对照：独立复核脚本（不复用改写脚本的判定）比较改写前导出与改写后目录，差异文件与差异行恰好等于全仓扫描清单（扫描 731 个文件，命中 80 个，63 个改写、17 个历史文件保留）、每个文件行数不变、测试名行只是删去纯编号片段、改写后非历史文件不再含任何编号、同一文件里的重名测试没有增加，32 行注释逐行人工复核；改写脚本先干跑再应用，两次结果一致；48 个 `.js/.mjs` 全部通过 `node --check`。运行对比：源仓里能运行的 37 个测试文件（`architecture/__tests__` 17、storage 2、`infra/` 18）在改写前后各跑一遍，逐文件的用例数、通过、失败、取消、跳过、todo 与退出码一致，用例名条数一致且没有新增同名用例（合计均为 635 条、628 通过、1 失败、6 跳过）；那 1 个失败是 `live-cloud.test.mjs` 缺少 storage 的 `dist/environment.js` 构建产物（`ERR_MODULE_NOT_FOUND`），6 个跳过是 `oss-versioning.test.mjs`，改写前后相同，属于环境所致。规则落点：在临时副本里加入 `docs/PRD.md`、多余的模块目录和指向已删文档的链接，三条源仓边界用例都变红并带出规则与出处；读取 `CONVENTIONS.md` 的 7 个测试文件共 101 条全部通过。回归（本条目提交前实测）：`infra/scripts/{setup,tdd-tools,qa-tools,agent-runner}/__tests__` 四个目录与 `agent-state-removed`、`qa-merge-version-sync` 两个单文件共 883 条，882 通过、0 失败、1 跳过（`tdd-tools` 的 `create-migration.test.js` 只在 Windows 上运行，本次未改动）。未覆盖：15 个 vitest `.test.tsx`（需要已生成应用的 `node_modules`，源仓里无法运行）与 11 个依赖数据库、云环境或旧版本源快照的 `.mjs`（`architecture/tests` 10 个、`e2e/tests` 1 个）没有运行，只做了静态核对（`test/it/describe` 调用数改写前后一致，去掉编号后没有新增同名标题）；没有运行聚合的 `pnpm test`：本次只改测试名、注释、一段规则文字与三条断言信息，影响面已逐文件界定，不满足全量测试的触发条件。

## [v3.10.2] - 2026-10-07

- 测试加固：`infra/scripts/qa-tools/__tests__/qa-run.test.js` 里验证“套件超时后终止整棵进程树”的用例（测试名带 `AC-BIZTEST-003-01 / TC-BIZTEST-007` 前缀）在高负载下偶发失败，报 `桩套件应该已经写出 pid 文件`。根因在测试写法而不在生产代码：桩套件 `fixtures/business-testing/suites/hang.js` 先启动孙进程再写 pid 文件，超时窗口（上一版放宽到 5 秒）从套件启动那一刻起计时，用例又只在整个运行结束后才读 pid 文件；机器负载高时桩套件启动慢于窗口，就在写出 pid 文件之前被终止。全量并发下对桩套件启动做了 150 次采样，从启动到写出 pid 文件最短 528 ms、中位数 1,492 ms、p90 7,349 ms、p99 19,315 ms、最长 23,611 ms，其中 23 次超过 5 秒窗口；全量并发运行（1,190 条）里也复现过 1 次失败。再放宽窗口只会把失败推给更慢的机器，所以改成让用例不再依赖启动速度。
- 做法：`hang.js` 新增 `delay=<毫秒>` 参数，推迟到该时间之后才启动孙进程并写出 pid 文件，用来确定性地模拟“套件启动很慢”（用例夹具 `s.hang()` 对应新增 `startupDelayMs`）。原来合在一起的用例拆成两层：① CLI 层的 `套件超时后记录 timeout，后续套件继续运行` 保留真实计时器，窗口从 5 秒改为 1 秒，桩套件延迟 1.5 秒启动，所以它必然在写出 pid 文件之前被终止；用例不再靠 pid 文件做任何断言（只在 `finally` 里尽力回收进程），仍断言 `STATUS`、`REASON`、`SUITE` 行、退出码 1、`timeout` 状态、耗时接近窗口、`exit_code` 为 null 与后续套件继续运行；② 进程内的 `套件超时后终止整棵进程树，记录 timeout` 与 `套件忽略 SIGTERM 时升级为强制终止，整棵进程树仍被清理` 用 `t.mock.method` 包装 `globalThis.setTimeout`，只截获库为套件创建的那个超时计时器（按延迟值识别，轮询与宽限等待的计时器照常工作），先等 pid 文件出现并确认进程树存活，再手动触发超时，之后断言整棵进程树被终止（忽略 SIGTERM 的套件被 SIGKILL 清理）。所有等待都只是 120 秒的兜底上限，条件成立立即返回，超限以明确原因失败；`readPids` 要求 pid 文件以换行结尾，避免读到只写了一半的文件；没有重试、跳过、放宽断言或改动测试环境。
- 版本与下游影响：只改测试与桩套件，生产脚本 `infra/scripts/qa-tools/qa-run.js` 零改动，实际项目里 `qa run` 的命令输出与行为不变。两个文件随 `infra/scripts/` 的 `overwrite` 登记分发，无本地修改时随 `template sync` 刷新；`hang.js` 只被 `qa-run.test.js` 引用，`qa-run.test.js` 没有被其他文件引用。源发布按 patch 递增（由 `tdd sync` 自动完成）。回退：revert 本次变更。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（28,815 B）均不变，常驻加载没有增量；专家、手册、`README.md`、`architecture/` 与 `infra/templates/` 也未改动。
- 验证方式与未覆盖（仅记录）：先红后绿：把原用例的窗口改为 1 秒并让桩套件延迟 1.5 秒启动，两条原用例都失败（2/2，`桩套件应该已经写出 pid 文件`，读到 null）；同样的延迟配 5 秒窗口时两条都通过，说明失败来自窗口与启动速度的竞争。新写法的 4 条超时与中断用例（原为 3 条）在同样的慢启动下通过，`qa-run.test.js` 的用例总数 35 → 36（原合并用例拆成两条）。变异检查：超时后不终止进程、去掉升级到 SIGKILL 的回退、只杀单个 pid 而不是整个进程组、库的超时计时器延迟偏移 1 ms（截获落空）四处变异都让对应用例变红，已还原。压力测试（10 个满负载进程并发，机器上另有其他应用运行，负载均值 6–34）：原写法 12 轮失败 1 轮（单条最慢 20.85 秒），新写法连续 30 轮全部通过、运行后没有遗留进程（单条最慢 19.25 秒）；两次不在同一时段，墙钟不可比。回归：`qa-run.test.js` 36 条全部通过；`qa-tools/__tests__/*.test.js` 的 26 个文件 511 条全部通过（0 失败、0 跳过）；`git diff --check` 无输出。提示：Node v24.19.0 下 `node --test <目录>/` 把目录当作测试模块运行，立即得到 0 条用例并以 1 退出（调用方式问题，不是测试失败），目录级回归须写成带引号的 glob。未覆盖：① `runCli` 的 `spawnSync` 60 秒上限与 `assertAllDead` 的 10 秒默认等待没有改动（压力测试中没有触发）；② CLI 层用例 `finally` 里读 pid 文件回收进程是尽力而为；③ 只在一台 macOS（Node v24.19.0）上验证，没有其他平台，也没有 CI（本地门禁）。

## [v3.10.1] - 2026-10-07

- 清理：息壤是模板源，不是实际项目，源仓不再保存某个项目的 PRD、ARCH、TASK、QA 文档与派生矩阵。删除 76 个文件：`docs/{prd,arch,task,qa}-modules/` 下 10 个功能域（`architecture-on-demand`、`architecture-platform`、`business-testing`、`data-semantics`、`drizzle`、`environment-file-initialization`、`file-storage`、`monorepo-platform`、`open-source-components`、`template-command-surface`）的详情与四份 `module-list.md`，共 63 个；四份总纲 `docs/PRD.md`、`docs/ARCH.md`、`docs/TASK.md`、`docs/QA.md`；`docs/data/` 下 9 份派生文档（`traceability-matrix.md`、`story-task-mapping.md`、`arch-prd-traceability.md`、`task-dependency-matrix.md`、`component-dependency-graph.md`、`global-dependency-graph.md`、`test-priority-matrix.md`、`test-risk-matrix.md`、`test-strategy-matrix.md`）。四个模块目录只保留 5 份模板自有骨架（`prd-modules/MODULE-TEMPLATE.md`、`prd-modules/MODULE-EXAMPLE.md`、`arch-modules/MODULE-TEMPLATE.md`、`task-modules/MODULE-TEMPLATE.md`、`qa-modules/MODULE-TEMPLATE.md`）；`docs/adr/`、`docs/data/change-requests/`、本 CHANGELOG、`docs/data/ERD.md` 与 `docs/data/dictionary.md` 保留。清理前的版本在提交 `73f1201` 里，可用 `git show 73f1201:<路径>` 查看。
- 链接与引用：ADR（027、028、033、034、035、037 各 1 处）与变更请求（`CR-20260823-001`、`CR-20260905-001`、`CR-20260906-001` 各 2 处）里共 12 处指向已删文档的相对链接，改成「名称（息壤源仓已不保留，见 git 历史）」的文字，原有的模块名与章节号保留。`docs/data/README.md`、`docs/data/qa-reports/README.md`（`init-if-missing`）以及模板自有文件（模块骨架与 `MODULE-EXAMPLE.md`、`docs/data/templates/`、`infra/scripts/qa-tools/README.md`）里指向 `module-list.md` 与总纲的链接面向实际项目，在项目里有效，按设计不改。
- 测试：`infra/scripts/setup/__tests__/template-surface.test.js` 新增 3 条源仓边界用例（49 → 52 条）：四个模块目录只含模板骨架（骨架清单取自 manifest 中 `overwrite` 的登记，不手写）；源仓不带四份总纲与 9 份派生文档；源仓自有文档（`README.md`、`CHANGELOG.md`、`docs/data/ERD.md`、`docs/data/dictionary.md`，以及 `docs/adr/`、`docs/data/change-requests/`、`docs/data/scrs/` 下的文档）不含指向这些已删文档的相对链接。三条都先读 `agent.config.json` 的 `template.role`，只在息壤源仓生效，随 `template sync` 分发到实际项目后直接跳过。`infra/scripts/qa-tools/__tests__/business-closed-loop.test.js` 删除第 5 节（息壤自身业务测试 PRD 的 22 条原子 AC 自检，只在源仓运行）及其唯一用到的 `loadBusinessSpec` 引入（顶层用例 12 → 11 条）；它读取的正是已删除的业务测试 PRD，其余用例都用临时仓库夹具，不受影响。
- 版本与下游影响：被删文件都不在模板分发范围内：63 个模块文件、四份总纲与 `traceability-matrix.md` 在 manifest 里是 `project-owned`（模块目录以目录前缀登记），其余 8 份派生文档从未登记；没有模板自有文件被删除，实际项目里的同名文件不受影响，`template sync` 不会因此产生删除。`qa-tools`、`task-tools`、`arch-tools`、`prd-tools` 等治理工具及其夹具仍面向实际项目，未改动；`template-surface.test.js` 与 `business-closed-loop.test.js` 随 `infra/scripts/` 的 `overwrite` 登记分发，无本地修改时随同步刷新。没有改动任何脚本、模板与默认配置，实际项目里的命令输出与行为不变。回退：revert 本次变更；被删文档可按上面的提交取回。
- 字节（UTF-8 实测）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（28,815 B）均不变，常驻加载没有增量；专家、手册、`README.md`、`architecture/` 与 `infra/templates/` 也未改动。
- 验证方式与未覆盖（仅记录）：先写失败的测试再删除：新增的 3 条用例先红（3 条全败，悬空链接恰好是上述 12 处），再删文件、改链接后转绿；`template-surface` 单独运行 52 条全部通过，与 `business-closed-loop` 一起运行 79 条全部通过。未覆盖：① 仍有 80 个文件引用原本对应被删文档的 `US-…`、`AC-…`、`TC-…`、`TASK-…` 编号并保留不改：测试文件 63 个（`architecture/` 44、`infra/` 18、`e2e/` 1，共 828 处，编号在测试名与注释里），ADR、变更请求与本 CHANGELOG 共 17 个；批量改名的风险大于收益，需要时按编号到 `73f1201` 里查；② `qa plan`、`qa verify`、`qa merge` 对息壤源跳过业务 PRD/QA 门禁的既有逻辑没有改动。

## [v3.10.0] - 2026-10-07

- 新增架构包可选模块 `e2e`（业务测试驱动脚手架，对应 US-OSSKIT-009 与 ADR-039），让 3.9.0 的业务测试闭环（`qa paths`、`qa run`、`qa verify`）在 Web 端开箱可用：在 `architecture.config.json` 的 `modules` 加入 `{"id":"e2e","path":"packages/e2e"}` 并执行 `architecture plan/init`，为每个 UI 应用（react-vite、react-next、Tauri 的 Web 层）生成一个 Playwright project 与一个开发服务器；包名 `@project/e2e`，所有权 `architecture:module:e2e`，是私有根包，不进入应用的 `modules`，不导出 API。
- 生成物与契约：`playwright.config.ts` 与 `src/apps.ts`（均为 update，后者随 UI 应用列表生成）、各应用的示例用例 `tests/<应用 id>/sample.spec.ts`（`init-if-missing`，此后归项目所有，后加应用只补它自己的示例）、`README.md`（update）、`package.json` 与 `tsconfig.json`（merge-json）、`.gitignore`（append-lines，忽略 `reports/`、`test-results/`、`playwright-report/`）。对 3.9.0 的驱动契约不新增也不改变：JUnit 写入被忽略的 `reports/junit.xml`，`retries` 为 0，`reuseExistingServer` 为 `false`，用例标题带 AC/TC 标识；模板不写 `agent.config.json`，README 给出可粘贴的 `qa.business.suites` 片段（`platform` 为 `web`）；模板不下载浏览器，`playwright install` 由项目执行，或设 `E2E_BROWSER_CHANNEL=chrome` 使用本机浏览器。环境变量 `E2E_BASE_PORT`（默认 4310，须为不小于 1024 且为全部应用留出连续端口的整数）、`E2E_BROWSER_CHANNEL`、`E2E_SKIP_WEBSERVER=1`（测试已在运行的服务）。
- 边界与元数据：没有 UI 应用、有应用声明 `e2e`、传入 `options`、v1 配置都在写任何文件之前明确拒绝；`workspace-check` 把 `e2e` 当作私有根包；包内只有 `type-check` 与 `e2e` 两个脚本，不定义 `test`、`build`、`generate`，根目录的聚合命令不会误启动浏览器与开发服务器。配置 schema 枚举、`architecture/manifest.json`、`open-source-catalog.json`、`dependencies.json`（`@playwright/test` 精确固定 1.62.1）、`dependency-audit.json`、开源能力指南与示例配置同步登记。
- 文档与手册：开源公共组件的 PRD、ARCH、TASK、QA 新增 US-OSSKIT-009（四条原子 AC，对应 TC-OSSKIT-009～012），新增 ADR-039；业务测试自动化的 PRD、ARCH、TASK、QA 把「P3 另行立项」改为指向本次交付；QA 手册「驱动产物与报告」新增一条 Web 驱动脚手架指引；`README.md` 与目录标准各补一句。
- 版本与下游影响：架构能力包 3.5.5 → 3.6.0，源发布 3.9.0 → 3.10.0（新增可选模块，按 minor）。未选择 `e2e` 的项目没有任何行为变化；新增的架构模板文件只在项目采用架构包并选择 `e2e` 时才被获取或生成；`qa-tools` 下新增的测试与夹具随目录级 `overwrite` 登记分发，无本地修改时随 `template sync` 创建；项目自己的 `agent.config.json`、PRD、QA 文档与追溯矩阵不被改写。回退：revert 本次变更。
- 字节（UTF-8 实测，不含测试、夹具、阶段文档与本条 CHANGELOG）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（28,815 B）均不变，常驻加载没有增量。按需读取：QA 手册 +481 B（47,507 → 47,988 B，只有读取该手册才多读）；根 `README.md` +37 B；`architecture/modules/open-source/` 下新增 `e2e/README.md` 3,475 B、`e2e/playwright.config.ts` 1,730 B、`e2e-sample/sample.spec.ts` 568 B，共 5,773 B，只在选择 `e2e` 时参与生成。
- 验证方式与未覆盖（仅记录）：按 TDD 先写失败的测试再实现。新增 `architecture/__tests__/e2e-driver.test.js` 8 条（登记一致性、生成与二次零变更、后加应用、项目自选路径、与业务测试契约一致、边界拒绝、私有根包与聚合脚本）和 `infra/scripts/qa-tools/__tests__/business-real-driver.test.js` 9 条；后者以真实 Playwright 1.62.1 + 本机 Google Chrome 154.0.8037.98 的原始 JUnit 报告为夹具（通过报告与原始输出逐字节一致，失败报告只脱敏本机路径前缀与三处行尾空格），回归 3.9.0 的解析、聚合与门禁判定（断言失败、抛出异常、两种跳过、含 `]]>` 的错误信息），并用真实的 `qa run`、`qa verify` 回放。真实驱动对生成配置与示例用例的运行，以及 `qa paths`、`qa run`、`qa verify` 在临时仓库里「放行一次、故意改坏后阻断一次、恢复后再放行」的取证见开源公共能力 QA 第 8 节。未覆盖：① 固定的是 `@playwright/test` 1.62.1，npm 最新 1.63.0 没有运行过（本机只缓存了它的 `playwright-core`），升级须重跑真实驱动取证；② 取证使用模仿 vite、next 端口参数处理的替身开发服务器，真实 react-vite、react-next 开发服务器没有启动，其对 `--port`、`--strictPort`、`-p` 的处理有待项目首次运行确认；③ Tauri 只覆盖 Web 层，iOS、Android 与原生桌面驱动仍由项目自带，也没有验证；④ 闭环中的 `qa verify` 运行在临时仓库的夹具任务状态上，息壤源自身的 `qa verify` 仍跳过业务验收门禁；⑤ PRD 里程碑 P2（`qa plan` 生成 TC 骨架与覆盖矩阵、断言质量检查）与 P4（flaky 策略、突变抽样、人工验收记录、性能与安全专项）仍另行立项。

## [v3.9.0] - 2026-10-07

- 新增业务测试自动化（P1 最小闭环，默认关闭），目标是让大模型按 PRD 生成页面或客户端的业务操作路径并自动完成测试：模型只在创作期工作，产出「原子 AC 表 → 页面状态与操作路径模型 → 测试名携带 AC/TC 标识的自动化用例」；脚本只做确定性的解析、校验、运行、绑定与判定，不调用大模型、无随机、不联网、零 npm 依赖，也不执行或展开 PRD、`PATHS.md` 与报告里的任何内容，同一份输入永远得出同一个结论。三个入口：① `pnpm agent -- qa paths` 只读（不建目录、不写文件），校验引用、路径首尾相接与覆盖准则，输出 AC → 转移 → 路径 → TC 矩阵（`MATRIX_AC=`、`MATRIX_PATH=`），共 20 种违规码，`STATUS=BLOCKED` 时退出码非零；② `pnpm agent -- qa run` 按 `qa.business.suites` 的顺序运行各套件命令，解析 JUnit XML，按测试名里的 `AC-…`/`TC-…` 标识把结果绑定到验收标准，把 `ac-results.json` 与报告副本写入容器 `tmp/qa-business-results/<工作区标识>/`，并绑定 HEAD、工作区是否干净、`qa.business` 配置摘要与报告 SHA256；超时终止整个进程组（SIGTERM，5 秒后 SIGKILL）；报告必须是仓库内未被 Git 跟踪的普通文件、路径不含符号链接，含 DOCTYPE 或自定义实体、超过 64 MiB 的报告判为无效；③ `qa verify` 在 `qa.business.enabled=true` 时追加业务验收门禁（14 种阻断码，依次检查配置、规格、结果是否存在、是否对应当前 HEAD/工作区/配置、套件硬失败（无法启动、超时、缺报告、报告无效）、报告与结果是否被篡改，最后是必需优先级的 AC 是否被通过的用例证明、路径覆盖是否有缺口），通过后才签发回执，被阻断时输出「业务验收未通过，回执未签发。」。必需优先级之外的 `auto` AC 未被证明、`manual` 的 AC（需人工验收）、无标识的用例、未知标识、个别没有原子 AC 表的 PRD 模块（其验收不受本门禁约束），以及套件命令自身非零退出但报告可用的情形，只披露为 `BUSINESS_RISK`，不单独阻断；必需优先级内的 AC 因用例失败、跳过或缺失而无法被证明时仍会阻断。
- 模板与示例统一到同一份规格：PRD 模块模板把原先 5 列的验收表拆为「3.1 用户故事」与「3.2 原子 AC 清单」（9 列：AC ID、Story、优先级、验证、端、Given、When、Then、TC），预期结果只能取自 PRD、数据字典、UX 规范与 ARCH 接口契约，不得取自代码当前输出，模块示例同步改写；新增 `docs/data/templates/qa/PATHS-TEMPLATE.md`（101 行），含界面、状态、转移、路径四张表与 `all-transitions`、`all-states`、`none` 三种覆盖准则，在 `template.manifest.json` 以 `overwrite` 登记；测试用例标识统一为 `TC-{MODULE}-NNN`，PRD、QA、TASK 三份模块模板与追溯矩阵模板同步。`PATHS.md` 只引用 AC 与 TC、不复制 Given/When/Then，规格以 PRD 原子 AC 表为唯一来源。
- 专家与手册：QA 手册新增「业务测试自动化」一章（预言机来源与禁止项、从原子 AC 到 `PATHS.md` 的六步路径推导、三种覆盖准则、等价类/边界值/判定表/状态迁移/两两组合五种设计技术、按优先级分配的用例预算、数据驱动与测试命名约定、刷新只新增或提差异而不覆盖已评审用例、驱动产物与报告约定、配置与使用顺序、阻断码与风险码速查）；PRD、ARCH、TDD、QA 四位专家与 PRD 手册各补入本阶段相关的要求与点读指引，`docs/CONVENTIONS.md` §4、§7、§8 与 `qa-tools` README 登记新命令、结果目录与门禁口径。`/qa plan` 从不生成或覆盖 `PATHS.md`、业务测试套件与已评审的 TC 行。
- 配置：`infra/templates/agent/config.example.json` 新增 `qa.business`，默认 `{"enabled": false, "requiredPriorities": ["P0"], "suites": []}`；`enabled` 不是布尔值、或 `qa.business` 下出现未知键（如拼错的 `enable`）时，`qa verify` 按已开启处理并以 `CONFIG_INVALID` 阻断，不会悄悄跳过门禁；每个套件含 `name`、`platform`（小写字母、数字与连字符组成的端标签，缺省为 `-`）、`command`、`report`（相对仓库根、以 `/` 分隔的路径）与 `timeoutSeconds`（默认 900，上限 7200）；`requiredPriorities` 取自 P0～P3，只有优先级落在其中且验证方式为 `auto` 的 AC 进入阻断范围。
- 下游影响：新增与修改的模板自有文件（`infra/scripts/qa-tools` 下的脚本、测试与夹具，`PATHS-TEMPLATE.md`，专家与手册，`docs/CONVENTIONS.md`，三份模块模板与示例，模板 README）均为 `overwrite`，无本地修改时随 `template sync` 创建或刷新，已本地修改的按既有规则冲突阻断；项目自己的 PRD、QA 文档、追溯矩阵、`PATHS.md` 与 `agent.config.json` 属项目文件，不被改写，按旧 5 列模板写出的验收表保持原样。`qa.business.enabled` 默认 `false`，关闭时 `qa verify` 的输出、退出码与回执与升级前一致。启用需要项目自行补齐原子 AC 表、`PATHS.md`、各端套件命令与对报告目录的 `.gitignore` 忽略（已被跟踪的报告须先 `git rm --cached`）。回退：revert 本次变更，或把 `qa.business.enabled` 设为 `false`。
- 取舍与未覆盖（仅记录）：① 模板不内置浏览器或客户端驱动，契约只有「JUnit XML + 测试名里的 AC/TC 标识 + 套件 `platform` 标签」，Playwright、pytest、XCUITest 等由项目自带，驱动脚手架与所有权登记属 P3；② 套件命令经 shell 按项目 `agent.config.json` 运行，信任边界就是项目配置，不对命令内容做沙箱；结果由 HEAD、配置摘要与报告 SHA256 绑定，能识别事后改写，但不是零信任，不防有仓库写权限的人伪造整套结果；③ 同一工作区不支持并行 `qa run`；④ 息壤源仓库沿用既有行为，`qa verify` 在源仓库跳过业务 PRD/QA 验收门禁，业务验收只在实际项目生效；⑤ 路径模型由模型推导，可能编造或过度细化，门禁只能检查自洽与覆盖，不能证明路径符合产品意图，P0 路径与断言仍须评审；⑥ 套件命令自身非零退出、但报告可用且用例全部通过时，门禁放行并披露 `RISK_SUITE_EXIT_NONZERO`，需要评审人留意；⑦ PRD 里程碑 P2（`qa plan` 生成 TC 骨架与覆盖矩阵、断言质量检查）、P3（architecture 包提供 Playwright 与客户端驱动脚手架）、P4（flaky 策略、突变抽样、人工验收记录、性能与安全专项）另行立项，不在本次范围。
- 字节（UTF-8 实测，不含测试、夹具、阶段文档与本条 CHANGELOG）：常驻加载的 `AGENTS.md`（18,970 B）不变，`docs/CONVENTIONS.md` +2,037 B（26,778 → 28,815 B），常驻加载合计 45,748 → 47,785 B，这是唯一的常驻增量。按需读取：PRD 专家 +1,504 B、ARCH 专家 +1,504 B、QA 专家 +3,058 B、TDD 专家 +1,209 B，PRD 手册 +686 B、QA 手册 +25,024 B（新增一章，只有点读该章才多读）；模板：prd 模块模板 +1,724 B、prd 模块示例 +3,688 B、qa 模块模板 +485 B、task 模块模板 +17 B、模板 README +499 B、追溯矩阵模板 +1,052 B、`qa-tools` README +4,166 B、`config.example.json` +104 B、`template.manifest.json` +101 B（版本号 3.8.1 变 3.9.0 字节数不变）；以上 16 个已有内容文件合计净 +46,858 B。新增 `PATHS-TEMPLATE.md` 7,186 B 与六个脚本 120,768 B（`business-spec.js` 17,148、`qa-paths.js` 10,800、`business-config.js` 7,330、`business-results.js` 36,988、`qa-run.js` 23,222、`qa-business-gate.js` 25,280），共 127,954 B。PRD、ARCH、QA、TDD 专家每次激活分别多读 1,504 B、1,504 B、3,058 B、1,209 B。体量：`AGENTS.md` 175/180 行不变，TDD 专家 178/220 行，prd、arch、qa 三份 `MODULE-TEMPLATE.md` 为 179、175、178/350 行。
- 验证方式与未覆盖（仅记录）：按 TDD 先写失败的测试再实现。新增 10 个业务测试文件共 420 条（`business-spec` 55、`qa-paths` 29、`business-config` 52、`business-results` 122、`qa-run` 35、`qa-business-gate` 52、`qa-verify-business` 11、`business-closed-loop` 28、`business-templates` 14、`business-guidance` 22）。闭环测试在临时 Git 仓库里用合成夹具走通「原子 AC 表 → `PATHS.md` → `qa paths` → 夹具套件产出 JUnit → `qa run` → `qa verify`」：基线全绿后逐个破坏（用例失败、跳过、缺失，结果陈旧，报告副本被改，工作区不干净，配置漂移，套件硬失败，结果缺失，规格违规，改字段、整段嫁接与替换副本式伪造），门禁变红并给出对应错误码、不签发回执，恢复后重新变绿；另覆盖确定性（重复运行逐字一致，用例、套件与 PRD 行序不影响判定）、规模（500 条 AC、2000 个用例在 5 秒内）与安全（报告路径越出仓库根或指向 `.git`，DOCTYPE 与外部实体，命令注入样式文本只当数据，环境变量的值不进入输出），并让息壤自身的业务测试 PRD 通过自家校验（22 条原子 AC、TC-BIZTEST-001～022 逐条可查）。另做一次手工变异抽查，15 个变异体全部被现有用例杀死，初始存活的 2 个变异体已靠加强断言消除（该抽查不属于模板分发的常规套件）。接线测试 `agent-cli` 7、`qa-verify` 8、`qa-verification-state` 3；契约守卫 `template-surface` 49、`agent-state-removed` 4、`multi-host-policy` 4、`rules-context-contract` 3、`workflow-continuation` 9。未运行全量 `pnpm test`、E2E、性能与安全测试：改动限于 `qa-tools`、配置与模板文档，没有业务运行时代码，回归按影响范围选定文件，范围决策与结果记入任务证据。本次没有真实浏览器或客户端驱动参与，闭环用合成 JUnit 报告与确定性夹具验证，不等同于在真实应用上的端到端验收。仓库既有的文档检查失败（`task:sync`、`prd:lint`、`sync-prd-arch-ids`、`qa:sync-prd-qa-ids`、`qa:check-defect-blockers`）与本次无关，未处理。

## [v3.8.1] - 2026-10-06

- 修复 3.8.0 合并后 `/code-review`（max，10 条发现，无运行期缺陷）指出的问题，逐条处置、无搁置；不改 AC 与 TC 编号，不改 manifest、命令与配置键，`AGENTS.md`、`docs/CONVENTIONS.md` 与 `RULES.md` 示例零字节变化。
- `DESIGN.md` 点读门禁在各专家文件间对齐：AC-015-03 规定仅在根 `DESIGN.md` 存在且含 YAML front matter 时点读、缺失回退 UX 规范 §5 与 `styles.css`，但 3.8.0 只有 TDD 手册完整写出；ARCH 手册、TDD 专家、QA 手册与 QA 专家的无障碍条目没有读取条件也没有回退，QA 专家的还原度条目有回退却缺 YAML front matter 条件，没有 `DESIGN.md` 的项目会被这些文字指向不存在的文件。现 ARCH 手册、TDD 专家与手册、QA 专家与手册五处消费方统一为同一读取条件和同一回退动词「回退 UX 规范 §5 与 `styles.css`」（TDD 手册只把「退回」改为「回退」）；TDD 专家同时写明 `docs/standards/ui.md` 只对已采用架构标准的项目另读，与手册一致。QA 的无障碍数值目标原先只能取自 `DESIGN.md` 的 Accessibility，缺失时没有来源，现 QA 专家、QA 手册与 UX 规范模板写为「`DESIGN.md` 的 Accessibility → UX 规范 §5 补充的取值 → WCAG 2.1 AA 默认阈值」，回退不复述任何数值，`4.5:1`、`44×44` 仍只在骨架一处。PRD 专家与手册是 `DESIGN.md` 的建立方，不设条件；TASK、DEVOPS 与常驻规则仍无路由。
- 骨架不再引用下游没有的路径：`DESIGN-TEMPLATE.md` Colors 节原写「息壤架构包 shadcn 组件的默认 Token（`architecture/components/shadcn/tokens.css`）」，该路径只在息壤源存在，下游项目读到的是死路径；改为不含源码路径的表述（61 行不变，2,938 → 2,892 B），取值不变。
- 契约测试补缺（`template-surface` 47 → 49 条）：路由测试原来只断言文件名出现，现逐文件断言读取条件（存在且含 YAML front matter）与回退（回退 UX 规范 §5 与 `styles.css`）；新增无障碍回退测试，并断言骨架不再出现 `architecture/components/` 与 `tokens.css`；组件取值必须是字符串——未加引号的 `{colors.primary}` 会被 YAML 解析成单键映射，旧的引用解析断言放过了它，现增加类型断言与负向自检；`tokens.css` 同源比对的三处隐患改为明确失败：名字正则 `[a-z-]+` 会静默丢掉含数字的 Token（如 `chart-1`），缺 `:root` 块会抛 `TypeError`，圆角按 rem 比较的假设没有断言；体量上限不再在范围测试与体量测试各固定一份，prd 模块模板 ≤ 350 行并入既有体量测试；章节解析函数 `headingBody` 与 `conventionsSection` 合并（6 个章节与原实现逐字节等价）；骨架在测试中只读一次。
- 文档更正：TASK 文档「两份 `MODULE-TEMPLATE.md` ≤ 350 行」更正为三份（prd、arch、qa，体量测试一直固定三份）；模块 QA 第 9 节的路由行从「均指向 `DESIGN.md`」收紧为读取条件与回退，并补无障碍回退、先红后绿、字节与合并后复核记录；模块 ARCH 的验证说明与实际覆盖对齐（体量上限由同文件既有的体量测试固定）。
- 下游影响：本次改动的模板自有文件（ARCH 手册、QA 专家与手册、TDD 专家与手册、骨架、UX 规范模板）均为 `overwrite`，无本地修改时随 `template sync` 自动刷新，已本地修改的按既有规则冲突阻断；没有新增或删除文件，没有 manifest 变化。项目根 `DESIGN.md`、UX 规范与 PRD 属项目文件，不被改写，已按 3.8.0 骨架建立根 `DESIGN.md` 的项目取值不受影响。行为变化只有一处：没有 `DESIGN.md`（或没有 YAML front matter）的项目，QA 与 TDD 现按文字回退到 UX 规范 §5 与 `styles.css`，QA 数值目标再无取值时按 WCAG 2.1 AA 默认阈值，此前这几处文字没有写明。回退：revert 本次变更。
- 字节（UTF-8 实测，不含测试、阶段文档与本条 CHANGELOG）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（26,778 B）均不变。按需读取：ARCH 手册 +90 B、QA 专家 +142 B、QA 手册 +204 B、TDD 专家 +131 B、TDD 手册 0 B；模板：UX 规范模板 +88 B、骨架 −46 B；7 个内容文件合计净 +609 B。TDD、QA 专家每次激活分别多读 131 B、142 B。体量：`AGENTS.md` 175/180 行，TDD 专家 170/220 行，骨架 61/80 行，三份 `MODULE-TEMPLATE.md` 为 160、175、176/350 行。
- 验证方式与未覆盖（仅记录）：门禁与回退、无障碍回退、骨架源码路径三类先红后绿——修复前 `template-surface` 49 条中 3 条按预期失败，修复后 49/49；其余 5 项只改测试自身（组件取值类型、`tokens.css` 解析加固、体量上限去重、章节解析复用、骨架单次读取），无法先红，以负向自检、合成 CSS 核对和逐字节等价核对代替。未运行全量 `pnpm test`、E2E、性能与安全测试（只改文档、模板与测试，无运行时代码改动）；没有运行官方 `@google/design.md` lint（下载未获授权），`DESIGN.md` 与 `styles.css` 的漂移检查仍属 TASK-ARCHPLAT-012。

## [v3.8.0] - 2026-10-06

- 新增界面视觉与无障碍契约骨架 `docs/data/templates/prd/DESIGN-TEMPLATE.md`（61 行、2,938 B），结构取自 Google `DESIGN.md` 规范（`version: alpha`）：YAML front matter 七个顶层键（`version`、`name`、`colors`、`typography`、`rounded`、`spacing`、`components`），正文八个规范章节依次为 Overview、Colors、Typography、Layout、Elevation & Depth、Shapes、Components、Do's and Don'ts，并在 Do's and Don'ts 下设 Accessibility、Motion、Visual QA 三个三级节承载规范之外的约定。初始色板、圆角与字体栈和息壤架构包 shadcn 组件的默认 Token（`architecture/components/shadcn/tokens.css`）逐值一致，不改色板的项目样式与契约天然同源；组件取值以 `{colors.primary}` 形式引用，不含网络字体或外部资源。Accessibility 默认目标：基线 WCAG 2.1 AA，正文对比度 ≥ 4.5:1、大文本 ≥ 3:1，触控目标推荐 ≥ 44×44、WCAG 2.2 SC 2.5.8 最低 24×24（AA），键盘全程可达；Visual QA 默认关键页面还原度 ≥ 95%，均注明可按项目调整。骨架在 `infra/templates/agent/template.manifest.json` 以 `overwrite` 登记，`docs/data/templates/README.md` 增加模板行与所有权说明。项目根目录 `DESIGN.md` 由 PRD 阶段按骨架建立，不在任何 manifest 中，模板更新既不创建也不改写，属项目文件。
- 取值只在一处，各阶段按需点读：色值、间距、断点与无障碍目标只写在根目录 `DESIGN.md`，规则文件不出现。PRD 专家把它列为有前端界面时的产出并写入 DoD，Playbook §5、§8 的对应条目改为指向它；ARCH 手册新增一行，只记录实现映射（Token → `styles.css`、组件集、明暗策略、字体加载）、不复述取值；TDD 手册新增「UI 实现约定」一节（取值以 `DESIGN.md` 为准，先改契约再改样式，业务页面不硬编码色值与间距；采用架构包的项目另读 `docs/standards/ui.md`；无 `DESIGN.md` 时回退到 UX 规范 §5 与 `styles.css`；与组件或禁忌条款有出入时先查 `DESIGN.md`，仍不明确回 PRD），TDD 专家只加一句触发条件；QA 专家与手册的无障碍、设计还原度条目改为对照 `DESIGN.md`，无 `DESIGN.md` 时同样回退。TASK、DEVOPS 专家与手册不增加路由；`AGENTS.md`、`docs/CONVENTIONS.md`、`RULES.md` 示例不出现 UI 内容或 `DESIGN.md`，既有体量契约不变（`AGENTS.md` ≤ 180 行、TDD 专家 ≤ 220 行、`MODULE-TEMPLATE.md` ≤ 350 行）。
- 去重与误标更正：UX 规范模板原 §5「设计系统规范」的色彩、排版、间距、其他视觉 Token 四张表删除，§5 改为「设计系统与组件状态」，只留一条指针和原 §5.5 组件库改名而来的 §5.1「组件状态覆盖」；§6.1 的五行断点表改为只记录页面间布局差异的页面级适配表，§6.2 触控尺寸、§7 清单中的对比度与触控目标、§8 交接流程与设计 QA 的还原度，改为引用 `DESIGN.md` 对应章节。PRD 模板 §8 的两条设计系统与无障碍条目合并为一条指针；prd 模块模板 §8 同样合并，自检清单增加「引用根目录 `DESIGN.md`」。更正一处误标：UX 模板原写「最小触控目标：44×44px（WCAG 2.5.8）」，44×44 CSS px 实为 WCAG 2.1 SC 2.5.5（AAA，2.2 起名为 Target Size (Enhanced)），2.5.8 Target Size (Minimum) 是 AA 级、要求 24×24。数字与正确出处只保留在骨架 Accessibility 一处，UX 规范与 PRD 手册不再复述（PRD 手册原「触控目标 ≥ 44×44px」一并移除），不是原地改写；WCAG 基线版本不变，仍为 2.1 AA。
- 下游影响：新增骨架为 `overwrite` 的模板自有文件，下游下次同步时创建；其余被修改的模板自有文件（专家、手册、三份模板、模板 README）无本地修改时随同步自动刷新，已本地修改的按既有规则冲突阻断。项目已有的 UX 规范、PRD 与根目录 `DESIGN.md` 属项目文件，不被改写：按旧模板写出 §5 取值表的 UX 规范保持原样；没有 `DESIGN.md` 的项目，QA 与 TDD 回退到 UX 规范 §5 与 `styles.css`，行为与升级前一致，采用时由 PRD 阶段按骨架建立。回退：revert 本次变更即可，项目已建立的根 `DESIGN.md` 保留。
- 取舍与未覆盖（仅记录）：`DESIGN.md` 与 `styles.css` 之间暂无自动漂移检查，依赖专家点读与 QA 核验；架构包 `ui.md` 增补视觉契约章节、`project-check.js` 漂移校验与 `architecture init` 为界面栈生成骨架均不在本次范围，登记为 TASK-ARCHPLAT-012，待评估。未引入 `@google/design.md` 依赖，也未运行其官方 lint（获取需下载，未获授权）；骨架合规由 TC-ARCHPLAT-015 的结构断言（行数、键序、章节序、`{token}` 引用可解析、无外部资源、取值同源）覆盖，不等同于官方 lint 通过。规范没有暗色机制，暗色策略在骨架 Colors 节以文字约定；规范合规不代替真实浏览器与设备上的视觉验收。
- 字节（UTF-8 实测，不含测试、阶段文档与本条 CHANGELOG）：常驻加载的 `AGENTS.md`（18,970 B）与 `docs/CONVENTIONS.md`（26,778 B）均不变。按需读取：PRD 专家 +383 B、QA 专家 +146 B、TDD 专家 +140 B，ARCH 手册 +159 B、PRD 手册 +302 B、QA 手册 +140 B、TDD 手册 +775 B；模板：UX 规范 −1,360 B（242→199 行）、PRD 模板 +39 B、prd 模块模板 +40 B、模板 README +475 B、`template.manifest.json` +102 B（含版本号 3.7.33 变 3.8.0 的 −1 B）；新增骨架 +2,938 B；13 个内容文件合计净 +4,279 B。新增的 UI 内容全部落在按需读取的文件，TDD 阶段每次激活多读一句（+140 B），点读「UI 实现约定」才多读该节。新增契约测试：`template-surface` 新增 6 条（41 变 47），TC-ARCHPLAT-015（骨架体量、键序、章节与无障碍目标；Token 同源与引用可解析）、TC-ARCHPLAT-016（manifest 与 README 登记且根 `DESIGN.md` 不入任何 manifest；三份模板去重与误标）、TC-ARCHPLAT-017（PRD、ARCH、TDD、QA 路由；TASK、DEVOPS 与常驻规则不含 `DESIGN.md`，体量上限）各 2 条；`update-template` 引导测试增加断言：模板更新后根 `DESIGN.md` 哨兵内容不变，投递的骨架与模板源一致（总数仍为 14）。

## [v3.7.33] - 2026-10-06

- `AGENTS.md`「GitHub 与安全」第 2 条改写，只改这一行：`不得裸执行 `git fetch/pull/push/ls-remote`、`gh pr/repo/api/workflow/run`。` → `GitHub 访问只用 `.env.local` 的 `GH_TOKEN`；不得裸执行 `git fetch/pull/push/ls-remote`、`gh`。`。含义变化两处：① 新增令牌来源约定——GitHub 访问只用 `.env.local` 的 `GH_TOKEN`；② 裸执行禁令里的 `gh` 由 `pr/repo/api/workflow/run` 五个子命令扩为整个 `gh`，清单之外的 `gh auth`、`gh release` 等此前不在禁令内，现在同样不得裸执行，须经 `infra/scripts/shared/github-auth-run.js` 或仓库脚本。起因：要求所有 GitHub 访问只走 `.env.local` 的 `GH_TOKEN`、不自带 git 身份；v3.7.32 已在机制层补了提交身份，本条是规则层的对应声明。「必须经包装器」仍只在 `docs/CONVENTIONS.md` §9，未复制进 `AGENTS.md`。字节：`AGENTS.md` +25 B（18,945 → 18,970 B），`docs/CONVENTIONS.md` 不变（26,778 B），常驻加载合计 45,723 → 45,748 B。`template-surface.test.js` 中逐字固定该行的断言同步改为新行。
- 已知取舍与未覆盖（仅记录）：① 「只用 `.env.local`」是规则层的声明性约束，比代码和 `docs/CONVENTIONS.md` §9 更严：`getProjectGitHubToken` 先取 `.env.local`（当前 worktree 与 Git 主 worktree），取不到时仍回退进程环境变量 `GH_TOKEN`，本次不改代码也不改 §9；② 它是写给执行器的约定，不是机制锁：拦截裸调用的 `permissions.deny` 规则与 PreToolUse 钩子仍未做（未获授权），装有 `gh` 时 `createGitHubBackend` 仍优先走 `gh`；③ v3.7.29 条目里引用的旧行原文属于历史记录，不改；④ 「只用 `.env.local`」没有限定范围，字面上也覆盖官方模板同步：`template sync` 按 `AGENTS.md`「模板所有权与升级」与 `docs/CONVENTIONS.md` §3「息壤官方同步」匿名 HTTPS 拉取官方公开分支，不读取项目 `GH_TOKEN`；以这两处更具体的规定为准，本次按指定原文落地，不改这行措辞，也不改那两处。

## [v3.7.32] - 2026-10-06

- 新增 `pnpm agent -- tdd commit [git commit 选项]`，并让脚本内的提交与注解 tag 在 git 没有身份时由 `.env.local` 的 `GH_TOKEN` 所属 GitHub 账号补齐作者与提交者，不再需要手填一次性的 `GIT_AUTHOR_*` / `GIT_COMMITTER_*`，也不需要配置 git 的 `user.name` / `user.email`。起因：令牌只负责鉴权，`git commit` 与 `git tag -a` 另需作者身份；没有身份时只能手填环境变量或写 git 配置，与「GitHub 访问只用 `GH_TOKEN`」的约定冲突。机制：① 新增 `infra/scripts/shared/github-identity.js`，`buildGitHubGitEnv` 在子命令为 `commit`（需要作者与提交者）或注解 `tag`（`-a`/`-s`/`-u`/`-m`/`-F` 及对应长选项，只需要提交者即 tagger；`-d`/`-l`/`-v` 不算）时，逐个角色用 `git -c user.useConfigOnly=true var GIT_AUTHOR_IDENT|GIT_COMMITTER_IDENT` 询问 git 是否已有显式身份（git 配置或 `GIT_*` 环境变量；EMAIL 与主机名自动探测不算），已有的角色保持不变且不访问网络，缺失的角色才取令牌账号；② 令牌账号经 `GET /user` 推导：姓名取账号 `name`（为空则用 `login`），邮箱为 `<id>+<login>@users.noreply.github.com`，与该账号经 GitHub 合并产生的提交所用的 noreply 身份一致；③ `buildGitHubGitEnv` 是同步接口而 GitHub API 请求是异步的，账号查询放在子进程里完成（`github-identity.js --probe`），令牌只经子进程环境变量 `XIRANG_GITHUB_IDENTITY_TOKEN` 传递，不进命令行参数，输出与错误信息中的令牌一律替换为 `***`；同一进程内同一令牌只查一次，失败不缓存，超时 15 秒；④ 身份只写入本次 git 进程的 `GIT_AUTHOR_NAME/EMAIL`、`GIT_COMMITTER_NAME/EMAIL` 环境变量，不写任何 git 配置，不落盘；补完后再让 git 复验一次，git 不接受该姓名或邮箱时报错；⑤ 有令牌却查不到账号时抛错（fail closed），不退回 git 自动探测，也不接受任何手填身份；没有令牌时 `resolveCommitIdentity` 返回 `unresolved`，由调用方决定（见取舍 ⑦）。覆盖面：`qa-merge` 的本地 squash 提交、发布/状态提交与 `tag -a`，以及 `tdd-push` 的工作区自动提交，共 4 处，全部经 `runGit` → `buildGitHubGitEnv`；新增结构扫描测试，凡含 `['commit', …]` 或 `['tag', …]` 调用的非测试脚本，源码里必须调用 `buildGitHubGitEnv(` 或 `resolveCommitIdentity(`，且 `qa-merge`、`tdd-push`、`tdd-commit` 三个文件必须被扫到。`merge --ff-only`、`merge --squash`、`add`、`status` 及 `push` 等不需要身份的命令不受影响，`push` 的 `http.https://github.com/.extraheader` 注入不变。`tdd commit` 入口：选项原样转发给 `git commit`；不接受 `--author`（含 `--au` 等缩写），作者只来自 git 已有身份或令牌账号；git 没有身份又读不到令牌，或账号查询失败时输出 `STATUS=BLOCKED` 并非零退出，不运行 git；成功时输出 `STATUS`、`SUMMARY`、`NEXT_ACTION`、`IDENTITY_SOURCE`（`configured` / `github-token`，阻断时为 `unresolved`）、`IDENTITY`、`COMMIT`。新增契约测试：`github-identity` 13 条（含两条跨真实进程边界的查询）、`tdd-commit` 8 条（其中 1 条经真实进程运行 `--help`）、`github-auth` 新增 8 条（9 条变 17 条，含真实 git 仓库中提交与注解 tag 的作者核对，以及 `.git/config` 不含 `[user]`）、`agent-cli` 新增 1 条（5 条变 6 条，固定 `tdd commit` 路由与帮助文本）；`cli-help` 的默认动作入口清单加入 `tdd-tools/tdd-commit.js`，固定其先处理 `--help` 再执行，帮助请求不会触发提交。`AgentRoles/TDD-PROGRAMMING-EXPERT.md` 在「强制交付流水线」增加 1 段说明（8,063→8,281 B，+218 B）；`infra/scripts/tdd-tools/README.md` 增加第 5 节与脚本状态表 1 行；`AGENTS.md`、`docs/CONVENTIONS.md`、`.claude/settings.json` 字节不变（常驻加载的两份规则仍为 45,723 B）。`infra/scripts/shared`、`infra/scripts/tdd-tools` 是模板自有目录，随 `template sync` 分发，无需新增 manifest 条目。
- 已知取舍与未覆盖（仅记录）：① 没有 git 身份时，提交现在依赖能访问 `api.github.com`；`GET /user` 对个人令牌（经典与 fine-grained）有效，GitHub App 安装令牌（`ghs_` 前缀）不适用；② 只覆盖经 `buildGitHubGitEnv` 的脚本调用与 `tdd commit`：终端里裸执行的 `git commit`、`github-auth-run.js -- git commit`（走 `buildGitHubShellEnv`，本次未改）、非快进的普通合并提交、cherry-pick、rebase 不会被补身份；`update-template.js` 用 `commit-tree` 自带身份，未改；注解 tag 的判定只认完整写出的长选项，不认 git 允许的缩写（如 `--mess=x`），这类写法不会被补身份，git 按自身配置处理，目前唯一创建 tag 的调用 `qa-merge` 用 `-a`/`-m`，不受影响；③ git 配置里身份不完整（例如只配了姓名没配邮箱）视为没有显式身份，该次提交改用令牌账号，不写入配置；④ `createGitHubBackend` 在安装了 `gh` 时仍优先走 `gh`，「GitHub 访问只用 `GH_TOKEN`」尚未做到 100%，需另行收紧；⑤ `.claude/settings.json` 未改，`pnpm agent -- tdd commit` 不在 allowlist 内，Claude Code 里每次调用可能弹出确认，需要免确认时在 `settings.local.json` 的 `permissions.allow` 追加 `Bash(pnpm agent -- tdd commit:*)`；⑥ 拦截裸调用的 `permissions.deny` 规则与 PreToolUse 钩子本次均未做（未获授权）：对「不得裸执行 `git fetch/pull/push/ls-remote`、`gh`」的约束目前仍是约定加 `github-auth-run.js` 包装器，没有机械拦截；⑦ 脚本内的提交（`tdd push` 的自动提交、`qa merge` 的本地 squash 提交与发布/状态提交、注解 tag）在 git 没有身份又读不到 `GH_TOKEN` 时，`buildGitHubGitEnv` 不补身份也不阻断，作者仍由 git 自己探测（EMAIL、主机名），与改动前一致；只有 `tdd commit` 在这种情况下阻断，让脚本内的提交也阻断属于行为变更，本次未做。

## [v3.7.31] - 2026-10-05

- `.claude/settings.json` 团队 allowlist 再删除 7 条在模板源没有任何可匹配脚本的遗留预批准（70 条变 63 条，其余条目内容与顺序不变，`git diff` 仅 7 行删除、0 行新增）：`Bash(pnpm build*)`、`Bash(pnpm run build*)`、`Bash(pnpm run clean*)`、`Bash(pnpm dev)`、`Bash(pnpm run priority:*)`、`Bash(pnpm run persona:*)`、`Bash(pnpm run goal:*)`。依据：把这 7 条逐一对照模板源 `package.json` 的 65 个脚本（按 `pnpm <脚本>` 与 `pnpm run <脚本>` 两种调用形式）无一匹配；`build`、`clean`、`dev` 在 `package.json` 历史中从未存在（`git log -S` 查无记录）；`priority:*`、`persona:*`、`goal:*` 对应的 9 个脚本在 f5822fa（2025-11-05）加入、dbf60fd（2026-04-23「make agent template portable」）移除，且 `:*` 按词边界只匹配无冒号后缀的 `pnpm run priority`；`Bash(pnpm dev)` 另是 `Bash(pnpm dev:*)` 的子集（后者按词边界同样匹配裸 `pnpm dev`），删除不改变放行结果；7 条均自 a0a8cbd（2026-04-21「同步 Claude/Codex 配置与 direnv 环境加载」）一并引入。删除只会让相应命令回到弹出确认，不新增任何放行，权限只减不增。下游影响：「无可匹配脚本」只对本模板源成立。`pnpm build*`、`pnpm run build*` 是原始前缀通配，原先会放行 `config.example.json` 登记的规范 alias（`pnpm build:app:<平台>`、`pnpm build:dev|staging|prod`）与默认 `commands.build` 的 `pnpm run build`；下游已实现这些脚本或自带 `build`、`clean` 脚本的，Claude 直接执行它们不再免确认，需要免确认时在 `settings.local.json` 的 `permissions.allow` 追加所需条目。`pnpm agent -- build ...` 本就在需确认之列，不受影响；`pnpm agent` 运行器内部拉起的子进程不是 Claude 的 Bash 工具调用，不受 allowlist 约束。`.claude/settings.json` 属 `merge-json`，统一引擎对数组整体比较，下游 `permissions.allow` 与已安装基线一致时自动采用新列表，已自定义时报 `JSON field conflict: $.permissions.allow` 并阻断，需手动对齐；旧版 `mergeJson` 路径保留下游本地数组，不报冲突也不自动删除这 7 条，需下游自行删除；`.claude/settings.template.json` 为覆盖分发，自动刷新。如需回退，把这 7 条加回 `.claude/settings.json`，或在下游 `settings.local.json` 只追加所需的几条。
- 保留不动（仅记录，未经授权不处理）：其余 17 条遗留 pnpm 规则——`pnpm lint*`、`pnpm run lint*`、`pnpm type-check*`、`pnpm run type-check*`、`pnpm run codemap*`、`pnpm run precommit*`、`pnpm run dev*`、`pnpm dev:*`、`pnpm run prd:*`、`pnpm run arch:*`、`pnpm run nfr:*`、`pnpm run task:*`、`pnpm run tdd:*`、`pnpm run qa:*`，以及 3 条 `ship:dev` 别名（`pnpm ship:dev`、`pnpm run ship:dev`、`pnpm run ship:dev:quick`）。其中 7 条 `:*` 规则（`pnpm dev:*`、`prd:*`、`arch:*`、`nfr:*`、`task:*`、`tdd:*`、`qa:*`）按官方权限文档语义（`:*` 等价于词边界的 ` *`，`claude-settings-allowlist` 的 `isAllowed` 同此建模）只匹配无冒号后缀的 `pnpm dev`、`pnpm run task` 之类；对模板源 65 个脚本的两种调用形式一条也不匹配，而这些前缀下共有 39 个带冒号后缀的脚本（`dev:` 5、`prd:` 2、`arch:` 4、`nfr:` 1、`task:` 9、`tdd:` 10、`qa:` 8）。该判断依据文档语义计算，未在 Claude Code 宿主内实机验证。字节（UTF-8 实测）：`.claude/settings.json` 3,221→3,008 B（−213 B）；常驻加载的 `AGENTS.md`、`docs/CONVENTIONS.md` 不变，本次不减少常驻上下文，目的是去掉没有对象的预批准。新增契约测试：`claude-settings-allowlist` 新增 2 条（4 条变 6 条），固定 7 条规则已从 allowlist 删除、`pnpm build`、`pnpm build:app:mac`、`pnpm run build`、`pnpm run build:dev`、`pnpm run clean` 及无冒号的 `pnpm run priority`、`pnpm run persona`、`pnpm run goal` 需确认、裸 `pnpm dev` 仍由 `Bash(pnpm dev:*)` 放行，以及上述 17 条遗留 pnpm 规则逐条保留。

## [v3.7.30] - 2026-10-05

- `AGENTS.md` 与 `docs/CONVENTIONS.md`（均为强制完整加载）互为重复的 7 处表述各只保留一份，规则含义不变。逐条承接：`AGENTS.md`「模板所有权与升级」中「`RULES.md`、业务源码、真实项目文档和部署实现属于项目；模板更新不得覆盖已有内容；`RULES.md` 缺失时按 `init-if-missing` 初始化」→ `AGENTS.md`「必须加载的上下文」「`RULES.md` 由实际项目维护；首次应用与更新仅在缺失时从模板骨架初始化，已有文件保持不变」与 `docs/CONVENTIONS.md` §3「`RULES.md`、真实项目文档、源码、业务部署脚本和已有 `agent.config.json` 均属于项目；`RULES.md` 仅在缺失时初始化，已有内容（包括空文件）不改写」及 `project-owned`、`init-if-missing` 两条策略；`AGENTS.md`「全仓扫描」正文（候选清单先写入 `tmp/scan-manifests/` 再编辑、报告四个计数并满足 `matched = modified + skipped`）改为「细则见 `docs/CONVENTIONS.md` §全仓扫描」，首句「Discovery 与 Editing 必须分离」保留，§10 是其超集（另有「包含范围、排除项和全部候选」「范围变化时创建新 manifest，不得静默缩小」）；`docs/CONVENTIONS.md` §6「mutation 必须显式提供可观察验收」→ `AGENTS.md`「任务输入门禁」「mutation 任务在创建或恢复修改 worktree 前必须有显式验收」及 §6 命令块 `--acceptance "<可观察验收>"`（指向「任务输入门禁」的指针保留）；「同一次 checkpoint 可更新步骤和验收项，减少机械写盘」→ `AGENTS.md`「长任务断点续跑」「一个 checkpoint 可同时完成步骤和验收项，并记录简短证据、退出码、路径或哈希」，动机「减少机械写盘」由同节「无需为无状态的微小动作反复写盘」承接；「新任务安全默认 `type=mutation`；确认不会修改 tracked 文件时才显式选择只读类型」→ `AGENTS.md`「新任务默认 `type=mutation` 并执行 completion guard；能证明不会修改 tracked 文件时才显式使用 `diagnose|research|operation`」（同条「schema v1 状态在读取时升级为 v2，保留既有步骤、证据与生命周期状态」是唯一内容，保留）；「旧 aliases 在已有项目中保留兼容，但模板不继续增加同义入口」→ `AGENTS.md`「稳定命令入口」「已有项目中的旧 package aliases 作为兼容入口保留；新模板不继续扩张别名集合」（同段「命令必须输出可解析的 `STATUS`、`SUMMARY`、`NEXT_ACTION`，失败时退出码非零」是唯一内容，保留）；`docs/CONVENTIONS.md` 末行「上下文预算、阶段交接与失败恢复协议以 `AGENTS.md`“上下文预算与阶段交接”和“长任务断点续跑”为准」（位于 §10 全仓扫描之下，自身不含规则，只转发）→ `AGENTS.md`「上下文预算与阶段交接」「长任务断点续跑」两节本身（与 `docs/CONVENTIONS.md` 同为强制完整加载，转发句不带来加载时机上的收益）；其中失败恢复半句在 `docs/CONVENTIONS.md` §6 另有两处就地指针，保留：「是否需要任务状态统一遵循 `AGENTS.md`“长任务断点续跑”」与「记录不可用时按 `AGENTS.md`“长任务断点续跑”的失败恢复规则对话留痕」；此条按用户在任务中途的建议并入，原先两处固定该指针存在的既有断言一并删除（见下）。字节（常驻加载）：`AGENTS.md` −328 B（19,273→18,945，176→175 行，仍受既有 ≤180 行契约约束）、`docs/CONVENTIONS.md` −453 B（27,231→26,778，274→271 行），合计 −781 B。
- `AgentRoles/DEVOPS-ENGINEERING-EXPERT.md` 与 `AgentRoles/Handbooks/DEVOPS-ENGINEERING-EXPERT.playbook.md` 去除已在 `docs/CONVENTIONS.md` §客户端与服务端快捷命令（常驻加载，不存在加载不及时）登记的快捷命令副本，改为指向该节的指针，规则含义不变。专家：快捷命令表删除 7 行（`/dev app <platform>`、`/private dev app <platform>`、`/build app <platform>`、`/private build app <platform>`、`/build <env>`、`/private build <env>`、`/private ship <env>`，第三列均只是「项目已有…alias（可选）」）→ §7 同名 7 行与平台矩阵；「命令说明」中 `/dev app`、`/build app` 与 `/build <env>`、`/ship <env>` 两条（分别由 `app.commands.dev/build.<platform>`、`devops.commands.build/ship` 定义，前者只生成产物、后者才改变环境状态）合并为一条指针 → §7 配置结构 `app.commands.<dev|build>.<platform>`、`devops.commands.build` / `devops.commands.ship`，以及 `/build <env>`「构建服务端环境产物，不改变目标环境状态」、`/ship <env>`「执行真实环境部署」；「开发启动、发行构建和真实部署的验收证据不得互相替代」原句保留在指针条中（§7 亦有「四种不同副作用边界，验收证据不得互相替代」）。手册：§5 脚本路径参考表尾 4 行（`/private restart`、`/dev app <platform>`、`/build app <platform>`、`/build <env>`；它们落在以「可选 package alias」为首列的表里，与表头列义不符）→ §7 同名各行，表后新增 1 行指针；「private profile 的用户快捷语法为 `/private start|restart|stop|status|logs`；内部 target 仅用于 dispatcher 调度，不作为用户命令暴露」→ 专家「本地服务管理」段「用户请求 private profile 时使用 `/private start|restart|stop|status|logs`；禁止写成 `/restart private` 或把内部 `--target=private` 暴露为用户快捷语法」与手册 dispatcher 段「用户使用 `/private ...` 语法，内部 target 不得作为用户快捷命令公开」，其中「仅用于 dispatcher 调度」是被删句独有的措辞，已并入保留的 dispatcher 段（现为「内部 target 仅用于 dispatcher 调度，不得作为用户快捷命令公开」）；「客户端开发与构建」两条「读取」条（`/dev app` 与 `/private dev app` 读取 `app.commands.dev.<platform>`，`/build app` 与 `/private build app` 读取 `app.commands.build.<platform>`）合并为一条指针 → §7 配置结构。保留不动：专家的 `/ship`、`/cd`、`/ci`、`/env`、`/restart`、`/private restart` 行（含 §7 未登记的 `cd`、`ci`、`env` 与 `ship` 的环境映射；`/restart`、`/private restart` 与 §7 重复，但被既有测试固定）、`/ci` 与 `/env` 说明、「本地服务管理」段与 DoD；手册的「显式 profile 没有精确命令时必须阻断，禁止回退 default；构建成功不得替代运行态验收」与其余各表。
- `AgentRoles/TDD-PROGRAMMING-EXPERT.md` 把相邻两条同义条款「不维护 tracked 阶段状态文档；运行证据留在 task state、QA 报告和部署记录」「运行证据写 session 或长任务状态，不写入阶段文件」合并为「不维护 tracked 阶段状态文档；运行证据写 session、长任务状态、QA 报告和部署记录，不写入阶段文件」，取两句所列落点的并集，其余条款不变。
- 5 个专家（ARCHITECTURE-WRITER、DEVOPS-ENGINEERING、PRD-WRITER、QA-TESTING、TASK-PLANNING）与 6 个手册（上述 5 个加 TDD-PROGRAMMING）开头「路径基准」注记中的「详见 `/AGENTS.md` §仓库拓扑」是失效指针：`AGENTS.md` 没有「仓库拓扑」一节（相关内容在「仓库与状态边界」），路径与仓库拓扑规则在 `docs/CONVENTIONS.md` §1「路径与仓库拓扑」。11 处统一改为「详见 `/docs/CONVENTIONS.md` §路径与仓库拓扑」，注记其余内容不变；这是修正而非精简，每处 +19 B，共 +209 B。
- 评估后保留未动（措辞有语义差、属唯一内容，或被测试固定）：`AGENTS.md`「模板所有权与升级」的身份行（官方源「固定为」）与官方同步安全语句（`匿名 HTTPS` 由 `template-surface` 固定），对应 `docs/CONVENTIONS.md` §3「默认上游」措辞有别；`docs/CONVENTIONS.md` §1 容器树、§1/§5/§6 中带限定作用的复述句、§4 模块化结构句（`AGENTS.md` 写「只使用」、此处写「采用」）、§7 稳定入口块（域列表与 `AGENTS.md`「稳定命令入口」不同）与平台矩阵（逐平台字面量被测试固定）、§3 中「模板更新流程」四步与「息壤官方同步」updater 流程的两处表述（重叠约 30 B，且后者与 `TEMPLATE_CONVERGENCE_STATUS` 同段）；QA、ARCH 专家中与 `docs/CONVENTIONS.md` 视角不同的命令语义与工作流指令；各处高风险域清单（措辞略有差异，统一即改变含义）。PRD、ARCH、TASK、QA 专家文件正文未改，仅路径指针；`AGENTS.md` 内部「`task finish` 只受任务绑定 blocker 阻断」的两处相近表述只记录，未改动。披露：手册实测节省（−438 B，不含路径指针）低于事前评估的 −576 B，原因是最终指针措辞比评估时的示意稿更长；未为追平数字再压缩其他句子。字节合计（UTF-8 实测，不含测试文件与本条 CHANGELOG）：常驻加载 −781 B；按需读取 DEVOPS 专家 −798 B、DEVOPS 手册 −419 B、TDD 专家 −36 B（前两者含路径指针各 +19 B，不含时分别为 −817 B、−438 B），其余 9 个专家与手册各 +19 B；14 个内容文件净 −1,863 B。指针是净增字节，收益在于把快捷命令登记收敛到 §7、消除两份副本漂移的风险、修复失效指针并降低常驻上下文。下游影响：改动文件均为 `overwrite` 的模板自有文件，下游无本地修改时随同步自动刷新，已本地修改的按既有规则阻断；`RULES.md` 等项目文件不受影响。新增契约测试：`template-surface` 新增 6 条测试，依次固定：`AGENTS.md` 的两处删除与保留的单行规则及指针，并断言承接原文仍在 `docs/CONVENTIONS.md`；`docs/CONVENTIONS.md` 的 5 句删除（含末行转发指针）、`AGENTS.md` 中对应承接原文与两节标题仍在，以及同句唯一内容和 §6 内两处「长任务断点续跑」指针保留；DEVOPS 专家的 7 行删除与 §7 同名行、配置键和验收证据句仍在，以及专家自有路由行保留；DEVOPS 手册的各项删除与指针数量，以及 profile 阻断、dispatcher 说明、配置约定保留；TDD 专家的单条运行证据表述；11 处路径基准注记均指向 `docs/CONVENTIONS.md` §路径与仓库拓扑，且 `AGENTS.md` 无「仓库拓扑」章节。原先分别在 `phase experts use bounded context handoffs instead of full document reloads` 与 `context governance uses staged soft watermarks without blocking lightweight work` 两条既有测试中固定「`docs/CONVENTIONS.md` 含该转发指针」的两处断言随指针一并删除，改由上述契约固定其已不存在且承接节仍在；`template-surface` 总数仍为 41 条。

## [v3.7.29] - 2026-10-05

- `.claude/settings.json` 团队 allowlist 删除 `Bash(pnpm test*)` 与 `Bash(pnpm run test*)` 两条（72 条变 70 条，其余条目内容与顺序不变）。这两条是原始前缀通配，不是词边界的 `:*`：既放行项目自有的聚合测试脚本（常为全量，与 `AGENTS.md`「不得把项目自有 `pnpm test` 或无文件参数的运行器当作默认回归」相悖），也会误放行 `pnpm testing` 之类无关命令；定向测试走 `pnpm agent -- test --file <测试文件> -- <运行器>`，该入口本就在需确认之列，需要免确认时在 `settings.local.json` 追加。`.claude/README.md`「需要确认的操作」增加 1 条说明；`claude-settings-allowlist.test.js` 新增契约测试，固定 `pnpm test`、`pnpm test:e2e`、`pnpm test --coverage`、`pnpm testing`、`pnpm run test`、`pnpm run test:unit`、`pnpm run testall` 仍需确认，且 allowlist 中不再有 `pnpm test` 类规则。下游影响：`.claude/settings.json` 属 `merge-json`，统一引擎对数组整体比较，下游 `permissions.allow` 与已安装基线一致时自动采用新列表，已自定义时报 `JSON field conflict: $.permissions.allow` 并阻断，需手动对齐；旧版 `mergeJson` 路径保留下游本地数组，不报冲突也不自动删除这两条，需下游自行删除；`.claude/README.md` 为覆盖分发，自动刷新。未改动其他遗留通配（`pnpm lint*`、`pnpm run lint*`、`pnpm type-check*`、`pnpm run type-check*`、`pnpm build*`、`pnpm run build*`、`pnpm run clean*`、`pnpm run codemap*`、`pnpm run precommit*`、`pnpm run dev*`），仅记录。
- `AgentRoles/QA-TESTING-EXPERT.md` 两处与 `AgentRoles/TDD-PROGRAMMING-EXPERT.md` 一处含糊的「通用约定」改为显式指向 `docs/CONVENTIONS.md` §测试范围与证据复用，其余子句不变：QA 专家「全量时核实通用约定中的触发项、调查证据及具体应用/测试类型」「可复用符合通用约定的 TDD 证据」，TDD 专家「高风险标签本身不触发全量，按通用约定界定范围」。QA 专家两处的既有契约固定项同步为显式指针写法；新增守卫测试固定 `AgentRoles/*.md` 与 `AgentRoles/Handbooks/*.md` 不再出现「通用约定」，并固定 TDD 专家的指针。
- `AGENTS.md`「GitHub 与安全」去除已被 `docs/CONVENTIONS.md` §5/§9 承接的重复子句，规则含义不变（`AGENTS.md` 与 `docs/CONVENTIONS.md` 均为强制完整加载）。逐条承接：「远端 Git/GitHub 操作只能走 `github-auth-run.js` 或仓库脚本，token 变量仅用 `GH_TOKEN`」→ §9「GitHub token 变量统一为 `GH_TOKEN`」「远端 Git/GitHub 命令必须由 `infra/scripts/shared/github-auth-run.js` 或上层脚本执行」；「PRD、ARCH、TASK、TDD、QA、DEVOPS 是阶段职责，不是电脑或账号身份；所有已获仓库权限的协作者均可…合并 PR，或对配置主干执行普通非强制 push」→ §9「专家名称表示当前阶段职责，不绑定电脑、hostname、机器角色或专用 QA 账号；所有已获仓库权限的协作者可以执行任意阶段、合并 PR 或普通更新配置主干」及「配置主干禁止 force push 和删除」「普通 push」；「`qa verify` 通过后…写入绑定…回执；`qa merge` 必须重新 fetch，并把回执与 PR base/head refs 逐项复验，任一漂移都阻断并要求重新 QA」→ §5「`qa verify` 通过后在本机原子保存绑定配置主干、功能分支、`BASE_SHA` 和 `HEAD_SHA` 的回执」「合并前重新 fetch，并把回执与 PR base/head refs、远端引用逐项复验」「任何 SHA 漂移、冲突或非快进拒绝都必须停止并要求重新 QA」；「配置主干禁止 force push 和删除」「主干并发更新失败时不得覆盖远端历史」→ §9 同句与 §5「不得自动 rebase 已验证分支或覆盖远端历史」；「TDD、QA 与合并门禁完全在本地执行…；该目录始终由实际项目自行维护」→ §9 同义句，并把 `AGENTS.md` 版更强的「完全在本地执行」「始终由实际项目自行维护」并入 §9（原为「在本地执行」「工作流目录属于实际项目」）。`AGENTS.md` 新增 1 条指针指向 §5、§9。逐条核对后保留：「不得裸执行 `git fetch/pull/push/ls-remote`、`gh pr/repo/api/workflow/run`」（§9 无该禁用清单）、「`tdd push` 必须显式以 `config.baseBranch` 为 PR base」（仅此一处）、「功能分支只有在精确 expected SHA 的 `--force-with-lease` 保护下才可清理」（与 §9「精确 `--force-with-lease` 仅可用于功能分支清理」方向不同：前者限定清理手段，后者限定租约用途）、「删除前解析并复核精确目标；失败、阻塞、等待确认和恢复态不得清理任务/worktree 状态」（§9 对应句讲路径解析与递归删除，要素不同）、「不记录或提交密钥、凭据、个人信息和大段原始日志」（§9 对应句讲 `.env.local`、用户数据、未脱敏日志与本地绝对路径快照，要素不同）。披露：v3.7.28 曾因 TASK-CMDSURF-025 记载 `AGENTS.md` 与 `docs/CONVENTIONS.md` 均明确同权与无 CI 协议而仅记录未改动，本次已获用户明确授权处理；该历史任务记录不改，同权与无 CI 协议的完整正文仍在 `docs/CONVENTIONS.md` §9，承接原文由新增契约测试逐句固定，`AGENTS.md` 保留指针；如需回退，恢复 `AGENTS.md` 中「阶段职责」与「完全在本地执行」两条即可。字节：常驻加载的 `AGENTS.md` −632 B、`docs/CONVENTIONS.md` +21 B，合计 −611 B；按需读取的 QA 专家 +80 B、TDD 专家 +40 B、`.claude/README.md` +199 B、`.claude/settings.json` −56 B；全部合计 −348 B。指针与说明为净增字节，收益在消除含糊指代、过宽放行与常驻上下文的重复。新增契约测试：`template-surface` 新增 2 条测试，并把 QA 专家既有测试中的 2 处固定项改为显式指针写法，`claude-settings-allowlist` 新增 1 条测试。

## [v3.7.28] - 2026-10-05

- `AGENTS.md`「Worktree-First」去除与 `docs/CONVENTIONS.md` §5 同义的一句，规则含义不变：原句「`worktree new` 在 required fetch 后发现远端同名分支时必须阻断；只有显式 `worktree resume` 可以按远端分支的固定 SHA 建立本机 worktree 和 session」的两个子句均保留于 §5「创建全新 worktree」段（「如果 required fetch 后已经存在 `refs/remotes/origin/<branch>`，`worktree new` 必须阻断并提示显式恢复或更名」「只有 `worktree resume` 可以从远端分支固定 SHA 创建本机 tracking branch、worktree 和 session」，表述更完整）。`AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md` 常用命令示例引导句中的「满足通用约定的升级条件」改为显式指向 `docs/CONVENTIONS.md` §测试范围与证据复用（与 v3.7.27 对 QA playbook 的处理一致），「须按项目运行器核实过滤参数并选择受影响用例」与「不按示例逐条执行」不变。经逐条核对不改动：`AGENTS.md`「合并后清理由 session 封印和补偿器完成…」（§5 无「封印」「补偿器」及「HEAD 漂移或缺少封印时转为恢复状态，禁止删除」正文；QA 专家与 playbook 的相近描述仅在 QA 阶段按需读取，且不含「缺少封印」「禁止删除」）、「多 worktree、多电脑可并行开发…」（「多 worktree、多电脑可并行开发」仅此一处，其余部分与 §5 末段、§9 近同义，但可去部分很小且需补指针）、「任务记录、worktree 创建、提交和部署分别执行…」「失败先按可观察证据区分…」「若 task start/checkpoint 本身不可执行…」三处拒绝后不得重试的表述（各含不可互相替代的要素：「拆分」「保留原始理由与调用编号」「迁移记录」，属有意重复的安全红线）、`task exec` 使用规则中 `<name>` 与 §7 `<evidence-name>` 的占位符写法差异（已由既有契约测试固定）。仅记录、未改动：`AgentRoles/` Expert 文件中的三处「通用约定」（TDD 专家一处、QA 专家两处，其中 QA 两处由既有契约测试逐字固定），以及 `AGENTS.md`「GitHub 与安全」与 §9/§5 的近同义条款（TASK-CMDSURF-025 要求 `AGENTS.md` 与 `docs/CONVENTIONS.md` 均明确同权与无 CI 协议），二者均需另行授权。字节：常驻加载的 `AGENTS.md` −184 B，按需读取的 playbook +40 B，合计 −144 B；新增两条契约测试固定删除项、保留项、承接原文与 playbook 指针。

## [v3.7.27] - 2026-10-05

- `AGENTS.md`「修改与交付门禁」清理延后句去除与 `docs/CONVENTIONS.md` §6 重复的命令片段，规则含义不变：原句的「通过 `task transition --defer-cleanup-step <id> --cleanup-evidence "<独立性与保留措施>"`」（保留于 §6 的 `transition ... --defer-cleanup-step S5 --cleanup-evidence ...` 示例，及同条的「仅限有结构化失败证明 `not_started` 的 `blocked` 步骤」「不得用于测试、验收、权限审批、发布前置条件或结果未知的副作用」等适用条件）改为指向 `docs/CONVENTIONS.md` §长任务状态文件 的条件与证据要求；「独立清理失败不得自动升级为交付前置条件」与「不改变失败状态、不重试被拒绝操作、不豁免测试或最终完成门禁」仍留在 `AGENTS.md`（后者的「最终完成门禁」宽于 §6 的「`task finish` 仍要求清理完成」，不能并入）。`AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md` 的三处「通用约定」指代与一处「并核实过滤参数」改为显式指向 `docs/CONVENTIONS.md` §测试范围与证据复用（过滤参数核实保留于该节运行器段「确认测试运行器支持所用过滤参数」），playbook 其余文字不变。经核对不改动：`AGENTS.md`「开发 worktree 的未提交内容…」整段（`tdd push --committed-only` 与 `CLEANUP_STATUS=PRESERVED` 在 §5/§6 均无正文）、`AGENTS.md` 的 `task exec` 使用规则（§7 仅登记语法，AGENTS 句另含触发阈值与 8KB/80 行摘要上限，且与 `agent-task.js` 默认值一致）。字节：常驻加载的 `AGENTS.md` −66 B，按需读取的 playbook +147 B，合计 +81 B；新增三条契约测试固定删除项、保留项、指针与承接原文。

## [v3.7.26] - 2026-10-05

- `AGENTS.md`「修改与交付门禁」与 `AgentRoles/QA-TESTING-EXPERT.md` 去除已在 `docs/CONVENTIONS.md` §8 有同义正文的重复子句，规则含义不变：`AGENTS.md` 测试入口句的「`task exec` 会在启动前拦截聚合测试命令」（保留于 §8 运行器段，并带「只有事先记录了匹配命令和触发依据的 `mode=full` 决策才放行」的放行条件）；QA 专家「测试执行」条的「检查完整 diff、调用方和依赖，按影响范围选择测试」（保留于 §8 首段）、「记录命令、退出码、覆盖范围和未运行项」（保留于 `TEST_SCOPE_DECISION` 的 `commands`/`impact_paths`/`not_run` 与 `TEST_SCOPE_RESULT` 的 `exit_code`）、「不得将未运行项记为通过」（保留于 §8 末段「未运行项不得记为通过」）；整条「局部变更」的三类场景（保留于变更影响表前三行）；「高风险变更」条的「全局样式追踪受影响页面」（保留于变更影响表局部样式行）、「高风险标签不自动触发全量」与「记录具体依据及全量的应用/测试类型」（保留于 §8「全量」段）；「证据复用与停止条件」条的「必需验证通过后…不继续扩大或重复测试」与「时间限制不能豁免必需项」（保留于 §8 末段，条目名随之收窄为「证据复用」）；QA 门禁第 1 项的「范围不明先调查再决定升级」（保留于 §8「全量」段第三类触发「（不猜测范围）」与变更影响表高风险行「先界定影响范围，再判断是否升级全量」）。「测试执行」条改为指向 §8 的括注，QA 专家保留高风险域清单（含 §8 未逐项列出的「跨模块联动」）、`TEST_SCOPE_*` 审查职责与「只补新增或失效范围」、门禁四项及「禁止执行 `/qa verify`」；`TEST_SCOPE_DECISION/RESULT` 字段与枚举、§8 变更影响表及全部必须/禁止类规则原样保留；新增契约测试逐条固定各删除项的承接与保留项。

## [v3.7.25] - 2026-10-05

- `docs/CONVENTIONS.md` §8 去除五处已在同节或 `AGENTS.md` 中有逐字副本的重复子句，规则含义不变：首段「进入 QA、创建 PR 或命中高风险标签也不能单独证明需要全量」（保留于「全量」段「均不能单独触发全量」）；「遇到范围不明先调查，仍不明再升级，不猜测范围」并入第三类全量触发「（不猜测范围）」；「大日志留在任务 evidence」（保留于 `AGENTS.md`「完整日志写入任务 evidence」与 §6 `evidence/` 目录）；QA 复用段重复的「提交前运行可用受测文件摘要核对」并入记录段「（可用受测文件摘要核对）」；运行器段「按上段记录触发依据」（保留于同段 `task exec` 放行条件与记录段 `full_trigger`/`trigger_evidence`）。变更影响表、`TEST_SCOPE_DECISION/RESULT` 字段与枚举、示例命令及全部必须/禁止类规则原样保留；新增契约测试固定各保留项与删除项。

## [v3.7.24] - 2026-10-04

- `docs/CONVENTIONS.md` §8 删除已在 `AGENTS.md`「修改与交付门禁」「GitHub 与安全」、TDD 专家（数据库与迁移、语义审查）和架构数据标准中有正式副本的四个段落（交付流水线与 completion guard、数据库 schema 变更、迁移注册表、高风险域），官方息壤源 `tdd sync` 版本递增段落缩为一句话并指向 `source-version-sync.js`；`### 测试范围与证据复用` 标题、影响范围表、四类全量触发与 `TEST_SCOPE_DECISION/RESULT` 规范保持不变。§5 回执段落补充「回执不跨电脑共享，换电脑合并须重新 `qa verify`」，原跨电脑语义不丢失；新增契约测试固定保留项、删除项与各正式副本。

## [v3.7.23] - 2026-10-04

- Node/Go 通用 OSS 适配兼容未开启、开启及暂停版本控制：缺少版本头规范化为 null，新增可选固定版本读/核验/删及包含删除标记的完整分页，权限或状态异常中止；保留独立最终文件与暂存重放保护，不回灌项目配置或迁移。

## [v3.7.22] - 2026-10-04

- `docs/CONVENTIONS.md` 删除与 `AGENTS.md`“上下文预算与阶段交接”重复的 §11（仅留一行指向）以及「失败分类与恢复」章节；失败分类（`tool_error|policy_denied|unknown_result`）、启动状态证据与恢复规则并入 `AGENTS.md`“长任务断点续跑”作为唯一来源，`.codex/README.md`、TDD playbook 引用同步改指 `AGENTS.md`，相关契约测试随之更新。

## [v3.7.21] - 2026-10-04

- `.claude/settings.json` 团队 allowlist 放行稳定入口的本地生命周期命令（`pnpm agent -- task start|checkpoint|resume|context|extend|transition|finish|paths`、`worktree new|list|resume`、`tdd sync`、`qa plan`、`qa verify`）；`tdd push`、`qa merge`、`finish`/`tdd finish`（自动串联 push 与 merge）、`worktree bootstrap`（执行依赖安装）、`task exec`、`task cancel`、`test`、`build`、`ship`、`template` 等有远端、部署或任意命令执行副作用的入口仍需确认。新增 `claude-settings-allowlist.test.js` 契约测试，`.claude/README.md` 同步说明。

## [v3.7.20] - 2026-10-04

- `tdd push` 生成 PR 概要、变更内容与标题时排除同步配置主干产生的 merge 提交；分支上还有其他提交时，工作区自动提交的文件清单不再写入概要、也不影响标题判定（仅剩一个人工 Conventional 提交时直接用其标题），只有自动提交时仍保留文件清单。

## [v3.7.19] - 2026-10-04

- 子进程被信号终止时 `pnpm agent`、`github-auth-run.js`、`tdd finish` 及 worktree/TDD 入口按 `128+信号号` 非零退出，不再把 `status=null` 当作成功；`pnpm agent` 只把 `--` 之前的 `-h`/`--help` 视为自身帮助，透传给下游运行器的参数不再被拦截。
- `tdd push`、`qa plan|verify|merge`、`worktree remove|cancel|resume|bootstrap`、`template sync|update|backfill`、devops 运行器等有副作用的入口被直接调用时，`--` 之前的 `-h`/`--help` 只打印用法并退出，不再被当作普通参数继续提交、推送、合并或改写文件。
- 移除从未接入且依赖未分发钩子源的 `install-git-hooks.js` 与 `pre-commit`，模板迁移按基线删除未修改的旧安装器；需要提交前检查的项目改用 `agent.config.json` 的 `tdd.projectChecks` / `qa.projectChecks`，由 `tdd sync` 与 `qa verify` 强制执行，不受 `--no-verify` 绕过、无需逐机安装。
- 删除源仓库残留的其他项目 GitHub workflow；根 `pnpm test` 纳入 `architecture/__tests__/*.test.mjs`，并以契约测试防止测试文件漏出聚合脚本；存储模块声明 ESM，消除 Node 模块类型重解析告警。
- `docs/CONVENTIONS.md` 补全 `remove` 策略与 manifest 兼容写法说明；`[Unreleased]` 历史条目归档到实际发布版本，官方源 `tdd sync` 递增版本时同步把 `[Unreleased]` 条目移入对应版本标题。
- `docs/data` 全局测试矩阵补齐 3.5–3.7 模块登记。

## [v3.7.18] - 2026-10-04

- PRD ↔ ARCH 追溯检查扫描 `docs/prd-modules/<domain>/` 下全部直接子级 Markdown 文档（含拆分规格），不再只读取模块 `PRD.md`；仅正式需求标题中的编号计为定义。

## [v3.7.17] - 2026-10-04

- `tdd push` 旧 PR 升级覆盖 3.7.14 生成的无标记正文（概要取提交要点、变更内容列 sha7）：与按分支提交重建的内容逐字一致时升级为带摘要标记的块，已修改或所列提交已不在分支上时保持原文。

## [v3.7.16] - 2026-10-04

- `tdd push` 自动概要起始标记记录内容摘要，人工修改过标记内文本时不再覆盖并给出提示；早期无标记但仍为自动格式（概要只有 PR 标题）的 PR 在再次推送时升级为带标记格式；工作区自动提交的正文逐条列出改动文件，概要不再只剩标题。修复 `git status --porcelain` 首行状态列被 trim 截断的问题。

## [v3.7.15] - 2026-10-04

- `tdd push` 自动生成的「概要」「变更内容」包在 `xirang:auto-summary` 标记内，已有 PR 再次推送时按当前分支提交刷新标记内文本，标记外手写内容与无标记的旧 PR 保持不变；`qa merge` 解析概要时忽略 HTML 注释行。修复 Review Gate 替换后吞掉下一章节前空行的问题。

## [v3.7.14] - 2026-10-04

- `tdd push` 新建 PR 时读取分支相对配置主干的提交：「概要」取提交正文中的 `-`/`*` 要点（无要点时取提交标题，无提交时回退为 PR 标题），「变更内容」列出短 SHA 与提交标题；分支只有一个 Conventional 提交时直接用其标题作 PR 标题。`qa merge` 以概要作为 squash 提交正文，合并记录不再只有一行。

## [v3.7.13] - 2026-10-04

- `qa merge` 的远端 squash 合并（gh CLI 与 GitHub API）与本地降级使用同一提交格式：标题为 `PR 标题 (#编号)`，正文为 PR「概要」段，不再落入 GitHub 默认的逐提交列表。

## [v3.7.12] - 2026-10-04

- `qa merge` 摘要的「策略」按实际合并后端显示：gh CLI 为 `gh pr merge --squash`，GH_TOKEN 走 GitHub API 时为 `GitHub API squash merge`，降级时为 `本地 git merge --squash`；本地 squash 提交信息不再硬编码 `Co-Authored-By: Claude Opus 4.6`，模板对 Codex 与 Claude 等执行器保持中立。

## [v3.7.11] - 2026-10-04

- `tdd push` 在本机缺少 gh CLI 时改用 `.env.local` 的 `GH_TOKEN` 走 GitHub API 创建 PR（base 为配置主干）或同步已有 PR 的 Review Gate，与 `qa merge` 共用 `infra/scripts/shared/github-api.js`；gh 与 GH_TOKEN 都不可用或 PR 创建失败时输出 `STATUS=BLOCKED` 并非零退出，不再只打印手动链接后静默成功。自动提交信息与 PR 标题按分支前缀（feature/fix/docs/refactor/test 等）生成 Conventional 类型并去掉末尾日期，不再出现 `chore: auto-commit before /tdd push`。

## [v3.7.10] - 2026-10-04

- 修复合并证据门禁：fixed-commit 下历史阻塞记录仅降级严重度或改为条件通过、未明确关闭/达标时阻断；严格模式（含 project）同样按 `qa.mergeEvidence.qaModulesDir`、`nfrTrackingFile` 读取证据；fixed-commit 发布结论的 P1 未修复/修复中统计与严格模式一致。

## [v3.7.9] - 2026-10-04

- 合并证据保持默认严格，新增项目显式启用的 `qa.mergeEvidence.mode=fixed-commit`：从 QA 回执的固定 base/head Git 快照检查新增或变化的阻塞、证据删除与未闭环记录，并单独输出发布结论。逐记录语义指纹避免无关文档修改误阻断；证据路径可配置且非法输入 fail closed。模板同步/update 的 Git 测试夹具固定换行；既有 Codex 维护分支兼容只做回归，不增加或推荐新的分支命名。

## [v3.7.1] - 2026-10-01

- 首次应用与后续更新息壤时自动补齐缺失的 `RULES.md`；已有文件（含空文件）保持原样，初始化后由项目维护。模板接入允许补齐缺失规则，创建后仍须完整预读再执行其他项目操作。

## [v3.7.0] - 2026-10-01

- 增加 Drizzle ORM/Kit 稳定组合，补齐任务 API、身份权限、文件 CAS、pg-boss 同库事务与原生迁移检查；Prisma 扩展 PostgreSQL、MySQL/MariaDB、SQLite。独立 schema、历史和驱动禁止自动转换，保留项目定制与旧 SQL。
- 官方源交付同步自动递增整体/独立架构版本，保留更高显式版本且重复同步幂等；整体模板与 Agent 发布清单同步为 `3.7.0`，独立架构能力包为 `3.5.0`；数据库差异、目录、原生迁移与验证限制见架构文档。
- 模板从 linked worktree 更新实际项目时，六个环境文件检查与缺失补建以目标项目主 `repo` 根目录为准；已有内容保持不变，实际文件从主 repo 对应 example 初始化，dry-run 不写入并报告目标路径。

## [v3.6.2] - 2026-09-28

- 测试范围默认按影响定向选择；全量仅在四类有证据的条件下升级。TDD 执行前记录结构化决策，QA 复核并复用有效结果；实际项目 `qa verify` 在签发 SHA 回执前校验证据与当前提交，纯文档任务可只提交静态/契约检查结果。
- 移除 Codex 侧无效的 `SessionStart` `GH_TOKEN` 环境注入钩子。Codex 不提供 `CLAUDE_ENV_FILE`，且 Hook 输出不能修改父进程环境；模板迁移会显式删除旧 `.codex/hooks.json`，Windows/macOS/Linux 的远端 GitHub 操作统一使用跨平台 Node 鉴权入口读取 `.env.local`。
- 修复阶段交接导致已授权任务停顿：PRD→ARCH→TASK→TDD→QA 默认刷新胶囊后连续推进，转换、恢复和胶囊统一输出自动续跑状态及精确 task ID 恢复命令。确需换执行器时先确认接管，宿主无交接能力且预算允许时在当前任务继续；保留未知副作用、真实阻塞、QA 和 completion guard，并增加跨进程完整阶段与中断恢复回归。

## [v3.6.1] - 2026-09-24

- 修正 `3.6.0` 迁移清单遗漏，显式删除状态模板和 `agent-state-utils` 实现及旧测试，确保旧消费者同步后不会残留已废弃入口。

## [v3.6.0] - 2026-09-24

### 移除 tracked 阶段状态文件

- 删除 `docs/AGENT_STATE.md` 和状态模板；分支、PR、步骤、重试、QA 回执与部署结论只保存在 task state、worktree session 和权威报告。
- `tdd push`、`qa plan`、`qa verify` 不再写阶段状态 Markdown；`qa merge` 不再读取或更新该文件。
- 删除 `agent-state-utils.js` 运行态写入入口；共享 Markdown 扫描器改为只读模块。
- AGENTS、专家、Handbook 和模板文档移除 `AGENT_STATE` 里程碑回流指令，并增加移除防回归契约。

## [v3.5.0] - 2026-09-23

### 上下文预算与阶段交接

- 新增只读 `task context`：按字节上限生成任务目标、阶段、验收、当前步骤、最近证据和下一动作胶囊，不创建目录、锁或状态。
- 新增 `task exec`：完整 stdout/stderr 写入任务 evidence，自动去除 ANSI，只回传退出码、耗时、日志路径、SHA-256 和有界摘要。
- `task transition` 增加 `CONTEXT_HANDOFF_REQUIRED` 与 `CONTEXT_COMMAND`，要求阶段边界在新执行上下文中继续。
- AGENTS、CONVENTIONS、阶段专家和 Codex 配置示例增加 180k 工作阈值、70% 缓存门禁、默认 4k 工具输出和约 8KB 长命令摘要预算。
- TDD/QA 改为使用任务胶囊和模块点读，不再要求全文加载 `docs/AGENT_STATE.md` 或大型阶段文档。

### 任务记录与 worktree 交付

- 缺少 lock 的旧消费者可显式指定 `--legacy-baseline <ref>`，按固定 Git 提交迁移未改动的模板 overwrite 文件；保留漂移阻断、项目所有权和已有 lock 优先。增加真实安装副本的模板边界回归，确认不依赖完整架构源码。
- 修复 Windows 匿名 Git 环境使用 Node 扩展空设备路径导致配置读取失败；改用 Git 可识别的 `NUL`，保留凭据隔离、禁止认证重试与 HTTPS 限制，并增加真实 Git 配置回归。
- 修正 TDD 手册仍默认落盘核查产物和任务帮助把工作类型称为只读类型的残留指引；通用约定直接提供跨执行器失败恢复协议，记录不可用时继续独立只读工作，保留修改与授权门禁。
- 允许开发 worktree 保留本地未提交内容并合并已验证提交；增加 `tdd push --committed-only`，合并后保留未提交内容并单独报告清理状态。
- 单会话只读核查不再因步骤数量强制创建或恢复任务记录；六阶段统一引用持久化触发规则，修改和需恢复的副作用仍保留任务门禁。
- 新增只读 `pnpm agent -- task paths [--task <id>]`，列出主项目、任务状态与锁目录，明确路径解析不等于权限授权；更新容器可写范围与策略拒绝说明，记录不可用时继续获准的独立只读检查。
- 任务 checkpoint 增加普通工具故障、策略拒绝、未知结果的结构化证据和只追加恢复历史；未知执行结果先核验，恢复必须提供依据，不自动重试或修改平台权限。
- 明确任务记录自身不可用时的最小证据协议、生命周期操作拆分和恢复边界，纠正 Codex never 等于所有命令放行的说明。

## [v3.4.3] - 2026-09-11

### 状态文档边界与验收索引修复

- 旧 `IN_PROGRESS` 字段的读写与清理限定到真实章节，空值不跨行，保留区外内容、代码示例、字段名和换行；相同值与重复清理不写文件。
- QA 里程碑按真实列表项识别，兼容大小写勾选并排除代码块、缩进示例、引用和注释；首次完成与初始化保留换行风格，重复条目或未闭合示例明确报告错误。
- 对齐开源公共能力、文件存储和环境初始化的任务模块、索引、总纲及追溯状态，引用已有 QA 证据；真实云、外部身份服务和跨平台发布的验证边界保持明确。

## [v3.4.2] - 2026-09-10

### QA 里程碑状态修复

- QA 合并区分首次更新、里程碑已完成、文件缺失和读写失败；过程与汇总使用同一状态说明，已完成时不再误报失败。
- 已完成的 `AGENT_STATE.md` 保持内容与修改时间不变，不生成重复状态提交；缺失文件提示跳过，真实读写失败保留原因。
- 补充文件操作与合并汇总回归，覆盖首次完成、重复合并、条目初始化、文件缺失和读写错误。

## [v3.4.1] - 2026-09-10

### 轻量架构检查与模板写入边界修复

- TDD/QA 架构检查共用轻量 CLI 的固定来源校验，从缓存运行所选项目检查；损坏或缺失的来源指针和缓存明确阻断，旧全量布局及未选择架构的项目保持兼容。
- 模板更新和冻结计划写入均拒绝 Git 主 worktree、息壤源角色目标；专用 linked worktree 和独立空目录仍可正常初始化与更新。
- 无效 scope/include 明确报错；模板和架构计划文件必须保存到项目及其主 worktree 以外，拒绝符号链接绕过并避免覆盖项目文件、版本锁或 Git index。
- 修正 TDD 手册的轻量架构标准入口和发布日志责任，补充实际消费者的共享检查与写入边界回归。

## [v3.4.0] - 2026-09-10

### 轻量架构入口与按需生成

- 实际项目仅安装架构 README、catalog/schema、选型 metadata、来源指针和 CLI；未选技术模板、示例、Registry 实现与测试留在源仓库或可重建缓存。作业包可继续独立使用。
- 固定官方提交、版本与内容摘要；缓存原子发布、并发互斥、离线命中校验，缺失时匿名获取同一提交，损坏与来源漂移明确阻断。目录按实际项目的主 worktree 解析，standalone 同样支持。
- 保留 catalog/detect/plan/init/update/check、冻结 apply 与恢复入口，代码和依赖只按已选择的应用、模块及依赖闭包生成。普通模板同步不会启用新的技术选择。
- 3.3 全量 runtime 仅在文件未偏离基线时缩减；业务定制与未知文件保留。新 lock 持久化后才清理失去全部引用的旧 baseline，中断可恢复。
- 完成原始 3.3 两类升级与实际 Web 消费验证；使用约定、架构专家入口和测试追溯同步更新。未改变现有组件选型或默认安装版本。

## [v3.3.0] - 2026-09-09

### 开源公共能力与存储

- 提供 Better Auth/Prisma、CASL、pg-boss/BullMQ Redis/PostgreSQL、i18next、Pino、OpenTelemetry 追踪、MSW 的按需生成实现与使用指南；配置、业务策略和词条保持项目所有。
- 新增 shadcn 身份面板、任务状态、Uppy 上传、Tiptap 编辑、Recharts Chart、dnd-kit 排序、React Flow 与 TanStack Virtual 表格；48 项 Registry，复用唯一 DataTable。
- Node/Go 支持 local、S3、阿里云 OSS、腾讯云 COS 原生适配与多存储路由；提供受认证文件会话、上传大小签名绑定、不可变转正键、CAS 元数据及恢复。
- Prisma PG/SQLite 的身份和文件模型独立初始化，迁移只追加；队列迁移单独显式执行。依赖严格检查并固定兼容版本，模板源不安装应用依赖。
- 单模块采用/更新补齐相关应用和数据源依赖；新增完整选型目录、Monorepo 配置示例、真实消费者与升级测试。备选组件与真实云/外部 IdP 验证边界明确记录。

## [v3.2.0] - 2026-09-09

### 多端 Monorepo 与 Prisma

- 新增 v2 架构选择、pnpm workspace、共享包 exports 和四种可展开蓝图；目录按项目配置，v1 项目保持兼容。
- 新 Node TypeScript / Prisma 7.10 数据访问包支持 PostgreSQL、SQLite，独立客户端/环境/迁移历史；迁移完整性守卫阻断历史缺失、改写和失败状态。
- 提供 OpenAPI 3.1 类型与运行时校验、无 React API client、Query 缓存、配置与观测、AppShell 和 Browser/Tauri 平台适配。
- 任务示例通过公共 shadcn DataTable 联动真实 API，支持分页、多列排序、筛选、多选、CRUD、导出、权限和并发失败恢复。
- YAML 三方更新保留项目键与注释；业务 schema/合约/页面仅初始化、迁移只追加、包管理器持有依赖锁。真实 3.1 升级保留定制并收敛。
- 固定兼容安全依赖覆盖；模板源保留源码、生成器与必要 updater 工具，应用依赖只在选定消费者安装。验证与限制见 docs/qa-modules/monorepo-platform/QA.md。

## [v3.1.0] - 2026-09-09

### 公共交互组件

- 提供 FormField/Section、FormDialog/Sheet、可选 React Hook Form 适配；统一字段关联、提交防重、失败保留、未保存关闭确认和焦点恢复。
- 提供本地单选/多选、异步搜索选择、日期/日期范围、确认对话框、异步按钮、加载/空态/错误状态及通知，继续由 shadcn 基础组件组合实现。
- DataTable 复用公共确认和状态，增加受控多选与日期范围列筛选，保留原有 Props、稳定选择、CRUD 和导出合约。
- 新增 9 个官方基础组件，合计 33 个基础控件、39 个 Registry 项；依赖与官方来源摘要统一管理。

### 初始化与升级

- 支持 applications[].componentSets 按需选择；默认 DataTable 自动安装其依赖，表单与 React Hook Form 独立可选，显式空集合仅保留基础 UI。
- 组件可放在应用内或 packages/ui；共享消费者合并依赖，初始化、Registry 和架构检查共用同一组件闭包。
- 兼容旧配置默认值与组件 owner ID；取消选择不自动卸载已安装源码及其依赖。旧项目的页面、utils、按钮定制和自有脚本保持保留。
- 修复共享组件重复 React 实例、受控面板关闭焦点和受限视口中日期弹层被裁切的问题；验证范围及证据见 docs/qa-modules/architecture-platform/QA.md 第 8 节。

## [v3.0.1] - 2026-09-09

### 兼容性升级

- 对照官方 Registry 复核全部 24 个 shadcn 基础组件，采用 cn 0.2.6，并升级 React 19.2.8、Lucide 1.43.0、Next 16.3.4、TypeScript 6.0.3、Vitest 5.0.0 及配套测试/类型依赖。
- 固定版本统一记录于 architecture/dependencies.json；dependency-audit.json 记录最新版本、采用版本和兼容保留依据。TanStack Table 保留最新 V8，TypeScript 使用最新兼容 V6，Node 类型保持 22.x。
- 项目 lib/utils.ts 仅初始化，保留已有 helper；基础控件直接引用 cn，Registry 和应用生成器使用一致依赖。保留 clsx/tailwind-merge 兼容项目导入。
- 适配 TypeScript 6 的路径与显式类型配置，初始化 Next 类型声明以支持构建前独立 type-check。前端 Node 要求与 jsdom/Vitest 对齐为 22.22.2+（22.x）、24.15+（24.x）或 26+。

## [v3.0.0] - 2026-09-09

### 新增

- 分离 agent 作业包、architecture 架构包和 tooling/xirang 通用更新引擎；保留既有作业脚本的兼容路径。
- 按应用/存储选择 Vite、Next、Node、Go、Tauri、PostgreSQL、SQLite，以及契约、迁移、可观测性、资源、插件和私有交付模块。
- 提供架构配置、目录标准、检测、冻结计划、初始化、检查和模块升级命令；应用目录不绑定某一种后端或数据库。
- 内置 24 个 shadcn 基础控件、可发布 Registry 和基于 TanStack 的公共 DataTable，支持分页、多选、排序、筛选、列显隐、导出及真实异步 CRUD 回调。

### 更新与迁移

- 文件按覆盖保护、三方更新、字段合并、幂等追加、受管块和仅初始化策略管理；版本锁和基线随项目提交，运行日志保存在容器 tmp。
- 原生控件、重复低阶表格、目录/别名冲突和迁移摘要变化进入本地架构检查；中断按哈希恢复，源/目标/版本锁漂移时阻断。
- 旧消费者首次缺少基线时需要显式接管。接管保留现有内容作为定制，不等于把所有旧协议直接替换成新版本。RULES.md、业务源码和实际项目文档继续归项目维护。
- 通过 400 项源码回归、生成前端的 8 项交互测试及 Vite/Next 构建、真实浏览器旅程、Node/Go 骨架、macOS Tauri 编译和隔离数据库验证。

## [v2.2.1] - 2026-09-06

### 修复
- 官方公开息壤模板改为匿名 HTTPS 拉取，不读取项目 GH_TOKEN；隔离用户 Git 配置、credential helper、askpass、认证头与 URL 重写。
- 初始化、获取和检出使用同一匿名环境，输出 TEMPLATE_AUTH_MODE；保留固定 SHA、失败阻断及 apply 收敛，项目 GitHub 鉴权不变。
- 匿名下载保留代理/CA 环境变量、开启 TLS 校验且拒绝重定向；真实 HTTP 请求与项目凭据回归覆盖成功和拒绝路径。

## [v2.2.0] - 2026-09-06

### 新增
- 模板正式命名为“息壤”（Xirang），登记稳定 ID、官方 GitHub 仓库与默认分支。
- 新增 `pnpm agent -- template sync`：required fetch 远端、固定 commit SHA，并从远端快照自举最新版 updater。
- 实际项目中的自然语言“更新息壤模板”确定性触发专用 worktree 更新与既有 TDD/QA 交付链。

### 安全与兼容
- fetch、ref 或源形状校验失败时在目标 tracked 写入前阻断，不回退缓存或本地旧模板。
- 模板写入后新增 convergence dry-run；`RULES.md`、业务源码、项目配置等 project-owned 内容继续受 manifest 保护。
- `template.sourceRepo` 保持本地回灌语义，与官方只读上游配置分离。

## [v2.0.0] - 2026-07-12

### Breaking Changes
- PRD、ARCH、TASK、QA 仅保留“主总纲与索引 + module-list + 模块文档”结构，删除单一文档模式及规模阈值分支。
- 主模板统一重命名为 `PRD-TEMPLATE.md`、`ARCH-TEMPLATE.md`、`TASK-TEMPLATE.md`、`QA-TEMPLATE.md`。
- 模板升级会通过受控 `remove` 策略删除目标项目中 8 个废弃的 `SMALL/LARGE` template-owned 文件。

### 更新
- TASK 生成器聚合主/模块 PRD 与 ARCH，校验模块集合一致后固定生成模块 TASK。
- QA 全项目生成固定产出主 QA、模块清单和全部模块 QA。
- PRD、ARCH、TASK、QA lint 在缺少模块目录、模块清单或模块文档时失败。

## [v1.18.12] - 2026-04-20

### 更新
- feat: chore remove rules md

---


## [v1.18.11] - 2026-04-16

### 更新
- feat: fix in progress commit after push

---


## [v1.18.10] - 2026-04-16

### 更新
- feat: in progress tracking

---


## [v1.18.9] - 2026-04-16

### 更新
- feat: tighten post push gate review policy

---


## [v1.18.8] - 2026-04-11

### 更新
- feat: align tdd code review commands

---


## [v1.18.7] - 2026-04-08

### 更新
- fix: qa merge main worktree support

---


## [v1.18.6] - 2026-03-28

### 更新
- fix: qa merge auth token

---


## [v1.18.5] - 2026-03-27

### 更新
- feat: codemap high value scan

---


## [v1.18.4] - 2026-02-24

### 更新
- 发布新版 v1.18.4

---


## [v1.18.4] - 2026-02-17

### 更新
- `/qa merge` 新增自动 rebase 功能：合并前主动将 feature 分支 rebase 到最新 main，避免合并时才发现冲突。含冲突自动中止、force-push 失败回退等边界处理。
- 修正 `QA-TESTING-EXPERT.md` 步骤列表与"15个关键步骤"声明的偏差（原列 13 项，现补齐为 15 项）。

---

## [v1.18.3] - 2025-11-13

### 更新
- 扩充 `AgentRoles/QA-TESTING-EXPERT.md`，新增测试产物管理与测试工具配置检查指南，明确 .gitignore 规则、Playwright/Jest 推荐配置与 QA 预检流程。
- 将包版本提升到 `v1.18.3`，同步发布元数据以便追踪最新 QA 规范。

---

## [v1.18.2] - 2025-11-13

### 更新
- 扩展 `.gitignore`，纳入环境变量、构建产物、IDE 配置、测试缓存等常见临时文件夹，避免误提交个人或生成内容。
- 将包版本提升到 `v1.18.2`，保持发布元数据与当前仓库状态一致。

---

## [v1.18.1] - 2025-11-13

### 更新
- 将包版本提升到 `v1.18.1`，保持发布元数据与当前代码一致。

---
