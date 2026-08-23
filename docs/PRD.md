# PromptsEngineering 模板需求总纲

日期：2026-08-23　版本：v1.0

## 1. 产品概述

PromptsEngineering 为目标仓库提供可移植的 Agent 工程治理模板。本轮目标是把客户端与服务端的高频操作收敛为稳定、可配置、可验证的命令协议，使自然语言快捷命令不依赖具体项目的 package alias。

成功指标：模板命令协议定向测试 100% 通过；所有命令从项目配置解析；未配置、平台不支持或 profile 不存在时 100% fail closed；模板默认值不包含目标项目产品参数。

## 2. 全局范围与边界

- 功能域：[模板命令面](prd-modules/template-command-surface/PRD.md)。
- In Scope：本地服务生命周期、客户端开发启动、客户端发行构建、服务端构建与部署的语义边界及统一入口。
- Out of Scope：具体端口、进程名、框架、签名、公证、部署拓扑、认证账号、数据库路径和项目专属别名。
- `RULES.md`、`agent.config.json`、业务源码与部署脚本继续由目标项目拥有。

## 3. 用户角色与核心场景

- 仓库维护者：在 `agent.config.json` 注册项目命令。
- Agent/自动化执行者：通过稳定命令入口执行并读取结构化结果。
- 模板维护者：升级协议和执行器而不覆盖项目差异。

核心场景为启动开发客户端、构建发行客户端、管理本地服务和区分构建与真实部署。

## 4. 非功能需求（NFR）

| NFR | 指标 | 目标 | 验证阶段 |
| --- | --- | --- | --- |
| 可移植性 | 模板硬编码产品参数 | 0 | TDD/QA |
| 安全性 | 缺失配置或非法维度 | 100% 阻断且退出码非零 | TDD/QA |
| 可审计性 | 执行结果 | 输出 STATUS、ACTION、目标维度、CWD 和 RUN_DIR | TDD/QA |
| 兼容性 | 既有服务端与部署入口 | 无破坏性回归 | QA |

## 5. 功能域索引

| 功能域 | 优先级/阶段 | 负责人 | 文档链接 | 依赖状态/Traceability | 当前 Gate 状态 |
| --- | --- | --- | --- | --- | --- |
| 模板命令面 | P0 / PRD 已确认 | @template-maintainers | [PRD.md](prd-modules/template-command-surface/PRD.md) | Traceability 已初始化 | 进入 ARCH |

## 6. 里程碑与依赖

| 里程碑 | 交付物 | Gate 条件 | 依赖状态 |
| --- | --- | --- | --- |
| M0 协议确认 | PRD、追溯矩阵 | Story/AC 完整 | 无外部依赖 |
| M1 模板实现 | 配置 schema、CLI/执行器、测试 | 定向与回归通过 | 依赖现有 agent.config loader |
| M2 传播验收 | 目标项目模板 dry-run/apply/convergence | project-owned 文件不变 | 依赖模板源合并 |

## 7. 风险与开放问题

| 风险 | 缓解措施 | 状态 |
| --- | --- | --- |
| 把 SaaS/Private 误当成通用产品模型 | 模板使用 profile/target 抽象，项目自行定义别名 | 已收敛 |
| 快捷命令与 package aliases 双重事实源 | 模板统一入口读取 agent.config，aliases 仅兼容 | 已收敛 |
| 开发、构建、部署语义混淆 | 协议和测试明确三者不可互相替代 | 已收敛 |

开放问题：无。

## 8. 用户体验设计（UX）

不适用。本功能域为 CLI/Agent 协议，无图形界面。

## 9. 追溯矩阵与发布 Gate

详见 [traceability-matrix.md](data/traceability-matrix.md)。PRD Gate 要求所有 Story 具备 Given-When-Then AC 和目标测试 ID；发布 Gate 要求模板源合并、传播 dry-run 收敛且目标项目 `RULES.md` 未被覆盖。
