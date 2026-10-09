# ADR Changelog

- 2026-10-09：[ADR 040](040-arch-design-drift-check.md)，`DESIGN.md` 与 `styles.css` 的漂移检查只告警：shadcn 应用按实际生效取值比较颜色、圆角与正文字体族，结果写入 `checkProject` 的 `warnings`，工作流门禁输出 `ARCHITECTURE_WARNING=` 行，不改变通过条件；[ADR 037](037-arch-ui-design-contract.md) 文末增补指针。

- 2026-10-08：[ADR 037](037-arch-ui-design-contract.md) 更正官方 lint 的门禁口径：规则 `broken-ref` 对未知的组件子属性只报警告、退出码仍为 0，门禁改为退出码为 0 且 `--format json` 输出中该规则的条数为 0；骨架 Components 节列出有效子属性清单。决策正文不变。

- 2026-10-08：[ADR 038](038-arch-business-test-automation.md) 补充真实项目试验后的三处修正（`qa run` 在必需优先级 AC 未被证明时以 `FAILED` 非零退出、回执可选携带 `business` 摘要、`task exec` 放行逐词一致的已登记套件命令）与 QA 生成器对 PRD 表格的识别；第 6 条「回执结构不变」与取舍「本期不扩展回执结构」由补充节更正，其余决策不变。

- 2026-10-08：[ADR 037](037-arch-ui-design-contract.md) 再补一次存量项目副本试验：25/25 的映射数据点，以及读取样式表实际生效取值的两处难点（两个 `:root` 块、`body` 字体族重复声明）；决策正文不变，漂移检查仍延后。

- 2026-10-08：[ADR 037](037-arch-ui-design-contract.md) 补充官方 lint 对骨架的验证结论、`DESIGN.md` 漂移检查延后的触发条件与设计输入，并更正「Token 名到 CSS 变量名的映射是难点」的判断；决策正文不变。

- 2026-10-07：[ADR 039](039-arch-e2e-driver-scaffold.md)，业务测试驱动脚手架作为 architecture 包的可选 `e2e` 模块：仅对接 JUnit/AC 标识/平台标签三项契约，生成 Playwright 配置与示例，不改写 `agent.config.json`、不下载浏览器、不重试。

- 2026-10-06：[ADR 038](038-arch-business-test-automation.md)，业务测试采用创作期推导、脚本期确定性判定：原子 AC、路径模型与 JUnit/AC 标识绑定的结果证据，`qa verify` 业务门禁默认关闭。

- 2026-10-06：[ADR 037](037-arch-ui-design-contract.md)，根目录 DESIGN.md 作为项目所有的界面视觉契约，骨架由作业包提供，仅在专家阶段按需点读。

- 2026-10-04：[ADR 036](036-arch-fixed-commit-merge-evidence.md)，默认严格、显式固定提交集成、逐记录语义指纹与独立发布判定。

- 2026-10-04：[ADR 035](035-arch-data-semantic-enforcement.md)，语义门禁默认阻断、按安装形态条件豁免、身份/文件模块核心表分层合规与适配器层软删除。

- 2026-10-03：[ADR 034](034-arch-data-semantic-conventions.md)，数据语义约定（命名、注释、审计字段、软删除、状态值）与 schema 变更阻断门禁。

- 2026-10-01：[ADR 002](002-arch-environment-file-init-if-missing.md) 补充 linked worktree 更新时主 repo 六文件补齐、主 repo example 优先及本地 ignore 边界。

- 2026-09-28：[ADR 032](032-arch-test-scope-evidence-gate.md)，全量测试高门槛、task evidence 决策与 QA 回执前结构校验。

- 2026-09-10：[ADR 031](031-arch-on-demand-runtime.md)，轻量架构入口、固定来源缓存及旧包安全缩减。

| ADR | 日期 | 状态 | 摘要 |
| --- | --- | --- | --- |
| [ADR-001](001-arch-template-command-dispatch.md) | 2026-08-23 | Accepted | 扩展现有模板命令执行面，避免第二套命令系统 |
| [ADR-002](002-arch-environment-file-init-if-missing.md) | 2026-08-24 | Accepted | 六个环境文件仅首次初始化，已有内容永久由项目持有 |
| [ADR-003](003-arch-container-directory-initialization.md) | 2026-08-26 | Accepted | 容器目录由写入命令显式按需初始化，配置读取保持无副作用 |
| [ADR-005](005-arch-worktree-required-base-sync.md) | 2026-09-01 | Accepted | 全新 worktree 默认要求远端基线刷新成功并从固定 commit SHA 创建 |
| [ADR-006](006-arch-multi-host-optimistic-git-coordination.md) | 2026-09-05 | Accepted | 所有电脑同权；本机状态只管本机，跨电脑以远端 SHA 和普通非快进更新协调 |
| [ADR-007](007-arch-xirang-official-template-sync.md) | 2026-09-06 | Accepted | 实际项目 required fetch 息壤固定官方源，以不可变 SHA 快照内最新应用器完成模板自更新 |
| [ADR-008](008-arch-xirang-anonymous-fetch.md) | 2026-09-06 | Accepted | 官方公开模板匿名 HTTPS 获取；隔离项目 token 与 Git 凭据，保留项目远端鉴权 |

- 2026-09-08：[ADR 026](026-arch-architecture-platform-packages.md)，独立能力包、架构配置与所有权升级引擎。

## 2026-09-09

- [ADR 030](030-arch-open-source-components.md)：全部推荐开源能力按需生成、兼容验证与明确的备选边界。

- [ADR 029](029-arch-file-storage-adapters.md)：统一文件服务、四类存储适配、受限上传和可恢复元数据。

- [ADR 028](028-arch-monorepo-prisma.md)：多端 Monorepo、Prisma、按需安装、预置组合与业务所有权。

- [ADR 027](027-arch-ui-component-sets.md)：四组公共 UI、可选择组件集、依赖闭包和日历日期合约。

- 2026-10-01 ADR-033：并列 ORM、常见数据库支持矩阵与稳定版迁移保护。

- 2026-10-03 ADR-034：数据语义约定与 schema 变更门禁。

- 2026-10-04 ADR-035：语义门禁默认阻断与模块核心表合规。
