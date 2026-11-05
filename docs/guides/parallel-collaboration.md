# 协作演练：多模型接力、多人多机与单机并行

[首页](../../README.md) · [English overview](../../README.en.md) · [先完成接入](quickstart.md) · [工程约定](../CONVENTIONS.md)

目标：两个会话分别修改不同文档，通过独立 worktree 交付，再顺序合并。它演示工作区隔离与提交验证，不证明任意业务任务可以无冲突并行。

## 选择协作方式

| 方式 | 如何使用本演练 |
| --- | --- |
| 多模型接力 | A 可由一个模型开始、另一个模型接手；共用规则与验收，按下文交接步骤继续同一任务，不同时写同一 worktree |
| 多人多机协作 | 两位协作者分别在自己的电脑执行 A、B，使用不同任务与分支；各机配置权限、依赖与本机 QA |
| 单机多任务并行 | 在一台电脑打开 A、B 两个 AI 会话，各自进入独立 worktree，分别修改和验证 |

三种方式可以组合。仓库提供 Claude Code、Codex、Gemini CLI 入口，其他工具也可按相同协议接入；每个工具须通过[工具接入检查](quickstart.md#工具接入检查)，能读取规则、操作文件并执行所需命令。能力与权限取决于客户端，不保证所有版本组合均已验证。

## 演练前提

- 使用自己可丢弃的演练项目；已建立 `origin/main`，本地和远端基线一致。
- 已完善 `RULES.md`、GitHub 鉴权与必要检查。各协作者有相应仓库权限。
- 每个会话完整读取基础规则。多人可以在不同电脑；同机多会话也可。
- 每个任务只拥有自己的文件，共享配置、依赖锁文件和接口由团队提前分配负责人。
- worktree 只隔离文件与依赖目录；应用服务、端口、数据库及测试数据须另外分配。独立目录不等于运行资源自动隔离。

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

验证按纯文档范围选择格式和链接检查，记录 `TEST_SCOPE_DECISION`；检查经 `task exec` 保存日志。完成 S2 后，先将提交推送与合并步骤 S3 标记为 `running`。`tdd push` 可能自动提交并改变 HEAD，须把 `TEST_SCOPE_RESULT` 绑定最终提交；受测文件未变且证据有效时可复用结果，不因阶段切换重复运行。

```bash
pnpm agent -- tdd sync
pnpm agent -- tdd push
```

核对最终 HEAD 并记录测试结果后，转换到 QA、刷新上下文并激活 QA 专家，再继续交付：

```bash
pnpm agent -- task transition --task demo-guide-a --phase qa --evidence "TDD_DONE: <最终提交与有效验证证据>"
pnpm agent -- task context --task demo-guide-a
```

```bash
pnpm agent -- qa plan
pnpm agent -- qa verify
pnpm agent -- qa merge
```

上述命令不能代替人工评估验收、测试证据和冲突。B 的所有示例命令均使用 `demo-guide-b`，不能复制 A 的任务 ID。合并与主干收尾见下文。

## 合并 A 后，B 应怎么做

A、B 可以同时实现，合并需要针对最新状态验证。如果 A 先合并，B 的旧 base/QA 回执可能失效；B 按脚本给出的下一动作重新同步，处理冲突，补跑受影响验证并重新 QA，然后合并。

不要为了保住旧回执而强推主干、自动覆盖别人的文件，或手工改写回执。各电脑的本机 QA 回执不共享；换电脑合并需要在该电脑重新验证。

本机锁只协调当前电脑的生命周期操作，不提供跨电脑互斥。跨电脑合并依赖远端 base/head SHA 复验和普通 push 的非快进拒绝；发现漂移后重新同步、验证，不能覆盖远端历史。

## 合并后在主 worktree 收尾

`qa merge` 可能因当前目录仍在使用而延后清理。先离开开发目录，进入脚本报告的主 worktree；不要把 `task exec` 的调用目录当成实际执行目录，它默认仍使用任务绑定的开发 worktree。

以下以配置主干为 `main`、任务 A 为例；路径、主干名和任务 ID 均按实际输出替换：

```bash
cd "<主-worktree-绝对路径>"
node infra/scripts/shared/github-auth-run.js -- git fetch origin main
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
pnpm agent -- task exec --task demo-guide-a --name finish-main --cwd main -- pnpm agent -- finish
```

仅在对应 PR 已合并、主工作区干净、本地与远端主干 SHA 一致且门禁 `STATUS=OK` 后，完成 S3、S4 和验收项的 checkpoint，再执行：

```bash
pnpm agent -- task finish --task demo-guide-a
```

未提交内容、HEAD 漂移或清理阻塞时保留目录和恢复状态，按生命周期输出处理；不要删除未确认归属的文件来通过门禁。任务级 `task finish` 只检查本任务明确绑定的生命周期，仓库级 `finish` 仍对全部受管 worktree 检查，不能把两者的结果混用。

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
| 两个任务使用相同端口、数据库或测试数据 | 分配独立运行资源或串行执行相关步骤；worktree 不隔离这些资源 |
| 提交、推送、合并命令超时 | 先核实本地与远端结果，保留 `verify_required` 状态 |
| 工作区有未提交内容或 HEAD 漂移 | 保留目录与恢复状态，按生命周期工具处理 |

## 切换模型或恢复任务

同机接力继续同一任务；并行 A、B 使用不同任务。切换模型时：

1. 原执行器记录完成项、证据、工作目录、分支与唯一下一动作，生成 `task context` 胶囊；推送、合并等结果不明的操作标为 `verify_required`。
2. 把精确任务 ID、worktree 路径与胶囊交给接手会话。原执行器停止写入；接手者确认接管后再继续，不能两个执行器同时写同一任务。
3. 接手者完整读取基础规则，核对真实工作区和外部副作用，再恢复任务；恢复命令本身不代表重新执行副作用。

同机已知任务、且任务状态仍在时，完成基础规则预读后依次运行：

```bash
pnpm agent -- task resume --task demo-guide-a
pnpm agent -- task context --task demo-guide-a
```

仅在不知道任务 ID 时才用 `resume --auto`；多候选不得猜选。不要把任务状态文件当作跨电脑锁。

跨电脑接手时，Git 推送只携带已提交内容，不会自动同步任务状态、胶囊、本机锁、未提交修改或 QA 回执。先确认原执行器已交接并提供必要证据；本机缺少任务状态时，不能假设 `task resume` 会从远端下载状态。核对远端分支，按本机任务门禁登记或恢复任务、明确验收，再通过 `pnpm agent -- worktree resume <实际分支名>` 恢复工作区；本机重新验证并签发 QA 回执后才可合并。不要盲目复制带旧路径的状态文件或锁。
