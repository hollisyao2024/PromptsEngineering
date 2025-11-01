# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v1.4] - 2025-11-01
### 新增
- 在 QA-TESTING-EXPERT.md 和 Playbook 中新增完整的部署与发布流程章节（§5），包含部署前检查清单、部署命令使用、部署后验证、回滚流程。
- 在 QA-TESTING-EXPERT.playbook.md 中新增"§2.5 部署与发布阶段"作业流程。
- 在 `/docs/QA.md` 推荐模板中新增"部署记录"表格，用于记录部署历史、冒烟结果与监控链接。
- 在 AGENTS.md 中新增"快捷命令与自动激活"章节，明确所有快捷命令会自动激活对应专家。

### 调整
- **职责分离优化**：明确 CI 命令归属 TDD 专家，CD/部署命令归属 QA 专家，建立清晰的质量门禁。
- 从 TDD-PROGRAMMING-EXPERT.md 中移除 4 个部署命令（`/ship staging`, `/ship prod`, `/cd staging`, `/cd prod`），移交给 QA 专家。
- 在 TDD-PROGRAMMING-EXPERT.playbook.md 中注释掉部署脚本，添加说明指向 QA 专家负责部署。
- 强化 TDD 专家的 QA 移交清单，明确移交条件（CI全绿、文档回写完成、CHANGELOG已更新、TDD_DONE已勾选）。
- 扩展 QA-TESTING-EXPERT.md 角色职责，新增部署与发布职责说明及5项前置条件。
- 优化 AGENTS.md 的"快捷命令速查"章节，按专家分组展示命令，每个命令都标注功能说明。

### 修复
- 清理 CHANGELOG.md 中的重复内容。
- 更新 QA-TESTING-EXPERT.playbook.md 章节编号（因插入新章节导致后续章节顺延）。
- 确保 AGENTS.md、专家角色文件、Playbook 三层文档的快捷命令完全一致。

## [v1.3] - 2025-10-13
### 新增
- `CHANGELOG.md`，作为模板版本历史记录入口。
- `.gemini/` 配置说明，默认将 Gemini CLI 上下文指向 `AGENTS.md`。
- `docs/AGENT_STATE.md` 增补 QA 阶段勾选项，确保状态机五阶段对齐。

### 调整
- 全面重写五位专家 Playbook 的结构，新增"输入与参考 / 输出与回写"段落并引用 `docs/CONVENTIONS.md`。
- 向各专家卡片和 `AGENTS.md` 添加点读 Playbook 提示，明确激活后获取模板与 Checklist 的路径。
- 更新 README 目录速览、快速开始与拷贝指引，说明文档回写 Gate、state 文件与 Playbook 用法。

### 修复
- 统一 QA 流程描述，补充 `/docs/QA.md`、`/docs/CHANGELOG.md`、ADR 等文档回写要求。

## [v1.2] - 2025-10-12
### 新增
- 首次公开发布 Agents Router 模板，包含五位专家卡片、配套 Playbook、`docs/AGENT_STATE.md` 状态机与目录骨架。
- 提供 `docs/CONVENTIONS.md` 目录规范、`db/migrations/` 双语言模板、`docs/data/` 数据视图示例。

### 调整
- 将 Handbooks 架构重构为按章节点读，强调激活后加载对应 Playbook。
- 状态机扩展至五阶段（PRD → ARCH → TASK → TDD → QA），同步更新 `AGENTS.md` 与 `docs/AGENT_STATE.md`。

### 修复
- 补全 QA 阶段文档回写说明，使 `/docs/QA.md`、`/docs/CHANGELOG.md`、ADR 与状态机保持一致。

[v1.4]: https://github.com/your-org/agents-router/releases/v1.4
[v1.3]: https://github.com/your-org/agents-router/releases/v1.3
[v1.2]: https://github.com/your-org/agents-router/releases/v1.2
