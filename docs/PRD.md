# PromptsEngineering 模板需求总纲

日期：2026-09-05　版本：v1.4

## 1. 产品概述

PromptsEngineering 为目标仓库提供可移植的 Agent 工程治理模板。本轮目标覆盖稳定命令协议、目标项目首次初始化时的环境变量文件骨架，以及不依赖 GitHub CI 的多电脑同权协作与主干合并保护。

成功指标：模板命令协议定向测试 100% 通过；mac、win、ios、android 的 dev/build、private 变体、本地服务生命周期及服务端 build 环境矩阵在模板更新后均可解析；平台不支持、profile 不存在或项目显式清空命令时 100% fail closed；全新 worktree 默认仅在 `origin` 基线刷新成功后创建且初始 HEAD 等于本次解析的远端 base commit；远端同名任务分支不会被误建、可由另一台电脑精确恢复；QA 与合并绑定配置主干和功能分支 SHA；并发更新不得覆盖已进入远端主干的提交；模板默认值不包含目标项目产品参数。

## 2. 全局范围与边界

- 功能域：[模板命令面](prd-modules/template-command-surface/PRD.md)、[环境文件初始化](prd-modules/environment-file-initialization/PRD.md)。
- In Scope：本地服务生命周期、客户端开发启动、客户端发行构建、服务端构建与部署的语义边界及统一入口；首次初始化缺失的环境 example 与本地实际文件；稳定命令按需自动创建缺失的容器层目录；全新 worktree 的远端基线刷新、确定 SHA 创建与显式离线逃生语义；远端同名分支保护、跨电脑恢复、QA 双 SHA 回执、配置主干合并与普通非强制 push 并发保护。
- Out of Scope：具体端口、进程名、框架、签名、公证、部署拓扑、认证账号、数据库路径和真实部署默认命令；固定专家电脑、机器角色、远程分布式锁、GitHub CI、GitHub merge queue，以及对本地 QA 的服务端零信任证明。
- `RULES.md`、`agent.config.json`、业务源码与部署脚本继续由目标项目拥有。

## 3. 用户角色与核心场景

- 仓库维护者：在 `agent.config.json` 注册项目命令。
- Agent/自动化执行者：通过稳定命令入口执行并读取结构化结果。
- 模板维护者：升级协议和执行器而不覆盖项目差异。
- 项目协作者：可在任意电脑执行任意专家阶段，并以相同仓库权限创建/合并 PR 或普通更新配置主干。

核心场景为启动开发客户端、构建发行客户端、管理本地服务和区分构建与真实部署。

## 4. 非功能需求（NFR）

| NFR | 指标 | 目标 | 验证阶段 |
| --- | --- | --- | --- |
| 可移植性 | 模板硬编码产品参数 | 0 | TDD/QA |
| 安全性 | 缺失配置或非法维度 | 100% 阻断且退出码非零 | TDD/QA |
| 可审计性 | 执行结果 | 输出 STATUS、ACTION、目标维度、CWD 和 RUN_DIR | TDD/QA |
| 兼容性 | 既有服务端与部署入口 | 无破坏性回归 | QA |
| 可恢复性 | 缺失容器目录 | 首次需要写入时 100% 自动创建；非法路径或权限错误 100% 明确阻断 | TDD/QA |
| 基线一致性 | 全新 worktree 初始 HEAD | 默认模式 100% 等于本次 fetch 后解析的 `origin/<base>` commit；失败时不创建 branch/worktree/session | TDD/QA |
| 多机一致性 | 远端分支恢复与 QA 合并 | 同名远端分支 100% 不被误建；base/head SHA 漂移 100% 阻断旧 QA 合并；主干 0 次 force push | TDD/QA |

## 5. 功能域索引

| 功能域 | 优先级/阶段 | 负责人 | 文档链接 | 依赖状态/Traceability | 当前 Gate 状态 |
| --- | --- | --- | --- | --- | --- |
| 模板命令面 | P0 / PRD 已确认 | @template-maintainers | [PRD.md](prd-modules/template-command-surface/PRD.md) | Traceability 已初始化 | 进入 ARCH |
| 环境文件初始化 | P0 / PRD 已确认 | @template-maintainers | [PRD.md](prd-modules/environment-file-initialization/PRD.md) | Traceability 已初始化 | 进入 ARCH |

## 6. 里程碑与依赖

| 里程碑 | 交付物 | Gate 条件 | 依赖状态 |
| --- | --- | --- | --- |
| M0 协议确认 | PRD、追溯矩阵 | Story/AC 完整 | 无外部依赖 |
| M1 模板实现 | 配置 schema、CLI/执行器、测试 | 定向与回归通过 | 依赖现有 agent.config loader |
| M2 传播验收 | 目标项目模板 dry-run/apply/convergence | project-owned 文件不变 | 依赖模板源合并 |
| M3 环境文件初始化 | 六个环境文件首次生成 | example 可跟踪、实际文件被忽略、已有内容不变 | 依赖模板 apply 引擎与 `.gitignore` 合并 |
| M4 多机同权协作 | 远端分支恢复、QA SHA 回执、配置主干安全合并 | 三份独立 clone 模拟、相关回归与模板收敛通过 | 依赖 Git origin、GitHub PR API 和本地 QA 命令 |

## 7. 风险与开放问题

| 风险 | 缓解措施 | 状态 |
| --- | --- | --- |
| 把 SaaS/Private 误当成通用产品模型 | 模板使用 profile/target 抽象，项目自行定义别名 | 已收敛 |
| 快捷命令与 package aliases 双重事实源 | 模板统一入口读取 agent.config，aliases 仅兼容 | 已收敛 |
| 开发、构建、部署语义混淆 | 协议和测试明确三者不可互相替代 | 已收敛 |
| 首次初始化覆盖项目已有环境配置 | 六个文件统一采用 init-if-missing，已有文件内容逐字节保持不变 | 已收敛 |
| 目录初始化污染只读命令或覆盖已有内容 | 仅在命令需要写入时幂等创建；负向测试验证非法路径与现有内容保护 | 已收敛 |
| 缓存的 `origin/<base>` 被误当成最新远端基线 | 默认 fetch 失败即阻断；只有显式 `--skip-fetch` 可使用缓存 remote ref 或本地 base，并输出未验证状态 | 已收敛 |
| 本机锁被误当成跨电脑 merge queue | 文档明确本机锁只保护本机生命周期；跨电脑以远端 SHA 比较和非快进拒绝协调 | 已确认方案 |
| QA 后主干或功能分支发生变化 | `qa verify` 记录 base/head SHA，`qa merge` 重新 fetch 并在任一漂移时使回执失效 | 已确认方案 |
| 所有协作者均可直接更新主干且无 GitHub CI | 明确信任边界；模板防误操作但不宣称服务端强制 QA，GitHub 仅禁止主干 force push 与删除 | 已接受约束 |

开放问题：无。

## 8. 用户体验设计（UX）

不适用。本功能域为 CLI/Agent 协议，无图形界面。

## 9. 追溯矩阵与发布 Gate

详见 [traceability-matrix.md](data/traceability-matrix.md)。PRD Gate 要求所有 Story 具备 Given-When-Then AC 和目标测试 ID；发布 Gate 要求模板源合并、传播 dry-run 收敛且目标项目 `RULES.md` 未被覆盖。
