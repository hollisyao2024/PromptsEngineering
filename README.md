# 息壤（Xirang）

**面向多人、多 AI 会话并行开发的工程协作模板。**

把 vibe coding 接入任务、独立 Git worktree、测试、QA 与合并流程，让每项修改有验收、每次交付有证据、中断后有恢复入口。

[快速上手](docs/guides/quickstart.md) · [插件入口](docs/guides/plugin-quickstart.md) · [并行协作教程](docs/guides/parallel-collaboration.md) · [完整使用参考](docs/guides/template-reference.md) · [English](README.en.md)

## 你可能遇到的问题

| 开发中的问题 | 息壤提供的机制 |
| --- | --- |
| 多个会话在同一工作目录里互相覆盖 | 每项修改进入独立 linked worktree，依赖目录各自建立 |
| AI 写完代码，却没有明确的完成标准 | 开工前记录可观察验收，交付前执行测试与 QA 门禁 |
| 长任务中断，接手者不知道做到哪 | 任务状态、证据和上下文胶囊提供恢复入口 |
| 两人同时交付，QA 检查的提交已经变了 | 合并前复验 base/head SHA，发现漂移则停止并重新验证 |
| 项目定制与模板更新混在一起 | 文件所有权、版本基线和三方更新明确处理定制与冲突 |

这些机制帮助控制协作风险。它们不保证 AI 产出正确，也不能自动消除业务冲突。

## 适合谁

- 已用 AI 编程工具开发，希望从单会话走向多任务并行的开发者。
- 需要多人、多电脑共享交付约定的小团队。
- 已有代码库，希望先接入协作流程，再按需采用架构模块的维护者。

如果只是一次性脚本或没有协作需求的小实验，先评估任务与 QA 流程的成本。息壤需要 Git、Node.js、pnpm，以及团队实际执行约定；它不是一键开启的自动调度服务。

## 先跑通一次接入

先采用**模型作业包**。它提供协议、任务、worktree 和交付工具，不要求更换现有技术栈。

在已获取的息壤源仓库执行，目标目录须存在；已有 Git 项目须使用干净的专用 linked worktree：

```bash
pnpm agent -- template update "<目标目录或目标-worktree>" --scope agent --dry-run
pnpm agent -- template update "<目标目录或目标-worktree>" --scope agent
```

从获取源码、准备环境到检查生成结果，按[快速上手](docs/guides/quickstart.md)操作。首次接入成功的判据是：生成协议和基线文件，再次预演无待应用差异；业务测试通过是后续项目验收。

## 多人、多会话怎样协作

1. 约定任务边界、共享接口和各自验收。
2. 每人或每个 AI 会话登记独立任务，创建自己的 worktree。
3. 在各自 worktree 完成修改与定向验证，生成 PR。
4. 对固定提交执行 QA；主干变化或提交漂移时重新同步、验证。
5. 合并后核对主干与远端，再按生命周期门禁清理。

[双任务协作教程](docs/guides/parallel-collaboration.md)提供可复制的任务指令、关键命令和冲突处理方式。

独立 worktree 隔离工作区；任务拆分处理业务依赖。本机锁不承担跨电脑互斥，跨电脑交付依赖远端 SHA 复验与普通 push 的非快进拒绝。

## 与 AI 编程工具配合

| 仓库提供的入口 | 用途 |
| --- | --- |
| `AGENTS.md` | 通用规则、阶段路由与交付约定 |
| `CLAUDE.md`、`.claude/` | Claude Code 的规则入口与配置材料 |
| `.codex/` | Codex 的配置材料；通用规则从 `AGENTS.md` 进入 |
| `GEMINI.md`、`.gemini/` | Gemini CLI 的规则入口与配置材料 |

有入口文件不等于所有客户端、版本和权限组合都已经验证。接入时确认工具实际读取了基础规则，并能运行仓库命令；权限由运行环境决定。详见[工具接入检查](docs/guides/quickstart.md#工具接入检查)。

已有 `0.1.0` 轻量插件，提供接入、启动任务、恢复、检查交付四项技能；Claude Code 与 OpenAI 本地市场清单指向同一份源码。安装步骤与实际验证范围见[插件上手](docs/guides/plugin-quickstart.md)。尚未提交公共市场，插件安装也不代表目标项目已接入模板。

## 按需采用架构能力

协作流程与应用架构可以独立采用。需要架构规划入口时追加 `--include architecture`，再按项目选择运行 `architecture plan/init/check`。不要与 `--scope agent` 同时使用。

架构包包含多端 Monorepo 蓝图、UI 组件、存储与开源模块的选型和生成材料。实际可用项、采用条件与边界以[架构包说明](architecture/README.md)及[组件目录](architecture/open-source-catalog.json)为准；它不是所有技术栈的通用生成器。

## 继续使用与参与

- [完整使用参考](docs/guides/template-reference.md)：首次接入、日常更新、旧版接管、架构选择、更新与恢复。
- [作业包](agent/README.md) / [架构包](architecture/README.md)：两类能力的详细入口。
- [工程约定](docs/CONVENTIONS.md) / [执行规则](AGENTS.md)：规则与命令的事实来源。
- [贡献与反馈](CONTRIBUTING.md)：报告问题、分享采用案例、提交改进。
- [版本记录](CHANGELOG.md)：模板演进。

遇到问题请在 [Issues](https://github.com/hollisyao2024/PromptsEngineering/issues) 提供脱敏复现步骤。欢迎分享采用过程与失败场景；如果项目对你有帮助，可以 Star，便于之后找到它。

许可状态：`package.json` 声明为 MIT；当前仓库尚缺根目录许可证正文。第三方组件保留各自许可证，具体授权范围需先核对。推广与贡献准备见[推广方案](docs/promotion/README.md)。
