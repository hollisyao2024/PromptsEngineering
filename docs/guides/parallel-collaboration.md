# 双任务演练：多人、多 AI 会话并行协作

[首页](../../README.md) · [先完成接入](quickstart.md) · [工程约定](../CONVENTIONS.md)

目标：两个会话分别修改不同文档，通过独立 worktree 交付，再顺序合并。它演示工作区隔离与提交验证，不证明任意业务任务可以无冲突并行。

## 演练前提

- 使用自己可丢弃的演练项目；已建立 `origin/main`，本地和远端基线一致。
- 已完善 `RULES.md`、GitHub 鉴权与必要检查。各协作者有相应仓库权限。
- 每个会话完整读取基础规则。多人可以在不同电脑；同机多会话也可。
- 每个任务只拥有自己的文件，共享配置、依赖锁文件和接口由团队提前分配负责人。

本例约定：A 新增 `docs/team-a.md`，写三条项目协作约定；B 新增 `docs/team-b.md`，写三条反馈约定。两项都要求 Markdown 链接有效，不改运行逻辑。

## 给会话 A 的完整指令

> 在演练项目执行文档任务 demo-guide-a。按基础规则登记 mutation 任务与验收，再创建独立 worktree。仅新增 docs/team-a.md，写三条协作约定并链接回项目 README。验收：文件存在、恰有三条约定、链接有效、无运行逻辑变化。按文档任务选择最小静态验证，记录证据；完成 TDD → QA → 合并和主干核对。不要修改 B 的文件；每次副作用按任务状态记录。遇到主干或提交漂移，重新同步和验证，不覆盖远端。最后关闭本任务。

## 给会话 B 的完整指令

> 在演练项目执行文档任务 demo-guide-b。按基础规则登记 mutation 任务与验收，再创建独立 worktree。仅新增 docs/team-b.md，写三条反馈约定并链接回项目 README。验收：文件存在、恰有三条约定、链接有效、无运行逻辑变化。按文档任务选择最小静态验证，记录证据；完成 TDD → QA → 合并和主干核对。不要修改 A 的文件；每次副作用按任务状态记录。遇到主干或提交漂移，重新同步和验证，不覆盖远端。最后关闭本任务。

这些是给执行器的任务输入，不是新增自动调度器。不要让两个会话在同一个开发 worktree 中执行。

## 关键命令与检查点

以 A 为例；B 使用独立的任务 ID `demo-guide-b`，不复用 A 的状态。

```bash
pnpm agent -- task start --task demo-guide-a --phase tdd --type mutation --desc "新增团队协作约定" --acceptance "docs/team-a.md包含三条约定，README链接有效且无运行逻辑变化" --verify-step "创建worktree" --verify-step "编写并验证文档" --verify-step "提交推送与QA合并" --step "主干核对并关闭任务"
pnpm agent -- task checkpoint --task demo-guide-a --step S1 --status running --evidence "已明确文件边界与验收"
pnpm agent -- worktree new --phase=tdd --task demo-guide-a
```

创建成功后，检查 `NEXT_CWD`、`BRANCH_NAME` 与 `BASE_COMMIT`。**立刻切换到各自的 `NEXT_CWD`**；所有后续编辑、脚本与测试均在其中执行。依赖通过 `worktree bootstrap` 在当前 worktree 独立建立，不能链接到另一个 worktree 的 `node_modules`。

继续用 `task checkpoint` 完成 S1、启动 S2，再写文件与验证；不要因为示例省略重复记账而绕过状态要求。实现后按顺序执行：

```bash
pnpm agent -- tdd sync
pnpm agent -- tdd push
pnpm agent -- qa plan
pnpm agent -- qa verify
pnpm agent -- qa merge
```

执行器按规则在进入 QA 前转换阶段并刷新任务上下文。上述命令不能代替人工评估验收、测试证据和冲突。最后在主 worktree 复核本地/远端主干与 completion guard，完成步骤和验收后执行 `task finish --task <本任务ID>`。

## 合并 A 后，B 应怎么做

A、B 可以同时实现，合并需要针对最新状态验证。如果 A 先合并，B 的旧 base/QA 回执可能失效；B 按脚本给出的下一动作重新同步，处理冲突，补跑受影响验证并重新 QA，然后合并。

不要为了保住旧回执而强推主干、自动覆盖别人的文件，或手工改写回执。各电脑的本机 QA 回执不共享；换电脑合并需要在该电脑重新验证。

## 可观察成功结果

- 两个任务得到不同 worktree 和分支，文件修改各自隔离。
- 每项任务都有验收和验证证据；对应 PR 的固定 head 经过 QA。
- 主干最终含 A、B 两个文件，本地主干提交等于远端主干提交。
- 本任务生命周期已收敛；仓库级 `finish` 仍会检查其他受管 worktree，不能把无关阻塞当作本任务已清理的证据。

## 不适合直接并行的情况

| 情况 | 处理 |
| --- | --- |
| 两项任务修改同一接口或数据库 schema | 先确认契约、迁移顺序和消费者，再拆分依赖 |
| 多人同时改依赖与锁文件 | 指定负责人或约定串行合并；合并后验证依赖闭包 |
| 提交、推送、合并命令超时 | 先核实本地与远端结果，保留 `verify_required` 状态 |
| 工作区有未提交内容或 HEAD 漂移 | 保留目录与恢复状态，按生命周期工具处理 |

恢复已知任务时，完成基础规则预读后依次运行：

```bash
pnpm agent -- task resume --task demo-guide-a
pnpm agent -- task context --task demo-guide-a
```

仅在不知道任务 ID 时才用 `resume --auto`；多候选不得猜选。不要把任务状态文件当作跨电脑锁。
