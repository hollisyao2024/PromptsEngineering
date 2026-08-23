# 模板命令面 - PRD 模块

> **所属主 PRD**：[PRD.md](../../PRD.md)  
> **负责团队**：@template-maintainers  
> **最后更新**：2026-08-23  
> **状态**：✅ 已确认  
> **追溯说明**：Story/AC 维护在 `docs/data/traceability-matrix.md`

## 1. 模块概述

建立跨项目可复用的客户端和服务端命令协议。模板负责稳定语义、配置解析、阻断策略和结构化输出；项目负责真实命令、平台、profile、环境和验收细节。

## 2. 范围与约束

In Scope：

- `/private restart` 作为 private profile 的用户可见快捷语法。
- `/dev app <platform>` 与 `/build app <platform>` 的开发/发行语义。
- 本地服务生命周期与 build/ship 边界。
- 通过 `agent.config.json` 注册命令，缺失时 fail closed。

Out of Scope：

- 不提供 `/restart --target=private` 作为用户快捷命令。
- 不硬编码 `private` 的端口、服务名、数据库、框架或部署方式。
- 不覆盖目标项目 `RULES.md`、`agent.config.json` 或已有 package aliases。

## 3. 用户故事与验收

| Story ID | 验收标准（Given-When-Then） | Task ID | Test Case ID | QA 负责人 |
| --- | --- | --- | --- | --- |
| US-CMDSURF-001 | AC-CMDSURF-001-01：Given 用户请求 private 本地服务重启，When 使用模板快捷语法，Then 只暴露 `/private restart`，且文档不再推荐 `/restart --target=private`。 | TASK-CMDSURF-001 | TC-CMDSURF-001 | @qa |
| US-CMDSURF-002 | AC-CMDSURF-002-01：Given 项目配置了客户端平台命令，When 执行 `/dev app <platform>`，Then 统一入口启动开发客户端且不把构建成功当作运行成功。 | TASK-CMDSURF-002 | TC-CMDSURF-002 | @qa |
| US-CMDSURF-002 | AC-CMDSURF-002-02：Given 项目配置了客户端平台命令，When 执行 `/build app <platform>`，Then 统一入口只生成发行产物且不执行部署。 | TASK-CMDSURF-002 | TC-CMDSURF-003 | @qa |
| US-CMDSURF-003 | AC-CMDSURF-003-01：Given 命令、平台、环境或 profile 未配置，When 调用统一入口，Then 输出 `STATUS=BLOCKED`、明确下一动作并以非零状态退出，且不得跨 profile 回退。 | TASK-CMDSURF-003 | TC-CMDSURF-004 | @qa |
| US-CMDSURF-004 | AC-CMDSURF-004-01：Given 模板应用到目标项目，When 执行 dry-run、apply 和收敛 dry-run，Then 仅更新 template-owned 文件且 `RULES.md` 与 `agent.config.json` 保持项目所有。 | TASK-CMDSURF-004 | TC-CMDSURF-005 | @qa |

## 4. 非功能需求（NFR）

- NFR-CMDSURF-001：命令选择为确定性映射，不得执行未配置回退。
- NFR-CMDSURF-002：所有执行写入容器层运行目录并输出可解析状态。
- NFR-CMDSURF-003：模板默认配置不包含真实产品名、端口、URL、凭据或签名身份。
- NFR-CMDSURF-004：macOS、Linux、Windows 的 Node 调度路径保持兼容；项目命令自行声明平台约束。

## 5. 依赖与风险

依赖现有 `agent-cli.js`、`devops-run.js`、配置加载器与模板 manifest。主要风险是把项目 alias 当成模板规范，以及 private profile 隐式回退到 default；通过显式语法与定向负向测试缓解。

## 6. 里程碑与 Gate

- M0 PRD：Story/AC/Traceability 完成。
- M1 ARCH/TASK：配置和执行边界冻结、测试任务可执行。
- M2 TDD/QA：定向测试、相关全量回归和模板传播验证通过。

## 7. 追溯矩阵与验证

详见 [`docs/data/traceability-matrix.md`](../../data/traceability-matrix.md)。五项 AC 必须全部关联自动化测试或传播验收证据。

## 8. 用户体验设计（UX）

不适用；命令输出要求为简短、结构化、可恢复。

## 9. 开放问题

无。

## 10. 变更记录

| 版本 | 日期 | 描述 | 责任人 |
| --- | --- | --- | --- |
| v1.0 | 2026-08-23 | 建立通用客户端和服务端快捷命令协议 | @template-maintainers |

## 11. 自检清单

- [x] Story/AC 使用 Given-When-Then。
- [x] 已同步追溯矩阵。
- [x] 无图形界面，UX 不适用。
- [x] 已通知后续 ARCH/TASK/TDD/QA 阶段。
