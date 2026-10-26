# ADR-041：QA 预言机独立于实现，完成以门禁输出为准

- 日期：2026-10-26
- 状态：Accepted
- 关联：承接 [ADR-038](038-arch-business-test-automation.md)「代价」所记“预言机污染只能靠指引、评审与夹具反例降低”；[ADR-032](032-arch-test-scope-evidence-gate.md) 的测试范围证据

## 背景

QA 专家在实际项目里沿代码路径写测试，再自报完成，测试抓不到错。逐项核对后的根因：

1. **预言机污染**：设计入口是 diff，先读实现再推预期；文档还写着“默认不新增测试”。ADR-038 只靠指引缓解。
2. **预期出处只在 `qa.business` 开启时受约束**：日常流程没有出处列，允许的输入不含数据字典与 UX 规范。
3. **文档鼓励最低量**：“至少 2 个断言”“尽量少路径”、同路径共用用例。
4. **能力缺口**：没有不变量、性质、业务状态机、变异测试与缺陷复现；“状态”只指界面，故障注入只写在 TDD 手册。
5. **完成靠自报**：完成检查是勾选清单；`qa verify` 主要检查文件形状；JUnit 自闭合用例算通过，一条通过即判 AC 通过，`classname` 命中会扇出绑定；覆盖准则默认 `none`。
6. **反向模板**：风险与优先级矩阵建议降低覆盖率门槛、跳过 P1/P2、禁用不稳定用例、用录制加速编写。
7. **“禁止放宽断言”只写在 TDD 专家文件**，QA 文件没有；TDD 文件还允许从代码安全推断预期。
8. **QA 专家文件与手册互相矛盾**：裁决口径（Go/Conditional 与 PASS/PASS_WITH_RISK）、用例下限、是否推荐录制。

## 决策

1. **按“谁定预期值”分工，不整体迁移测试编写**：

   | 测试类型 | 谁定预期 | 谁写代码 |
   | --- | --- | --- |
   | 规则、不变量、反例（测试设计） | QA（设计模式） | — |
   | 单元、模块内集成 | QA 规则表 | TDD，测试名引用规则或反例 ID，不得改预期 |
   | 跨模块黑盒集成、API 业务流、性质、业务状态机、故障注入、E2E | QA | QA（黑盒模式），只调公开接口 |
   | 有效性审计（完整性、变异、缺陷复现、不稳定用例） | QA（审计模式） | QA，可读实现，不改预期 |

2. **QA 三种模式**：设计模式在实现前只读规格，产出 `docs/qa-modules/<domain>/TEST-DESIGN.md` 并单独提交 `test(design): <模块> 规则与反例`；黑盒模式按设计写测试；审计模式读实现找缺口，新增规则只能追加行或经评审修改。
3. **测试设计三张表**（模板 `docs/data/templates/qa/TEST-DESIGN-TEMPLATE.md`）：
   - 规则表 `RUL-{MODULE}-NNN`：类型 `rule|invariant|forbidden|pre|post|undefined`，验证方式 `example|property|state-machine|fault|manual`；出处只允许 `AC-*`、`INV-*`、`docs/**.md#锚点`，`推断：<理由>` 只计风险并回流 PRD。
   - 反例目录 `ADV-{MODULE}-NNN`：维度 `auth|state|boundary|concurrency|dependency|time|input`；每条 P0 规则在前五个维度各有一行，不适用写明理由。
   - 缺陷复现 `BUG-{MODULE}-NNN`：来源 `qa-design|qa-redteam|qa-audit|user|prod`，复现用例须修复前失败、修复后通过。
4. **PRD 模块新增可选「不变量与禁止行为」表** `INV-{MODULE}-NNN`，类型 `invariant|forbidden|pre|post`，承载跨 Story 恒成立的规则。
5. **预期值出处与完整性写入通用约定**（`docs/CONVENTIONS.md` §8）：预期只取 PRD 原子 AC、数据字典、UX 规范、ARCH 接口契约与 QA 测试设计；修复失败测试时不得放宽断言、改写字面预期、删除测试、减少断言或新增 skip/only；必需用例被跳过即未通过；完成以适用门禁的 `STATUS` 为准，清单自报不是证据。
6. **裁决只保留 `PASS|PASS_WITH_RISK|BLOCKED`**，删除 Go/Conditional 语义；指标以 P0 规则验证数、反例维度覆盖、缺陷复现、新发现缺陷与不稳定率为主，覆盖率只作辅助。
7. **反向模板改正**：矩阵模板不再建议降低门槛、跳过必需用例、禁用不稳定用例或录制加速；未执行项记为未验证，不计通过。

## 门禁路线

本 ADR 随第一个 PR（只改文档）落地，以上决策只靠专家文件与模板约束。后续四个 PR 把它们变成确定性门禁，每个都有正反夹具；所有门禁输出 `STATUS`、`SUMMARY`、`NEXT_ACTION`，`warn` 只披露风险，`enforce` 阻断：

| PR | 门禁 | 要点 |
| --- | --- | --- |
| 完整性 | `qa integrity` | 对 base..HEAD 的测试文件比对：新增 skip/only/todo 阻断，删除测试、用例数或断言数下降须有豁免证据；绑定 P0 的用例 skipped 阻断。同时收紧现有门禁：只按 JUnit `name` 绑定、AC 的全部绑定用例通过才算通过、自闭合用例不计通过、未声明覆盖准则阻断、`qa verify` 找不到目标 fail-closed、TEST_SCOPE 证据须引用 `task exec` 日志摘要。模板源同样执行 |
| 测试设计 | `qa design context/check/amend` | 解析三张表；P0 规则须有通过的用例与五维反例；设计提交须早于第一个源码提交；已有行的陈述或预期被改须有 amend 证据。提供只接收规格材料包、无文件读取工具的设计与红队子代理；没有子代理的执行器退化为提交时序约束，报告 `DESIGN_ISOLATION=subagent|commit-order` |
| 重复与复现 | `qa run --repeat N`、`qa repro --bug <ID>` | 同一用例 N 次结果须一致，P0 不一致即阻断；在临时 detached worktree 中用 base 实现跑新测试须失败、HEAD 须通过 |
| 变异 | `qa mutate run/accept` | 只对变更文件跑项目配置的变异命令，解析 mutation-testing-report-schema；分数低于阈值或绑定 P0 的用例一个变异体都没杀死即阻断；默认关闭 |

“三道过滤”对应：套件可运行 → 重复 N 次结果一致 → 变异击杀（未启用变异时只把覆盖率增量记为风险）。

## 取舍与后果

- 拒绝把单元与集成测试整体迁给 QA：会让 QA 依赖实现细节，反而加重污染。只收回预期值所有权，并把跨模块黑盒集成划给 QA。
- 修正 ADR-038 对套件退出码的取舍：ADR-038 拒绝“非零退出一律阻断”，理由是低优先级用例失败也会使驱动整体非零，这一点仍成立。完整性 PR 只在必需套件非零退出、且报告中没有失败用例能解释该退出时阻断，其余仍按 AC 绑定判定。
- 盲测只能程序约束子代理的工具与提交时序，不能证明主代理没读过实现；模板不宣称更强的保证。
- 完整性检查基于正则，可被 `if (false)` 一类写法绕过，由变异门禁兜底；变异门禁默认关闭，未开启的项目只得到前两道过滤。
- 文件名 `TEST-DESIGN.md` 含子串 `DESIGN.md`，与 ADR-037 的界面视觉契约在文本检索上相撞；不在任务规划、运维及通用约定类文件中写出该字面文件名，由 `template-surface.design.test.js` 约束。
- 文档 PR 不新增命令与配置，不改变任何门禁结果；`TEST-DESIGN.md` 与 `INV-*` 表在测试设计门禁落地前只受评审约束。

## 实施记录

### 完整性 PR（`qa-integrity-gate`）

- 新增 `qa integrity check|waive`：阻断 `TEST_SKIP_ADDED`、`TEST_ONLY_ADDED`、`TEST_CASES_DECREASED`、`TEST_ASSERTS_DECREASED`、`TEST_FILE_DELETED`、`TEST_WAIVER_INVALID`，改字面预期记 `TEST_EXPECTATION_CHANGED` 风险；豁免只覆盖后三类下降，绑定文件内容摘要并写入任务证据。`qa.integrity.mode` 默认 `enforce`，模板源同样执行。
- `qa verify` 裁决改为 `QA_VERDICT=PASS|PASS_WITH_RISK|BLOCKED` 并写入回执；找不到目标以 `QA_TARGET_MISSING` 阻断，`--no-module --reason` 显式放行记为风险。
- 业务门禁：只按 JUnit `name` 绑定，仅 classname 命中记 `RISK_CLASSNAME_ONLY`；AC 任一绑定用例失败或跳过即不通过；必需套件非零退出且报告中没有失败用例时以 `SUITE_EXIT_UNEXPLAINED` 阻断；PATHS 未声明覆盖准则以 `CRITERION_MISSING` 阻断。
- TEST_SCOPE 的 `checks[].evidence` 必须引用 `task exec` 日志并校验 sha256。
- `qa merge` 与 `tdd finish` 删除 `--skip-checks`，传入即在副作用前失败（原计划保留参数并降为风险，审读后它只用于跳过门禁，故直接移除）。
- 与路线表的偏差：
  - 未实施“自闭合用例不计通过”：多数 JUnit 报告器把通过的用例写成自闭合 `<testcase/>`，无法据此区分未执行；未执行由跳过判定与后续重复、变异门禁兜底。
  - `qa automate` 未改：其完成态（步骤 5）已由 JUnit 结果判定，步骤 3 的文本扫描只提示“用例已写”，文案已注明不算覆盖。
  - “绑定 P0 的用例 skipped 阻断”由业务门禁的 AC 判定承担，不在完整性门禁中重复解析 JUnit。

### 测试设计 PR（`qa-design-gate`）

- 新增 `qa design context|check|amend`，`qa verify` 在签发回执前调用 `check`，输出 `DESIGN_GATE`、`RULES_TOTAL`、`RULES_VERIFIED`、`ADV_COVERED`、`DESIGN_AMENDMENTS`、`DESIGN_ISOLATION`，摘要写入回执 `design` 字段。`qa.design` 配置节默认 `warn`（阻断项降为 `DESIGN_RISK`），未知键以 `DESIGN_CONFIG_INVALID` fail-closed；模板源输出 `DESIGN_GATE=SKIPPED`。
- G1 阻断码：`TABLE_MISSING`、`TABLE_DUPLICATE`、`ROW_INVALID`、`ID_DUPLICATE`、`SOURCE_CODE`、`SOURCE_INVALID`、`SOURCE_UNKNOWN`、`SOURCE_UNCOVERED`、`PRIORITY_LOWER`、`TC_MISSING`、`TC_UNPROVEN`、`RESULTS_UNAVAILABLE`、`DIMENSION_MISSING`、`REFERENCE_UNKNOWN`。`推断：` 出处、`undefined` 规则、`manual` 验证、未修复缺陷与头部缺失只记风险。TC 证明读取当前 HEAD 的 `qa run` 结果，`enforce` 项目须先跑 `qa run`。
- G2 以 `ORDER` 阻断：本分支新增的设计行须早于 `qa.design.sourceGlobs` 命中的首个源码提交；审计模式事后补行须用 `amend` 登记“新增”，降为 `ADDED_AFTER_SOURCE` 风险。
- G3 以 `EXPECTATION_CHANGED` 阻断未登记的改写或删除，以 `AMENDMENT_REMOVED` 阻断改写已提交的变更记录；修改与新增须给合法新出处，`DESIGN_AMENDMENTS` 只计修改与删除。
- 子代理 `.claude/agents/xirang-qa-designer.md`、`xirang-qa-redteam.md` 以 `overwrite` 分发。Claude Code 省略 `tools` 即继承全部工具，故用 `tools: Read` 加 `disallowedTools: Read` 得到零工具；材料包由主代理内联，子代理只返回表格行。
- 与路线表的偏差：
  - 头部 `设计材料包：sha256=…` 只校验格式、供追溯，不与当前材料包比对：规格演进后旧摘要仍合法，比对会把正常回流误报为阻断。
  - `DESIGN_ISOLATION` 取自各设计文件头部声明，另有 `NONE`（无设计文件）、`UNDECLARED`、`mixed`；它是自报值，程序约束只来自子代理零工具与 G2 时序。
  - 改动 `docs/qa-modules/<域>/` 会推断出 QA 模块，要求该域存在 `QA.md`，沿用 `qa verify` 既有语义。

## 迁移

- 存量项目同步本次模板后无需改动即可通过现有门禁；新模块按 PRD 模板补「不变量与禁止行为」表，并从 `TEST-DESIGN-TEMPLATE.md` 复制测试设计。
- 测试设计门禁 `qa.design.mode` 默认 `warn`，先披露缺口；项目补齐测试设计并接入 `qa run` 后再改为 `enforce`。项目若已有同名 `.claude/agents/` 文件，模板同步因无可信基线阻断，须先改名或显式接管。完整性门禁默认 `enforce`，属破坏性变更，在对应版本的 CHANGELOG 中标注；存量项目可先设 `qa.integrity.mode=warn` 只披露风险。脚本或 CI 中调用 `qa merge --skip-checks`、`tdd finish --skip-checks` 的须删除该参数；旧任务的 `TEST_SCOPE_RESULT` 自由文本证据须用 `task exec` 重跑补录；PATHS.md 须显式声明覆盖准则。
