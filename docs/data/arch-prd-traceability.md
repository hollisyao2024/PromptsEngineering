# PRD ↔ ARCH 追溯报告

**生成时间**：2025-11-05T17:52:25.739Z

---

## Story ID 追溯

### 统计

- **ARCH 中引用的 Story ID**：0 个
- **PRD 中定义的 Story ID**：0 个
- **ARCH 引用但 PRD 不存在**：0 个
- **PRD 定义但 ARCH 未引用**：0 个

---

## Component ID 追溯

### 统计

- **依赖图中的 Component ID**：3 个
- **模块文档中定义的 Component ID**：0 个
- **依赖图引用但模块文档不存在**：3 个

### ❌ 依赖图引用但模块文档不存在

| Component ID | 引用文件 | 行号 |
|--------------|---------|------|
| USER-SVC-001 | component-dependency-graph.mmd | 14 |
| PAY-SVC-001 | component-dependency-graph.mmd | 18 |
| NOTIF-SVC-001 | component-dependency-graph.mmd | 22 |

---

> 本报告由 `npm run arch:sync -- --report` 自动生成
