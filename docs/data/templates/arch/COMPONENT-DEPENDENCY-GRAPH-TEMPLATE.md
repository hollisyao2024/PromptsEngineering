# 跨模块组件依赖图（Mermaid 格式）

> **用途**：可视化跨模块的组件依赖关系，识别关键路径与团队协作点
> **维护者**：ARCH 专家
> **更新日期**：2025-11-08

---

## 跨模块组件依赖关系图

```mermaid
graph TB
    subgraph USER["用户管理模块"]
        USER_SVC_001["USER-SVC-001<br/>用户认证服务<br/>Node.js + Express"]
    end

    subgraph PAY["支付系统模块"]
        PAY_SVC_001["PAY-SVC-001<br/>订单服务<br/>Node.js + Express"]
    end

    subgraph NOTIF["通知服务模块"]
        NOTIF_SVC_001["NOTIF-SVC-001<br/>通知服务<br/>Node.js + Express"]
    end

    PAY_SVC_001 -->|同步调用<br/>GET /api/users/{id}| USER_SVC_001
    PAY_SVC_001 -->|异步消息<br/>payment.success 事件| NOTIF_SVC_001
    USER_SVC_001 -->|异步消息<br/>user.registered 事件| NOTIF_SVC_001
```

---

## 依赖说明表

| 依赖方模块 | 被依赖方模块 | 依赖类型 | 接口/事件 | 说明 |
|-----------|------------|---------|----------|------|
| 支付系统 | 用户管理 | 同步调用 | GET /api/users/{id} | 获取用户信息，验证用户身份 |
| 支付系统 | 通知服务 | 异步消息 | payment.success 事件 | 支付成功后发送通知 |
| 用户管理 | 通知服务 | 异步消息 | user.registered 事件 | 用户注册后发送欢迎邮件 |

---

## 与模块依赖图的区别

**本文件（全局组件依赖图）**：
- 只包含**跨模块**的组件依赖关系
- 示例：`PAY-SVC-001` → `USER-SVC-001`（支付服务调用用户服务）

**模块依赖图**（`prd-modules/{domain}/dependency-graph.md`）：
- 只包含**模块内**的 Story 依赖关系
- 示例：`US-USER-001` → `US-USER-003`（注册前置条件是用户表创建）

---

## 维护指南

### 何时更新
- 新增跨模块接口调用
- 新增跨模块事件订阅/发布
- 删除跨模块依赖关系

### 如何更新
1. 编辑 Mermaid 图，添加/删除依赖关系
2. 同步更新"依赖说明表"
3. 在主架构文档（`/docs/ARCH.md`）的"跨模块依赖关系"章节保持一致

---

## 相关资源

- [主架构文档](../../ARCH.md)
- [模块索引](../../arch-modules/module-list.md)
- [全局数据目录](README.md)

---

> 本文件由 ARCH 专家在需求澄清阶段创建并维护。
