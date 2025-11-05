# PRD 工具脚本使用说明

> 这些脚本用于自动化 PRD 质量检查、依赖分析、NFR 验证等任务，提升需求管理效率。

---

## 📦 安装

本工具脚本使用 Node.js 编写，无需额外依赖。

```bash
# 确保已安装 Node.js (推荐 v16+)
node --version

# 赋予脚本执行权限（Unix/Mac）
chmod +x scripts/prd-tools/*.js
```

---

## 🚀 快速开始

### 1. PRD 完整性检查
检查 PRD 文档的章节完整性、Story ID 格式、验收标准规范。

```bash
npm run prd:lint
```

**检查项**：
- ✅ 主 PRD 必需章节完整性
- ✅ 追溯矩阵是否存在
- ✅ 依赖关系图是否存在
- ✅ Story ID 格式规范（US-MODULE-NNN）
- ✅ 验收标准使用 Given-When-Then 格式

**示例输出**：
```
============================================================
PRD 完整性检查工具 v1.0
============================================================

✅ 主 PRD 存在
✅ 追溯矩阵 存在
✅ 依赖关系图 存在

📋 检查主 PRD 章节完整性...
✅ 主 PRD 包含所有必需章节

🔍 检查 Story ID 格式规范...
✅ 所有 Story ID 格式规范（共 15 个）

🧪 检查验收标准 Given-When-Then 格式...
⚠️  发现 2 个用户故事缺少 GWT 关键词:
   - US-USER-004: 缺少 Then
   - US-PAY-003: 缺少 Given, When

============================================================
检查结果汇总:
============================================================
❌ 部分检查未通过，请根据上述提示修正。
```

---

### 2. 依赖循环检查
检测 Story 之间的循环依赖和无效依赖。

```bash
npm run prd:check-dependency-cycles
```

**检查项**：
- ✅ 解析所有 Story 的依赖关系
- ✅ 检测循环依赖（A → B → C → A）
- ✅ 检测无效依赖（依赖的 Story 不存在）

**示例输出**：
```
============================================================
依赖循环检查工具 v1.0
============================================================

📖 解析依赖关系...
✅ 找到 25 个用户故事
📊 总依赖关系数: 18

🔍 检测循环依赖...
❌ 发现 1 个循环依赖:

   循环 1:
   US-USER-005 → US-PAY-001 → US-PAY-002 → US-USER-005

🔍 检测无效依赖...
⚠️  发现 2 个无效依赖:
   US-PAY-003 依赖的 US-USER-999 不存在
   US-NOTIF-001 依赖的 US-OLD-001 不存在

============================================================
检查结果汇总:
============================================================
❌ 发现问题，请修正：
   - 1 个循环依赖
   - 2 个无效依赖
```

---

### 3. NFR 达标检查
检查非功能需求的达标情况，生成发布 Gate 报告。

```bash
npm run nfr:check-compliance
```

**检查项**：
- ✅ 解析 NFR 追踪表
- ✅ 统计达标状态
- ✅ 按类型分组统计
- ✅ 生成发布建议

**示例输出**：
```
============================================================
NFR 达标检查工具 v1.0
============================================================

📖 解析 NFR 追踪表...
✅ 找到 18 个 NFR

📊 按类型分组统计:
   性能: 3/4 达标 (75.0%)
   安全: 4/4 达标 (100.0%)
   可用性: 1/2 达标 (50.0%)
   可扩展性: 0/1 达标 (0.0%)

============================================================
发布 Gate 检查报告
============================================================

❌ 阻塞性问题（未达标的 NFR）:
   - NFR-PERF-004: 移动端首屏加载时间
     当前值: 3.5s | 目标值: < 3s
     关联 Story: US-CONTENT-001
     负责人: @frontend

   - NFR-SCALE-001: 并发支付处理能力
     当前值: 850 TPS | 目标值: 1000 TPS
     关联 Story: US-PAY-002
     负责人: @backend

⚠️  警告项（接近阈值的 NFR）:
   - NFR-AVAIL-002: 数据库故障切换时间
     当前值: 45秒 | 目标值: < 30秒

📊 统计摘要:
   总 NFR 数: 18
   ✅ 达标: 14 (77.8%)
   ❌ 未达标: 2 (11.1%)
   🔄 优化中: 2 (11.1%)

🚀 发布建议:
   ❌ 阻塞发布！存在 2 个未达标的 NFR，必须修复后才能发布。
```

---

## 📋 所有可用命令

### PRD 质量检查
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run prd:lint` | PRD 完整性检查 | ⭐⭐⭐ |
| `npm run prd:check-dependency-cycles` | 依赖循环检查 | ⭐⭐⭐ |
| `npm run prd:check-dependencies` | 第三方依赖可用性检查 | ⭐⭐ |
| `npm run prd:check-compliance` | 数据合规性检查 | ⭐⭐ |
| `npm run prd:preflight-report` | 生成前置验证报告 | ⭐⭐ |

### NFR 管理
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run nfr:check-compliance` | NFR 达标检查 | ⭐⭐⭐ |

### 优先级管理
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run priority:check-conflicts` | 优先级冲突检测 | ⭐⭐ |
| `npm run priority:calc-dependency` | 计算依赖权重 | ⭐⭐ |
| `npm run priority:report` | 生成优先级报告 | ⭐⭐ |

### 角色覆盖分析
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run persona:coverage-report` | 角色覆盖率报告 | ⭐⭐ |
| `npm run persona:check-orphans` | 孤儿角色检测 | ⭐⭐ |
| `npm run persona:check-conflicts` | 权限冲突检测 | ⭐ |

### 业务目标追溯
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run goal:coverage-report` | 目标覆盖率报告 | ⭐⭐ |
| `npm run goal:check-orphans` | 孤儿 Story 检测 | ⭐⭐ |
| `npm run goal:roi-analysis` | ROI 分析报告 | ⭐ |

### 变更请求管理
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run cr:new` | 创建新变更请求 | ⭐⭐ |
| `npm run cr:pending` | 列出待审批 CR | ⭐⭐ |
| `npm run cr:impact` | 分析 CR 影响范围 | ⭐⭐ |

### 自动化工具
| 命令 | 说明 | 优先级 |
|------|------|--------|
| `npm run prd:sync-matrix` | 同步追溯矩阵 | ⭐ |
| `npm run prd:generate-dependency-graph` | 自动生成依赖关系图 | ⭐ |

---

## 🔧 集成到工作流

### 本地开发
在提交 PRD 变更前运行：

```bash
npm run prd:lint && npm run prd:check-dependency-cycles
```

### CI/CD 集成
在 `.github/workflows/prd-check.yml` 中添加：

```yaml
name: PRD Quality Gate

on:
  pull_request:
    paths:
      - 'docs/PRD.md'
      - 'docs/prd-modules/**'

jobs:
  prd-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Run PRD Lint
        run: npm run prd:lint

      - name: Check Dependency Cycles
        run: npm run prd:check-dependency-cycles

      - name: Check NFR Compliance
        run: npm run nfr:check-compliance
```

---

## 📊 脚本状态

| 脚本 | 状态 | 版本 | 说明 |
|------|------|------|------|
| check-completeness.js | ✅ 已实现 | v1.0 | PRD 完整性检查 |
| check-dependency-cycles.js | ✅ 已实现 | v1.0 | 依赖循环检测 |
| check-nfr-compliance.js | ✅ 已实现 | v1.0 | NFR 达标检查 |
| 其他脚本 | 📝 待实现 | - | 骨架已创建，功能待实现 |

**注**：标记为"📝 待实现"的脚本目前为骨架，执行时会提示"功能开发中"。

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
    "your:command": "node scripts/prd-tools/your-script.js"
  }
}
```

---

## ❓ 常见问题

### Q1: 脚本执行报错 "Permission denied"
**A**: 赋予执行权限：
```bash
chmod +x scripts/prd-tools/*.js
```

### Q2: 脚本提示"功能开发中"
**A**: 该脚本为骨架，功能尚未完全实现。可参考已实现的脚本（check-completeness.js、check-dependency-cycles.js、check-nfr-compliance.js）自行开发。

### Q3: 如何自定义检查规则？
**A**: 编辑对应脚本的配置部分。例如在 `check-completeness.js` 中修改 `REQUIRED_SECTIONS` 数组。

### Q4: 能否在 Windows 上运行？
**A**: 可以。脚本使用纯 JavaScript 编写，跨平台兼容。但颜色输出在 Windows CMD 中可能显示异常（PowerShell 和 Windows Terminal 正常）。

---

## 📚 参考资料

- [PRD 增强功能实施路线图](../../docs/PRD-ENHANCEMENT-ROADMAP.md)
- [PRD-WRITER-EXPERT Playbook](../../AgentRoles/Handbooks/PRD-WRITER-EXPERT.playbook.md)
- [AGENTS.md](../../AGENTS.md)

---

> 这些脚本持续改进中。欢迎提交 Issue 或 PR 贡献新功能！
