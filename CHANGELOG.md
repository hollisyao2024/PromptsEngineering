# Changelog

 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v1.18.10] - 2026-04-16

### 更新
- feat: in progress tracking

---


## [v1.18.9] - 2026-04-16

### 更新
- feat: tighten post push gate review policy

---


## [v1.18.8] - 2026-04-11

### 更新
- feat: align tdd code review commands

---


## [v1.18.7] - 2026-04-08

### 更新
- fix: qa merge main worktree support

---


## [v1.18.6] - 2026-03-28

### 更新
- fix: qa merge auth token

---


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
