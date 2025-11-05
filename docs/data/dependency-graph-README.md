# 需求依赖关系图使用指南

## 概述

`dependency-graph.mmd` 使用 Mermaid 语法描述用户故事之间的依赖关系，支持：
- 可视化需求依赖网络
- 识别关键路径（Critical Path）
- 追踪模块间依赖
- 区分强依赖（阻塞）与弱依赖（非阻塞）

---

## 快速查看

### 在线渲染
1. 访问 [Mermaid Live Editor](https://mermaid.live/)
2. 将 `dependency-graph.mmd` 内容复制粘贴到编辑器
3. 实时查看依赖关系图

### 在 GitHub/GitLab 中查看
- GitHub：直接在仓库中预览 `.mmd` 文件
- GitLab：在 Markdown 文档中引用：
  ```markdown
  ```mermaid
  // 将 dependency-graph.mmd 内容粘贴到此处
  ```
  ```

### 在 VSCode 中查看
安装插件：[Markdown Preview Mermaid Support](https://marketplace.visualstudio.com/items?itemName=bierner.markdown-mermaid)

---

## 图例说明

### 节点样式

| 颜色 | 优先级 | 说明 |
|------|--------|------|
| 🔴 红色 | P0 | 核心功能，必须实现 |
| 🟡 黄色 | P1 | 重要功能，优先实现 |
| 🔵 蓝色 | P2 | 增值功能，资源允许时实现 |
| 🟢 绿色 | 已完成 | Story 已实现并通过验证 |
| 🔶 虚线红框 | 阻塞中 | Story 因依赖或技术问题被阻塞 |

### 连接线类型

| 线型 | 依赖类型 | 说明 |
|------|---------|------|
| `-->` 实线箭头 | 强依赖 | 前置 Story 必须完成，否则阻塞后续开发 |
| `-.->` 虚线箭头 | 弱依赖 | 前置 Story 未完成时，可降级或异步处理 |

---

## 使用场景

### 1. Sprint 规划
在 Sprint 规划会议中：
1. 识别当前 Sprint 范围内的 Story
2. 检查是否有未完成的依赖项
3. 评估关键路径上的风险

**示例**：
- 如果 Sprint 包含 `US-PAY-001`（创建支付订单），必须确保 `US-USER-003`（用户登录）已完成
- 关键路径：`US-USER-001 → US-USER-002 → US-USER-003 → US-PAY-001 → US-PAY-002`

### 2. 风险识别
- **单点依赖**：如果多个 Story 都依赖某个 Story，该 Story 延期会导致连锁反应
- **循环依赖**：检查图中是否存在环（Mermaid 会渲染异常），需重新设计
- **跨团队依赖**：不同模块的 Story 依赖关系，需协调团队工作顺序

### 3. 变更影响分析
当某个 Story 需要变更时：
1. 在依赖图中找到该 Story
2. 向下查找所有依赖它的 Story（下游影响）
3. 向上查找所有它依赖的 Story（上游变化）

**示例**：
- 如果 `US-USER-003`（登录）的 AC 发生变更，需检查：
  - 下游影响：`US-PAY-001`、`US-USER-005`、`US-USER-004` 可能需要调整
  - 上游依赖：`US-USER-002`（邮箱验证）是否需要同步修改

### 4. 并行开发规划
识别哪些 Story 可以并行开发：
- **无依赖 Story**：可由不同团队同时开发
- **同一模块内的独立 Story**：如 `US-NOTIF-001` 和 `US-NOTIF-002` 可并行

---

## 维护指南

### 新增 Story
1. 在对应模块的 `subgraph` 中添加节点：
   ```mermaid
   US_MODULE_NNN["US-MODULE-NNN<br/>Story 标题<br/>P0"]
   ```
2. 添加依赖关系（如有）：
   ```mermaid
   US_MODULE_AAA --> US_MODULE_NNN
   ```
3. 应用优先级样式：
   ```mermaid
   class US_MODULE_NNN p0
   ```

### 标记完成状态
取消注释 `completed` 行，添加已完成的 Story ID：
```mermaid
class US_USER_001,US_USER_002,US_USER_003 completed
```

### 标记阻塞状态
取消注释 `blocked` 行，添加阻塞的 Story ID：
```mermaid
class US_PAY_003 blocked
```

### 修改依赖关系
- 修改依赖类型：将 `-->` 改为 `-.->` 或反向
- 删除依赖：删除对应的连接线
- 添加依赖：添加新的连接线

---

## 自动化生成（高级）

### 从 PRD 模块自动生成
编写脚本解析所有模块 PRD 的"依赖"字段，自动生成 Mermaid 语法：

```javascript
// scripts/generate-dependency-graph.js
const fs = require('fs');
const path = require('path');

// 扫描 /docs/prd-modules/*.md
const prdModules = fs.readdirSync('./docs/prd-modules')
  .filter(file => file.endsWith('.md') && file !== 'README.md');

let mermaidCode = 'graph TB\n';

prdModules.forEach(module => {
  const content = fs.readFileSync(`./docs/prd-modules/${module}`, 'utf-8');

  // 正则匹配：**依赖：** US-XXX-YYY
  const dependencyRegex = /\*\*依赖[：:]\*\*\s*(US-[\w-]+(?:,\s*US-[\w-]+)*)/g;
  const matches = [...content.matchAll(dependencyRegex)];

  matches.forEach(match => {
    const dependencies = match[1].split(',').map(d => d.trim());
    dependencies.forEach(dep => {
      mermaidCode += `  ${dep} --> ${match.input.storyId}\n`;
    });
  });
});

fs.writeFileSync('./docs/data/dependency-graph-auto.mmd', mermaidCode);
console.log('✅ 依赖关系图已自动生成：dependency-graph-auto.mmd');
```

运行：
```bash
node scripts/generate-dependency-graph.js
```

### 与 CI 集成
在 PR 中自动检查：
- 是否存在循环依赖
- 新增 Story 是否已在依赖图中定义
- 是否有孤儿 Story（无依赖也无被依赖）

---

## 关键路径分析

### 手动识别
1. 找到所有"入口 Story"（无前置依赖，如 `US-USER-001`）
2. 从入口开始，沿依赖链向下遍历
3. 计算每条路径的总工时
4. 工时最长的路径即为关键路径

### 示例
假设每个 Story 工期 2 天：
- 路径 1：`US-USER-001(2d) → US-USER-002(2d) → US-USER-003(2d) → US-PAY-001(2d) → US-PAY-002(2d)` = **10 天**
- 路径 2：`US-USER-001(2d) → US-USER-002(2d) → US-USER-003(2d) → US-USER-005(2d)` = 8 天

**关键路径**：路径 1（10 天），任何一个 Story 延期都会影响整体交付时间。

---

## 与其他文档的关系

```
依赖关系图（dependency-graph.mmd）
  ├─ 数据来源 → PRD 模块（/docs/prd-modules/*.md）的"依赖"字段
  ├─ 影响 → 任务规划（/docs/TASK.md）的 WBS 排序
  ├─ 影响 → Sprint 规划（选择无依赖冲突的 Story）
  └─ 影响 → 变更请求（/docs/data/change-requests/*.md）的影响范围分析
```

---

## 工具推荐

| 工具 | 用途 | 链接 |
|------|------|------|
| Mermaid Live Editor | 在线编辑和预览 | https://mermaid.live/ |
| VSCode 插件 | 本地预览 | Markdown Preview Mermaid Support |
| GitHub | 原生支持 Mermaid 渲染 | 直接在 Markdown 中使用 |
| Notion | 支持嵌入 Mermaid 图表 | 使用 `/code` 块，语言选 mermaid |
| Confluence | 通过插件支持 | Mermaid Plugin for Confluence |

---

> 本文件说明 `dependency-graph.mmd` 的使用方法，由 PRD 专家和 TASK 专家协同维护。
