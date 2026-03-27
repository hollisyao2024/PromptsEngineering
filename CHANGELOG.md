# Changelog

 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v1.18.5] - 2026-03-27

### 更新
- feat: codemap high value scan

---


## [v1.18.4] - 2026-02-24

### 更新
- 发布新版 v1.18.4

---


## [v1.18.4] - 2026-02-17

### 更新
- `/qa merge` 新增自动 rebase 功能：合并前主动将 feature 分支 rebase 到最新 main，避免合并时才发现冲突。含冲突自动中止、force-push 失败回退等边界处理。
- 修正 `QA-TESTING-EXPERT.md` 步骤列表与"15个关键步骤"声明的偏差（原列 13 项，现补齐为 15 项）。

---

## [v1.18.3] - 2025-11-13

### 更新
- 扩充 `AgentRoles/QA-TESTING-EXPERT.md`，新增测试产物管理与测试工具配置检查指南，明确 .gitignore 规则、Playwright/Jest 推荐配置与 QA 预检流程。
- 将包版本提升到 `v1.18.3`，同步发布元数据以便追踪最新 QA 规范。

---

## [v1.18.2] - 2025-11-13

### 更新
- 扩展 `.gitignore`，纳入环境变量、构建产物、IDE 配置、测试缓存等常见临时文件夹，避免误提交个人或生成内容。
- 将包版本提升到 `v1.18.2`，保持发布元数据与当前仓库状态一致。

---

## [v1.18.1] - 2025-11-13

### 更新
- 将包版本提升到 `v1.18.1`，保持发布元数据与当前代码一致。

---

## [v1.18.0] - 2025-11-12

### 更新
- 增加 `docs/data/templates/arch/ERD-TEMPLATE.md` 与 `docs/data/templates/arch/dictionary-TEMPLATE.md`，为 ARCH 数据视图提供标准化的 ER 图与数据字段条目模板，并在 `/docs/data/README.md` 与 `AgentRoles/ARCHITECTURE-WRITER-EXPERT.md` 中明确引用。
- 说明 `docs/data/ERD.md` 与 `docs/data/dictionary.md` 由数据视图流程动态生成，并移除仓库中的静态副本，只保留模板作为源文件；同时在 `docs/CONVENTIONS.md`、`docs/data/README.md` 中补充同步/生成提示。
- 将包版本升至 `v1.18.0`，保持发布元数据与新的文档整理一致。

---

## [v1.17.0] - 2025-11-11

### 更新
- 将包版本提升到 `v1.17.0`，确保发布元数据与当前代码一致。
- 仅同步版本记录与变更日志，暂无额外功能或规范调整。

---

## [v1.16.0] - 2025-11-11

### 更新
- 同步 `AGENT` 路由文档、`docs` 模块与 `scripts/arch-tools` 的最新改动，确保 PRD/ARCH/QA/Task 的上下文一致。
- 将包版本提升到 `v1.16.0`，作为当前代码状态的正式里程碑。

---
