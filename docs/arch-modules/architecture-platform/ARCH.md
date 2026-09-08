# 双能力包与架构落地 - ARCH

> 主架构：[ARCH.md](../../ARCH.md)；基线：[已确认 PRD v1.0](../../prd-modules/architecture-platform/PRD.md)；Story：US-ARCHPLAT-001~009；2026-09-08。

## 1. 边界与组件

| 组件 ID | 源目录 | 职责 | Story |
| --- | --- | --- | --- |
| CMP-ARCHPLAT-AGENT | agent/ | 作业包入口、manifest、协议与现有兼容路径；ARCH 专家负责规划流程 | US-ARCHPLAT-001 |
| CMP-ARCHPLAT-CATALOG | architecture/ | 标准、可选 stacks/components/modules/profiles、配置 schema、示例及初始化/检查脚本 | US-ARCHPLAT-002~005、008 |
| CMP-ARCHPLAT-ENGINE | tooling/xirang/ | 通用冻结计划、所有权合并、内容基线、写入前复验、事务日志与恢复 | US-ARCHPLAT-006~007、009 |

作业包保留 AgentRoles、infra/scripts 等公开路径，使用 manifest 显式引用，避免移动导致旧命令失效。架构实现与技术规范放 architecture；通用引擎不依赖 React、数据库或项目业务。消费者使用两包的版本化资产目录，只有被选择的模块会生成到 apps/packages/infra/tooling。

## 2. 配置与数据视图

architecture.config.json 是项目所有的选型源：schemaVersion、applications（id、stack、path、组件路径、modules、targets）、datastores（id、engine、path、consumers）、modules（id、path）、profiles（id、kind、edition、environment、applications、path、denyPatterns）。避免全局单一前后端/数据库值。所有 ID 稳定、所有目标路径相对项目根且无链接、不得重叠。

agent.config.json 继续保存作业命令；配置 loader 从 architecture 配置派生旧 paths 的缺失值，显式已有 paths 优先并由检查报告不一致。不得同步维护两份手写选型。

xirang.lock.json 记录 installed package/module 版本、来源 commit、生成参数摘要、受管文件策略与 base 内容摘要。基线采用 .xirang/baselines/<sha256> 内容寻址，随项目提交，以便跨电脑恢复；只保存模板生成内容，不采集运行时密钥或业务数据。保留上一个 lock 的原始散列作为并发前提。

## 3. 运行与接口视图

稳定入口：architecture catalog/detect/validate/plan/init/update/adopt/check/install-deps/resume。catalog/detect/validate/check 只读；plan 可显式输出容器 tmp 中计划；init/update 先生成完整计划，再应用。template update/sync 复用同一引擎更新作业包及已安装架构资产；scope 可限定 agent、architecture 或具体模块。所有更新绑定同一次来源和输入摘要。

计划包含 schema、target、来源、选择、每项 before/after/base 哈希、内容、模式与原因；id 为规范化计划摘要。执行前校验全计划、文件路径、source 输入、target 输入、lock 和 baseline。所有冲突在任一目标写入前处理。无冲突则创建外部 journal，逐文件原子 rename，逐项核验输出，最后提交 lock。中断只在 before/after 已知状态下继续；第三种状态转冲突，禁止猜测或全目录回滚。

## 4. 所有权决策

| 策略 | 语义 |
| --- | --- |
| overwrite | 模板所有；若 L 偏离 B 且不等于 U，阻断本地改动 |
| update | 文本三方合并：L=B 取 U；U=B 保留 L；两边相同直接采用；其他使用 Git diff3；重叠冲突整批阻断 |
| merge-json | 对模板拥有的 JSON 字段递归三方合并，项目独有键保留；数组按明确声明语义处理 |
| append | 新文件/稳定 ID 条目只追加；相同 ID 不同内容报冲突；禁止改变既有迁移 |
| managed-block | 只更新受管标记块，块外项目文本保留；块内定制参与三方合并 |
| init-if-missing | 只在缺失时生成；随后保持项目所有权 |
| project-owned | 永不写入 |

无基线且同路径不同内容时，overwrite/update 都产生 adoption-required。当前接管命令显式保留当前内容作为相对所选上游的定制起点，并在冻结计划中保留 before/after/upstream 以供审查；不得隐式假设当前文件来自模板。旧 refs/agent/backfill-baseline 只用于其已有回灌职责，不冒充新模板原始内容。

## 5. 选型与组件视图

首批 stacks 为 React/Vite、React/Next、Node HTTP API、Go HTTP API 和 Tauri 桌面；存储 PostgreSQL、SQLite 按消费者选择。组件模块基于官方 shadcn 源资产和 TanStack 状态模型，路径默认 apps/<app>/src/components/ui 与 components/data-table；跨应用复用可映射 packages/ui/src，业务层不能互相导入 apps 源码。基础语义 HTML 只用于 UI 原子内部。

公共 DataTable 以稳定 getRowId、原始 accessor、受控/非受控筛选排序分页选择和真实异步 action 回调为接口。客户端模式按完整数据计算；服务端模式显式 query/onQueryChange/rowCount，导出及跨页选择的范围必须说明。禁止 UI 替代后端权限校验。

可选模块提供契约与生成漂移检查、结构化脱敏事件、追加迁移及校验、资源校验和、插件清单/权限校验、私有交付禁用地址检查与参数化 profile。没有平台工具、证书或真实环境配置时报告缺失能力，不声称部署/原生构建成功。

## 6. 安全、运行与恢复

规划不执行任意配置字符串；依赖安装使用固定 executable 与 argv，并作为独立显式动作。冻结计划和本机 journal 不构成权限隔离边界，必须保护来源仓库及项目写权限。阻止绝对路径、父级逃逸、符号链接、重复文件所有者和保留元数据路径注入。来源资产和基线均校验摘要。

生产迁移/部署不在初始化和更新事务内。应用可运行命令分别声明开发、构建、验证、迁移及部署，显式 profile 不得回退默认。日志不包含密钥；错误输出 STATUS/REASON/NEXT_ACTION。整个模板升级在专属 worktree 中审查，Git 是最终代码历史与回滚边界。

## 7. 验证与风险

核心引擎使用真实临时目录、文件内容及 Git 三方合并测试；覆盖冲突、部分写入恢复、哈希漂移、旧版接管和幂等。生成 UI 执行 TypeScript、构建及 DOM 交互验证；Node/Go 骨架按本机可用工具运行；异构组合做配置/目录/模块生成验证。原生跨平台发布不以配置测试代替。TC-ARCHPLAT-001~009 与 QA 文档保持对应。

ADR：[版本化能力包与所有权引擎](../../adr/026-arch-architecture-platform-packages.md)。
