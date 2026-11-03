# 快速上手：先接入模型作业包

[首页](../../README.md) · [常用指令](commands.md) · [并行协作](parallel-collaboration.md) · [完整参考](template-reference.md)

目标：在新目录或已有项目中安装作业包文件，检查协议、配置与更新基线，再准备第一次协作；目标是否已有 Git 仓库不影响初始化。

## 让 AI 自动初始化

在息壤源项目中打开 AI 会话，直接发送：

> 初始化项目，路径为 `C:\Projects\MyApp\repo`。

AI 读取源的基础规则后，按[源专用初始化协议](source-initialization.md)自动完成：路径与环境检查 → 目标分流 → 记录操作 → 预演 → 安装 → 读取目标规则 → 收敛复查。目标不存在时可创建空目录；默认只安装模型作业包，不需要预先创建项目文件或选择技术栈。没有冲突就连续执行，不再逐步索取相同授权。

初始化只安装对应文件，不运行目标项目的 `git init`、提交、推送、远端配置或 worktree 操作，也不在目标创建任务记录。已有 Git 仓库、有无提交均可继续；已有文件按清单所有权处理。已有息壤痕迹先核实更新或恢复状态；冲突、规则读取失败或基线不明时停止，不强行覆盖。

完成报告应包含目标绝对路径、源 commit、安装与复查结果、日志位置和待配置项。文件安装并复查通过即完成本次初始化；仅模板接入成功不等于业务开发环境已就绪。下文 GitHub/Git 准备是后续独立操作，不由本指令触发。

这是项目规则提供的 AI 工作流，不是新增 CLI 命令。空白项目中的 AI 若未安装息壤插件、也未获得源位置，不能仅凭这句话发现模板；可改在息壤源中发起。需要手动执行时按下文操作。

## 环境与目录

- Git、Node.js、pnpm 能在同一终端运行。本文示例按 POSIX shell 编写；Windows 可使用 WSL。
- 源仓库 `package.json` 固定 pnpm 版本，按该版本准备环境；本文不要求安装应用技术栈依赖。
- 能访问 GitHub。完成远端任务、PR 和合并还需要自己的项目仓库与相应权限。
- 新建一个工作父目录，确保其中尚无 `xirang-source`、`xirang-demo`。不要直接在业务目录上试验。

```bash
git --version
node --version
pnpm --version
git clone https://github.com/hollisyao2024/PromptsEngineering.git xirang-source
mkdir xirang-demo
cd xirang-source
```

`xirang-source` 是模板源，`xirang-demo` 是你的目标项目。后续模板维护使用目标项目的命令；不要把业务代码写进模板源。

## 预览并安装

以下两条命令都在 `xirang-source` 中运行：

```bash
pnpm agent -- template update ../xirang-demo --scope agent --initialize --dry-run
pnpm agent -- template update ../xirang-demo --scope agent --initialize
```

先看预演中的新增、更新和冲突。遇到冲突或 `STATUS=BLOCKED` 时，保留输出并按下一动作处理；不要删除已有文件或基线来强行通过。

再次执行同一预演：

```bash
pnpm agent -- template update ../xirang-demo --scope agent --initialize --dry-run
```

首次接入成功需同时满足：

1. 安装命令退出码为 0，输出成功状态。
2. 目标含 `AGENTS.md`、`docs/CONVENTIONS.md`、`RULES.md`、`agent.config.json`、`xirang.lock.json` 与 `.xirang/baselines/`。
3. 再次预演没有待应用差异和冲突。纯作业包接入不生成业务应用或架构目录。

这只验证模板接入，不表示业务代码、模型行为或所有操作系统已通过测试。

## 工具接入检查

在 AI 编程工具中打开 `xirang-demo`，发送：

> 先按 UTF-8 完整读取 AGENTS.md、docs/CONVENTIONS.md、RULES.md，并确认读到末尾。现在只读检查：说明项目根目录、默认主分支、任务状态与 worktree 的位置；列出开始修改前还缺哪些配置。不要先修改文件、创建任务或放宽工具权限。

检查工具给出的路径是否对应你的项目。仓库中的 Claude Code、Codex、Gemini CLI 入口是接入材料；客户端版本、规则加载方式、沙箱和执行权限需要在你的环境验证。工具无法读文件或运行 Node/pnpm 时，先解决环境问题。

## 后续可选：准备自己的 GitHub 项目

本节不属于“初始化实际项目”的自动执行范围。后续需要开发交付时，由维护者单独发起初始仓库设置；若目录已有 Git 历史，不要重新初始化。

```bash
cd ../xirang-demo
git init -b main
```

安装器会从环境示例初始化缺失的本地环境文件；已有 `.env.local` 不要覆盖。完整阅读并完善项目 `RULES.md`，明确产品边界与验证命令。按项目需要配置 `agent.config.json` 的检查、构建与部署入口；模板的占位检查不证明业务质量。

在 GitHub 创建自己的空仓库，把它设为目标项目的 `origin`。按 [GitHub 鉴权约定](../CONVENTIONS.md#9-github命名与安全)，只在被忽略的 `.env.local` 配置项目 `GH_TOKEN`；不要把令牌发给 AI、贴进 Issue 或写进命令历史。

完成首次基线提交和远端初始化后，再开始任务/worktree 生命周期。首次提交必须包含 `xirang.lock.json` 与 `.xirang/baselines/`；不要忽略它们。远端 Git 操作使用生成的封装，例如：

```bash
node infra/scripts/shared/github-auth-run.js -- git push -u origin main
```

上述命令要求已经配置远端、已有初始提交，并具备推送权限。初始提交与账号身份由维护者设置；模板不会代建 GitHub 仓库或授予权限。

## 已有项目

首次初始化已有项目同样从息壤源执行 `template update "<项目路径>" --scope agent --initialize --dry-run`，核对计划后去掉 `--dry-run` 安装，再复查。无需创建目标 worktree；已有业务、项目规则和配置按所有权保留，Git 元数据不变。未指定 `--initialize` 的普通应用仍遵循原有 linked-worktree 门禁。

已接入息壤的项目，直接在对应实际项目的 AI 会话说“更新息壤模板”。AI 明确当前项目的绝对路径，登记更新任务并创建专用 worktree 后，在输出的 `NEXT_CWD` 中使用 `pnpm agent -- template sync`，固定从官方 GitHub `main` 获取最新提交并继续原有交付链。源项目不代为跨项目更新。缺基线、旧版接管、架构选型与恢复见[完整参考](template-reference.md)。

### 初始化与更新有什么不同

| 情况 | 对 AI 的指令 | 执行位置与命令 |
| --- | --- | --- |
| 空白新项目首次接入 | 在息壤源说“初始化项目，路径为 `<目标路径>`” | 源中执行 `template update "<目标绝对路径>" --scope agent --initialize`，先预演、安装后复查 |
| 已有代码库首次接入 | 同样提供项目路径并要求初始化 | 使用同一 `--initialize` 文件安装模式；已有 Git 仓库及尚无提交均可，不创建目标 worktree |
| 已接入项目日常升级 | 在实际项目说“更新息壤模板” | 目标项目登记 mutation 任务并创建专用 worktree，在 `NEXT_CWD` 执行 `pnpm agent -- template sync`，完成项目 TDD/QA/合并门禁 |

首次接入使用当前已核实的本地息壤源，报告实际源 SHA；不声称自动取得最新官方版本。日常升级则由 `template sync` 匿名拉取官方 `main`，固定来源 SHA，使用该版本的 updater 自动预演、应用和复查；获取失败即停止。它按已记录的版本基线和文件所有权处理差异，保留项目自有 `RULES.md`、配置与业务代码，冲突和未知基线必须先解决。默认同步作业包及已采用的架构模块，不自动增加技术选择；明确只更新作业包时才追加 `--scope agent`。

## 下一步与排错

- 接入完成：按[双任务教程](parallel-collaboration.md)练习两个独立修改。
- `pnpm`、`node` 或 `npx` 找不到：检查当前终端 PATH 和完整的 Node/pnpm 安装，再重新运行未启动的命令。
- bootstrap 报“command is not configured”：实际业务项目应配置依赖安装命令；确实不需要依赖的纯文档场景可显式 `worktree bootstrap --skip-bootstrap`，不能用于跳过必要安装。
- GitHub 鉴权或网络失败：检查本机网络、`.env.local` 与仓库权限，保留脱敏错误；不要切换到裸远端 Git 命令。
- 中断后不知道是否已经推送或合并：先读取任务状态并核实远端结果，再按恢复入口处理，禁止盲目重放。

反馈模板见[贡献指南](../../CONTRIBUTING.md)。
