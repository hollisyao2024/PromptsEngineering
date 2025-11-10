# ARCH 工具脚本使用说明

> 这些脚本面向架构团队，自动化检查 ARCH 文档、组件依赖与 PRD/ARCH 的追溯要求，便于在 CI 或本地 Gate 前确保架构一致性。

---

## 📦 安装

```bash
# 建议使用 Node.js 18+，确保与脚本一致
node --version

# Unix/Mac 下可赋予执行权限
chmod +x scripts/arch-tools/*.js
```

---

## 🚀 快速开始

### 1. 架构完整性检查

```bash
npm run arch:lint
```

**检查项：**
- ✅ `docs/ARCH.md` 与 `docs/arch-modules/*/ARCH.md` 是否存在并可读
- ✅ 核验总览、C4、接口视图、数据视图、技术选型、风险、运行时等必需章节
- ✅ Mermaid 图语法基本校验与模块化架构清单（`module-list.md`）一致性
- ✅ 模块化 ARCH 中新增的组件清单、接口导出/导入、数据资产、风险验证、Story/Component 追溯表等 artifact 是否齐全

**示例输出片段：**
```
🔍 Running Architecture Document Lint...
✅ Architecture document exists
✅ Required sections found (11/11)
⚠️ 组件/服务清单缺失：docs/arch-modules/payments/ARCH.md
```

> ℹ️ `arch-lint` 也会在模块化项目下遍历 `docs/arch-modules` 目录，若检测到缺失的 artifact（例如风险表、接口视图）会打印缺失模块列表，方便追补。

---

### 2. API 契约一致性检查

```bash
npm run arch:check-api-contracts [--json]
```

**检查项：**
- ✅ 从 `docs/ARCH.md` “跨模块依赖关系”找出所有 HTTP 端点引用（GET/POST...）
- ✅ 在 `docs/arch-modules/*/ARCH.md` 的“接口视图”中检索同一路径+方法的定义
- ✅ 输出缺失的 API 定义并推荐在模块文档补齐

`--json` 可生成结构化结果，便于在脚本中集成告警或质量看板。

---

### 3. 组件循环依赖检测

```bash
npm run arch:check-component-cycles [--json]
```

**检查项：**
- ✅ 解析 `docs/data/component-dependency-graph.md` 中的 Mermaid 边关系（`COMPONENT_A --> COMPONENT_B` 等）
- ✅ 使用 DFS 检测循环依赖路径，并去重后列出所有循环
- ✅ 若图仍是模板骨架或不存在则提前提示并退出

`arch:check-component-cycles` 在生成报告中还会注明循环会带来的部署、测试风险，并提供破环建议。

---

### 4. PRD ↔ ARCH ID 双向追溯

```bash
npm run arch:sync [--json] [--report]
```

**检查项：**
- ✅ 扫描 `docs/ARCH.md`、模块 ARCH 中的 Story ID（US-/FEAT-）并与 PRD（主 + 模块）做双向比对
- ✅ 验证 `docs/data/component-dependency-graph.md` 中 Component ID 是否在 `docs/arch-modules/*/ARCH.md` 中定义
- ✅ 可选 `--report` 生成 `docs/data/arch-prd-traceability.md` 追溯报告，记录 Story&Component ID 差异情况

`--json` 便于把结构化结果喂给流水线面板或自定义检查脚本。

---

## 📊 脚本状态

| 脚本 | 状态 | 说明 |
|------|------|------|
| `arch-lint.js` | ✅ 已实现 | 架构文档完整性与模块 artifact 检查 |
| `check-api-contracts.js` | ✅ 已实现 | ARCH ↔ 模块接口契约一致性验证 |
| `check-component-cycles.js` | ✅ 已实现 | Component 依赖图的循环检测与建议 |
| `sync-prd-arch-ids.js` | ✅ 已实现 | PRD/ARCH Story & Component ID 双向追溯，可输出追溯报告 |

---

## 🔧 集成建议

### 本地开发
在提交 ARCH 或 PRD 变更前先跑：

```bash
npm run arch:lint && npm run arch:sync -- --report
```

### CI/CD
在 `.github/workflows/arch-check.yml` 中新增：

```yaml
jobs:
  arch-quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with: { node-version: '18' }
      - name: Run Architecture Lint
        run: npm run arch:lint
      - name: Check API Contracts
        run: npm run arch:check-api-contracts
      - name: Detect Component Cycles
        run: npm run arch:check-component-cycles
      - name: Sync PRD-ARCH IDs
        run: npm run arch:sync -- --report
```

---

## ❓ 常见问题

### Q1: `arch:check-api-contracts` 没有输出？
**A**：可能是 `docs/ARCH.md` 中未写 `跨模块依赖关系` 章节或格式不规范，请补充章节并采用 `METHOD /path` 风格描述。

### Q2: `component-dependency-graph.md` 还是模板样式？
**A**：脚本会拒绝运行，先复制 `docs/data/templates/COMPONENT-DEPENDENCY-GRAPH-TEMPLATE.md` 并按实际组件补齐节点/边，再重新运行。

### Q3: 如何阅读 `arch-prd-traceability.md`？
**A**：该报告列出所有 Story/Component ID 统计与差异表，适合与 QA/PO 复核追溯；若差异超过 0，说明 ARCH 与 PRD 之间的追溯链不完整。

---

## 📚 参考资料

- [ARCHITECTURE-WRITER-EXPERT.md](../../AgentRoles/ARCHITECTURE-WRITER-EXPERT.md)
- [AGENTS.md](../../AGENTS.md)

> 持续改进中，如需扩展 CLI 选项可参考现有脚本结构或编写新的检查器并在 `package.json` 中注册命令。
