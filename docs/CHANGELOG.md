# Changelog

## v1.11.0 (2025-11-07)

### ✨ Features
- **QA 专家自动生成功能**：删除手动维护的 QA.md，改为基于 PRD/ARCH/TASK 自动生成
  - 新增 `/qa plan` 快捷命令（QA 专家角色）
  - 新增 `npm run qa:generate` 工具脚本
  - 智能检测项目规模，自动选择模板（小型项目单文件 / 大型项目主从结构）
  - 支持 9 类测试覆盖（功能/集成/E2E/回归/契约/降级/事件/性能/安全）
  - 自动生成测试策略、测试用例、测试矩阵
  - 与现有 5 个 QA 工具无缝集成（lint/coverage/sync/report/blockers）

### 📝 Documentation
- `AgentRoles/QA-TESTING-EXPERT.md`：增加"自动生成规范（`/qa plan` 流程）"章节
- `AGENTS.md`：更新 Phase 5 - QA 专家输出说明，增加自动生成流程
- `AGENTS.md`：快捷命令速查中增加 `/qa plan` 命令

### 🛠️ Technical
- 新增 `scripts/qa-tools/generate-qa.js` (~550 行，20KB)
- 更新 `package.json`：增加 `qa:generate` 命令

### 🗑️ Breaking Changes
- 删除 `docs/QA.md`：现在由自动生成工具创建，不再手动维护

---

## 2025-10-12
- Init package (v1.5)
