# 模型作业能力包

本包管理需求、架构、任务、TDD、QA、交付、worktree 和长任务恢复。[manifest.json](manifest.json) 是能力入口，`applyManifest` 引用唯一分发规则。公开执行路径继续为 `AgentRoles/`、`infra/scripts/` 和 `infra/templates/`，保持现有项目入口兼容。

只采用作业包，不生成 `architecture/`、`apps/`、数据库或 UI 业务文件。技术选型、组件源码与生成器在息壤源仓库的 `architecture/` 中维护；实际项目需要时再取得轻量入口。文件更新机制由 `tooling/xirang/` 提供。

## 采用与更新

首次从息壤源仓库向已存在的目标目录安装；已有 Git 项目使用专用 linked worktree：

~~~bash
pnpm agent -- template update "<目标目录或目标-worktree>" --scope agent --dry-run
pnpm agent -- template update "<目标目录或目标-worktree>" --scope agent
~~~

已接入项目在自身干净的专用 worktree 中更新：

~~~bash
pnpm agent -- template sync --scope agent
~~~

默认 `template sync` 或 `--scope all` 更新作业包及已采用的架构选择；`--scope agent` 保持已有架构文件，不执行卸载。新增轻量架构入口用 `template sync --include architecture`，不能同时指定 `--scope agent`。`include` 不生成应用，后续需根据项目配置执行 `architecture plan/init/check`。

## 所有权与基线

作业协议、模板工具由 `manifest` 管理。`xirang.lock.json` 和 `.xirang/baselines/` 必须随项目提交，普通更新根据上次基线检查本地定制；它们不能由手工复制文件替代。

旧项目缺少基线时，先检查 `adoption required` 的差异，再用 `template sync --adopt --dry-run` 预演。确认后的 `--adopt` 保留现有内容作为项目定制并建立依据，不等于所有旧协议和脚本已经换成新实现。旧引导器不支持参数时，从新版息壤源使用 `template update "<目标-worktree>" --scope agent --adopt` 完成一次引导，同样先 `dry-run`。

项目规则放 `RULES.md`，参数放稀疏 `agent.config.json`，真实业务、架构决策与部署实现保持项目所有。模板协议需要改进时在息壤源修改后分发；已有受管文件的本地漂移必须按计划处理冲突。

执行规范见 [AGENTS.md](../AGENTS.md) 和[通用约定](../docs/CONVENTIONS.md)。更新后继续 TDD 同步、推送、QA 验证、合并及 completion guard；中断用 `node tooling/xirang/resume.js` 恢复冻结计划。
