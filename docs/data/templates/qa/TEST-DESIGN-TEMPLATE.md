# {功能域名称} — 测试设计（规则、反例与缺陷复现）

> 复制到 `docs/qa-modules/{domain}/TEST-DESIGN.md` 后使用，`{domain}` 与 `docs/prd-modules/{domain}/` 同名。仅由 QA 专家编辑，其他专家只引用其中的 ID，修改通过评审提出。
> 下面的表格是「用户管理」示例，出处对应 `docs/prd-modules/MODULE-EXAMPLE.md` 的原子 AC 清单与不变量表，TC 编号与 `PATHS-TEMPLATE.md` 共用同一编号空间；示例只节选登录与注册，实际文件须覆盖全部 P0 原子 AC 与不变量。复制后整体替换为本模块的内容。

**维护者**：QA 专家
**模板版本**：v1.0
**功能域**：{domain}
**设计材料**：{本次设计读取的规格文件及其提交，不含源码与测试}

---

## 1. 它是什么，不是什么

- **是**：本模块测试的预言机。它从规格推导出规则、反例与缺陷复现，决定每个测试断言什么；TDD 编写单元与模块内集成测试时，期望值引用这里的 ID。
- **不是**：验收规格。规格只在 PRD 的原子 AC 表与不变量表里；本文件引用 AC 与 INV，不复制 Given/When/Then。也不是用例代码或执行记录。
- 预期结果只来自 PRD、数据字典、UX 规范与 ARCH 接口契约，不读源码，不以被测系统当前的输出为准。
- 与 PATHS 分工：PATHS 选端到端路径；本文件写清每条规则在越权、状态、边界、并发、依赖故障等维度上的期望。

## 2. 设计时机

1. 实现之前设计，只读规格；完成后单独提交 `test(design): <模块> 规则与反例`，再开始实现。
2. 修复缺陷时，先登记缺陷复现行并写出在修复前失败的用例，再修复。
3. 实现完成后审计只能追加行，或通过评审修改；已评审行的陈述与预期不因实现结果改写，变更时在「变更记录」写明原因与新出处。

## 3. 规则表

- **ID**：`RUL-{MODULE}-NNN`，模块标记与 PRD 一致。
- **类型**：`rule`（业务规则）、`invariant`（恒成立）、`forbidden`（禁止发生）、`pre`（前置条件）、`post`（后置条件）、`undefined`（规格未定义，须写明期望处置并回流 PRD）。
- **陈述**：可断言的期望，写出具体值；不写实现方式。
- **出处**：`AC-*`、`INV-*` 或 `docs/**.md#锚点`，多个用逗号分隔，不得指向源码或测试；找不到出处时写 `推断：<理由>`，只计为风险并回流 PRD 补规格。
- **优先级**：`P0`–`P3`，不低于出处的优先级。
- **验证方式**：`example`（示例）、`property`（性质）、`state-machine`（状态机）、`fault`（故障注入）、`manual`（人工）。
- **TC**：承载该规则的用例，多个用逗号分隔，暂无写 `-`；用例名必须包含 TC 或本行 ID。

| ID | 类型 | 陈述 | 出处 | 优先级 | 验证方式 | TC |
|----|------|------|------|--------|----------|----|
| RUL-USER-001 | rule | 连续第 5 次密码错误后账号锁定 15 分钟并返回 2002；锁定期内提交正确密码同样返回 2002 | AC-USER-002-03 | P0 | example | TC-USER-007 |
| RUL-USER-002 | invariant | 返回 2001 时 `remainingAttempts` 恒等于 5 减去含本次在内的连续失败次数，取值只在 1–4 | AC-USER-002-02 | P0 | property | TC-USER-031 |
| RUL-USER-003 | forbidden | 处于锁定期或未完成邮箱验证的账号，任何登录尝试都不签发 `token` 与 `refreshToken` | INV-USER-003, AC-USER-002-04 | P0 | state-machine | TC-USER-032 |
| RUL-USER-004 | invariant | 同一邮箱最多对应一个账号；重复注册返回 1001 且账号数不变 | INV-USER-002, AC-USER-001-02 | P0 | property | TC-USER-033 |
| RUL-USER-005 | forbidden | 注册、登录、锁定与重置流程的响应、日志和事件载荷都不含明文密码或密码哈希 | INV-USER-001 | P0 | property | TC-USER-034 |
| RUL-USER-006 | undefined | 邮箱仅大小写不同（`A@x.com` 与 `a@x.com`）是否视为同一账号未定义；期望处置：回流 PRD，确认前按同一邮箱处理并返回 1001 | 推断：数据字典未规定邮箱规范化 | P1 | example | TC-USER-035 |

## 4. 反例目录

- **ID**：`ADV-{MODULE}-NNN`。
- **规则**：被挑战的 `RUL-*`，多个用逗号分隔。
- **维度**：`auth`（角色、租户、越权）、`state`（前置状态与状态顺序）、`boundary`（取值边界）、`concurrency`（重复、乱序、并发）、`dependency`（依赖超时、报错、返回异常数据）、`time`（过期、时区、时钟跳变）、`input`（格式、编码、注入）。
- 每条 P0 规则在 `auth`、`state`、`boundary`、`concurrency`、`dependency` 五个维度上都要有一行；某维度确实不适用时，「场景」写 `不适用：<理由>`，「预期」与「TC」写 `-`，不得留空。
- **预期**：同样只取规格；出处与所挑战规则不同时，在预期里注明。

| ID | 规则 | 维度 | 场景 | 预期 | TC |
|----|------|------|------|------|----|
| ADV-USER-001 | RUL-USER-001, RUL-USER-002 | boundary | 连续第 4 次与第 5 次提交错误密码 | 第 4 次返回 2001 且 `remainingAttempts` 为 1；第 5 次返回 2002 并开始锁定 | TC-USER-036 |
| ADV-USER-002 | RUL-USER-001, RUL-USER-003 | time | 锁定满 15 分钟前 1 秒、后 1 秒各提交一次正确密码（可控时钟） | 前者返回 2002 且不签发 Token；后者返回 200 | TC-USER-037 |
| ADV-USER-003 | RUL-USER-001, RUL-USER-002 | concurrency | 同一账号并发提交 5 次错误密码 | 恰好锁定一次；任何 2001 响应的 `remainingAttempts` 都在 1–4 且互不重复 | TC-USER-038 |
| ADV-USER-004 | RUL-USER-002, RUL-USER-003 | state | 连续失败 3 次后成功登录，再提交 1 次错误密码 | 成功登录中断「连续」计数，随后返回 2001 且 `remainingAttempts` 为 4 | TC-USER-039 |
| ADV-USER-005 | RUL-USER-001, RUL-USER-002, RUL-USER-003 | dependency | 风控检查超过 500ms 未响应 | 按 `docs/prd-modules/user-management/PRD.md#42-依赖的接口imports` 视为 low 继续；锁定与签发规则不变 | TC-USER-040 |
| ADV-USER-006 | RUL-USER-001, RUL-USER-002, RUL-USER-003, RUL-USER-004 | auth | 不适用：注册与登录面向匿名访客，规格不区分角色或租户 | - | - |
| ADV-USER-007 | RUL-USER-004 | concurrency | 同一邮箱的两个注册请求同时到达 | 恰好一个返回 201，另一个返回 1001，账号只有一条 | TC-USER-041 |
| ADV-USER-008 | RUL-USER-004 | state | 已注册但未完成邮箱验证的邮箱再次注册 | 返回 1001，不新建账号 | TC-USER-042 |
| ADV-USER-009 | RUL-USER-004 | boundary | 不适用：唯一性不随取值大小变化；大小写差异由 RUL-USER-006 处理 | - | - |
| ADV-USER-010 | RUL-USER-004 | dependency | 注册时发送验证邮件失败 | 按 `docs/prd-modules/user-management/PRD.md#42-依赖的接口imports` 记录日志并异步重试；账号已创建，再次注册返回 1001 | TC-USER-043 |
| ADV-USER-011 | RUL-USER-005 | boundary | 恰为最短合规长度 8 位的密码注册成功，以及 7 位密码注册被拒 | 两种情况的响应、日志与事件载荷都检索不到该密码或其哈希 | TC-USER-044 |
| ADV-USER-012 | RUL-USER-005 | state | 依次触发注册成功、登录失败、账号锁定、申请重置 | 每一步的响应、日志与事件载荷都不含密码或哈希 | TC-USER-034 |
| ADV-USER-013 | RUL-USER-005 | dependency | 风控超时与邮件发送失败时的错误日志 | 错误日志不含请求中的密码字段 | TC-USER-045 |
| ADV-USER-014 | RUL-USER-005 | concurrency | 不适用：输出内容与请求并发度无关，由同一检索断言覆盖 | - | - |
| ADV-USER-015 | RUL-USER-005 | auth | 不适用：规则对任何调用者都成立，规格未定义可读取密码字段的角色 | - | - |

## 5. 缺陷复现

- **ID**：`BUG-{MODULE}-NNN`，登记后不复用。
- **现象**：可观察的错误结果与触发条件。
- **关联规则**：被违反的 `RUL-*` 或 `ADV-*`；规则表没有对应行时，先补规则再登记。
- **来源**：`qa-design`（设计时发现）、`qa-redteam`（红队）、`qa-audit`（实现后审计）、`user`（用户反馈）、`prod`（线上）。
- **TC**：复现用例，修复前必须失败、修复后必须通过。
- **修复提交**：修复所在提交的 SHA，未修复写 `-`。

| ID | 现象 | 关联规则 | 来源 | TC | 修复提交 |
|----|------|----------|------|----|----------|
| BUG-USER-001 | 两个并发的错误密码请求都读到失败次数 4，均返回 2001，第 6 次才锁定 | ADV-USER-003 | qa-audit | TC-USER-038 | - |

## 6. 变更记录

| 日期 | 行 ID | 变更 | 原因与新出处 | 评审人 |
|------|-------|------|--------------|--------|
| {YYYY-MM-DD} | RUL-USER-002 | 新增 | AC-USER-002-02 | @qa-lead |

## 7. 自检清单

- [ ] 每条预期都能指向 AC、INV 或规格文档锚点，没有一条取自源码或被测系统当前的输出？
- [ ] 每条 P0 规则都有 TC，并在五个必需维度上各有一行反例或写明不适用的理由？
- [ ] `undefined` 与 `推断：` 行已回流 PRD 并列为风险？
- [ ] 用例名包含对应的 TC、RUL、ADV 或 BUG 标识？
- [ ] 已评审行的陈述与预期没有被直接改写，改动都在「变更记录」里有原因与新出处？
