# 息壤插件源码与打包

[用户上手](../docs/guides/plugin-quickstart.md) · [插件包说明](xirang/README.md)

`xirang/` 是自包含的技能插件；当前版本以 [portable 清单](xirang/plugin.json) 和 [Claude Code 清单](xirang/.claude-plugin/plugin.json) 为准，两份版本须一致。两种入口共享四个技能及包内资源。根目录的两个 marketplace 文件负责发现，不写入已有项目的模板分发清单。

插件安装、项目首次接入、架构生成和任务交付是独立结果。首次接入使用已核实源中的 `template update "<目标>" --scope agent --initialize`，先预演、安装后复查；已接入项目更新仍走专属任务/worktree 中的官方 `template sync`。插件不捆绑 updater、不自动调度代理或同步状态，也不会因安装而获得项目权限，详见[用户上手](../docs/guides/plugin-quickstart.md)。

维护者使用 Node、Git、`zip`（Windows 改用系统自带 `tar.exe`）、`unzip` 验证与打包。消费者运行项目探测器只需要 Node 和可用的 Git，不需要打包工具。

```bash
pnpm agent -- test --file plugins/__tests__/inspect-project.test.cjs -- node --test
pnpm agent -- test --file plugins/__tests__/package.test.cjs -- node --test
pnpm agent -- test --file plugins/__tests__/adoption.test.cjs -- node --test
node plugins/pack.cjs --output "/已有产物目录/xirang-<插件清单版本>.zip"
```

将 `<插件清单版本>` 替换为本次固定源码的真实版本。输出父目录必须存在，目标 ZIP 必须不存在且位于插件目录之外。打包器使用包含 MIT 正文与隐私政策的固定文件白名单、拒绝缺失文件和包内符号链接，失败只清理本次临时目录，不覆盖旧归档。

ZIP 根目录即插件根目录，不包含市场注册清单或整套息壤源码。它是本地测试与未来提交准备材料，不是公共市场已批准的发行版。插件版本与模板版本独立；改变插件行为或资源时同步更新两个插件 manifest。

`adoption.test.cjs` 在隔离目录创建本地 bare remote，调用真实 updater 和任务/worktree CLI，验证双任务隔离与未知结果恢复，不联系 GitHub。它不证明真人操作、模型技能触发或完整 QA 合并。

多模型接力继续已交接的同一任务；多人多机或单机多任务并行各用独立任务与 worktree。文件隔离不等于共享服务、端口、数据库或测试数据隔离。Git 不自动同步本机任务状态、未提交内容、锁、胶囊或 QA 回执，换电脑合并需重新执行本机 QA；打包通过也不证明所有客户端兼容。
