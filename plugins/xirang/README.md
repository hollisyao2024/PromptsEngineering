# 息壤 Xirang 插件 0.1.0

给支持本地项目文件和 shell 的 AI 编程环境增加四个入口：接入息壤、启动隔离任务、恢复任务、检查或完成交付。插件复用目标项目 CLI；不包含完整模板、MCP 服务、hook 或自动代理调度。

| 技能 | 使用提示 |
| --- | --- |
| xirang-setup | 给这个项目接入息壤，先展示变更范围 |
| xirang-task | 用息壤启动一个独立任务，先明确验收 |
| xirang-resume | 恢复息壤任务 demo-a，先核实未知结果 |
| xirang-deliver | 只读检查 demo-a 的交付条件 |

Claude Code 的完整技能名形如 `/xirang:xirang-setup`。其他宿主按其技能发现界面使用，优先自然语言描述目标。需要用户授权的交付动作不会由安装自动执行。

## 包内资源

`plugin.json` 是 OpenAI portable 入口，`.claude-plugin/plugin.json` 是 Claude Code 入口。两者共享 `skills/`、`references/`、`scripts/` 和 `assets/`，无需从插件缓存跨目录引用源仓库。

只读探测示例，在解压后的插件目录运行：

```bash
node scripts/inspect-project.cjs --project "<已有目录>"
```

输出 READY 只说明规则、入口和基线存在，不证明业务测试、模板来源哈希或所有客户端兼容性。缺失规则返回 INCOMPLETE；有模板文件但缺 Git 返回 NEEDS_GIT。探测器不会创建任务或工作区。

## 安装与移除

Claude Code：从完整息壤仓库注册其市场，再安装 `xirang@xirang-plugins`；本地试验也可使用宿主支持的 plugin-dir 入口。OpenAI：仓库级 `.agents/plugins/marketplace.json` 指向同一目录，可在支持本地市场的客户端中发现并安装。解压 ZIP 本身不会自动注册市场。

完整安装、移除、验证范围与演练见源仓库的 `docs/guides/plugin-quickstart.md`，在线入口：[息壤 GitHub](https://github.com/hollisyao2024/PromptsEngineering)。不要为安装修改个人全局安全策略。安装后先核对宿主实际列出的四项技能。

## 验证与许可边界

本包是首版本地分发材料，尚未提交公共市场。自动化检查与实际客户端激活是不同证据；具体实测范围以项目的插件上手文档为准。不承诺所有客户端或纯网页会话可执行本地 Git/pnpm。

源项目 package.json 声明 MIT，但根目录许可正文尚待核对补齐；此包不扩展第三方授权。公开再分发前先确认适用条款。
