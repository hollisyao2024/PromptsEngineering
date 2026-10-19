# 插件上手：息壤 0.1.2

[首页](../../README.md) · [模板接入](quickstart.md) · [双任务演练](parallel-collaboration.md) · [试用记录表](../promotion/trial-feedback.md)

插件提供四个工作入口，实际项目仍使用息壤自己的 CLI、任务状态与规则。源码包在 [plugins/xirang](../../plugins/xirang/README.md)，适用于可以读写项目文件并执行本地命令的环境。

## 先确认安装对象

- **插件安装**：让 AI 能发现四项工作流程。
- **项目接入**：给目标项目安装规则、CLI 与更新基线，须另行预演和应用。
- **任务交付**：在项目内完成实现、验证、QA 和合并。

三者不会因其中一步成功而自动全部完成。本版本无 MCP 服务或 hook，不修改个人权限策略，也不会自动拉起多个代理。

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

首次接入已有 Git 项目时，若主项目尚未忽略 `.codex/config.toml`，预演会 `STATUS=BLOCKED`；先在该项目 `.gitignore` 加入此路径。接入分支合回主工作区前，删除初始化在主工作区留下、且与提交内容一致的未跟踪 `.env*.example`。

## Codex / ChatGPT 桌面本地市场

仓库包含 `.agents/plugins/marketplace.json`，指向同一份插件。支持本地市场的客户端可从插件目录选择“息壤 Xirang”并安装；具体入口以当前客户端版本为准。纯网页会话不能据此获得本地 shell。

Codex CLI 已支持下列注册与安装命令；这两步会修改使用者本机的市场/插件配置，由试用者主动执行：

```bash
codex plugin marketplace add "/息壤源绝对路径"
codex plugin list --marketplace xirang-plugins --available --json
codex plugin add xirang@xirang-plugins
```

如仅想检查目录发现而不注册市场，可使用单次参数：

```bash
codex -c 'marketplaces.xirang-plugins.source_type="local"' -c 'marketplaces.xirang-plugins.source="/息壤源绝对路径"' plugin list --marketplace xirang-plugins --available --json
```

成功输出应包含 `pluginId: xirang@xirang-plugins`、`version: 0.1.2` 和 `installPolicy: AVAILABLE`。若只有空列表，先确认市场是否被当前客户端加载；命令退出 0 不能当作插件已发现。

移除：

```bash
codex plugin remove xirang@xirang-plugins
codex plugin marketplace remove xirang-plugins
```

普通用户安装方式见[官方打包指南](https://developers.openai.com/plugins/build/plugins)；本地配置字段见[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)。不要通过放宽运行权限来解决市场或路径错误。

## 第一次使用

在可丢弃的演练目录中依次试：

1. “给这个项目接入息壤，先展示变更范围。”核对目标与官方源 commit，再执行已授权的接入。
2. 完成项目 Git/远端与实际检查命令配置后：“用息壤启动任务 demo-a，只新增 docs/demo-a.md，内容为三条协作约定。”
3. 第二个会话使用任务 demo-b 和另一个文件。检查两个 `NEXT_CWD` 不同，主工作区没有混入它们的修改。
4. “只读检查 demo-a 的交付条件。”此时技能应列出证据缺口，不自动提交或合并。
5. 明确要求完成交付时，按项目规则执行完整流水线。中断后用已知任务 ID 恢复；未知副作用先核实。

完整人工演练见[双任务教程](parallel-collaboration.md)。不要把教程成功或脚本验证写成真实用户反馈。

## 验证范围

| 项目 | 本轮证据范围 |
| --- | --- |
| Codex CLI | `0.163.0-alpha.10.2`，0.1.0 已实际安装、调用四项技能并卸载，个人配置恢复；0.1.1 仅更新元数据与许可 |
| 插件 ZIP | 解压后独立运行探测器，包内引用有效，凭据与无关文件不进入归档 |
| 项目接入与隔离 | 自动测试调用真实 updater、任务与 worktree 命令；使用隔离的本地 bare remote |
| Claude Code | `2.1.299`，0.1.1 从 GitHub 市场安装，`plugin details` 列出四项技能、无 MCP/hook；在一次性 Git 项目完成接入收敛、隔离 worktree、中断恢复（转为待核实）与只读交付检查（前后快照一致）；卸载后个人插件配置与备份一致。CLI 未登录，未做模型驱动的技能触发；0.1.2 仅新增隐私政策与 `privacyPolicyUrl`，通过 `plugin validate --strict` |
| ChatGPT 图形界面 | 尚未做客户端安装、四技能真实触发与卸载实测 |
| 真实远端交付 | 0.1.0 在已有下游项目的隔离 worktree 内移除再接入模板，完成真实 GitHub PR → QA → 合并与推送；未据此宣称多人跨电脑验证 |

支持信息、失败位置和是否需作者介入，记录到[试用表](../promotion/trial-feedback.md)。MIT 正文见[许可](../../LICENSE)。公开提交需要发布者身份验证和平台检查；模板安装、提交审核、公开上架须分别报告。Claude Desktop 的提交操作见[可复制提示词](claude-marketplace-submit-prompt.md)。
