# 模型作业能力包

[首页](../README.md) · [English overview](../README.en.md) · [快速上手](../docs/guides/quickstart.md) · [并行协作](../docs/guides/parallel-collaboration.md) · [完整参考](../docs/guides/template-reference.md)

本包管理需求、架构、任务、TDD、QA、交付、worktree 和长任务恢复。[manifest.json](manifest.json) 是能力入口，`applyManifest` 引用唯一分发规则。公开执行路径继续为 `AgentRoles/`、`infra/scripts/` 和 `infra/templates/`，保持现有项目入口兼容。

同一项目支持多模型接力、多人多机协作、单机多任务并行：共享项目规则与验收，每项并行修改使用独立任务、分支和 worktree；切换模型依据任务状态、证据与上下文胶囊交接。工具须能读取规则、操作文件和执行必要命令，已有入口不代表所有客户端、版本与权限组合均已验证。

worktree 隔离文件与依赖目录，不隔离共享服务、端口、数据库或测试数据；接口和锁文件仍需协调负责人及合并顺序。本包不自动调度会话，也不保证零冲突。各 worktree 独立建立依赖，禁止共享 `node_modules`。

只采用作业包，不生成 `architecture/`、`apps/`、数据库或 UI 业务文件。技术选型、组件源码与生成器在息壤源仓库的 `architecture/` 中维护；实际项目需要时再取得轻量入口。文件更新机制由 `tooling/xirang/` 提供。

## 采用与更新

首次在息壤源会话说“初始化项目，路径为 `<目标绝对路径>`”，或手动向已存在的目录安装。空目录与已有 Git 仓库均使用 `--initialize`，有无提交均可，不要求目标 worktree；只安装文件，不操作目标 Git、远端或任务生命周期。手动执行：

~~~bash
pnpm agent -- template update "<目标目录>" --scope agent --initialize --dry-run
pnpm agent -- template update "<目标目录>" --scope agent --initialize
pnpm agent -- template update "<目标目录>" --scope agent --initialize --dry-run
~~~

先核对来源与预演，冲突不覆盖，安装后读取目标完整基础规则并复查收敛。首次使用已核实的本地源并报告源 SHA，不保证自动取得最新版；安装成功不等于项目 Git、业务环境或测试已经就绪。后续开发准备独立进行，不带 `--initialize` 的普通应用仍守 linked-worktree 门禁。

已接入项目在自身会话说“更新息壤模板”：登记任务与显式验收，创建干净专用 worktree，切到 `NEXT_CWD` 后更新。命令每次匿名获取官方 `main` 并固定 SHA，来源获取或校验失败时阻断，不回退缓存。只更新作业包：

~~~bash
pnpm agent -- template sync --scope agent
~~~

默认 `template sync` 或 `--scope all` 更新作业包及已采用的架构选择；`--scope agent` 保持已有架构文件，不执行卸载。新增轻量架构入口用 `template sync --include architecture`，不能同时指定 `--scope agent`。`include` 不生成应用，后续需根据项目配置执行 `architecture plan/init/check`。

安装插件只增加工作入口，不安装本包、配置业务环境或完成任务交付；纯网页会话也不会因此获得本地 shell。安装方法及历史验证边界见[插件上手](../docs/guides/plugin-quickstart.md)。

## 所有权与基线

作业协议、模板工具由 `manifest` 管理。`xirang.lock.json` 和 `.xirang/baselines.json` 必须随项目提交，普通更新根据上次基线检查本地定制；它们不能由手工复制文件替代。

旧项目缺少基线时，先检查 `adoption required` 的差异，再用 `template sync --adopt --dry-run` 预演。确认后的 `--adopt` 保留现有内容作为项目定制并建立依据，不等于所有旧协议和脚本已经换成新实现。旧引导器不支持参数时，从新版息壤源使用 `template update "<目标-worktree>" --scope agent --adopt` 完成一次引导，同样先 `dry-run`。

项目规则放 `RULES.md`，参数放稀疏 `agent.config.json`，真实业务、架构决策与部署实现保持项目所有。模板协议需要改进时在息壤源修改后分发；已有受管文件的本地漂移必须按计划处理冲突。

## 交付与恢复

执行规范见 [AGENTS.md](../AGENTS.md) 和[通用约定](../docs/CONVENTIONS.md)。开发与更新走 `tdd sync → tdd push → qa plan → qa verify → qa merge`，保留任务 checkpoint、QA 阶段转换和绑定最终提交的测试证据。合并前复验 base/head SHA；合并后切回主 worktree 核对本地/远端主干，执行完成门禁，再记录验收并 `task finish`。通过 `task exec` 在主工作区留证时须指定 `--cwd main`，不能仅切换调用目录；详见[交付收尾](../docs/guides/parallel-collaboration.md#合并后在主-worktree-收尾)。日常修复、文档与重构走轻量流程；需求、架构或合约变化走 PRD → ARCH → TASK → TDD → QA，环境或发布工作再进入 OPS。

恢复入口按中断对象区分：

- **开发任务或同机模型接力**：先交接精确任务 ID、worktree、分支和胶囊，接手确认后继续；完整读取基础规则，再依次执行 `pnpm agent -- task resume --task <任务ID>`、`pnpm agent -- task context --task <任务ID>`。结果不明的推送、合并等先核实，不盲目重放。
- **模板应用冻结计划**：仅作业包用 `node tooling/xirang/resume.js`；已安装架构入口可用 `pnpm agent -- architecture resume`。恢复冻结计划不等于恢复开发任务或完成交付。
- **跨电脑接手**：Git 不自动同步任务状态、未提交内容、本机锁、胶囊或 QA 回执。先交接证据、按本机任务门禁登记或恢复任务，再用 `worktree resume <实际分支名>` 恢复工作区，并重新执行本机 QA；`task resume` 不会从远端下载状态。详见[模型切换与恢复](../docs/guides/parallel-collaboration.md#切换模型或恢复任务)。
