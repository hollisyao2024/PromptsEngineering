# 业务测试自动化 PRD

主纲：[PRD](../../PRD.md)。状态：已确认。日期：2026-10-06。用户授权：2026-10-06 明确要求息壤模板支持大模型依据 PRD 推导页面与客户端的业务操作路径并自动化完成测试，并据此修改模板。

## 1. 模块概述

实际项目的大模型在创作期把 PRD 的原子验收标准（AC）推导为“界面—状态—转移—路径”的业务操作路径模型，再按覆盖准则与测试设计技术生成数据驱动用例；脚本负责校验路径模型、运行测试套件、按用例名中的 AC/TC 标识绑定结果，并在 `qa verify` 门禁判定。执行与判定不经过模型，期望值只来自规格，不来自被测代码的当前输出。

覆盖端：Web 页面与 mac、win、ios、android 客户端。统一接口只有三项：JUnit XML 报告、用例名携带 AC/TC 标识、套件的 `platform` 标签；具体驱动（Playwright、Maestro、XCUITest、Espresso 等）由项目选择，模板不绑定。

## 2. 范围与约束

范围：规格契约（原子 AC 清单、TC 标识统一）、业务操作路径模型及其校验（`qa paths`）、套件执行与结果绑定（`qa run`）、业务验收门禁（`qa verify` 增量）、QA 生成指引与四个角色文件同步、闭环验证夹具。

非范围：脚本调用任何 LLM API；E2E/客户端驱动脚手架与初始化（后续由 architecture 包提供）；突变测试、断言质量 lint、flaky 重试策略；性能与安全专项自动化；真实云服务与身份提供方验收（属项目自有）；manual 类 AC 的验收记录门禁（本期只披露风险）。

约束：默认关闭，既有 `qa verify` 行为与输出不变；脚本只读规格文档与测试报告，套件命令仅来自受信配置；运行产物写入容器 `tmp`，不进入 tracked 目录；模板源自身无业务应用，闭环以夹具验证。

## 3. 用户故事与验收

| Story | 说明 |
| --- | --- |
| US-BIZTEST-001 | 规格契约：每条验收独立成行并携带优先级、验证方式与端；测试用例标识统一为 `TC-` |
| US-BIZTEST-002 | 业务操作路径模型：由 PRD 推导，经脚本校验为状态机上的合法游走并满足覆盖准则 |
| US-BIZTEST-003 | 执行与结果绑定：脚本运行套件、按 ID 绑定结果并产出可审计的 `ac-results.json` |
| US-BIZTEST-004 | 业务验收门禁：P0 自动化 AC 未被通过用例证明时阻断，默认关闭保持兼容 |
| US-BIZTEST-005 | 生成指引与不变量：预言机只来自规格，用例数量由覆盖准则、技术与预算收敛 |
| US-BIZTEST-006 | 闭环验证与传播：故意破坏必须使门禁变红，新模板文件按所有权传播且不覆盖项目文档 |

### 原子 AC 清单

列含义：`验证` 取 `auto`（自动化证明）或 `manual`（人工验收）；`端` 为逗号分隔的平台标签（如 `web,ios`），`-` 表示不限端；一条 AC 只断言一个可观察结果。

| AC ID | Story | 优先级 | 验证 | 端 | Given | When | Then | TC |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AC-BIZTEST-001-01 | US-BIZTEST-001 | P0 | auto | - | 模块 PRD 按新模板写出原子 AC 清单 | 脚本解析该清单 | 每条 AC 具备合法 ID、Story、优先级、验证方式、端与 Given/When/Then；缺列或非法值被逐项报告 | TC-BIZTEST-001 |
| AC-BIZTEST-001-02 | US-BIZTEST-001 | P0 | auto | - | PRD、QA 模板与示例 | 对模板源内容扫描 | 测试用例标识统一为 `TC-{MODULE}-NNN`，QA 模板不再使用 `QA-N`，PRD 示例不再把 Given/When/Then 拆成三个 AC | TC-BIZTEST-002 |
| AC-BIZTEST-002-01 | US-BIZTEST-002 | P0 | auto | - | 路径模型按模板写出界面与状态、转移、路径与覆盖准则 | 执行 `qa paths` | 解析出界面、状态、转移（起止状态、操作、守卫、关联 AC）与路径（转移序列、关联 TC）；结构缺失或 ID 重复被报告 | TC-BIZTEST-003 |
| AC-BIZTEST-002-02 | US-BIZTEST-002 | P0 | auto | - | 路径引用不存在的转移或 AC，或相邻转移首尾状态不衔接 | 执行 `qa paths` | `STATUS=BLOCKED`，退出码非零，逐项列出违规 | TC-BIZTEST-004 |
| AC-BIZTEST-002-03 | US-BIZTEST-002 | P0 | auto | - | 声明覆盖准则 `all-transitions` 或 `all-states` | 路径集合未覆盖全部转移或状态，或存在未被任何转移关联的 P0 自动化 AC | `STATUS=BLOCKED` 并列出缺口 | TC-BIZTEST-005 |
| AC-BIZTEST-002-04 | US-BIZTEST-002 | P1 | auto | - | 路径模型合法 | 执行 `qa paths` | `STATUS=OK` 并输出 AC、转移、路径、TC 的覆盖矩阵与计数 | TC-BIZTEST-006 |
| AC-BIZTEST-003-01 | US-BIZTEST-003 | P0 | auto | - | 配置了业务测试套件 | 执行 `qa run` | 脚本逐套运行命令并收集 JUnit XML，记录退出码与产物 SHA256；套件失败、无法启动或缺少报告均不被掩盖 | TC-BIZTEST-007 |
| AC-BIZTEST-003-02 | US-BIZTEST-003 | P0 | auto | - | JUnit 用例名含 AC 或 TC 标识 | 脚本解析报告 | 据标识把 pass、fail、error、skipped 绑定到 AC 与 TC，不依赖模型自述；无标识用例单独计数 | TC-BIZTEST-008 |
| AC-BIZTEST-003-03 | US-BIZTEST-003 | P0 | auto | - | 运行完成 | 写出 `ac-results.json` | 含 HEAD SHA、生成时间、套件命令与退出码与产物哈希、逐 TC 与逐 AC 状态、路径状态与汇总；文件位于容器 `tmp` | TC-BIZTEST-009 |
| AC-BIZTEST-003-04 | US-BIZTEST-003 | P1 | auto | - | 套件声明 `platform` | 绑定结果 | 每条 AC 的状态按端分别记录 | TC-BIZTEST-010 |
| AC-BIZTEST-004-01 | US-BIZTEST-004 | P0 | auto | - | `qa.business.enabled=true` 且存在 P0 自动化 AC | 某 AC 无绑定用例、存在失败或仅有跳过 | `qa verify` 为 `BLOCKED` 并列出该 AC | TC-BIZTEST-011 |
| AC-BIZTEST-004-02 | US-BIZTEST-004 | P0 | auto | - | `ac-results.json` 缺失、HEAD SHA 与当前不一致或产物哈希不符 | 执行 `qa verify` | `BLOCKED` 并提示重新执行 `qa run` | TC-BIZTEST-012 |
| AC-BIZTEST-004-03 | US-BIZTEST-004 | P0 | auto | - | `qa.business.enabled` 为默认值 | 执行 `qa verify` | 行为与既有一致，不读取 `ac-results.json` | TC-BIZTEST-013 |
| AC-BIZTEST-004-04 | US-BIZTEST-004 | P1 | auto | - | 低于必需优先级的 AC 未通过，或验证方式为 `manual` | 执行 `qa verify` | 作为风险披露而不阻断；必需优先级可配置 | TC-BIZTEST-014 |
| AC-BIZTEST-004-05 | US-BIZTEST-004 | P1 | auto | - | AC 声明了端 | 执行 `qa verify` | 每个声明的端须各有通过用例且无失败，否则阻断 | TC-BIZTEST-015 |
| AC-BIZTEST-004-06 | US-BIZTEST-004 | P1 | auto | - | 模块存在路径模型 | 执行 `qa verify` | 声明的覆盖准则须由通过的路径满足，否则阻断 | TC-BIZTEST-016 |
| AC-BIZTEST-005-01 | US-BIZTEST-005 | P0 | auto | - | QA 指引与专家文件 | 对内容扫描 | 明确预言机只来自 PRD AC、数据字典、UX 规范与 ARCH 契约，禁止以被测代码当前输出作期望值，规格歧义回流 PRD | TC-BIZTEST-017 |
| AC-BIZTEST-005-02 | US-BIZTEST-005 | P0 | auto | - | QA 指引 | 对内容扫描 | 含路径推导步骤、覆盖准则、等价类、边界值、判定表、状态迁移、两两组合、按优先级的用例预算与数据驱动用例约定 | TC-BIZTEST-018 |
| AC-BIZTEST-005-03 | US-BIZTEST-005 | P1 | auto | - | 已评审的用例再次生成 | 对刷新策略扫描 | 刷新只新增或提出差异，不覆盖已评审用例 | TC-BIZTEST-019 |
| AC-BIZTEST-005-04 | US-BIZTEST-005 | P0 | auto | - | PRD、ARCH、QA、TDD 角色文件 | 对内容扫描 | 命令表与完成定义同步原子 AC、`qa paths`、`qa run`、测试名携带 AC/TC 标识 | TC-BIZTEST-020 |
| AC-BIZTEST-006-01 | US-BIZTEST-006 | P0 | auto | - | 夹具含 PRD AC、路径模型与可运行套件 | 故意令用例失败、跳过、缺失或结果过期 | 门禁逐一变红，恢复后变绿 | TC-BIZTEST-021 |
| AC-BIZTEST-006-02 | US-BIZTEST-006 | P0 | auto | - | 新增的模板自有文件 | 校验模板 manifest | 均已登记所有权策略；项目自有文档不被模板更新覆盖 | TC-BIZTEST-022 |

## 4. 非功能需求

| NFR | 指标 | 目标 | 验证 |
| --- | --- | --- | --- |
| 确定性 | 同一仓库状态与同一报告 | 路径校验、结果绑定与门禁输出逐字节一致（时间戳字段除外），无随机、无网络、无模型调用 | TDD |
| 兼容性 | 默认配置 | 既有 `qa verify` 输出与退出码不变 | TDD/QA |
| 性能 | 500 条 AC、2000 条用例 | 校验、绑定与判定合计不超过 5 秒（本机） | TDD |
| 安全 | 套件命令与报告解析 | 命令只来自受信配置；报告与文档中的内容不作为命令执行；解析不展开外部实体；日志与结果不输出环境变量值 | TDD/QA |
| 可审计 | 结果文件 | 绑定 HEAD SHA 与产物 SHA256；结果过期或产物被改动时门禁阻断 | TDD/QA |
| 可追溯 | P0 自动化 AC | 至少一条绑定通过用例，否则阻断；人工验收 AC 披露为风险 | TDD/QA |

## 5. 依赖与风险

依赖：既有 `qa verify` 门禁与本机回执、`infra/scripts/shared/governance-ids.js` 的 ID 规则、稀疏配置加载、项目自选且能输出 JUnit XML 的测试驱动。

| 风险 | 缓解 | 状态 |
| --- | --- | --- |
| 模型把被测代码当前输出当作期望值，形成循环验证 | 预言机规则写入指引与专家文件；P0 用例需人工评审；故意破坏夹具验证门禁可证伪 | 已确认方案 |
| 路径模型由模型臆造 | `qa paths` 校验引用存在、转移衔接与覆盖准则，P0 路径需人工评审 | 已确认方案 |
| 结果文件被手写或陈旧 | 绑定 HEAD SHA 与产物 SHA256，`qa verify` 复验；信任边界与既有本地门禁一致，不宣称服务端零信任 | 已接受约束 |
| 用例数量随路径与取值组合爆炸 | 覆盖准则选路径，等价类/边界值/判定表/两两组合生成数据行，变体下沉到 API 层，UI 只保留关键旅程 | 已确认方案 |
| 项目忽略用例命名约定 | P0 AC 无绑定用例即阻断；无标识用例单独计数并披露 | 已确认方案 |
| 不稳定用例造成误报 | 本期失败即失败，不自动重试；重试与 flaky 策略列入后续阶段 | 已接受约束 |

开放问题：无。

## 6. 里程碑与 Gate

| 阶段 | 交付 | Gate |
| --- | --- | --- |
| P1 最小闭环（本次） | 原子 AC 与 `TC-` 统一、路径模型模板、`qa paths`、`qa run`、`qa verify` 增量、QA 指引与角色文件、夹具验证 | 定向测试与夹具反例通过，模板收敛 dry-run 无差异 |
| P2 | `qa plan` 生成 TC 骨架与覆盖矩阵、断言质量检查 | 另行立项 |
| P3 | architecture 包提供 Playwright 与客户端驱动脚手架及所有权登记 | 另行立项 |
| P4 | flaky 策略、突变抽样、人工验收记录、性能与安全专项 | 另行立项 |

按 PRD → ARCH → TASK → TDD → QA 交付。

## 7. 追溯矩阵与验证

追溯见 [矩阵](../../data/traceability-matrix.md)，验证证据见 [QA](../../qa-modules/business-testing/QA.md)。本模块无图形界面，UX 规范不适用。
