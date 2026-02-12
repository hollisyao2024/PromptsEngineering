# TDD 工具脚本使用说明

> 专为 TDD 阶段的开发者准备，自动化迁移创建、任务勾选与标准化发布，帮助在代码提交前完成质量 Gate 与版本管理。

---

## 📦 安装与环境

- Node.js 18+：`tdd-tick.js` 与 `tdd-push.js` 使用 Node 环境执行。
- Bash：`create-migration*.sh` 脚本使用 POSIX/Bash 语法，Unix/Mac 可直接运行，Windows 可在 WSL/git bash 中执行。
- 统一添加执行权限（Unix/Mac）：
  ```bash
  chmod +x scripts/tdd-tools/*.sh
  ```

---

## 🚀 快速开始

### 1. 通用迁移模板生成

```bash
./scripts/tdd-tools/create-migration.sh <description> [--dir <path>] [--dialect <postgres|mysql|oracle|sqlite|generic>]
```

**说明：**
- `description` 仅允许小写字母/数字/下划线（例如 `add_user_roles`）。
- `--dir` 可定制输出目录（默认 `db/migrations`）。
- `--dialect` 用于提示块中标注目标数据库，方便团队成员识别（默认 `generic`）。
- 生成文件内包含 Expand → Migrate → Contract 模板、各方言示例与幂等性提示、回滚建议。

**示例输出：**
```
✅ 迁移文件创建成功！
📄 文件路径: db/migrations/20251112094500_add_user_roles.sql
🧩 方言标签: postgres
```

---

### 2. Supabase 专用迁移生成

```bash
./scripts/tdd-tools/create-migration-supabase.sh <description>
```

**说明：**
- 输出路径固定为 `supabase/migrations/`，方便 Supabase CLI 识别。
- 同样要求描述使用小写+下划线，并在文件内追加回滚提示与示例 SQL。
- 输出带颜色提示（红/绿/黄），便于在终端快速识别。

---

### 3. 任务自动勾选（/tdd tick）

```bash
pnpm run tdd:sync
pnpm run tdd:sync -- --project
或者
pnpm run tdd:tick
```

**检查项：**
- 根据当前 Git 分支名称提取 `TASK-XXX` ID（例如 `feature/TASK-PAY-010`）。
- `tdd:sync` 默认是 `session` 作用域：仅处理当前会话涉及模块（主 `TASK.md` + 对应域的模块 TASK + `module-list.md`）。
- `tdd:sync -- --project` 或 `tdd:tick` 为全项目作用域：遍历 `docs/TASK.md` 与 `docs/task-modules/**/*.md`。
- 输出未找到的任务 ID 以阻断缺失勾选。

**Tip**：脚本还会根据任务名称生成标准化变种，尽量匹配表格/列表中的描述，避免手工漏勾。

---

### 4. 发布前自动推送（/tdd push）

```bash
pnpm run tdd:push [bump|vX.Y.Z] [release-note]
pnpm run tdd:push -- --project [bump|vX.Y.Z] [release-note]
```

**执行流程：**
- `tdd:push` 会发布当前分支（版本变更、tag、push、创建当前分支 PR），不会操作其他分支。
- `tdd:push -- --project` 为显式项目模式，仍只针对当前分支执行：
  - 校验工作树干净（`git status --porcelain`）。
  - 读取 `package.json` 当前版本并决定目标版本。
  - 更新 `package.json` 与 `CHANGELOG.md`。
  - `git add` / `git commit` / `git tag` / `git push` / 自动创建 PR。

> ℹ️ 如果提供 `release-note`，会作为 `chore(release)` commit 的内容与标签说明使用。

---

## 📊 脚本状态

| 脚本 | 状态 | 说明 |
|------|------|------|
| `create-migration.sh` | ✅ 实用 | 通用数据库迁移模板，支持多方言与幂等性提示 |
| `create-migration-supabase.sh` | ✅ 实用 | Supabase 风格迁移，输出到 `supabase/migrations` |
| `tdd-tick.js` | ✅ 实现 | 基于分支名自动勾选 TASK 文档中的复选项 |
| `tdd-push.js` | ✅ 实现 | 版本 bump + changelog + commit/tag/push 自动化 |

---

## 🔧 集成建议

### 开发节奏
1. 修改功能后运行 `/tdd tick` 确保 TASK 文档同步。
2. 编写/更新迁移脚本时优先使用 `create-migration.sh`（或 Supabase 版本）。
3. 准备发布时走 `/tdd push`，省去手动版本准备的重复劳动。

### CI/CD
可在 Release Pipeline 中运行：

```yaml
steps:
  - name: Run TDD Tick
    run: pnpm run tdd:tick
  - name: Create Deployment Migration
    run: ./scripts/tdd-tools/create-migration.sh add_new_feature --dir db/migrations --dialect postgres
  - name: Publish Release
    run: pnpm run tdd:push bump "Release prep"
```

---

## ❓ 常见问题

### Q: `tdd:push` 提示 `工作区存在未提交的变动`？
A: 清理所有本地修改（commit/stash）后再执行，确保版本变更与 changelog 是唯一差异。

### Q: `create-migration.sh` 文件出现重复？
A: 检查 `TIMESTAMP` 生成是否重复，或者指定不同的 `--dir` 路径；脚本会在目标路径检测文件是否已存在。

### Q: `tdd-tick` 未找到 TASK ID？
A: 请确认当前分支名包含 `TASK-` 关键字（如 `TASK-PAY-010` 或 `feature/TASK-PAY-010`），该脚本依赖命名规范。

---

## 📚 参考资料

- `package.json` 中的 `tdd:*` 脚本定义
- `/docs/TASK.md` & `/docs/task-modules/` 任务模板
- [AGENTS.md](../../AGENTS.md)

> 欢迎在脚本新增功能时同步更新本 README，保持工具文档一致性。
