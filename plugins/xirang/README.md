# Xirang / 息壤 plugin 0.1.2

Four skills for local AI coding projects: adopt Xirang, start isolated tasks, resume work, and verify delivery. Skills define the workflows; the plugin packages them for installation and updates; the project template supplies the CLI, rules, ownership baselines, and lifecycle gates.

Requires local project files and a shell, Git, Node.js, and pnpm. This skills-only package has no MCP server, hooks, telemetry service, or automatic agent scheduler. Installing it does not install the project template or authorize commits, pushes, or merges.

Install in Claude Code:

```bash
claude plugin marketplace add hollisyao2024/PromptsEngineering
claude plugin install xirang@xirang-plugins
```

For Codex CLI installation and removal, see the [online guide](https://github.com/hollisyao2024/PromptsEngineering/blob/main/docs/guides/plugin-quickstart.md). Public-directory approval is a separate result. A web chat without local execution cannot run these workflows.

给支持本地项目文件和 shell 的 AI 编程环境增加四个入口：接入息壤、启动隔离任务、恢复任务、检查或完成交付。插件复用目标项目 CLI；不包含完整模板、MCP 服务、hook 或自动代理调度。

| 技能 | 使用提示 |
| --- | --- |
| xirang-setup | 给这个项目接入息壤，先展示变更范围 |
| xirang-task | 用息壤启动一个独立任务，先明确验收 |
| xirang-resume | 恢复息壤任务 demo-a，先核实未知结果 |
| xirang-deliver | 只读检查 demo-a 的交付条件 |

Claude Code 的完整技能名形如 `/xirang:xirang-setup`。其他宿主按其技能发现界面使用，优先自然语言描述目标。需要用户授权的交付动作不会由安装自动执行。

## 包内资源

`plugin.json` 是 OpenAI portable 入口，`.claude-plugin/plugin.json` 是 Claude Code 入口。两者共享 `skills/`、`references/`、`scripts/`、`assets/` 与 `PRIVACY.md`，无需从插件缓存跨目录引用源仓库。

只读探测示例，在解压后的插件目录运行：

```bash
node scripts/inspect-project.cjs --project "<已有目录>"
```

输出 READY 只说明规则、入口和基线存在，不证明业务测试、模板来源哈希或所有客户端兼容性。缺失规则返回 INCOMPLETE；有模板文件但缺 Git 返回 NEEDS_GIT。探测器不会创建任务或工作区。

## 安装与移除

Claude Code：从完整息壤仓库注册其市场，再安装 `xirang@xirang-plugins`；本地试验也可使用宿主支持的 plugin-dir 入口。OpenAI：仓库级 `.agents/plugins/marketplace.json` 指向同一目录，可在支持本地市场的客户端中发现并安装。解压 ZIP 本身不会自动注册市场。

完整安装、移除、验证范围与演练见源仓库的 `docs/guides/plugin-quickstart.md`，在线入口：[息壤 GitHub](https://github.com/hollisyao2024/PromptsEngineering)。不要为安装修改个人全局安全策略。安装后先核对宿主实际列出的四项技能。

## 验证与许可边界

本包用于仓库分发和公共市场提交准备；打包成功不代表市场审核通过。0.1.0 已在 Codex CLI 做实际安装、技能调用与卸载，并在下游项目验证真实 GitHub PR、QA 与合并；0.1.1 仅调整元数据、许可和说明。Claude Code `2.1.299` 已验证 0.1.1 的市场安装、四项技能清单、一次性项目流程与卸载，模型驱动的技能触发未验证；0.1.2 仅新增隐私政策。ChatGPT 图形界面仍需独立实测。不承诺所有客户端或纯网页会话可执行本地 Git/pnpm。

## Data and permissions

The packaged inspector reads the selected project's local metadata without changing it. Skills can ask the host to run project commands after the applicable user and project gates. Those commands may read or modify project files and contact GitHub or the configured template source. Credentials stay in the project's existing ignored configuration; do not place them in this package or paste them into a chat. The host's model, data, and permission policies still apply. No separate Xirang account or hosted service is provided by this package. See the [privacy policy](PRIVACY.md).

## License and support

MIT; see [LICENSE](LICENSE). This grant does not replace third-party license terms. Report reproducible problems through [GitHub Issues](https://github.com/hollisyao2024/PromptsEngineering/issues); include the client version and a redacted error, without tokens or project secrets.
