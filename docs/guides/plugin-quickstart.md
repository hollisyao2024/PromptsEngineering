# 插件上手：息壤 Xirang

[首页](../../README.md) · [English overview](../../README.en.md) · [模板接入](quickstart.md) · [并行协作](parallel-collaboration.md) · [完整参考](template-reference.md) · [试用记录表](../promotion/trial-feedback.md)

插件提供四个工作入口，实际项目仍使用息壤自己的 CLI、任务状态与规则。源码包在 [plugins/xirang](../../plugins/xirang/README.md)，适用于可以读写项目文件并执行本地命令的环境。

当前版本以所选源码中的 [portable 清单](../../plugins/xirang/plugin.json) 和 [Claude Code 清单](../../plugins/xirang/.claude-plugin/plugin.json) 为准，两份版本应一致；历史版本的验证结果见文末，不自动外推到当前版本或其他客户端。

## 先确认安装对象

- **插件安装**：让 AI 能发现四项工作流程。
- **项目接入**：给目标项目安装规则、CLI 与更新基线，须另行预演和应用。
- **任务交付**：在项目内完成实现、验证、QA 和合并。

三者不会因其中一步成功而自动全部完成。本版本无 MCP 服务或 hook，不修改个人权限策略，也不会自动拉起多个代理。

| 协作方式 | 插件提供的入口与边界 |
| --- | --- |
| 多模型接力 | 通过恢复入口读取同一任务的状态、证据与胶囊；先交接，再由接手者继续，不同时写同一 worktree |
| 多人多机协作 | 各自登记任务、建立独立分支和 worktree；跨电脑交付重新核对远端 SHA 并执行本机 QA |
| 单机多任务并行 | 各 AI 会话使用不同任务 ID 和 worktree，独立安装依赖、修改和验证 |

插件不绑定一个模型，但每个宿主仍须通过[工具接入检查](quickstart.md#工具接入检查)。现有安装入口不代表所有客户端、版本和权限组合均已验证。worktree 不隔离端口、共享服务、数据库或测试数据，共享接口与锁文件仍须约定负责人和合并顺序；插件不保证零冲突。

## Claude Code

从本机完整息壤源仓库注册市场，替换占位路径：

```bash
claude plugin validate "/息壤源绝对路径"
claude plugin marketplace add "/息壤源绝对路径"
claude plugin install xirang@xirang-plugins
```

按宿主提示刷新插件或新建会话，在技能列表核对 `xirang-setup`、`xirang-task`、`xirang-resume`、`xirang-deliver`。Claude Code 的调用名形如 `/xirang:xirang-setup`。

远端分发入口为官方息壤 GitHub 仓库；本地版本验证稳定后，可按 Claude Code 的市场命令使用 `hollisyao2024/PromptsEngineering`。这是项目自建市场，不是官方市场收录。

移除时使用 Claude Code 的插件管理界面卸载 `xirang@xirang-plugins`；不再使用该市场时执行 `claude plugin marketplace remove xirang-plugins`。移除插件不会卸载已接入项目的模板文件或删除项目任务。

2026-10-20 已用 Claude Code `2.1.299` 从 GitHub 市场 `hollisyao2024/PromptsEngineering` 实际安装、核对四项技能并卸载，见下方验证范围。

首次接入新目录或已有 Git 项目均使用下文的 `--initialize` 文件安装模式，不为安装创建目标分支或 worktree。已有文件、配置与 Git 元数据按所有权保留；预演有冲突时先核对，不以删除未跟踪文件或覆盖本地配置来通过门禁。个人配置与环境文件的忽略和保留方式以 updater 的实际计划、目标规则为准。

## Codex / ChatGPT 桌面本地市场

仓库包含 `.agents/plugins/marketplace.json`，指向同一份插件。支持本地市场的客户端可从插件目录选择“息壤 Xirang”并安装；具体入口以当前客户端版本为准。纯网页会话不能据此获得本地 shell。

以下为验证记录采用的 Codex CLI 注册与安装命令；执行前确认当前客户端提供这些子命令。注册和安装会修改使用者本机的市场/插件配置，由试用者主动执行：

```bash
codex plugin marketplace add "/息壤源绝对路径"
codex plugin list --marketplace xirang-plugins --available --json
codex plugin add xirang@xirang-plugins
```

如仅想检查目录发现而不注册市场，可使用单次参数：

```bash
codex -c 'marketplaces.xirang-plugins.source_type="local"' -c 'marketplaces.xirang-plugins.source="/息壤源绝对路径"' plugin list --marketplace xirang-plugins --available --json
```

成功输出应包含 `pluginId: xirang@xirang-plugins`、与所选源码清单一致的 `version` 和 `installPolicy: AVAILABLE`。若只有空列表，先确认市场是否被当前客户端加载；命令退出 0 不能当作插件已发现。安装后仍须核对四项技能是否实际可用。

移除：

```bash
codex plugin remove xirang@xirang-plugins
codex plugin marketplace remove xirang-plugins
```

普通用户安装方式见[官方打包指南](https://developers.openai.com/plugins/build/plugins)；本地配置字段见[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。不要通过放宽运行权限来解决市场或路径错误。

## 第一次使用

在可丢弃的演练目录中依次试：

1. “给这个项目接入息壤，先展示变更范围。”明确目标绝对路径，取得并核实官方源目录，读取源规则后，用源自身的 `pnpm agent -- template update "<目标目录>" --scope agent --initialize --dry-run` 预演，再安装和复查。首次接入报告实际源 SHA，不声称自动取得最新提交；初始化不执行目标 Git 生命周期。插件不捆绑模板源码或 updater，无法取得来源时报告缺口。
2. 完成目标基础规则读取、项目 Git/远端与实际检查命令配置后：“用息壤启动任务 demo-a，只新增 docs/demo-a.md，内容为三条协作约定；验收为恰有三条约定、Markdown 链接有效且无运行逻辑变化。”
3. 第二个会话使用任务 demo-b 和另一个文件。检查两个 `NEXT_CWD` 不同，主工作区没有混入它们的修改。
4. “只读检查 demo-a 的交付条件。”此时技能应列出证据缺口，不自动提交或合并。
5. 明确要求完成交付时，按项目规则执行完整流水线。中断后用已知任务 ID 恢复；未知副作用先核实。

完整人工演练见[双任务教程](parallel-collaboration.md)。不要把教程成功或脚本验证写成真实用户反馈。

已接入项目升级时，在该项目说“更新息壤模板”，登记更新任务并创建干净专属 worktree，在 `NEXT_CWD` 执行 `pnpm agent -- template sync`，固定官方 `main` 的获取结果再交付。`--scope agent` 只更新作业包并保留已有架构；需要架构入口时单独使用 `--include architecture`，不能与 `--scope agent` 同传。详见[完整参考](template-reference.md)。

同机换模型接手已有任务时，先交接任务 ID、worktree、分支和证据，原执行器停止写入；接手者读取规则后依次 `task resume`、`task context`，未知副作用先核实。Git 不自动同步任务状态、未提交内容、本机锁、胶囊或 QA 回执；跨电脑接手先按本机任务门禁登记或恢复任务，再恢复远端分支并重做本机 QA，不能把恢复技能当作自动下载状态。

明确授权的交付仍按 `tdd sync → tdd push → qa plan → qa verify → qa merge` 推进，记录阶段转换和绑定最终 HEAD 的测试证据。合并后切回主 worktree 核对本地/远端主干，执行完成门禁并关闭任务；通过 `task exec` 留证时显式使用 `--cwd main`。步骤与异常处理见[并行教程收尾](parallel-collaboration.md#合并后在主-worktree-收尾)。插件安装不授权部署、市场提交或外部发布。

## 历史验证范围

下表保留当时的客户端、版本与验证范围，不能据此认定当前源码已完成宿主安装、模型触发、多人跨电脑或图形界面实测。当前源码版本从清单读取；新增静态或打包检查也不替代这些实测。

| 项目 | 本轮证据范围 |
| --- | --- |
| Codex CLI | `0.163.0-alpha.10.2`，0.1.0 已实际安装、调用四项技能并卸载，个人配置恢复；0.1.1 仅更新元数据与许可 |
| 插件 ZIP | 解压后独立运行探测器，包内引用有效，凭据与无关文件不进入归档 |
| 项目接入与隔离 | 自动测试调用真实 updater、任务与 worktree 命令；使用隔离的本地 bare remote |
| Claude Code | `2.1.299`，0.1.1 从 GitHub 市场安装，`plugin details` 列出四项技能、无 MCP/hook；在一次性 Git 项目完成接入收敛、隔离 worktree、中断恢复（转为待核实）与只读交付检查（前后快照一致）；卸载后个人插件配置与备份一致。CLI 未登录，未做模型驱动的技能触发；0.1.2 仅新增隐私政策与 `privacyPolicyUrl`，通过 `plugin validate --strict` |
| ChatGPT 图形界面 | 尚未做客户端安装、四技能真实触发与卸载实测 |
| 真实远端交付 | 0.1.0 在已有下游项目的隔离 worktree 内移除再接入模板，完成真实 GitHub PR → QA → 合并与推送；未据此宣称多人跨电脑验证 |

支持信息、失败位置和是否需作者介入，记录到[试用表](../promotion/trial-feedback.md)。MIT 正文见[许可](../../LICENSE)。公开提交需要发布者身份验证和平台检查；模板安装、提交审核、公开上架须分别报告。Claude Desktop 的提交操作见[可复制提示词](claude-marketplace-submit-prompt.md)。
