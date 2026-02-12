# TASK 工具脚本使用说明

> 这些脚本用于自动化 TASK 生成、质量检查、依赖分析、关键路径计算、资源冲突检测等任务，提升任务管理效率。

---

## 📦 安装

本工具脚本使用 Node.js 编写，无需额外依赖。

```bash
# 确保已安装 Node.js (推荐 v16+)
node --version

# 赋予脚本执行权限（Unix/Mac）
chmod +x scripts/task-tools/*.js
```

---

## 🚀 快速开始

### 0. TASK 自动生成 ⭐ 新增（v1.12 增强）

从 PRD + ARCHITECTURE 自动生成 TASK.md，包含 WBS、依赖矩阵、关键路径、里程碑、风险。**大型项目自动拆分为模块文档**。

```bash
npm run task:generate
```

**功能**：
- ✅ 从 PRD 提取 Story，自动分解为 Task（Epic → Feature → Task）
- ✅ 从 ARCHITECTURE 提取 Component 依赖，自动生成任务依赖矩阵
- ✅ 计算关键路径（CPM 算法）
- ✅ 生成 Story → Task 映射表
- ✅ **智能检测项目规模，自动决定单文件 vs 模块化拆分**
- ✅ **大型项目自动创建模块任务文档（`task-modules/{domain}/TASK.md`）**
- ✅ **自动生成跨模块依赖关系表**
- ✅ 支持增量更新（保留人工标注的 Owner、优先级、风险备注）

**使用场景**：
- **首次生成**：TASK.md 不存在时，从零自动生成完整任务计划
- **增量更新**：PRD/ARCH 变更后，刷新 WBS/依赖/关键路径，保留人工调整
- **快速原型**：新项目启动时，快速生成初始任务分解
- **大型项目**：自动拆分为主文档（总纲）+ 模块文档（详细 WBS）

**示例输出（小型项目）**：
```
============================================================
TASK 自动生成工具 v1.0
============================================================
✅ 读取 PRD 与 ARCHITECTURE...
📋 解析 Story 与 Component...
   - 找到 25 个 Story
   - 找到 12 个 Component
🔧 生成 WBS...
   - 生成 78 个 Task
   - 项目规模：小型（单文件）
📝 生成 TASK.md...
✅ 已生成：/docs/TASK.md

==============================
✅ TASK.md 自动生成完成！

接下来建议：
1. 检查生成的 TASK.md：cat docs/TASK.md
2. 运行质量检查：npm run task:lint
3. 验证关键路径：npm run task:check-critical-path
4. 同步 PRD ↔ TASK ID：npm run task:sync
5. 在 /docs/AGENT_STATE.md 勾选 TASK_PLANNED
```

**示例输出（大型项目 - v1.12 新增）**：
```
============================================================
TASK 自动生成工具 v1.0
============================================================
✅ 读取 PRD 与 ARCHITECTURE...
📋 解析 Story 与 Component...
   - 找到 120 个 Story
   - 找到 35 个 Component
🔧 生成 WBS...
   - 生成 320 个 Task
   - 项目规模：大型（需拆分）
📝 生成 TASK.md...
✅ 已生成：/docs/TASK.md

📂 项目规模较大，自动创建模块化任务文档...
   ✅ 创建模块文档：user/TASK.md (85 个任务)
   ✅ 创建模块文档：payment/TASK.md (92 个任务)
   ✅ 创建模块文档：notification/TASK.md (68 个任务)
   ✅ 创建模块文档：infra/TASK.md (75 个任务)
   ✅ 更新模块索引：task-modules/module-list.md
✅ 已创建 4 个模块任务文档
✅ 主 TASK.md 已转换为总纲结构（< 500 行）

==============================
✅ TASK.md 自动生成完成！

📋 大型项目已完成模块化拆分：
   - 主文档：docs/TASK.md（总纲与索引）
   - 模块文档：docs/task-modules/{domain}/TASK.md
   - 模块索引：docs/task-modules/module-list.md

接下来建议：
1. 检查生成的 TASK.md：cat docs/TASK.md
   检查模块文档：ls docs/task-modules/
2. 运行质量检查：npm run task:lint
3. 验证关键路径：npm run task:check-critical-path
4. 同步 PRD ↔ TASK ID：npm run task:sync
5. 在 /docs/AGENT_STATE.md 勾选 TASK_PLANNED
```

**拆分条件（自动判断）**：
- 主文档预估 > 1000 行
- 工作包 > 50 个
- 并行模块 ≥ 3 个

**注意事项**：
- 生成工具会根据 PRD/ARCH 的实际格式智能解析，可能需要调整正则表达式
- 人工标注（Owner、优先级、完成状态）在再次执行时会自动保留
- **大型项目自动拆分后**，主 TASK.md 转为总纲（< 500 行），详细 WBS 存放在模块文档中

---

### 1. TASK 完整性检查
检查 TASK 文档的章节完整性、Task ID 格式、依赖关系规范。

```bash
npm run task:lint
```

**检查项**：
- ✅ 主 TASK 必需章节完整性
- ✅ 任务依赖矩阵是否存在
- ✅ Story → Task 映射表是否存在
- ✅ Task ID 格式规范（TASK-MODULE-NNN）
- ✅ 工作量估算是否存在
- ✅ 负责人是否指定
- ✅ 依赖关系格式规范

**示例输出**：
```
============================================================
TASK 完整性检查工具 v1.0
============================================================

✅ 主 TASK 存在
✅ Story → Task 映射表 存在
✅ 任务依赖矩阵 存在

📋 检查主 TASK 章节完整性...
✅ 主 TASK 包含所有必需章节

🔍 检查 Task ID 格式规范...
✅ 所有 Task ID 格式规范（共 45 个）

🔍 检查任务工作量估算...
⚠️  发现 3 个任务缺少工作量估算:
   - TASK-USER-005: 用户注册接口实现
   - TASK-PAY-002: 支付回调处理
   - TASK-NOTIF-001: 邮件通知服务

🔍 检查任务负责人...
✅ 所有任务都已指定负责人

============================================================
检查结果汇总:
============================================================
⚠️  发现 3 个警告，建议修正。
```

---

### 2. 任务依赖循环检查
检测 Task 之间的循环依赖和无效依赖。

```bash
npm run task:check-cycles
```

**检查项**：
- ✅ 解析所有 Task 的依赖关系
- ✅ 检测循环依赖（A → B → C → A）
- ✅ 检测无效依赖（依赖的 Task 不存在）
- ✅ 检测跨模块依赖完整性

**示例输出**：
```
============================================================
任务依赖循环检查工具 v1.0
============================================================

📖 解析依赖关系...
✅ 找到 45 个任务
📊 总依赖关系数: 38

🔍 检测循环依赖...
❌ 发现 1 个循环依赖:

   循环 1:
   TASK-USER-005 → TASK-PAY-001 → TASK-PAY-002 → TASK-USER-005

🔍 检测无效依赖...
⚠️  发现 2 个无效依赖:
   TASK-PAY-003 依赖的 TASK-USER-999 不存在
   TASK-NOTIF-001 依赖的 TASK-OLD-001 不存在

============================================================
检查结果汇总:
============================================================
❌ 发现问题，请修正：
   - 1 个循环依赖
   - 2 个无效依赖
```

---

### 3. Story → Task 映射验证
验证所有 Story 是否都有对应的 Task，确保需求追溯完整性。

```bash
npm run task:sync
```

**检查项**：
- ✅ 解析 PRD 中的所有 Story ID
- ✅ 解析 TASK 中的所有 Task ID
- ✅ 验证 Story → Task 映射表完整性
- ✅ 检测孤儿 Story（无 Task 实现）
- ✅ 检测孤儿 Task（无对应 Story）

**示例输出**：
```
============================================================
Story → Task 映射验证工具 v1.0
============================================================

📖 解析 PRD 中的 Story ID...
✅ 找到 25 个用户故事

📖 解析 TASK 中的 Task ID...
✅ 找到 45 个任务

🔍 验证 Story → Task 映射...
✅ 映射表存在: /docs/data/story-task-mapping.md

🔍 检测孤儿 Story（无 Task 实现）...
⚠️  发现 2 个孤儿 Story:
   - US-ANALYTICS-005: 数据可视化仪表板
   - US-ADMIN-002: 权限管理界面

🔍 检测孤儿 Task（无对应 Story）...
✅ 所有 Task 都有对应的 Story

============================================================
检查结果汇总:
============================================================
⚠️  发现 2 个孤儿 Story，建议补充对应 Task。
```

---

### 4. 生成甘特图
基于任务依赖关系和工作量，生成 Mermaid 格式的甘特图。

```bash
npm run task:generate-gantt
```

**功能**：
- ✅ 自动解析任务依赖关系
- ✅ 计算任务开始和结束时间
- ✅ 生成 Mermaid gantt 图
- ✅ 标记关键路径任务

**示例输出**：
```
============================================================
甘特图生成工具 v1.0
============================================================

📖 解析任务...
✅ 找到 45 个任务

📊 计算时间线...
✅ 计算完成

📝 生成甘特图...
✅ 甘特图已保存到: /docs/data/milestone-gantt.md

🔗 在 Markdown 中引用:
```mermaid
gantt
    title 项目任务甘特图
    dateFormat YYYY-MM-DD

    section 用户管理
    TASK-USER-001 数据库表设计   :crit, 2025-01-01, 2d
    TASK-USER-002 API 框架搭建   :crit, 2025-01-03, 3d
    ...
```
```

---

### 5. 关键路径分析
计算项目关键路径，识别影响工期的瓶颈任务。

```bash
npm run task:check-critical-path
```

**功能**：
- ✅ 使用 CPM（关键路径法）算法
- ✅ 计算每个任务的最早/最晚开始时间
- ✅ 识别浮动时间
- ✅ 标记关键路径任务

**示例输出**：
```
============================================================
关键路径分析工具 v1.0
============================================================

📖 解析任务依赖...
✅ 找到 45 个任务，38 个依赖关系

📊 计算关键路径（CPM）...
✅ 计算完成

🔍 关键路径（总工期：65 天）:
TASK-ARCH-001（3d） → TASK-USER-001（2d） → TASK-USER-003（5d） →
TASK-PAY-001（4d） → ... → TASK-QA-FINAL（10d）

📋 关键路径任务清单（共 12 个）:
| Task ID | 任务名称 | 工期 | 最早开始 | 最晚开始 | 浮动时间 |
|---------|---------|------|---------|---------|---------|
| TASK-ARCH-001 | 数据库架构搭建 | 3d | Day 1 | Day 1 | 0 |
| TASK-USER-001 | 用户表设计 | 2d | Day 4 | Day 4 | 0 |
| TASK-USER-003 | 用户登录实现 | 5d | Day 6 | Day 6 | 0 |

⚠️  关键路径任务延期将直接影响项目总工期！

📝 关键路径已保存到: /docs/data/critical-path.md
```

---

### 6. 数据库迁移任务验证
验证数据库迁移任务是否遵循 Expand → Migrate/Backfill → Contract 流程。

```bash
npm run task:validate-db-tasks
```

**检查项**：
- ✅ 识别所有 DB 迁移任务
- ✅ 验证三阶段流程（Expand/Migrate/Contract）
- ✅ 检查阶段顺序
- ✅ 验证幂等性标记
- ✅ 检查回滚计划

**示例输出**：
```
============================================================
数据库迁移任务验证工具 v1.0
============================================================

📖 识别 DB 迁移任务...
✅ 找到 6 个数据库迁移任务

🔍 验证 Expand → Migrate → Contract 流程...

✅ TASK-DB-001: 添加 email 列
   - Expand: TASK-DB-001-EXPAND（添加可空列）
   - Migrate: TASK-DB-001-MIGRATE（数据回填）
   - Contract: TASK-DB-001-CONTRACT（设置非空约束）
   ✅ 阶段完整，顺序正确

❌ TASK-DB-002: 重命名 password 列
   ⚠️  缺少 Expand 阶段
   ⚠️  缺少回滚计划

============================================================
检查结果汇总:
============================================================
⚠️  发现 1 个任务不符合规范，请修正。
```

---

### 7. 资源冲突检测
检测同一人员是否被分配到并行的多个任务，识别资源超载。

```bash
npm run task:check-resource-conflicts
```

**检查项**：
- ✅ 解析所有任务的负责人和时间段
- ✅ 检测并行任务冲突
- ✅ 计算人员工作负荷
- ✅ 生成资源分配建议

**示例输出**：
```
============================================================
资源冲突检测工具 v1.0
============================================================

📖 解析资源分配...
✅ 找到 8 个人员，45 个任务

🔍 检测并行任务冲突...
⚠️  发现 3 个资源冲突:

   冲突 1: @dev-a
   时间段: 2025-01-10 ~ 2025-01-15
   并行任务:
   - TASK-USER-005: 用户注册接口实现（5d，100%）
   - TASK-USER-007: 邮箱验证逻辑（3d，100%）
   总工作量: 200%（超载！）

   冲突 2: @dev-b
   时间段: 2025-01-20 ~ 2025-01-25
   并行任务:
   - TASK-PAY-001: 订单创建实现（4d，100%）
   - TASK-NOTIF-002: 通知模板开发（3d，50%）
   总工作量: 150%（超载！）

📊 人员工作负荷统计:
| 人员 | 总任务数 | 总工作量（人天） | 平均负载 | 状态 |
|------|---------|----------------|---------|------|
| @dev-a | 8 | 28d | 80% | ⚠️  接近满载 |
| @dev-b | 6 | 22d | 65% | ✅ 正常 |
| @dev-c | 4 | 15d | 45% | ✅ 正常 |

💡 建议:
   - 调整 TASK-USER-007 的开始时间，避免与 TASK-USER-005 冲突
   - 将 TASK-NOTIF-002 重新分配给 @dev-c

============================================================
检查结果汇总:
============================================================
⚠️  发现 3 个资源冲突，建议调整任务分配。
```

---

### 8. 生成任务状态报告
生成任务执行状态报告，包括完成率、风险任务、延期任务。

```bash
npm run task:generate-status-report
```

**功能**：
- ✅ 统计任务完成率
- ✅ 识别延期任务
- ✅ 标记高风险任务
- ✅ 按模块分组统计
- ✅ 生成趋势分析

**示例输出**：
```
============================================================
任务状态报告生成工具 v1.0
============================================================

📊 整体进度统计:
   总任务数: 45
   ✅ 已完成: 18 (40%)
   🔄 进行中: 12 (27%)
   📝 待启动: 15 (33%)

⚠️  延期任务（共 3 个）:
   - TASK-USER-008: 用户头像上传功能
     计划完成: 2025-01-10
     当前状态: 进行中（已延期 5 天）
     负责人: @dev-b

   - TASK-PAY-003: 退款流程实现
     计划完成: 2025-01-15
     当前状态: 待启动（已延期 2 天）
     负责人: @dev-c

🚨 高风险任务（共 2 个）:
   - TASK-PAY-001: 订单创建实现
     风险: 第三方 API 延迟交付
     缓解措施: 提前 Mock，并行开发
     负责人: @dev-a

   - TASK-ARCH-002: Redis 集群搭建
     风险: 运维资源不足
     缓解措施: 申请云服务商技术支持
     负责人: @ops

📋 按模块分组统计:
| 模块 | 总任务 | 已完成 | 进行中 | 待启动 | 完成率 |
|------|--------|--------|--------|--------|--------|
| 用户管理 | 15 | 8 | 4 | 3 | 53% |
| 支付系统 | 18 | 6 | 5 | 7 | 33% |
| 通知引擎 | 8 | 3 | 2 | 3 | 38% |
| 分析服务 | 4 | 1 | 1 | 2 | 25% |

📈 趋势分析:
   - 本周完成任务数: 5
   - 上周完成任务数: 4
   - 完成速度: 提升 25%

💡 建议:
   - 关注 3 个延期任务，分析延期原因
   - 对高风险任务进行每日跟踪
   - 支付系统模块进度偏慢，建议增加资源

📝 报告已保存到: /docs/data/task-status-report-2025-01-20.md
```

---

## 📋 所有可用命令

### TASK 核心检查（优先级 ⭐⭐⭐）
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run task:lint` | TASK 完整性检查 | ⭐⭐⭐ |
| `npm run task:check-cycles` | 任务依赖循环检查 | ⭐⭐⭐ |
| `npm run task:sync` | Story → Task 映射验证 | ⭐⭐⭐ |

### TASK 可视化与分析（优先级 ⭐⭐）
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run task:generate-gantt` | 生成甘特图 | ⭐⭐ |
| `npm run task:check-critical-path` | 关键路径分析 | ⭐⭐ |
| `npm run task:generate-status-report` | 生成任务状态报告 | ⭐⭐ |

### TASK 专项检查（优先级 ⭐⭐）
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run task:validate-db-tasks` | 数据库迁移任务验证 | ⭐⭐ |
| `npm run task:check-resource-conflicts` | 资源冲突检测 | ⭐⭐ |

---

## 🔧 集成到工作流

### 本地开发
在提交 TASK 变更前运行：

```bash
npm run task:lint && npm run task:check-cycles && npm run task:sync
```

### CI/CD 集成
在 `.github/workflows/task-validation.yml` 中添加：

```yaml
name: TASK Quality Gate

on:
  pull_request:
    paths:
      - 'docs/TASK.md'
      - 'docs/task-modules/**'
      - 'docs/data/task-dependency-matrix.md'
      - 'docs/data/story-task-mapping.md'

jobs:
  task-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Run TASK Lint
        run: npm run task:lint

      - name: Check Task Dependency Cycles
        run: npm run task:check-cycles

      - name: Verify Story → Task Mapping
        run: npm run task:sync

      - name: Check Critical Path
        run: npm run task:check-critical-path

      - name: Validate DB Migration Tasks
        run: npm run task:validate-db-tasks
```

---

## 📊 脚本状态

| 脚本 | 状态 | 版本 | 说明 |
|------|------|------|------|
| task-lint.js | ✅ 已实现 | v1.0 | TASK 完整性检查 |
| check-task-cycles.js | ✅ 已实现 | v1.0 | 任务依赖循环检测 |
| sync-prd-task-ids.js | ✅ 已实现 | v1.0 | Story → Task 映射验证 |
| generate-gantt.js | ✅ 已实现 | v1.0 | 生成甘特图 |
| check-critical-path.js | ✅ 已实现 | v1.0 | 关键路径分析 |
| validate-db-tasks.js | ✅ 已实现 | v1.0 | DB 迁移任务验证 |
| check-resource-conflicts.js | ✅ 已实现 | v1.0 | 资源冲突检测 |
| generate-status-report.js | ✅ 已实现 | v1.0 | 生成任务状态报告 |

---

## 🛠️ 开发新脚本

### 脚本模板

```javascript
#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// 颜色输出工具
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// 主函数
function main() {
  log('='.repeat(60), 'cyan');
  log('工具名称 v1.0', 'cyan');
  log('='.repeat(60), 'cyan');

  // 你的逻辑...

  process.exit(0);
}

// 运行
if (require.main === module) {
  try {
    main();
  } catch (error) {
    log(`\n❌ 执行出错: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}
```

### 添加到 package.json

```json
{
  "scripts": {
    "task:your-command": "node scripts/task-tools/your-script.js"
  }
}
```

---

## ❓ 常见问题

### Q1: 脚本执行报错 "Permission denied"
**A**: 赋予执行权限：
```bash
chmod +x scripts/task-tools/*.js
```

### Q2: 如何自定义检查规则？
**A**: 编辑对应脚本的配置部分。例如在 `task-lint.js` 中修改 `REQUIRED_SECTIONS` 数组。

### Q3: 关键路径计算是否考虑资源约束？
**A**: 当前版本仅实现基于依赖关系的 CPM 算法，不考虑资源约束。未来版本将引入资源受限的关键路径（RCPSP）。

### Q4: 能否在 Windows 上运行？
**A**: 可以。脚本使用纯 JavaScript 编写，跨平台兼容。但颜色输出在 Windows CMD 中可能显示异常（PowerShell 和 Windows Terminal 正常）。

### Q5: 如何与 PRD/ARCH 工具联动？
**A**: 使用 `npm run task:sync` 可自动验证 PRD 中的 Story ID 与 TASK 中的 Task ID 的映射关系。确保需求追溯完整。

---

## 📚 参考资料

- [TASK-PLANNING-EXPERT Playbook](../../AgentRoles/Handbooks/TASK-PLANNING-EXPERT.playbook.md)
- [AGENTS.md](../../AGENTS.md) - Phase 3: TASK 规划专家
- [CONVENTIONS.md](../../docs/CONVENTIONS.md) - TASK 模块化规范

---

> 这些脚本持续改进中。欢迎提交 Issue 或 PR 贡献新功能！
