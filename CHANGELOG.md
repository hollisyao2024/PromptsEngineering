# Changelog

 遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范，记录模板发布历史与重要调整。

## [Unreleased]

## [v3.7.32] - 2026-10-06

- 新增 `pnpm agent -- tdd commit [git commit 选项]`，并让脚本内的提交与注解 tag 在 git 没有身份时由 `.env.local` 的 `GH_TOKEN` 所属 GitHub 账号补齐作者与提交者，不再需要手填一次性的 `GIT_AUTHOR_*` / `GIT_COMMITTER_*`，也不需要配置 git 的 `user.name` / `user.email`。起因：令牌只负责鉴权，`git commit` 与 `git tag -a` 另需作者身份；没有身份时只能手填环境变量或写 git 配置，与「GitHub 访问只用 `GH_TOKEN`」的约定冲突。机制：① 新增 `infra/scripts/shared/github-identity.js`，`buildGitHubGitEnv` 在子命令为 `commit`（需要作者与提交者）或注解 `tag`（`-a`/`-s`/`-u`/`-m`/`-F` 及对应长选项，只需要提交者即 tagger；`-d`/`-l`/`-v` 不算）时，逐个角色用 `git -c user.useConfigOnly=true var GIT_AUTHOR_IDENT|GIT_COMMITTER_IDENT` 询问 git 是否已有显式身份（git 配置或 `GIT_*` 环境变量；EMAIL 与主机名自动探测不算），已有的角色保持不变且不访问网络，缺失的角色才取令牌账号；② 令牌账号经 `GET /user` 推导：姓名取账号 `name`（为空则用 `login`），邮箱为 `<id>+<login>@users.noreply.github.com`，与该账号经 GitHub 合并产生的提交所用的 noreply 身份一致；③ `buildGitHubGitEnv` 是同步接口而 GitHub API 请求是异步的，账号查询放在子进程里完成（`github-identity.js --probe`），令牌只经子进程环境变量 `XIRANG_GITHUB_IDENTITY_TOKEN` 传递，不进命令行参数，输出与错误信息中的令牌一律替换为 `***`；同一进程内同一令牌只查一次，失败不缓存，超时 15 秒；④ 身份只写入本次 git 进程的 `GIT_AUTHOR_NAME/EMAIL`、`GIT_COMMITTER_NAME/EMAIL` 环境变量，不写任何 git 配置，不落盘；补完后再让 git 复验一次，git 不接受该姓名或邮箱时报错；⑤ 查不到时抛错（fail closed），不退回 git 自动探测，也不接受任何手填身份。覆盖面：`qa-merge` 的本地 squash 提交、发布/状态提交与 `tag -a`，以及 `tdd-push` 的工作区自动提交，共 4 处，全部经 `runGit` → `buildGitHubGitEnv`；新增结构扫描测试，凡含 `['commit', …]` 或 `['tag', …]` 调用的非测试脚本，源码里必须调用 `buildGitHubGitEnv(` 或 `resolveCommitIdentity(`，且 `qa-merge`、`tdd-push`、`tdd-commit` 三个文件必须被扫到。`merge --ff-only`、`merge --squash`、`add`、`status` 及 `push` 等不需要身份的命令不受影响，`push` 的 `http.https://github.com/.extraheader` 注入不变。`tdd commit` 入口：选项原样转发给 `git commit`；不接受 `--author`（含 `--au` 等缩写），作者只来自 git 已有身份或令牌账号；git 没有身份又读不到令牌，或账号查询失败时输出 `STATUS=BLOCKED` 并非零退出，不运行 git；成功时输出 `STATUS`、`SUMMARY`、`NEXT_ACTION`、`IDENTITY_SOURCE`（`configured` / `github-token`，阻断时为 `unresolved`）、`IDENTITY`、`COMMIT`。新增契约测试：`github-identity` 13 条（含两条跨真实进程边界的查询）、`tdd-commit` 8 条（其中 1 条经真实进程运行 `--help`）、`github-auth` 新增 8 条（9 条变 17 条，含真实 git 仓库中提交与注解 tag 的作者核对，以及 `.git/config` 不含 `[user]`）、`agent-cli` 新增 1 条（5 条变 6 条，固定 `tdd commit` 路由与帮助文本）；`cli-help` 的默认动作入口清单加入 `tdd-tools/tdd-commit.js`，固定其先处理 `--help` 再执行，帮助请求不会触发提交。`AgentRoles/TDD-PROGRAMMING-EXPERT.md` 在「强制交付流水线」增加 1 段说明（8,063→8,281 B，+218 B）；`infra/scripts/tdd-tools/README.md` 增加第 5 节与脚本状态表 1 行；`AGENTS.md`、`docs/CONVENTIONS.md`、`.claude/settings.json` 字节不变（常驻加载的两份规则仍为 45,723 B）。`infra/scripts/shared`、`infra/scripts/tdd-tools` 是模板自有目录，随 `template sync` 分发，无需新增 manifest 条目。
- 已知取舍与未覆盖（仅记录）：① 没有 git 身份时，提交现在依赖能访问 `api.github.com`；`GET /user` 对个人令牌（经典与 fine-grained）有效，GitHub App 安装令牌（`ghs_` 前缀）不适用；② 只覆盖经 `buildGitHubGitEnv` 的脚本调用与 `tdd commit`：终端里裸执行的 `git commit`、`github-auth-run.js -- git commit`（走 `buildGitHubShellEnv`，本次未改）、非快进的普通合并提交、cherry-pick、rebase 不会被补身份；`update-template.js` 用 `commit-tree` 自带身份，未改；③ git 配置里身份不完整（例如只配了姓名没配邮箱）视为没有显式身份，该次提交改用令牌账号，不写入配置；④ `createGitHubBackend` 在安装了 `gh` 时仍优先走 `gh`，「GitHub 访问只用 `GH_TOKEN`」尚未做到 100%，需另行收紧；⑤ `.claude/settings.json` 未改，`pnpm agent -- tdd commit` 不在 allowlist 内，Claude Code 里每次调用可能弹出确认，需要免确认时在 `settings.local.json` 的 `permissions.allow` 追加 `Bash(pnpm agent -- tdd commit:*)`；⑥ 拦截裸调用的 `permissions.deny` 规则与 PreToolUse 钩子本次均未做（未获授权）：对「不得裸执行 `git fetch/pull/push/ls-remote`、`gh`」的约束目前仍是约定加 `github-auth-run.js` 包装器，没有机械拦截。

## [v3.7.31] - 2026-10-05

- `.claude/settings.json` 团队 allowlist 再删除 7 条在模板源没有任何可匹配脚本的遗留预批准（70 条变 63 条，其余条目内容与顺序不变，`git diff` 仅 7 行删除、0 行新增）：`Bash(pnpm build*)`、`Bash(pnpm run build*)`、`Bash(pnpm run clean*)`、`Bash(pnpm dev)`、`Bash(pnpm run priority:*)`、`Bash(pnpm run persona:*)`、`Bash(pnpm run goal:*)`。依据：把这 7 条逐一对照模板源 `package.json` 的 65 个脚本（按 `pnpm <脚本>` 与 `pnpm run <脚本>` 两种调用形式）无一匹配；`build`、`clean`、`dev` 在 `package.json` 历史中从未存在（`git log -S` 查无记录）；`priority:*`、`persona:*`、`goal:*` 对应的 9 个脚本在 f5822fa（2025-11-05）加入、dbf60fd（2026-04-23「make agent template portable」）移除，且 `:*` 按词边界只匹配无冒号后缀的 `pnpm run priority`；`Bash(pnpm dev)` 另是 `Bash(pnpm dev:*)` 的子集（后者按词边界同样匹配裸 `pnpm dev`），删除不改变放行结果；7 条均自 a0a8cbd（2026-04-21「同步 Claude/Codex 配置与 direnv 环境加载」）一并引入。删除只会让相应命令回到弹出确认，不新增任何放行，权限只减不增。下游影响：「无可匹配脚本」只对本模板源成立。`pnpm build*`、`pnpm run build*` 是原始前缀通配，原先会放行 `config.example.json` 登记的规范 alias（`pnpm build:app:<平台>`、`pnpm build:dev|staging|prod`）与默认 `commands.build` 的 `pnpm run build`；下游已实现这些脚本或自带 `build`、`clean` 脚本的，Claude 直接执行它们不再免确认，需要免确认时在 `settings.local.json` 的 `permissions.allow` 追加所需条目。`pnpm agent -- build ...` 本就在需确认之列，不受影响；`pnpm agent` 运行器内部拉起的子进程不是 Claude 的 Bash 工具调用，不受 allowlist 约束。`.claude/settings.json` 属 `merge-json`，统一引擎对数组整体比较，下游 `permissions.allow` 与已安装基线一致时自动采用新列表，已自定义时报 `JSON field conflict: $.permissions.allow` 并阻断，需手动对齐；旧版 `mergeJson` 路径保留下游本地数组，不报冲突也不自动删除这 7 条，需下游自行删除；`.claude/settings.template.json` 为覆盖分发，自动刷新。如需回退，把这 7 条加回 `.claude/settings.json`，或在下游 `settings.local.json` 只追加所需的几条。
- 保留不动（仅记录，未经授权不处理）：其余 17 条遗留 pnpm 规则——`pnpm lint*`、`pnpm run lint*`、`pnpm type-check*`、`pnpm run type-check*`、`pnpm run codemap*`、`pnpm run precommit*`、`pnpm run dev*`、`pnpm dev:*`、`pnpm run prd:*`、`pnpm run arch:*`、`pnpm run nfr:*`、`pnpm run task:*`、`pnpm run tdd:*`、`pnpm run qa:*`，以及 3 条 `ship:dev` 别名（`pnpm ship:dev`、`pnpm run ship:dev`、`pnpm run ship:dev:quick`）。其中 7 条 `:*` 规则（`pnpm dev:*`、`prd:*`、`arch:*`、`nfr:*`、`task:*`、`tdd:*`、`qa:*`）按官方权限文档语义（`:*` 等价于词边界的 ` *`，`claude-settings-allowlist` 的 `isAllowed` 同此建模）只匹配无冒号后缀的 `pnpm dev`、`pnpm run task` 之类；对模板源 65 个脚本的两种调用形式一条也不匹配，而这些前缀下共有 39 个带冒号后缀的脚本（`dev:` 5、`prd:` 2、`arch:` 4、`nfr:` 1、`task:` 9、`tdd:` 10、`qa:` 8）。该判断依据文档语义计算，未在 Claude Code 宿主内实机验证。字节（UTF-8 实测）：`.claude/settings.json` 3,221→3,008 B（−213 B）；常驻加载的 `AGENTS.md`、`docs/CONVENTIONS.md` 不变，本次不减少常驻上下文，目的是去掉没有对象的预批准。新增契约测试：`claude-settings-allowlist` 新增 2 条（4 条变 6 条），固定 7 条规则已从 allowlist 删除、`pnpm build`、`pnpm build:app:mac`、`pnpm run build`、`pnpm run build:dev`、`pnpm run clean` 及无冒号的 `pnpm run priority`、`pnpm run persona`、`pnpm run goal` 需确认、裸 `pnpm dev` 仍由 `Bash(pnpm dev:*)` 放行，以及上述 17 条遗留 pnpm 规则逐条保留。

## [v3.7.30] - 2026-10-05

- `AGENTS.md` 与 `docs/CONVENTIONS.md`（均为强制完整加载）互为重复的 7 处表述各只保留一份，规则含义不变。逐条承接：`AGENTS.md`「模板所有权与升级」中「`RULES.md`、业务源码、真实项目文档和部署实现属于项目；模板更新不得覆盖已有内容；`RULES.md` 缺失时按 `init-if-missing` 初始化」→ `AGENTS.md`「必须加载的上下文」「`RULES.md` 由实际项目维护；首次应用与更新仅在缺失时从模板骨架初始化，已有文件保持不变」与 `docs/CONVENTIONS.md` §3「`RULES.md`、真实项目文档、源码、业务部署脚本和已有 `agent.config.json` 均属于项目；`RULES.md` 仅在缺失时初始化，已有内容（包括空文件）不改写」及 `project-owned`、`init-if-missing` 两条策略；`AGENTS.md`「全仓扫描」正文（候选清单先写入 `tmp/scan-manifests/` 再编辑、报告四个计数并满足 `matched = modified + skipped`）改为「细则见 `docs/CONVENTIONS.md` §全仓扫描」，首句「Discovery 与 Editing 必须分离」保留，§10 是其超集（另有「包含范围、排除项和全部候选」「范围变化时创建新 manifest，不得静默缩小」）；`docs/CONVENTIONS.md` §6「mutation 必须显式提供可观察验收」→ `AGENTS.md`「任务输入门禁」「mutation 任务在创建或恢复修改 worktree 前必须有显式验收」及 §6 命令块 `--acceptance "<可观察验收>"`（指向「任务输入门禁」的指针保留）；「同一次 checkpoint 可更新步骤和验收项，减少机械写盘」→ `AGENTS.md`「长任务断点续跑」「一个 checkpoint 可同时完成步骤和验收项，并记录简短证据、退出码、路径或哈希」，动机「减少机械写盘」由同节「无需为无状态的微小动作反复写盘」承接；「新任务安全默认 `type=mutation`；确认不会修改 tracked 文件时才显式选择只读类型」→ `AGENTS.md`「新任务默认 `type=mutation` 并执行 completion guard；能证明不会修改 tracked 文件时才显式使用 `diagnose|research|operation`」（同条「schema v1 状态在读取时升级为 v2，保留既有步骤、证据与生命周期状态」是唯一内容，保留）；「旧 aliases 在已有项目中保留兼容，但模板不继续增加同义入口」→ `AGENTS.md`「稳定命令入口」「已有项目中的旧 package aliases 作为兼容入口保留；新模板不继续扩张别名集合」（同段「命令必须输出可解析的 `STATUS`、`SUMMARY`、`NEXT_ACTION`，失败时退出码非零」是唯一内容，保留）；`docs/CONVENTIONS.md` 末行「上下文预算、阶段交接与失败恢复协议以 `AGENTS.md`“上下文预算与阶段交接”和“长任务断点续跑”为准」（位于 §10 全仓扫描之下，自身不含规则，只转发）→ `AGENTS.md`「上下文预算与阶段交接」「长任务断点续跑」两节本身（与 `docs/CONVENTIONS.md` 同为强制完整加载，转发句不带来加载时机上的收益）；其中失败恢复半句在 `docs/CONVENTIONS.md` §6 另有两处就地指针，保留：「是否需要任务状态统一遵循 `AGENTS.md`“长任务断点续跑”」与「记录不可用时按 `AGENTS.md`“长任务断点续跑”的失败恢复规则对话留痕」；此条按用户在任务中途的建议并入，原先两处固定该指针存在的既有断言一并删除（见下）。字节（常驻加载）：`AGENTS.md` −328 B（19,273→18,945，176→175 行，仍受既有 ≤180 行契约约束）、`docs/CONVENTIONS.md` −453 B（27,231→26,778，274→271 行），合计 −781 B。
- `AgentRoles/DEVOPS-ENGINEERING-EXPERT.md` 与 `AgentRoles/Handbooks/DEVOPS-ENGINEERING-EXPERT.playbook.md` 去除已在 `docs/CONVENTIONS.md` §客户端与服务端快捷命令（常驻加载，不存在加载不及时）登记的快捷命令副本，改为指向该节的指针，规则含义不变。专家：快捷命令表删除 7 行（`/dev app <platform>`、`/private dev app <platform>`、`/build app <platform>`、`/private build app <platform>`、`/build <env>`、`/private build <env>`、`/private ship <env>`，第三列均只是「项目已有…alias（可选）」）→ §7 同名 7 行与平台矩阵；「命令说明」中 `/dev app`、`/build app` 与 `/build <env>`、`/ship <env>` 两条（分别由 `app.commands.dev/build.<platform>`、`devops.commands.build/ship` 定义，前者只生成产物、后者才改变环境状态）合并为一条指针 → §7 配置结构 `app.commands.<dev|build>.<platform>`、`devops.commands.build` / `devops.commands.ship`，以及 `/build <env>`「构建服务端环境产物，不改变目标环境状态」、`/ship <env>`「执行真实环境部署」；「开发启动、发行构建和真实部署的验收证据不得互相替代」原句保留在指针条中（§7 亦有「四种不同副作用边界，验收证据不得互相替代」）。手册：§5 脚本路径参考表尾 4 行（`/private restart`、`/dev app <platform>`、`/build app <platform>`、`/build <env>`；它们落在以「可选 package alias」为首列的表里，与表头列义不符）→ §7 同名各行，表后新增 1 行指针；「private profile 的用户快捷语法为 `/private start|restart|stop|status|logs`；内部 target 仅用于 dispatcher 调度，不作为用户命令暴露」→ 专家「本地服务管理」段「用户请求 private profile 时使用 `/private start|restart|stop|status|logs`；禁止写成 `/restart private` 或把内部 `--target=private` 暴露为用户快捷语法」与手册 dispatcher 段「用户使用 `/private ...` 语法，内部 target 不得作为用户快捷命令公开」，其中「仅用于 dispatcher 调度」是被删句独有的措辞，已并入保留的 dispatcher 段（现为「内部 target 仅用于 dispatcher 调度，不得作为用户快捷命令公开」）；「客户端开发与构建」两条「读取」条（`/dev app` 与 `/private dev app` 读取 `app.commands.dev.<platform>`，`/build app` 与 `/private build app` 读取 `app.commands.build.<platform>`）合并为一条指针 → §7 配置结构。保留不动：专家的 `/ship`、`/cd`、`/ci`、`/env`、`/restart`、`/private restart` 行（含 §7 未登记的 `cd`、`ci`、`env` 与 `ship` 的环境映射；`/restart`、`/private restart` 与 §7 重复，但被既有测试固定）、`/ci` 与 `/env` 说明、「本地服务管理」段与 DoD；手册的「显式 profile 没有精确命令时必须阻断，禁止回退 default；构建成功不得替代运行态验收」与其余各表。
- `AgentRoles/TDD-PROGRAMMING-EXPERT.md` 把相邻两条同义条款「不维护 tracked 阶段状态文档；运行证据留在 task state、QA 报告和部署记录」「运行证据写 session 或长任务状态，不写入阶段文件」合并为「不维护 tracked 阶段状态文档；运行证据写 session、长任务状态、QA 报告和部署记录，不写入阶段文件」，取两句所列落点的并集，其余条款不变。
- 5 个专家（ARCHITECTURE-WRITER、DEVOPS-ENGINEERING、PRD-WRITER、QA-TESTING、TASK-PLANNING）与 6 个手册（上述 5 个加 TDD-PROGRAMMING）开头「路径基准」注记中的「详见 `/AGENTS.md` §仓库拓扑」是失效指针：`AGENTS.md` 没有「仓库拓扑」一节（相关内容在「仓库与状态边界」），路径与仓库拓扑规则在 `docs/CONVENTIONS.md` §1「路径与仓库拓扑」。11 处统一改为「详见 `/docs/CONVENTIONS.md` §路径与仓库拓扑」，注记其余内容不变；这是修正而非精简，每处 +19 B，共 +209 B。
- 评估后保留未动（措辞有语义差、属唯一内容，或被测试固定）：`AGENTS.md`「模板所有权与升级」的身份行（官方源「固定为」）与官方同步安全语句（`匿名 HTTPS` 由 `template-surface` 固定），对应 `docs/CONVENTIONS.md` §3「默认上游」措辞有别；`docs/CONVENTIONS.md` §1 容器树、§1/§5/§6 中带限定作用的复述句、§4 模块化结构句（`AGENTS.md` 写「只使用」、此处写「采用」）、§7 稳定入口块（域列表与 `AGENTS.md`「稳定命令入口」不同）与平台矩阵（逐平台字面量被测试固定）、§3 中「模板更新流程」四步与「息壤官方同步」updater 流程的两处表述（重叠约 30 B，且后者与 `TEMPLATE_CONVERGENCE_STATUS` 同段）；QA、ARCH 专家中与 `docs/CONVENTIONS.md` 视角不同的命令语义与工作流指令；各处高风险域清单（措辞略有差异，统一即改变含义）。PRD、ARCH、TASK、QA 专家文件正文未改，仅路径指针；`AGENTS.md` 内部「`task finish` 只受任务绑定 blocker 阻断」的两处相近表述只记录，未改动。披露：手册实测节省（−438 B，不含路径指针）低于事前评估的 −576 B，原因是最终指针措辞比评估时的示意稿更长；未为追平数字再压缩其他句子。字节合计（UTF-8 实测，不含测试文件与本条 CHANGELOG）：常驻加载 −781 B；按需读取 DEVOPS 专家 −798 B、DEVOPS 手册 −419 B、TDD 专家 −36 B（前两者含路径指针各 +19 B，不含时分别为 −817 B、−438 B），其余 9 个专家与手册各 +19 B；14 个内容文件净 −1,863 B。指针是净增字节，收益在于把快捷命令登记收敛到 §7、消除两份副本漂移的风险、修复失效指针并降低常驻上下文。下游影响：改动文件均为 `overwrite` 的模板自有文件，下游无本地修改时随同步自动刷新，已本地修改的按既有规则阻断；`RULES.md` 等项目文件不受影响。新增契约测试：`template-surface` 新增 6 条测试，依次固定：`AGENTS.md` 的两处删除与保留的单行规则及指针，并断言承接原文仍在 `docs/CONVENTIONS.md`；`docs/CONVENTIONS.md` 的 5 句删除（含末行转发指针）、`AGENTS.md` 中对应承接原文与两节标题仍在，以及同句唯一内容和 §6 内两处「长任务断点续跑」指针保留；DEVOPS 专家的 7 行删除与 §7 同名行、配置键和验收证据句仍在，以及专家自有路由行保留；DEVOPS 手册的各项删除与指针数量，以及 profile 阻断、dispatcher 说明、配置约定保留；TDD 专家的单条运行证据表述；11 处路径基准注记均指向 `docs/CONVENTIONS.md` §路径与仓库拓扑，且 `AGENTS.md` 无「仓库拓扑」章节。原先分别在 `phase experts use bounded context handoffs instead of full document reloads` 与 `context governance uses staged soft watermarks without blocking lightweight work` 两条既有测试中固定「`docs/CONVENTIONS.md` 含该转发指针」的两处断言随指针一并删除，改由上述契约固定其已不存在且承接节仍在；`template-surface` 总数仍为 41 条。

## [v3.7.29] - 2026-10-05

- `.claude/settings.json` 团队 allowlist 删除 `Bash(pnpm test*)` 与 `Bash(pnpm run test*)` 两条（72 条变 70 条，其余条目内容与顺序不变）。这两条是原始前缀通配，不是词边界的 `:*`：既放行项目自有的聚合测试脚本（常为全量，与 `AGENTS.md`「不得把项目自有 `pnpm test` 或无文件参数的运行器当作默认回归」相悖），也会误放行 `pnpm testing` 之类无关命令；定向测试走 `pnpm agent -- test --file <测试文件> -- <运行器>`，该入口本就在需确认之列，需要免确认时在 `settings.local.json` 追加。`.claude/README.md`「需要确认的操作」增加 1 条说明；`claude-settings-allowlist.test.js` 新增契约测试，固定 `pnpm test`、`pnpm test:e2e`、`pnpm test --coverage`、`pnpm testing`、`pnpm run test`、`pnpm run test:unit`、`pnpm run testall` 仍需确认，且 allowlist 中不再有 `pnpm test` 类规则。下游影响：`.claude/settings.json` 属 `merge-json`，统一引擎对数组整体比较，下游 `permissions.allow` 与已安装基线一致时自动采用新列表，已自定义时报 `JSON field conflict: $.permissions.allow` 并阻断，需手动对齐；旧版 `mergeJson` 路径保留下游本地数组，不报冲突也不自动删除这两条，需下游自行删除；`.claude/README.md` 为覆盖分发，自动刷新。未改动其他遗留通配（`pnpm lint*`、`pnpm run lint*`、`pnpm type-check*`、`pnpm run type-check*`、`pnpm build*`、`pnpm run build*`、`pnpm run clean*`、`pnpm run codemap*`、`pnpm run precommit*`、`pnpm run dev*`），仅记录。
- `AgentRoles/QA-TESTING-EXPERT.md` 两处与 `AgentRoles/TDD-PROGRAMMING-EXPERT.md` 一处含糊的「通用约定」改为显式指向 `docs/CONVENTIONS.md` §测试范围与证据复用，其余子句不变：QA 专家「全量时核实通用约定中的触发项、调查证据及具体应用/测试类型」「可复用符合通用约定的 TDD 证据」，TDD 专家「高风险标签本身不触发全量，按通用约定界定范围」。QA 专家两处的既有契约固定项同步为显式指针写法；新增守卫测试固定 `AgentRoles/*.md` 与 `AgentRoles/Handbooks/*.md` 不再出现「通用约定」，并固定 TDD 专家的指针。
- `AGENTS.md`「GitHub 与安全」去除已被 `docs/CONVENTIONS.md` §5/§9 承接的重复子句，规则含义不变（`AGENTS.md` 与 `docs/CONVENTIONS.md` 均为强制完整加载）。逐条承接：「远端 Git/GitHub 操作只能走 `github-auth-run.js` 或仓库脚本，token 变量仅用 `GH_TOKEN`」→ §9「GitHub token 变量统一为 `GH_TOKEN`」「远端 Git/GitHub 命令必须由 `infra/scripts/shared/github-auth-run.js` 或上层脚本执行」；「PRD、ARCH、TASK、TDD、QA、DEVOPS 是阶段职责，不是电脑或账号身份；所有已获仓库权限的协作者均可…合并 PR，或对配置主干执行普通非强制 push」→ §9「专家名称表示当前阶段职责，不绑定电脑、hostname、机器角色或专用 QA 账号；所有已获仓库权限的协作者可以执行任意阶段、合并 PR 或普通更新配置主干」及「配置主干禁止 force push 和删除」「普通 push」；「`qa verify` 通过后…写入绑定…回执；`qa merge` 必须重新 fetch，并把回执与 PR base/head refs 逐项复验，任一漂移都阻断并要求重新 QA」→ §5「`qa verify` 通过后在本机原子保存绑定配置主干、功能分支、`BASE_SHA` 和 `HEAD_SHA` 的回执」「合并前重新 fetch，并把回执与 PR base/head refs、远端引用逐项复验」「任何 SHA 漂移、冲突或非快进拒绝都必须停止并要求重新 QA」；「配置主干禁止 force push 和删除」「主干并发更新失败时不得覆盖远端历史」→ §9 同句与 §5「不得自动 rebase 已验证分支或覆盖远端历史」；「TDD、QA 与合并门禁完全在本地执行…；该目录始终由实际项目自行维护」→ §9 同义句，并把 `AGENTS.md` 版更强的「完全在本地执行」「始终由实际项目自行维护」并入 §9（原为「在本地执行」「工作流目录属于实际项目」）。`AGENTS.md` 新增 1 条指针指向 §5、§9。逐条核对后保留：「不得裸执行 `git fetch/pull/push/ls-remote`、`gh pr/repo/api/workflow/run`」（§9 无该禁用清单）、「`tdd push` 必须显式以 `config.baseBranch` 为 PR base」（仅此一处）、「功能分支只有在精确 expected SHA 的 `--force-with-lease` 保护下才可清理」（与 §9「精确 `--force-with-lease` 仅可用于功能分支清理」方向不同：前者限定清理手段，后者限定租约用途）、「删除前解析并复核精确目标；失败、阻塞、等待确认和恢复态不得清理任务/worktree 状态」（§9 对应句讲路径解析与递归删除，要素不同）、「不记录或提交密钥、凭据、个人信息和大段原始日志」（§9 对应句讲 `.env.local`、用户数据、未脱敏日志与本地绝对路径快照，要素不同）。披露：v3.7.28 曾因 TASK-CMDSURF-025 记载 `AGENTS.md` 与 `docs/CONVENTIONS.md` 均明确同权与无 CI 协议而仅记录未改动，本次已获用户明确授权处理；该历史任务记录不改，同权与无 CI 协议的完整正文仍在 `docs/CONVENTIONS.md` §9，承接原文由新增契约测试逐句固定，`AGENTS.md` 保留指针；如需回退，恢复 `AGENTS.md` 中「阶段职责」与「完全在本地执行」两条即可。字节：常驻加载的 `AGENTS.md` −632 B、`docs/CONVENTIONS.md` +21 B，合计 −611 B；按需读取的 QA 专家 +80 B、TDD 专家 +40 B、`.claude/README.md` +199 B、`.claude/settings.json` −56 B；全部合计 −348 B。指针与说明为净增字节，收益在消除含糊指代、过宽放行与常驻上下文的重复。新增契约测试：`template-surface` 新增 2 条测试，并把 QA 专家既有测试中的 2 处固定项改为显式指针写法，`claude-settings-allowlist` 新增 1 条测试。

## [v3.7.28] - 2026-10-05

- `AGENTS.md`「Worktree-First」去除与 `docs/CONVENTIONS.md` §5 同义的一句，规则含义不变：原句「`worktree new` 在 required fetch 后发现远端同名分支时必须阻断；只有显式 `worktree resume` 可以按远端分支的固定 SHA 建立本机 worktree 和 session」的两个子句均保留于 §5「创建全新 worktree」段（「如果 required fetch 后已经存在 `refs/remotes/origin/<branch>`，`worktree new` 必须阻断并提示显式恢复或更名」「只有 `worktree resume` 可以从远端分支固定 SHA 创建本机 tracking branch、worktree 和 session」，表述更完整）。`AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md` 常用命令示例引导句中的「满足通用约定的升级条件」改为显式指向 `docs/CONVENTIONS.md` §测试范围与证据复用（与 v3.7.27 对 QA playbook 的处理一致），「须按项目运行器核实过滤参数并选择受影响用例」与「不按示例逐条执行」不变。经逐条核对不改动：`AGENTS.md`「合并后清理由 session 封印和补偿器完成…」（§5 无「封印」「补偿器」及「HEAD 漂移或缺少封印时转为恢复状态，禁止删除」正文；QA 专家与 playbook 的相近描述仅在 QA 阶段按需读取，且不含「缺少封印」「禁止删除」）、「多 worktree、多电脑可并行开发…」（「多 worktree、多电脑可并行开发」仅此一处，其余部分与 §5 末段、§9 近同义，但可去部分很小且需补指针）、「任务记录、worktree 创建、提交和部署分别执行…」「失败先按可观察证据区分…」「若 task start/checkpoint 本身不可执行…」三处拒绝后不得重试的表述（各含不可互相替代的要素：「拆分」「保留原始理由与调用编号」「迁移记录」，属有意重复的安全红线）、`task exec` 使用规则中 `<name>` 与 §7 `<evidence-name>` 的占位符写法差异（已由既有契约测试固定）。仅记录、未改动：`AgentRoles/` Expert 文件中的三处「通用约定」（TDD 专家一处、QA 专家两处，其中 QA 两处由既有契约测试逐字固定），以及 `AGENTS.md`「GitHub 与安全」与 §9/§5 的近同义条款（TASK-CMDSURF-025 要求 `AGENTS.md` 与 `docs/CONVENTIONS.md` 均明确同权与无 CI 协议），二者均需另行授权。字节：常驻加载的 `AGENTS.md` −184 B，按需读取的 playbook +40 B，合计 −144 B；新增两条契约测试固定删除项、保留项、承接原文与 playbook 指针。

## [v3.7.27] - 2026-10-05

- `AGENTS.md`「修改与交付门禁」清理延后句去除与 `docs/CONVENTIONS.md` §6 重复的命令片段，规则含义不变：原句的「通过 `task transition --defer-cleanup-step <id> --cleanup-evidence "<独立性与保留措施>"`」（保留于 §6 的 `transition ... --defer-cleanup-step S5 --cleanup-evidence ...` 示例，及同条的「仅限有结构化失败证明 `not_started` 的 `blocked` 步骤」「不得用于测试、验收、权限审批、发布前置条件或结果未知的副作用」等适用条件）改为指向 `docs/CONVENTIONS.md` §长任务状态文件 的条件与证据要求；「独立清理失败不得自动升级为交付前置条件」与「不改变失败状态、不重试被拒绝操作、不豁免测试或最终完成门禁」仍留在 `AGENTS.md`（后者的「最终完成门禁」宽于 §6 的「`task finish` 仍要求清理完成」，不能并入）。`AgentRoles/Handbooks/QA-TESTING-EXPERT.playbook.md` 的三处「通用约定」指代与一处「并核实过滤参数」改为显式指向 `docs/CONVENTIONS.md` §测试范围与证据复用（过滤参数核实保留于该节运行器段「确认测试运行器支持所用过滤参数」），playbook 其余文字不变。经核对不改动：`AGENTS.md`「开发 worktree 的未提交内容…」整段（`tdd push --committed-only` 与 `CLEANUP_STATUS=PRESERVED` 在 §5/§6 均无正文）、`AGENTS.md` 的 `task exec` 使用规则（§7 仅登记语法，AGENTS 句另含触发阈值与 8KB/80 行摘要上限，且与 `agent-task.js` 默认值一致）。字节：常驻加载的 `AGENTS.md` −66 B，按需读取的 playbook +147 B，合计 +81 B；新增三条契约测试固定删除项、保留项、指针与承接原文。

## [v3.7.26] - 2026-10-05

- `AGENTS.md`「修改与交付门禁」与 `AgentRoles/QA-TESTING-EXPERT.md` 去除已在 `docs/CONVENTIONS.md` §8 有同义正文的重复子句，规则含义不变：`AGENTS.md` 测试入口句的「`task exec` 会在启动前拦截聚合测试命令」（保留于 §8 运行器段，并带「只有事先记录了匹配命令和触发依据的 `mode=full` 决策才放行」的放行条件）；QA 专家「测试执行」条的「检查完整 diff、调用方和依赖，按影响范围选择测试」（保留于 §8 首段）、「记录命令、退出码、覆盖范围和未运行项」（保留于 `TEST_SCOPE_DECISION` 的 `commands`/`impact_paths`/`not_run` 与 `TEST_SCOPE_RESULT` 的 `exit_code`）、「不得将未运行项记为通过」（保留于 §8 末段「未运行项不得记为通过」）；整条「局部变更」的三类场景（保留于变更影响表前三行）；「高风险变更」条的「全局样式追踪受影响页面」（保留于变更影响表局部样式行）、「高风险标签不自动触发全量」与「记录具体依据及全量的应用/测试类型」（保留于 §8「全量」段）；「证据复用与停止条件」条的「必需验证通过后…不继续扩大或重复测试」与「时间限制不能豁免必需项」（保留于 §8 末段，条目名随之收窄为「证据复用」）；QA 门禁第 1 项的「范围不明先调查再决定升级」（保留于 §8「全量」段第三类触发「（不猜测范围）」与变更影响表高风险行「先界定影响范围，再判断是否升级全量」）。「测试执行」条改为指向 §8 的括注，QA 专家保留高风险域清单（含 §8 未逐项列出的「跨模块联动」）、`TEST_SCOPE_*` 审查职责与「只补新增或失效范围」、门禁四项及「禁止执行 `/qa verify`」；`TEST_SCOPE_DECISION/RESULT` 字段与枚举、§8 变更影响表及全部必须/禁止类规则原样保留；新增契约测试逐条固定各删除项的承接与保留项。

## [v3.7.25] - 2026-10-05

- `docs/CONVENTIONS.md` §8 去除五处已在同节或 `AGENTS.md` 中有逐字副本的重复子句，规则含义不变：首段「进入 QA、创建 PR 或命中高风险标签也不能单独证明需要全量」（保留于「全量」段「均不能单独触发全量」）；「遇到范围不明先调查，仍不明再升级，不猜测范围」并入第三类全量触发「（不猜测范围）」；「大日志留在任务 evidence」（保留于 `AGENTS.md`「完整日志写入任务 evidence」与 §6 `evidence/` 目录）；QA 复用段重复的「提交前运行可用受测文件摘要核对」并入记录段「（可用受测文件摘要核对）」；运行器段「按上段记录触发依据」（保留于同段 `task exec` 放行条件与记录段 `full_trigger`/`trigger_evidence`）。变更影响表、`TEST_SCOPE_DECISION/RESULT` 字段与枚举、示例命令及全部必须/禁止类规则原样保留；新增契约测试固定各保留项与删除项。

## [v3.7.24] - 2026-10-04

- `docs/CONVENTIONS.md` §8 删除已在 `AGENTS.md`「修改与交付门禁」「GitHub 与安全」、TDD 专家（数据库与迁移、语义审查）和架构数据标准中有正式副本的四个段落（交付流水线与 completion guard、数据库 schema 变更、迁移注册表、高风险域），官方息壤源 `tdd sync` 版本递增段落缩为一句话并指向 `source-version-sync.js`；`### 测试范围与证据复用` 标题、影响范围表、四类全量触发与 `TEST_SCOPE_DECISION/RESULT` 规范保持不变。§5 回执段落补充「回执不跨电脑共享，换电脑合并须重新 `qa verify`」，原跨电脑语义不丢失；新增契约测试固定保留项、删除项与各正式副本。

## [v3.7.23] - 2026-10-04

- Node/Go 通用 OSS 适配兼容未开启、开启及暂停版本控制：缺少版本头规范化为 null，新增可选固定版本读/核验/删及包含删除标记的完整分页，权限或状态异常中止；保留独立最终文件与暂存重放保护，不回灌项目配置或迁移。

## [v3.7.22] - 2026-10-04

- `docs/CONVENTIONS.md` 删除与 `AGENTS.md`“上下文预算与阶段交接”重复的 §11（仅留一行指向）以及「失败分类与恢复」章节；失败分类（`tool_error|policy_denied|unknown_result`）、启动状态证据与恢复规则并入 `AGENTS.md`“长任务断点续跑”作为唯一来源，`.codex/README.md`、TDD playbook 引用同步改指 `AGENTS.md`，相关契约测试随之更新。

## [v3.7.21] - 2026-10-04

- `.claude/settings.json` 团队 allowlist 放行稳定入口的本地生命周期命令（`pnpm agent -- task start|checkpoint|resume|context|extend|transition|finish|paths`、`worktree new|list|resume`、`tdd sync`、`qa plan`、`qa verify`）；`tdd push`、`qa merge`、`finish`/`tdd finish`（自动串联 push 与 merge）、`worktree bootstrap`（执行依赖安装）、`task exec`、`task cancel`、`test`、`build`、`ship`、`template` 等有远端、部署或任意命令执行副作用的入口仍需确认。新增 `claude-settings-allowlist.test.js` 契约测试，`.claude/README.md` 同步说明。

## [v3.7.20] - 2026-10-04

- `tdd push` 生成 PR 概要、变更内容与标题时排除同步配置主干产生的 merge 提交；分支上还有其他提交时，工作区自动提交的文件清单不再写入概要、也不影响标题判定（仅剩一个人工 Conventional 提交时直接用其标题），只有自动提交时仍保留文件清单。

## [v3.7.19] - 2026-10-04

- 子进程被信号终止时 `pnpm agent`、`github-auth-run.js`、`tdd finish` 及 worktree/TDD 入口按 `128+信号号` 非零退出，不再把 `status=null` 当作成功；`pnpm agent` 只把 `--` 之前的 `-h`/`--help` 视为自身帮助，透传给下游运行器的参数不再被拦截。
- `tdd push`、`qa plan|verify|merge`、`worktree remove|cancel|resume|bootstrap`、`template sync|update|backfill`、devops 运行器等有副作用的入口被直接调用时，`--` 之前的 `-h`/`--help` 只打印用法并退出，不再被当作普通参数继续提交、推送、合并或改写文件。
- 移除从未接入且依赖未分发钩子源的 `install-git-hooks.js` 与 `pre-commit`，模板迁移按基线删除未修改的旧安装器；需要提交前检查的项目改用 `agent.config.json` 的 `tdd.projectChecks` / `qa.projectChecks`，由 `tdd sync` 与 `qa verify` 强制执行，不受 `--no-verify` 绕过、无需逐机安装。
- 删除源仓库残留的其他项目 GitHub workflow；根 `pnpm test` 纳入 `architecture/__tests__/*.test.mjs`，并以契约测试防止测试文件漏出聚合脚本；存储模块声明 ESM，消除 Node 模块类型重解析告警。
- `docs/CONVENTIONS.md` 补全 `remove` 策略与 manifest 兼容写法说明；`[Unreleased]` 历史条目归档到实际发布版本，官方源 `tdd sync` 递增版本时同步把 `[Unreleased]` 条目移入对应版本标题。
- `docs/data` 全局测试矩阵补齐 3.5–3.7 模块登记。

## [v3.7.18] - 2026-10-04

- PRD ↔ ARCH 追溯检查扫描 `docs/prd-modules/<domain>/` 下全部直接子级 Markdown 文档（含拆分规格），不再只读取模块 `PRD.md`；仅正式需求标题中的编号计为定义。

## [v3.7.17] - 2026-10-04

- `tdd push` 旧 PR 升级覆盖 3.7.14 生成的无标记正文（概要取提交要点、变更内容列 sha7）：与按分支提交重建的内容逐字一致时升级为带摘要标记的块，已修改或所列提交已不在分支上时保持原文。

## [v3.7.16] - 2026-10-04

- `tdd push` 自动概要起始标记记录内容摘要，人工修改过标记内文本时不再覆盖并给出提示；早期无标记但仍为自动格式（概要只有 PR 标题）的 PR 在再次推送时升级为带标记格式；工作区自动提交的正文逐条列出改动文件，概要不再只剩标题。修复 `git status --porcelain` 首行状态列被 trim 截断的问题。

## [v3.7.15] - 2026-10-04

- `tdd push` 自动生成的「概要」「变更内容」包在 `xirang:auto-summary` 标记内，已有 PR 再次推送时按当前分支提交刷新标记内文本，标记外手写内容与无标记的旧 PR 保持不变；`qa merge` 解析概要时忽略 HTML 注释行。修复 Review Gate 替换后吞掉下一章节前空行的问题。

## [v3.7.14] - 2026-10-04

- `tdd push` 新建 PR 时读取分支相对配置主干的提交：「概要」取提交正文中的 `-`/`*` 要点（无要点时取提交标题，无提交时回退为 PR 标题），「变更内容」列出短 SHA 与提交标题；分支只有一个 Conventional 提交时直接用其标题作 PR 标题。`qa merge` 以概要作为 squash 提交正文，合并记录不再只有一行。

## [v3.7.13] - 2026-10-04

- `qa merge` 的远端 squash 合并（gh CLI 与 GitHub API）与本地降级使用同一提交格式：标题为 `PR 标题 (#编号)`，正文为 PR「概要」段，不再落入 GitHub 默认的逐提交列表。

## [v3.7.12] - 2026-10-04

- `qa merge` 摘要的「策略」按实际合并后端显示：gh CLI 为 `gh pr merge --squash`，GH_TOKEN 走 GitHub API 时为 `GitHub API squash merge`，降级时为 `本地 git merge --squash`；本地 squash 提交信息不再硬编码 `Co-Authored-By: Claude Opus 4.6`，模板对 Codex 与 Claude 等执行器保持中立。

## [v3.7.11] - 2026-10-04

- `tdd push` 在本机缺少 gh CLI 时改用 `.env.local` 的 `GH_TOKEN` 走 GitHub API 创建 PR（base 为配置主干）或同步已有 PR 的 Review Gate，与 `qa merge` 共用 `infra/scripts/shared/github-api.js`；gh 与 GH_TOKEN 都不可用或 PR 创建失败时输出 `STATUS=BLOCKED` 并非零退出，不再只打印手动链接后静默成功。自动提交信息与 PR 标题按分支前缀（feature/fix/docs/refactor/test 等）生成 Conventional 类型并去掉末尾日期，不再出现 `chore: auto-commit before /tdd push`。

## [v3.7.10] - 2026-10-04

- 修复合并证据门禁：fixed-commit 下历史阻塞记录仅降级严重度或改为条件通过、未明确关闭/达标时阻断；严格模式（含 project）同样按 `qa.mergeEvidence.qaModulesDir`、`nfrTrackingFile` 读取证据；fixed-commit 发布结论的 P1 未修复/修复中统计与严格模式一致。

## [v3.7.9] - 2026-10-04

- 合并证据保持默认严格，新增项目显式启用的 `qa.mergeEvidence.mode=fixed-commit`：从 QA 回执的固定 base/head Git 快照检查新增或变化的阻塞、证据删除与未闭环记录，并单独输出发布结论。逐记录语义指纹避免无关文档修改误阻断；证据路径可配置且非法输入 fail closed。模板同步/update 的 Git 测试夹具固定换行；既有 Codex 维护分支兼容只做回归，不增加或推荐新的分支命名。

## [v3.7.1] - 2026-10-01

- 首次应用与后续更新息壤时自动补齐缺失的 `RULES.md`；已有文件（含空文件）保持原样，初始化后由项目维护。模板接入允许补齐缺失规则，创建后仍须完整预读再执行其他项目操作。

## [v3.7.0] - 2026-10-01

- 增加 Drizzle ORM/Kit 稳定组合，补齐任务 API、身份权限、文件 CAS、pg-boss 同库事务与原生迁移检查；Prisma 扩展 PostgreSQL、MySQL/MariaDB、SQLite。独立 schema、历史和驱动禁止自动转换，保留项目定制与旧 SQL。
- 官方源交付同步自动递增整体/独立架构版本，保留更高显式版本且重复同步幂等；整体模板与 Agent 发布清单同步为 `3.7.0`，独立架构能力包为 `3.5.0`；数据库差异、目录、原生迁移与验证限制见架构文档。
- 模板从 linked worktree 更新实际项目时，六个环境文件检查与缺失补建以目标项目主 `repo` 根目录为准；已有内容保持不变，实际文件从主 repo 对应 example 初始化，dry-run 不写入并报告目标路径。

## [v3.6.2] - 2026-09-28

- 测试范围默认按影响定向选择；全量仅在四类有证据的条件下升级。TDD 执行前记录结构化决策，QA 复核并复用有效结果；实际项目 `qa verify` 在签发 SHA 回执前校验证据与当前提交，纯文档任务可只提交静态/契约检查结果。
- 移除 Codex 侧无效的 `SessionStart` `GH_TOKEN` 环境注入钩子。Codex 不提供 `CLAUDE_ENV_FILE`，且 Hook 输出不能修改父进程环境；模板迁移会显式删除旧 `.codex/hooks.json`，Windows/macOS/Linux 的远端 GitHub 操作统一使用跨平台 Node 鉴权入口读取 `.env.local`。
- 修复阶段交接导致已授权任务停顿：PRD→ARCH→TASK→TDD→QA 默认刷新胶囊后连续推进，转换、恢复和胶囊统一输出自动续跑状态及精确 task ID 恢复命令。确需换执行器时先确认接管，宿主无交接能力且预算允许时在当前任务继续；保留未知副作用、真实阻塞、QA 和 completion guard，并增加跨进程完整阶段与中断恢复回归。

## [v3.6.1] - 2026-09-24

- 修正 `3.6.0` 迁移清单遗漏，显式删除状态模板和 `agent-state-utils` 实现及旧测试，确保旧消费者同步后不会残留已废弃入口。

## [v3.6.0] - 2026-09-24

### 移除 tracked 阶段状态文件

- 删除 `docs/AGENT_STATE.md` 和状态模板；分支、PR、步骤、重试、QA 回执与部署结论只保存在 task state、worktree session 和权威报告。
- `tdd push`、`qa plan`、`qa verify` 不再写阶段状态 Markdown；`qa merge` 不再读取或更新该文件。
- 删除 `agent-state-utils.js` 运行态写入入口；共享 Markdown 扫描器改为只读模块。
- AGENTS、专家、Handbook 和模板文档移除 `AGENT_STATE` 里程碑回流指令，并增加移除防回归契约。

## [v3.5.0] - 2026-09-23

### 上下文预算与阶段交接

- 新增只读 `task context`：按字节上限生成任务目标、阶段、验收、当前步骤、最近证据和下一动作胶囊，不创建目录、锁或状态。
- 新增 `task exec`：完整 stdout/stderr 写入任务 evidence，自动去除 ANSI，只回传退出码、耗时、日志路径、SHA-256 和有界摘要。
- `task transition` 增加 `CONTEXT_HANDOFF_REQUIRED` 与 `CONTEXT_COMMAND`，要求阶段边界在新执行上下文中继续。
- AGENTS、CONVENTIONS、阶段专家和 Codex 配置示例增加 180k 工作阈值、70% 缓存门禁、默认 4k 工具输出和约 8KB 长命令摘要预算。
- TDD/QA 改为使用任务胶囊和模块点读，不再要求全文加载 `docs/AGENT_STATE.md` 或大型阶段文档。

### 任务记录与 worktree 交付

- 缺少 lock 的旧消费者可显式指定 `--legacy-baseline <ref>`，按固定 Git 提交迁移未改动的模板 overwrite 文件；保留漂移阻断、项目所有权和已有 lock 优先。增加真实安装副本的模板边界回归，确认不依赖完整架构源码。
- 修复 Windows 匿名 Git 环境使用 Node 扩展空设备路径导致配置读取失败；改用 Git 可识别的 `NUL`，保留凭据隔离、禁止认证重试与 HTTPS 限制，并增加真实 Git 配置回归。
- 修正 TDD 手册仍默认落盘核查产物和任务帮助把工作类型称为只读类型的残留指引；通用约定直接提供跨执行器失败恢复协议，记录不可用时继续独立只读工作，保留修改与授权门禁。
- 允许开发 worktree 保留本地未提交内容并合并已验证提交；增加 `tdd push --committed-only`，合并后保留未提交内容并单独报告清理状态。
- 单会话只读核查不再因步骤数量强制创建或恢复任务记录；六阶段统一引用持久化触发规则，修改和需恢复的副作用仍保留任务门禁。
- 新增只读 `pnpm agent -- task paths [--task <id>]`，列出主项目、任务状态与锁目录，明确路径解析不等于权限授权；更新容器可写范围与策略拒绝说明，记录不可用时继续获准的独立只读检查。
- 任务 checkpoint 增加普通工具故障、策略拒绝、未知结果的结构化证据和只追加恢复历史；未知执行结果先核验，恢复必须提供依据，不自动重试或修改平台权限。
- 明确任务记录自身不可用时的最小证据协议、生命周期操作拆分和恢复边界，纠正 Codex never 等于所有命令放行的说明。

## [v3.4.3] - 2026-09-11

### 状态文档边界与验收索引修复

- 旧 `IN_PROGRESS` 字段的读写与清理限定到真实章节，空值不跨行，保留区外内容、代码示例、字段名和换行；相同值与重复清理不写文件。
- QA 里程碑按真实列表项识别，兼容大小写勾选并排除代码块、缩进示例、引用和注释；首次完成与初始化保留换行风格，重复条目或未闭合示例明确报告错误。
- 对齐开源公共能力、文件存储和环境初始化的任务模块、索引、总纲及追溯状态，引用已有 QA 证据；真实云、外部身份服务和跨平台发布的验证边界保持明确。

## [v3.4.2] - 2026-09-10

### QA 里程碑状态修复

- QA 合并区分首次更新、里程碑已完成、文件缺失和读写失败；过程与汇总使用同一状态说明，已完成时不再误报失败。
- 已完成的 `AGENT_STATE.md` 保持内容与修改时间不变，不生成重复状态提交；缺失文件提示跳过，真实读写失败保留原因。
- 补充文件操作与合并汇总回归，覆盖首次完成、重复合并、条目初始化、文件缺失和读写错误。

## [v3.4.1] - 2026-09-10

### 轻量架构检查与模板写入边界修复

- TDD/QA 架构检查共用轻量 CLI 的固定来源校验，从缓存运行所选项目检查；损坏或缺失的来源指针和缓存明确阻断，旧全量布局及未选择架构的项目保持兼容。
- 模板更新和冻结计划写入均拒绝 Git 主 worktree、息壤源角色目标；专用 linked worktree 和独立空目录仍可正常初始化与更新。
- 无效 scope/include 明确报错；模板和架构计划文件必须保存到项目及其主 worktree 以外，拒绝符号链接绕过并避免覆盖项目文件、版本锁或 Git index。
- 修正 TDD 手册的轻量架构标准入口和发布日志责任，补充实际消费者的共享检查与写入边界回归。

## [v3.4.0] - 2026-09-10

### 轻量架构入口与按需生成

- 实际项目仅安装架构 README、catalog/schema、选型 metadata、来源指针和 CLI；未选技术模板、示例、Registry 实现与测试留在源仓库或可重建缓存。作业包可继续独立使用。
- 固定官方提交、版本与内容摘要；缓存原子发布、并发互斥、离线命中校验，缺失时匿名获取同一提交，损坏与来源漂移明确阻断。目录按实际项目的主 worktree 解析，standalone 同样支持。
- 保留 catalog/detect/plan/init/update/check、冻结 apply 与恢复入口，代码和依赖只按已选择的应用、模块及依赖闭包生成。普通模板同步不会启用新的技术选择。
- 3.3 全量 runtime 仅在文件未偏离基线时缩减；业务定制与未知文件保留。新 lock 持久化后才清理失去全部引用的旧 baseline，中断可恢复。
- 完成原始 3.3 两类升级与实际 Web 消费验证；使用约定、架构专家入口和测试追溯同步更新。未改变现有组件选型或默认安装版本。

## [v3.3.0] - 2026-09-09

### 开源公共能力与存储

- 提供 Better Auth/Prisma、CASL、pg-boss/BullMQ Redis/PostgreSQL、i18next、Pino、OpenTelemetry 追踪、MSW 的按需生成实现与使用指南；配置、业务策略和词条保持项目所有。
- 新增 shadcn 身份面板、任务状态、Uppy 上传、Tiptap 编辑、Recharts Chart、dnd-kit 排序、React Flow 与 TanStack Virtual 表格；48 项 Registry，复用唯一 DataTable。
- Node/Go 支持 local、S3、阿里云 OSS、腾讯云 COS 原生适配与多存储路由；提供受认证文件会话、上传大小签名绑定、不可变转正键、CAS 元数据及恢复。
- Prisma PG/SQLite 的身份和文件模型独立初始化，迁移只追加；队列迁移单独显式执行。依赖严格检查并固定兼容版本，模板源不安装应用依赖。
- 单模块采用/更新补齐相关应用和数据源依赖；新增完整选型目录、Monorepo 配置示例、真实消费者与升级测试。备选组件与真实云/外部 IdP 验证边界明确记录。

## [v3.2.0] - 2026-09-09

### 多端 Monorepo 与 Prisma

- 新增 v2 架构选择、pnpm workspace、共享包 exports 和四种可展开蓝图；目录按项目配置，v1 项目保持兼容。
- 新 Node TypeScript / Prisma 7.10 数据访问包支持 PostgreSQL、SQLite，独立客户端/环境/迁移历史；迁移完整性守卫阻断历史缺失、改写和失败状态。
- 提供 OpenAPI 3.1 类型与运行时校验、无 React API client、Query 缓存、配置与观测、AppShell 和 Browser/Tauri 平台适配。
- 任务示例通过公共 shadcn DataTable 联动真实 API，支持分页、多列排序、筛选、多选、CRUD、导出、权限和并发失败恢复。
- YAML 三方更新保留项目键与注释；业务 schema/合约/页面仅初始化、迁移只追加、包管理器持有依赖锁。真实 3.1 升级保留定制并收敛。
- 固定兼容安全依赖覆盖；模板源保留源码、生成器与必要 updater 工具，应用依赖只在选定消费者安装。验证与限制见 docs/qa-modules/monorepo-platform/QA.md。

## [v3.1.0] - 2026-09-09

### 公共交互组件

- 提供 FormField/Section、FormDialog/Sheet、可选 React Hook Form 适配；统一字段关联、提交防重、失败保留、未保存关闭确认和焦点恢复。
- 提供本地单选/多选、异步搜索选择、日期/日期范围、确认对话框、异步按钮、加载/空态/错误状态及通知，继续由 shadcn 基础组件组合实现。
- DataTable 复用公共确认和状态，增加受控多选与日期范围列筛选，保留原有 Props、稳定选择、CRUD 和导出合约。
- 新增 9 个官方基础组件，合计 33 个基础控件、39 个 Registry 项；依赖与官方来源摘要统一管理。

### 初始化与升级

- 支持 applications[].componentSets 按需选择；默认 DataTable 自动安装其依赖，表单与 React Hook Form 独立可选，显式空集合仅保留基础 UI。
- 组件可放在应用内或 packages/ui；共享消费者合并依赖，初始化、Registry 和架构检查共用同一组件闭包。
- 兼容旧配置默认值与组件 owner ID；取消选择不自动卸载已安装源码及其依赖。旧项目的页面、utils、按钮定制和自有脚本保持保留。
- 修复共享组件重复 React 实例、受控面板关闭焦点和受限视口中日期弹层被裁切的问题；验证范围及证据见 docs/qa-modules/architecture-platform/QA.md 第 8 节。

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
