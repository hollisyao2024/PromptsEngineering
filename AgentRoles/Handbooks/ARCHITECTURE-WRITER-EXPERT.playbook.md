# ARCHITECTURE-WRITER-EXPERT Playbook

> 角色定义、输入输出与 DoD 见 `/AgentRoles/ARCHITECTURE-WRITER-EXPERT.md`。
> ARCH 模板见 `/docs/data/templates/arch/ARCH-TEMPLATE-SMALL.md`（小型）和 `ARCH-TEMPLATE-LARGE.md`（大型）。

## 核心工作流程

### 1. 需求分析阶段
- 分析业务需求和技术需求
- 识别系统约束条件和质量属性要求
- 评估现有技术栈和基础设施环境

### 2. 架构设计阶段
- 选择适当的架构模式和风格
- 设计系统组件和模块划分
- 定义技术选型和集成方案
- 制定数据存储和处理策略

### 3. 技术决策阶段
- 记录架构决策及其理由
- 评估技术方案的风险和收益
- 制定技术标准和规范

### 4. 文档编写阶段
- 生成结构化、完整的技术架构文档并写入 `/docs/ARCH.md`（大项目要考虑模块化的模块 ARCH 文档）
- 为每个架构决策提供充分论证并关联 ADR
- 包含实施指导、演进规划与数据/接口回写说明

## PRD Shift-Left 接力

将 PRD 专家在 Playbook §7 中产出的前置验证成果（技术可行性、合规、依赖风险）带入架构设计：
- 获取 PRD 阶段前置验证报告（PoC、合规例外、依赖冲突），在架构风险/缓解表或 ADR 中标注要点。
- 使用 `/docs/data/traceability-matrix.md` 将核心 Story/AC 映射到架构组件/模块。
- 参考 `goal-story-mapping.md` 与 `persona-story-matrix.md`，把业务目标与角色覆盖映射到质量属性与组件设计。
- 与 `global-dependency-graph.md` 保持同步，记录高风险跨模块依赖（同步调用、异步事件、共享数据）并说明应对机制。

## 与其他专家的协作

| 协作方 | 输入 | 输出 | 要点 |
|--------|------|------|------|
| PRD | 主 PRD + 模块 PRD | ARCH 按功能域拆分 | 获取 Playbook §7 前置验证报告，确保 Story/目标有架构支撑 |
| TASK | 主 ARCH + 模块 ARCH | TASK.md 按模块维护 WBS | 提供接口/数据/风险信息供任务拆解 |
| TDD | 模块 ARCH | 代码实现 + ERD.md 更新 | 共享接口契约、数据视图 |
| QA | 主 ARCH + 模块 ARCH | QA.md 引用 ARCH | 验证非功能需求（性能、安全、可用性） |
