# TASK-PLANNING-EXPERT Playbook

> 角色定义、输入输出与 DoD 见 `/AgentRoles/TASK-PLANNING-EXPERT.md`。
> 主 TASK 总纲模板见 `/docs/data/templates/task/TASK-TEMPLATE.md`；模块任务模板见 `/docs/task-modules/MODULE-TEMPLATE.md`。
> **路径基准**：本文件中所有相对路径以 `repo/`（Git 主 worktree 根）为基准；详见 `/AGENTS.md` §仓库拓扑。

## 核心工作流程

### 1. 输入分析阶段
- 读取 PRD 与 ARCH 模块清单，锁定必须生成 TASK 的完整模块集合
- 分析各模块 PRD 的用户故事与模块 ARCH 的组件、接口和依赖
- 识别时间、资源、技术约束条件

### 2. 任务分解阶段
- 按模块构建工作分解结构（WBS），确保粒度 1-5 人天
- 识别任务间的技术依赖和时序关系
- 进行关键路径分析（CPM）

### 3. 计划制定阶段
- 基于业务价值和技术依赖排定优先级
- 估算资源需求，制定时间线与里程碑
- 填充 DB 任务段（Expand/Migrate/Contract）

### 4. 跟踪监控阶段
- 从 task state、session 和 QA 证据核对执行状态与问题反馈
- 监控计划偏差和潜在风险；仅在范围、依赖或验收口径变化时更新 tracked 计划文档

## 进度跟踪机制

- **事实来源**：TASK 文档保存稳定计划；执行进度以 task state/session 为准，不把复选项或状态栏作为唯一信源。
- **节奏与回顾**：按需回顾完成证据、风险与关键路径；规划发生变化时同步"风险与缓解"及"依赖矩阵"。
- **可视化聚焦**：依赖矩阵、关键路径图、DB 任务表头和模块任务列表呈现规划重点；当前阻塞查任务运行态。
- **主从边界**：详细 WBS 只写模块 TASK，主 TASK 只保存模块索引、跨模块依赖、全局里程碑和风险。
- **里程碑驱动**：TASK 文档定义里程碑通过条件；当前准备度由 task state 和验证证据给出。

## 与其他专家的协作

| 协作方 | 输入 | 输出 | 要点 |
|--------|------|------|------|
| PRD | 主 PRD + 模块 PRD | TASK 按功能域拆分 | 获取 Story/AC 映射，确保任务覆盖所有需求 |
| ARCH | 主 ARCH + 模块 ARCH | TASK.md 按模块维护 WBS | 获取接口/数据/风险信息供任务拆解 |
| TDD | 主 TASK + 模块 TASK | 代码实现 + task state/session 证据 | 共享任务顺序、验收标准和风险关注项 |
| QA | 主 TASK + 模块 TASK | QA.md 引用 TASK | 验证测试映射（Story→AC→Test Case→任务ID） |
