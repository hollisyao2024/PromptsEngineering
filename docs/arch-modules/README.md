# 功能域架构模块索引

> **用途**：大型项目的架构模块化管理 - 按功能域拆分详细架构设计
> **更新日期**：2025-11-05
> **版本**：v1.0

---

## 📂 模块清单

| 模块名称 | 文档路径 | 负责团队 | 核心服务 | 状态 | 最后更新 |
|---------|---------|---------|---------|------|---------|
| （示例）用户管理 | [user-management.md](user-management.md) | @team-auth | USER-SVC-001 | 📝 待启动 | - |
| （示例）支付系统 | [payment-system.md](payment-system.md) | @team-payment | PAY-SVC-001 | 📝 待启动 | - |

**状态说明**：
- 📝 待启动
- 🔄 进行中
- ✅ 已确认
- ⚠️ 需更新

---

## 📋 模块命名规范

### 文件命名
- **格式**：`{domain}.md`
- **命名风格**：kebab-case（小写字母 + 连字符）
- **示例**：
  - `user-management.md`
  - `payment-system.md`
  - `notification-service.md`
  - `order-management.md`

### 组件/服务 ID 命名
- **格式**：`{MODULE}-{TYPE}-{序号}`
- **TYPE 类型**：
  - `SVC`：服务（Service）
  - `DB`：数据库（Database）
  - `CACHE`：缓存（Cache）
  - `MQ`：消息队列（Message Queue）
  - `API`：API 端点（API Endpoint）
  - `JOB`：定时任务（Job）
- **示例**：
  - `USER-SVC-001`：用户管理服务
  - `USER-DB-001`：用户数据库
  - `PAY-SVC-001`：支付服务
  - `PAY-CACHE-001`：支付缓存

---

## 🏗️ 标准模块架构文档结构

每个模块架构文档（`{domain}.md`）应包含以下章节：

### 1. 模块概述
- 功能范围（本模块负责的业务能力）
- 负责团队（@团队标识）
- 依赖的模块（上游依赖）

### 2. C4 架构视图
- **Container 视图**：模块内容器/服务划分（Mermaid 图）
- **Component 视图**：核心组件关系图（Mermaid 图）

### 3. 运行时视图
- 关键流程时序图（Sequence Diagram）
- 用例场景说明

### 4. 数据视图
- **模块内实体关系**：ER 图（Mermaid）
- **核心数据表**：表名、用途、主键、重要字段、索引策略
- **索引策略**：查询热点、复合索引
- **事务边界**：强一致性 vs 最终一致性
- **容量与保留**：预估数据量、增长率、数据保留期
- **备份与恢复**：备份频率、RTO/RPO

### 5. 接口视图
- **5.1 提供的接口（Exports）**：
  - API 路径、方法、输入输出格式
  - 错误码规范
  - 幂等性设计
  - 限流策略
  - SLA（响应时间、可用性）
- **5.2 依赖的接口（Imports）**：
  - 上游模块依赖
  - 降级策略
- **5.3 事件订阅/发布**：
  - 事件 Schema
  - 幂等性保障
  - 重试策略

### 6. 运维视图
- **部署拓扑**：模块部署图（Mermaid）
- **弹性策略**：水平扩展、自动扩容、降级策略
- **监控指标**：关键业务指标、系统指标
- **SLO（服务等级目标）**：可用性、响应时间、错误率

### 7. 安全与合规
- 模块级认证授权
- 数据安全（加密、脱敏）
- 审计要求

### 8. 技术选型与 ADR
- 模块特定的技术决策
- ADR 链接（`/docs/adr/NNN-{module}-*.md`）

### 9. 外部依赖
- 对其他模块的依赖说明
- 跨模块数据流
- 集成点

---

## 🔗 与其他文档的关系

### 与主架构文档的关系
- **主架构**（`/docs/ARCHITECTURE.md`）：
  - 系统全景（C4 Context）
  - 功能域架构索引（链接到各模块）
  - 全局技术选型
  - 跨模块依赖关系
- **模块架构**（本目录）：
  - 详细的 Container/Component 视图
  - 模块内部数据、接口、部署设计
  - 模块特定的技术决策

### 与 PRD 模块的对齐
- **功能域边界一致**：`arch-modules/user-management.md` ↔ `prd-modules/user-management/PRD.md`
- **Story → Component 映射**：PRD 中的用户故事应能追溯到 ARCH 中的组件

### 与全局数据的协作
- **全局 ER 图**（`/docs/data/ERD.md`）：仅包含跨模块实体关系
- **模块 ER 图**（本模块第 4 章）：仅包含模块内实体关系
- **全局组件依赖图**（`/docs/data/component-dependency-graph.md`）：跨模块组件依赖关系

---

## 🛠️ 模块化工作流

### 1. ARCH 专家创建模块架构
1. 读取对应模块 PRD（`/docs/prd-modules/{domain}/PRD.md`）
2. 生成模块架构文档（`/docs/arch-modules/{domain}.md`）
3. 更新本文件（README.md）的模块清单表格
4. 在主架构文档（`/docs/ARCHITECTURE.md`）的功能域架构索引中链接

### 2. TASK 专家读取模块架构
1. 读取主 ARCHITECTURE.md（全局视图）
2. 按需读取对应模块架构（详细设计）
3. 生成模块任务计划（`/docs/task-modules/{domain}.md`）

### 3. TDD 专家实现模块功能
1. 读取模块 PRD、ARCH、TASK
2. 实现功能，更新数据视图（ERD.md）
3. 提交前执行文档回写 Gate

### 4. QA 专家验证模块质量
1. 读取模块 PRD、ARCH、QA
2. 验证架构合规性（性能、安全、可用性）
3. 更新 QA 文档

---

## 📊 跨模块协作机制

### 1. 跨模块依赖管理
- **同步调用**：REST API、gRPC（在主架构的跨模块依赖关系章节维护）
- **异步消息**：消息队列、事件总线（在主架构的跨模块依赖关系章节维护）
- **数据共享**：共享数据库、数据湖（不推荐，优先使用 API）

### 2. 接口契约
- 在模块架构第 5 章定义提供的接口
- 在主架构第 5 章维护跨模块依赖关系表格
- 使用 API 契约确保接口一致性

### 3. ADR 命名规范
- **模块级 ADR**：`NNN-{module}-{decision-title}.md`
  - 示例：`001-user-oauth-provider-selection.md`
- **全局级 ADR**：`NNN-global-{decision-title}.md`
  - 示例：`003-global-api-gateway-selection.md`

---

## 🚀 快速开始

### 创建新模块架构文档
1. 复制模块模板（`MODULE-TEMPLATE.md`）
2. 重命名为 `{domain}.md`（如 `user-management.md`）
3. 填充内容（参考模板各章节说明）
4. 在本文件（README.md）的模块清单中注册
5. 在主架构文档（`/docs/ARCHITECTURE.md`）的功能域索引中添加链接

### 维护模块架构文档
- 当模块架构发生重大变更时，更新对应模块文档
- 在模块文档的变更记录章节记录变更
- 如涉及跨模块影响，同步更新主架构文档
- 关键技术决策需新增 ADR 至 `/docs/adr/`

---

## 📚 相关资源

- [主架构文档](../ARCHITECTURE.md)
- [模块结构指南](STRUCTURE-GUIDE.md)
- [模块架构模板](MODULE-TEMPLATE.md)
- [全局数据目录](../data/README.md)
- [ADR 目录](../adr/)
- [目录规范](../CONVENTIONS.md)

---

> 本目录遵循高内聚、低耦合原则，按功能域拆分架构设计。每个模块由独立团队负责，支持并行开发与维护。

