# 快速上手：先接入模型作业包

[首页](../../README.md) · [并行协作](parallel-collaboration.md) · [完整参考](template-reference.md)

目标：在一个空目录安装作业包，检查协议、配置与更新基线，再准备第一次协作。已有 Git 项目请跳到“已有项目”。

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
pnpm agent -- template update ../xirang-demo --scope agent --dry-run
pnpm agent -- template update ../xirang-demo --scope agent
```

先看预演中的新增、更新和冲突。遇到冲突或 `STATUS=BLOCKED` 时，保留输出并按下一动作处理；不要删除已有文件或基线来强行通过。

再次执行同一预演：

```bash
pnpm agent -- template update ../xirang-demo --scope agent --dry-run
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

## 准备自己的 GitHub 项目

下面由维护者完成初始仓库设置；若目录已有 Git 历史，不要重新初始化。

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

先用项目现有流程建立干净的 linked worktree，再从息壤源执行 `template update "<该-worktree>" --scope agent --dry-run`。核对计划后再应用；已有业务、项目规则和配置按所有权保留。

已接入息壤的项目，登记更新任务并创建专用 worktree 后，在输出的 `NEXT_CWD` 中使用 `pnpm agent -- template sync`，继续原有交付链。缺基线、旧版接管、架构选型与恢复见[完整参考](template-reference.md)。

## 下一步与排错

- 接入完成：按[双任务教程](parallel-collaboration.md)练习两个独立修改。
- `pnpm`、`node` 或 `npx` 找不到：检查当前终端 PATH 和完整的 Node/pnpm 安装，再重新运行未启动的命令。
- bootstrap 报“command is not configured”：实际业务项目应配置依赖安装命令；确实不需要依赖的纯文档场景可显式 `worktree bootstrap --skip-bootstrap`，不能用于跳过必要安装。
- GitHub 鉴权或网络失败：检查本机网络、`.env.local` 与仓库权限，保留脱敏错误；不要切换到裸远端 Git 命令。
- 中断后不知道是否已经推送或合并：先读取任务状态并核实远端结果，再按恢复入口处理，禁止盲目重放。

反馈模板见[贡献指南](../../CONTRIBUTING.md)。
