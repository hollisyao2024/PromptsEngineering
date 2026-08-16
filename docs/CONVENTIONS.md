# 通用工程约定

本文件定义模板可复用的详细协议。项目专用规则放在根目录 `RULES.md`，项目参数放在稀疏 `agent.config.json`；模板源不提供 `RULES.md`。

## 1. 路径与仓库拓扑

所有仓库内相对路径以主 Git worktree 根为基准。推荐容器结构：

```text
<container>/
├── repo/          # 主 worktree
├── worktrees/     # 修改任务 worktrees
├── tmp/           # 状态、锁、测试报告
├── cache/         # 可重建缓存
└── artifacts/     # 构建/发布产物
```

脚本必须使用 `infra/scripts/shared/config.js` 的 `resolveRepoRoot()`、`getMainRepoRoot()` 和 `resolveContainerPath()` 解析路径。linked worktree 中禁止以 `../tmp` 猜测容器位置。

主 worktree 保持在 base branch。修改 tracked 文件只在专属 worktree 中进行；只读诊断可在任意 worktree。每个 worktree 独立安装依赖，包内容复用交给包管理器 store。

## 2. 配置

有效配置按以下优先级合并：

```text
CLI > 环境变量 > agent.config.json > infra/templates/agent/config.example.json
```

`config.example.json` 是唯一默认值来源；代码不得再维护第二份大体积默认对象。项目根 `agent.config.json` 只保存与默认值不同的键。目录不存在时，通用脚本应跳过或输出明确下一动作。

模板协议文件：

- `infra/templates/agent/config.example.json`：完整默认值和配置结构。
- `infra/templates/agent/project-config.example.json`：新项目的稀疏配置起点。
- `infra/templates/agent/package-scripts.example.json`：推荐公共命令，不代表完整兼容别名。
- `infra/templates/agent/template.manifest.json`：模板所有权和合并策略。

配置和 JSON 文件使用 UTF-8、两个空格缩进、文件末尾换行。密钥只能从环境或忽略的本地文件读取。

## 3. 模板所有权

Manifest 支持以下策略：

- `overwrite`：模板协议文件可升级覆盖。
- `init-if-missing`：仅初始化，已有项目文件不覆盖。
- `merge-json` / `merge-lines`：只合并协议允许的缺失项。
- `project-owned`：模板永不写入。

`RULES.md`、真实项目文档、源码、业务部署脚本和已有 `agent.config.json` 均属于项目。模板更新流程必须：

1. dry-run 并报告 create/update/merge/conflict/skip；
2. 冲突时 fail-closed；
3. apply 后校验哈希和文件范围；
4. 再次 dry-run，预期无差异。

模板回灌默认关闭，仅处理已记录 baseline 之后的 template-owned 改动；项目规则、配置、业务文档和 generated 文件不可回灌。

## 4. 文档与阶段状态

治理流程采用模块化文档：

- `docs/PRD.md`、`ARCH.md`、`TASK.md`、`QA.md`：总纲和模块索引。
- `docs/{prd|arch|task|qa}-modules/module-list.md`：模块登记表。
- `docs/{prd|arch|task|qa}-modules/<domain>/`：功能域详情。
- `docs/data/traceability-matrix.md`：需求到测试的追踪关系。

`docs/AGENT_STATE.md` 只保存稳定里程碑：

1. `PRD_CONFIRMED`
2. `ARCHITECTURE_DEFINED`
3. `TASK_PLANNED`
4. `TDD_DONE`
5. `QA_VALIDATED`
6. `DEPLOYED`

里程碑已勾选时不得附加新的 PR、日期或重试行。运行态由外部 session 文件承担，避免每次合并产生无意义文档提交。

## 5. Worktree 生命周期

创建/恢复入口：

```bash
pnpm agent -- worktree new --phase=<phase> --task <id>
pnpm agent -- worktree bootstrap
pnpm agent -- worktree list
```

任务标识、分支名或描述至少提供一个。创建成功后必须切换到脚本输出的 `NEXT_CWD`。禁止从 worktree A 用绝对路径调用 worktree B 或主仓库脚本。

并行开发状态写入 `../tmp/worktree-sessions/`，锁写入 `../tmp/agent-locks/`。锁包含 PID；仅在确认 owner 不存活后回收 stale lock。

合并前按顺序 fetch、rebase、验证、文件集合复查并进入串行 merge queue。合并后先原子记录 HEAD、worktree 路径和 cleanup intent，再清理。出现 HEAD 漂移、dirty worktree 或缺少封印时必须保留并转 `recovery_required`。

## 6. 长任务状态文件

满足以下任一条件必须使用任务状态：用户明确要求持续执行；至少 3 个可独立验证步骤；预计跨会话、压缩或进程重启。

状态目录固定为：

```text
<container>/tmp/agent-task-runs/<task-id>/
├── state.json
└── evidence/      # 可选大体积证据
```

`state.json` 是唯一事实来源，固定记录：

- schema/version、task id、目标、描述、类型和生命周期状态；
- 验收标准、约束、步骤、当前步骤、最后错误和唯一下一动作；
- 主项目、当前 repo/worktree/branch；
- 每步 `replay=safe|verify_first`、状态、简短证据和更新时间；
- 完成或清理状态。

状态写入必须复用 `agent-locks`，采用同目录临时文件、flush/sync 和原子 rename。读取时忽略残留临时文件；损坏 JSON、schema 不符、锁冲突和多候选任务必须 fail-closed。

### 命令

```bash
pnpm agent -- task start --task <id> --desc "<目标>" --step "<步骤>"
pnpm agent -- task checkpoint --task <id> --step <id> --status done --evidence "<证据>" --next "<下一动作>"
pnpm agent -- task resume --auto
pnpm agent -- task finish --task <id>
pnpm agent -- task cancel --task <id> --force
```

步骤状态为 `pending|running|done|blocked|verify_required`：

- `safe` 步骤中断后回到 `pending`，可重放。
- `verify_first` 步骤中断时转为 `verify_required`，先查询真实外部状态。
- `done` 必须有证据；`blocked`/错误/等待必须有 `nextAction`。
- 同一次 checkpoint 可更新步骤和验收项，减少机械写盘。
- `resume --auto` 仅在当前主 repo/worktree/branch 唯一匹配时选择任务；否则输出候选和 `STATUS=BLOCKED`。

`finish` 要求所有必需步骤、验收项和证据完成。修改任务还必须通过 completion guard。门禁通过后先写 `completed`，再删除精确任务目录；删除失败保留 `cleanup_pending`，但不得重新执行任务。

容器普通 tmp 清理必须保护 `agent-task-runs/` 中的未完成任务。只有 `finish` 或用户明确 `cancel --force` 可删除。

## 7. 命令面

新项目只推荐统一入口：

```text
pnpm agent -- task <action>
pnpm agent -- worktree <action>
pnpm agent -- tdd <action>
pnpm agent -- qa <action>
pnpm agent -- template <action>
pnpm agent -- dev|ship|finish
```

旧 aliases 在已有项目中保留兼容，但模板不继续增加同义入口。命令必须输出可解析的 `STATUS`、`SUMMARY`、`NEXT_ACTION`，失败时退出码非零。

## 8. TDD、QA 与交付

测试遵循最小风险覆盖：

- 先写会失败的定向测试，再实现，再回归。
- 纯文档变更至少执行格式、链接或模板契约测试。
- 共享基础设施变更执行单元、集成和相关回归；不得用全量失败掩盖定向结果。
- 测试证据记录命令、退出码和简短结论，不粘贴超长日志。

修改任务固定执行 `tdd sync → tdd push → qa plan → qa verify → qa merge → finish`。`finish`/completion guard 只在主分支已合并、工作区干净且与远端一致时返回成功。

审查高风险域：认证权限、数据写删、事务一致性、缓存一致性、并发、外部 API、数据库 schema、共享基础库、跨文件业务联动和 hotfix。未命中可跳过语义 review，但不可跳过 lint、类型检查和测试。

## 9. GitHub、命名与安全

- GitHub token 变量统一为 `GH_TOKEN`。
- 远端 Git/GitHub 命令必须由 `infra/scripts/shared/github-auth-run.js` 或上层脚本执行。
- branch、task id、目录使用小写 kebab-case；脚本使用 kebab-case，JavaScript 标识符使用 camelCase。
- 不提交凭据、`.env.local`、用户数据、未脱敏日志或本地绝对路径快照。
- destructive 操作前解析精确路径并验证归属；不对仓库根、HOME、通配符或未解析变量递归删除。

## 10. 全仓扫描

完整性影响正确性的跨目录任务先 Discovery、后 Editing。候选 manifest 写入容器 `tmp/scan-manifests/`，包含范围、排除项和全部候选。最终必须报告：

```text
scanned_count
matched_count
modified_count
skipped_count
```

并满足 `matched_count = modified_count + skipped_count`。范围变化时创建新 manifest，不得静默缩小。
