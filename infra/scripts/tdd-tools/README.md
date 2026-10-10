# TDD 工具脚本使用说明

> 专为 TDD 阶段的开发者准备，自动化迁移创建、任务勾选与标准化发布，帮助在代码提交前完成质量 Gate 与版本管理。

---

## 📦 安装与环境

- Node.js 18+：`tdd-tick.js` 与 `tdd-push.js` 使用 Node 环境执行。
- Bash：`create-migration*.sh` 脚本使用 POSIX/Bash 语法，Unix/Mac 可直接运行，Windows 可在 WSL/git bash 中执行。
- 统一添加执行权限（Unix/Mac）：
  ```bash
  chmod +x infra/scripts/tdd-tools/*.sh
  ```

---

## 🚀 快速开始

### 1. 通用迁移模板生成

```bash
./infra/scripts/tdd-tools/create-migration.sh <description> [--dir <path>] [--dialect <postgres|mysql|oracle|sqlite|generic>]
```

**说明：**
- `description` 仅允许小写字母/数字/下划线（例如 `add_user_roles`）。
- `--dir` 指定输出目录；也可通过 `AGENT_MIGRATIONS_DIR` 或 `agent.config.json paths.migrationsDir` 配置，未配置时脚本会明确阻断，避免猜测项目目录。
- `--dialect` 用于提示块中标注目标数据库，方便团队成员识别（默认 `generic`）。
- 生成文件内包含 Expand → Migrate → Contract 模板、各方言示例与幂等性提示、回滚建议。

**示例输出：**
```
✅ 迁移文件创建成功！
📄 文件路径: <migrations-dir>/20251112094500_add_user_roles.sql
🧩 方言标签: postgres
```

---

### 2. Supabase 专用迁移生成

```bash
./infra/scripts/tdd-tools/create-migration-supabase.sh <description>
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
- `pnpm agent -- tdd sync` 在文档门禁之前先执行 Base Sync Gate：`git fetch --prune origin <base>` 后，若 `origin/<base>` 不是当前 HEAD 的祖先则 `git merge --no-edit origin/<base>`，输出 `BASE_SYNC=OK|SKIPPED  BASE_REF=  BASE_SHA=  MERGED=true|false`（在主干上或无 origin 时 `SKIPPED` 并给 `REASON=`）。fetch 失败为 `REASON=BASE_FETCH_FAILED`，合并冲突会 `merge --abort` 并以 `REASON=BASE_MERGE_CONFLICT` 阻断，`NEXT_ACTION` 指向手动合并；这样 `qa verify` 不再因远端主干前进而报 `STALE_QA_BASE`。

**Tip**：脚本还会根据任务名称生成标准化变种，尽量匹配表格/列表中的描述，避免手工漏勾。

---

### 4. 发布前自动推送（/tdd push）

```bash
pnpm run tdd:push [bump|vX.Y.Z] [release-note]
pnpm run tdd:push -- --project [bump|vX.Y.Z] [release-note]
pnpm agent -- tdd review-gate [--base <ref>] [--json]
pnpm agent -- tdd review-gate --record required|optional --reason "<结论>" [--task <id>]
```

**执行流程：**
- `tdd:push` 会发布当前分支（版本变更、tag、push、创建当前分支 PR），不会操作其他分支。
- `tdd:push -- --project` 为显式项目模式，仍只针对当前分支执行：
  - 若工作树存在未提交改动，自动执行 `git add -A`，并基于当前分支名生成 commit message 后提交到当前分支。
  - 先执行 `tdd:review-gate`，输出 `Review-Class` 与 `Reason`。
  - `tdd review-gate --record <required|optional> --reason <text>` 把模型侧语义审查结论作为 `REVIEW_DECISION=<json>`（含 `head_sha`、`base_ref`）追加到当前任务未完成步骤的 evidence，输出 `REVIEW_RECORDED=<task>/<step>`；`--task` 未给时按当前 worktree 自动选择任务。随后的 `tdd push` 读取最近一条记录，在 PR 描述的 Review Gate 段追加 `Model-Review: <decision>（<reason>）`，没有记录时不写该行。
  - 通过脚本内认证执行当前分支 push / 自动创建当前分支 PR，并在 PR 描述中写入 `Review-Class` / `Reason`。优先使用 gh CLI；gh 不可用时用 `.env.local` 的 `GH_TOKEN` 走 GitHub API。两者都不可用或 PR 创建失败时输出 `STATUS=BLOCKED` 并非零退出，修复后重跑 `tdd push`（已有 PR 时同步 Review Gate，并刷新标记内的概要与变更内容）。
  - 自动提交信息与 PR 标题由分支前缀推导 Conventional 类型（`feature/`→`feat`、`fix/`、`docs/`、`refactor/` 等），去掉末尾 8 位日期。
  - PR「概要」取分支提交正文中的 `-`/`*` 要点，「变更内容」列出短 SHA 与提交标题，二者包在 `<!-- xirang:auto-summary:start/end -->` 标记内；起始标记带生成内容摘要（`digest=`），再次 `tdd push` 仅在标记内容未被修改时按当前提交刷新，人工改过的概要保持原样并提示；标记外的手写章节保持不变。要重新自动生成，删除起始标记里的 `digest=…`；要彻底手工接管，删除这两行标记。早期无标记的自动正文（3.7.13 及更早：概要只有 PR 标题一行；3.7.14：概要取提交要点、变更内容列 sha7）只要与按当前分支提交重建的内容逐字一致，就会在下次推送时升级为带标记的格式；被修改过、或所列提交已不在分支上（如 rebase 后）的正文不改动。工作区自动提交的正文逐条列出改动文件（最多 20 条），使概要不再只有提交标题。`qa merge` 用「概要」作为 squash 提交正文。
  - 若结果为 `required`，Claude Code / Gemini CLI 后续必须执行当前 CLI 对应的 code review；Codex CLI 不执行 `codex review --base <PR目标分支>`，也不要求人工 `Approved`，记录 `Codex review skipped by policy` 后继续后续流程。
  - 若结果为 `optional-skipped` 或 `skipped`，可跳过 review，但不能跳过 lint / typecheck / 定向测试。

> ℹ️ 如果提供 `release-note`，会作为 `chore(release)` commit 的内容与标签说明使用。

---

### 5. 提交（/tdd commit）

```bash
pnpm agent -- tdd commit [git commit 选项...]
```

提交已暂存的改动；提交身份只来自 git 已有身份或 `.env.local` 的 `GH_TOKEN` 所属账号，不需要也不接受手填身份。

**执行流程：**
- 选项原样转发给 `git commit`（如 `-m`、`-a`、`--no-verify`）；不接受 `--author`（含 `--au` 等缩写）。不负责暂存，先用 `git add` 选好要提交的文件。
- 作者与提交者分别判断：git 已有显式身份（git 配置，或 `GIT_AUTHOR_*` / `GIT_COMMITTER_*` 环境变量）的角色保持不变，不访问网络。
- git 没有身份的角色，取 `GH_TOKEN` 所属账号（`GET /user`）：姓名为账号 `name`（为空则用 `login`），邮箱为 `<id>+<login>@users.noreply.github.com`，与该账号经 GitHub 合并产生的提交所用的 noreply 身份一致。身份只经本次 git 进程的环境变量传递，不写任何 git 配置，不落盘缓存；账号查询在子进程中完成，令牌只经子进程环境变量传递，不进命令行参数，错误信息中的令牌一律替换为 `***`。
- git 没有身份、又读不到 `GH_TOKEN`，或账号查询失败时输出 `STATUS=BLOCKED` 并非零退出，不运行 git，也不退回 git 的 EMAIL / 主机名自动探测。
- 输出 `STATUS`、`SUMMARY`、`NEXT_ACTION`、`IDENTITY_SOURCE`（`configured` / `github-token` / `unresolved`）、`IDENTITY`、`COMMIT`。

**同一机制也作用于脚本内的 git 调用：** `tdd push` 的自动提交，以及 `tdd sync` Base Sync Gate 的 `git merge --no-edit origin/<base>`，以及 `qa merge` 的本地 squash 提交、发布/状态提交与注解 tag，经共享的 `buildGitHubGitEnv` 时按同样规则补身份，只对 `commit`、非快进 `merge`（`--ff-only`、`--abort`、`--quit` 除外）和注解 `tag` 生效。直接在终端裸执行的 `git commit`、以及 `github-auth-run.js -- git commit` 不经过这条路径，不会被补身份。git 没有身份又读不到 `GH_TOKEN` 时，这条脚本路径不补身份也不阻断，作者仍由 git 自己探测（与改动前一致）；只有 `tdd commit` 在这种情况下阻断。

---

## 📊 脚本状态

| 脚本 | 状态 | 说明 |
|------|------|------|
| `create-migration.sh` | ✅ 实用 | 通用数据库迁移模板，支持多方言与幂等性提示 |
| `create-migration-supabase.sh` | ✅ 实用 | Supabase 风格迁移，输出到 `supabase/migrations` |
| `tdd-new-branch.js` | ⚠️ 显式 opt-in | 默认阻断并提示使用 worktree；传入 `--explicit` 才创建普通 branch，不提供默认 package alias |
| `tdd-tick.js` | ✅ 实现 | 基于分支名自动勾选 TASK 文档中的复选项 |
| `tdd-push.js` | ✅ 实现 | push + 自动创建 PR + 输出 review gate 判定 |
| `tdd-commit.js` | ✅ 实现 | 提交已暂存改动；git 无身份时作者与提交者取自 `GH_TOKEN` 所属账号，不写 git 配置 |
| `tdd-review-gate.js` | ✅ 实现 | 按差异风险判定 `required / optional-skipped / skipped`；`--record` 把模型审查结论写入任务 evidence，供 `tdd push` 写入 PR `Model-Review` |

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
    run: ./infra/scripts/tdd-tools/create-migration.sh add_new_feature --dir <migrations-dir> --dialect postgres
  - name: Publish Release
    run: pnpm run tdd:push bump "Release prep"
```

---

## ❓ 常见问题

### Q: `tdd:push` 遇到未提交改动会怎样？
A: 脚本会默认把当前工作区改动 `git add -A` 后自动提交到当前分支，再继续 push / PR / review gate。若你不希望某些改动进入本次 PR，应先手动整理工作区。

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
