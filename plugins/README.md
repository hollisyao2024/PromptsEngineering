# 息壤插件源码与打包

[用户上手](../docs/guides/plugin-quickstart.md) · [插件包说明](xirang/README.md)

`xirang/` 是自包含的 `0.1.1` 插件；Claude Code 与 OpenAI portable 清单共享四个技能及包内资源。根目录的两个 marketplace 文件负责发现，不写入已有项目的模板分发清单。

维护者使用 Node、Git、`zip`、`unzip` 验证与打包。消费者运行项目探测器只需要 Node 和可用的 Git，不需要打包工具。

```bash
pnpm agent -- test --file plugins/__tests__/inspect-project.test.cjs -- node --test
pnpm agent -- test --file plugins/__tests__/package.test.cjs -- node --test
pnpm agent -- test --file plugins/__tests__/adoption.test.cjs -- node --test
node plugins/pack.cjs --output "/已有产物目录/xirang-0.1.1.zip"
```

输出父目录必须存在，目标 ZIP 必须不存在且位于插件目录之外。打包器使用包含 MIT 正文的固定文件白名单、拒绝缺失文件和包内符号链接，失败只清理本次临时目录，不覆盖旧归档。

ZIP 根目录即插件根目录，不包含市场注册清单或整套息壤源码。它是本地测试与未来提交准备材料，不是公共市场已批准的发行版。插件版本与模板版本独立；改变插件行为或资源时同步更新两个插件 manifest。

`adoption.test.cjs` 在隔离目录创建本地 bare remote，调用真实 updater 和任务/worktree CLI，验证双任务隔离与未知结果恢复，不联系 GitHub。它不证明真人操作、模型技能触发或完整 QA 合并。
