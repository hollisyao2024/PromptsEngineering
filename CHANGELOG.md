# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v1.2] - 2025-10-12
### 新增
- 首次公开发布 Agents Router 模板，包含五位专家卡片、配套 Playbook、`docs/AGENT_STATE.md` 状态机与目录骨架。
- 提供 `docs/CONVENTIONS.md` 目录规范、`db/migrations/` 双语言模板、`docs/data/` 数据视图示例。

### 调整
- 将 Handbooks 架构重构为按章节点读，强调激活后加载对应 Playbook。
- 状态机扩展至五阶段（PRD → ARCH → TASK → TDD → QA），同步更新 `AGENTS.md` 与 `docs/AGENT_STATE.md`。

### 修复
- 补全 QA 阶段文档回写说明，使 `/docs/QA.md`、`/docs/CHANGELOG.md`、ADR 与状态机保持一致。

# Changelog

遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v1.3] - 2025-10-13
### 新增
- `CHANGELOG.md`，作为模板版本历史记录入口。
- `.gemini/` 配置说明，默认将 Gemini CLI 上下文指向 `AGENTS.md`。
- `docs/AGENT_STATE.md` 增补 QA 阶段勾选项，确保状态机五阶段对齐。

### 调整
- 全面重写五位专家 Playbook 的结构，新增“输入与参考 / 输出与回写”段落并引用 `docs/CONVENTIONS.md`。
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

[v1.3]: https://example.com/releases/v1.3
[v1.2]: https://example.com/releases/v1.2
