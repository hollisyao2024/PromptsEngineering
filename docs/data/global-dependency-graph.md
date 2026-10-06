# 全局依赖关系图

## 模块关系

当前治理模块之间无循环依赖；`template-command-surface` 的息壤同步器复用模板 apply 生命周期，环境文件初始化继续由 apply 结果驱动。`business-testing` 复用既有 `qa verify` 本地门禁、治理标识解析与容器目录初始化，不引入新的外部服务。

```mermaid
graph TD
  CMDSURF[template-command-surface] --> APPLY[template apply lifecycle]
  APPLY --> ENV[environment-file-initialization]
  BIZTEST[business-testing] --> QAV[qa verify 本地门禁与回执]
  BIZTEST --> GOVID[governance-ids 标识解析]
  BIZTEST --> CONTDIR[容器目录按需初始化器]
```

## 外部与基础设施依赖

| 依赖 | 类型 | 约束 | 状态 |
| --- | --- | --- | --- |
| `agent.config.json` 配置加载器 | 模板内部 | 继续使用深合并和稀疏项目覆盖 | 已存在 |
| `agent-cli.js` 与执行器 | 模板内部 | 命令缺失时 fail closed | 已存在 |
| 目标项目命令 | 项目所有 | 模板不得提供业务回退 | 配置时可用 |
| Git `origin` 与 configured base branch | 外部远端/模板内部约定 | 全新 worktree 默认必须成功刷新并解析 commit；显式 skip 才可离线 | 已存在 |
| Git `origin` feature refs 与 GitHub PR | 外部远端 | 远端同名分支由 resume 显式接管；QA/merge 绑定 base/head SHA | 已存在 |
| GitHub CI / merge queue | 外部能力 | 本功能明确不依赖、不创建、不触发 | 禁用 |
| 息壤官方 GitHub 仓库 | 外部远端 | 普通模板同步 required fetch 固定 URL/branch，并锁定本次 SHA | 新增 |
| 模板 SHA 临时快照 | 模板内部运行态 | 必须调用快照内最新 updater/manifest；结束后精确清理 | 新增 |
| 项目测试驱动（Playwright、Maestro、XCUITest、Espresso 等） | 项目所有 | 模板不内置驱动，只约定 JUnit XML、用例命名与 `platform` 标签；无报告即无证据 | 配置时可用 |
| 模块 PRD 原子 AC 表与 `PATHS.md` | 项目所有 | 业务验收的唯一事实源；模板只提供模板、校验与门禁 | 配置时可用 |
| 业务测试结果目录（容器 `tmp`） | 模板内部运行态 | 仅 `qa run` 创建；绑定 HEAD、配置摘要与报告 SHA256，不跨电脑 | 新增 |

范围变化或新增模块时必须更新本图并执行依赖环检查。
