# Changelog

 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [v3.0.1] - 2026-09-09

### 兼容性升级

- 对照官方 Registry 复核全部 24 个 shadcn 基础组件，采用 cn 0.2.6，并升级 React 19.2.8、Lucide 1.43.0、Next 16.3.4、TypeScript 6.0.3、Vitest 5.0.0 及配套测试/类型依赖。
- 固定版本统一记录于 architecture/dependencies.json；dependency-audit.json 记录最新版本、采用版本和兼容保留依据。TanStack Table 保留最新 V8，TypeScript 使用最新兼容 V6，Node 类型保持 22.x。
- 项目 lib/utils.ts 仅初始化，保留已有 helper；基础控件直接引用 cn，Registry 和应用生成器使用一致依赖。保留 clsx/tailwind-merge 兼容项目导入。
- 适配 TypeScript 6 的路径与显式类型配置，初始化 Next 类型声明以支持构建前独立 type-check。前端 Node 要求与 jsdom/Vitest 对齐为 22.22.2+（22.x）、24.15+（24.x）或 26+。

## [v3.0.0] - 2026-09-09

### 新增

- 分离 agent 作业包、architecture 架构包和 tooling/xirang 通用更新引擎；保留既有作业脚本的兼容路径。
- 按应用/存储选择 Vite、Next、Node、Go、Tauri、PostgreSQL、SQLite，以及契约、迁移、可观测性、资源、插件和私有交付模块。
- 提供架构配置、目录标准、检测、冻结计划、初始化、检查和模块升级命令；应用目录不绑定某一种后端或数据库。
- 内置 24 个 shadcn 基础控件、可发布 Registry 和基于 TanStack 的公共 DataTable，支持分页、多选、排序、筛选、列显隐、导出及真实异步 CRUD 回调。

### 更新与迁移

- 文件按覆盖保护、三方更新、字段合并、幂等追加、受管块和仅初始化策略管理；版本锁和基线随项目提交，运行日志保存在容器 tmp。
- 原生控件、重复低阶表格、目录/别名冲突和迁移摘要变化进入本地架构检查；中断按哈希恢复，源/目标/版本锁漂移时阻断。
- 旧消费者首次缺少基线时需要显式接管。接管保留现有内容作为定制，不等于把所有旧协议直接替换成新版本。RULES.md、业务源码和实际项目文档继续归项目维护。
- 通过 400 项源码回归、生成前端的 8 项交互测试及 Vite/Next 构建、真实浏览器旅程、Node/Go 骨架、macOS Tauri 编译和隔离数据库验证。

## [v2.2.1] - 2026-09-06

### 修复
- 官方公开息壤模板改为匿名 HTTPS 拉取，不读取项目 GH_TOKEN；隔离用户 Git 配置、credential helper、askpass、认证头与 URL 重写。
- 初始化、获取和检出使用同一匿名环境，输出 TEMPLATE_AUTH_MODE；保留固定 SHA、失败阻断及 apply 收敛，项目 GitHub 鉴权不变。
- 匿名下载保留代理/CA 环境变量、开启 TLS 校验且拒绝重定向；真实 HTTP 请求与项目凭据回归覆盖成功和拒绝路径。

## [v2.2.0] - 2026-09-06

### 新增
- 模板正式命名为“息壤”（Xirang），登记稳定 ID、官方 GitHub 仓库与默认分支。
- 新增 `pnpm agent -- template sync`：required fetch 远端、固定 commit SHA，并从远端快照自举最新版 updater。
- 实际项目中的自然语言“更新息壤模板”确定性触发专用 worktree 更新与既有 TDD/QA 交付链。

### 安全与兼容
- fetch、ref 或源形状校验失败时在目标 tracked 写入前阻断，不回退缓存或本地旧模板。
- 模板写入后新增 convergence dry-run；`RULES.md`、业务源码、项目配置等 project-owned 内容继续受 manifest 保护。
- `template.sourceRepo` 保持本地回灌语义，与官方只读上游配置分离。

## [v2.0.0] - 2026-07-12

### Breaking Changes
- PRD、ARCH、TASK、QA 仅保留“主总纲与索引 + module-list + 模块文档”结构，删除单一文档模式及规模阈值分支。
- 主模板统一重命名为 `PRD-TEMPLATE.md`、`ARCH-TEMPLATE.md`、`TASK-TEMPLATE.md`、`QA-TEMPLATE.md`。
- 模板升级会通过受控 `remove` 策略删除目标项目中 8 个废弃的 `SMALL/LARGE` template-owned 文件。

### 更新
- TASK 生成器聚合主/模块 PRD 与 ARCH，校验模块集合一致后固定生成模块 TASK。
- QA 全项目生成固定产出主 QA、模块清单和全部模块 QA。
- PRD、ARCH、TASK、QA lint 在缺少模块目录、模块清单或模块文档时失败。

## [v1.18.12] - 2026-04-20

### 更新
- feat: chore remove rules md

---


## [v1.18.11] - 2026-04-16

### 更新
- feat: fix in progress commit after push

---


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
