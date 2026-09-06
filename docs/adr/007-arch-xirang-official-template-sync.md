# ADR-007：息壤模板使用固定官方源与不可变 SHA 快照自更新

- 状态：Accepted
- 日期：2026-09-06
- 关联：US-CMDSURF-009、CR-20260906-001
- 后续修订：官方源的项目 token 鉴权已由 [ADR-008](008-arch-xirang-anonymous-fetch.md) 取代为匿名 HTTPS；本文件保留原决策历史。

## 背景

模板应用到实际项目后，项目会携带一份当时版本的更新脚本、apply engine、manifest 和默认配置。若实际项目直接运行自身的 `template update .`，默认 source 仍是项目内这份旧快照；若依赖维护者事先更新某个本地模板目录，则“更新息壤模板”无法证明连接了官方 GitHub、获得了最新版本或使用了同一提交完成 dry-run 与 apply。旧更新器还可能无法理解新 manifest 策略，形成自举缺口。

## 决策

模板正式身份为“息壤（Xirang）”，稳定 ID 为 `xirang`。template-owned 默认配置登记固定官方仓库 `https://github.com/hollisyao2024/PromptsEngineering.git` 和默认分支 `main`。实际项目中的 `AGENTS.md` 将“更新息壤模板”确定性映射到 `pnpm agent -- template sync`，并要求先进入该项目专用 linked worktree。

`template sync` 是轻量引导器：它在目标 tracked mutation 前校验调用 worktree和模板身份，在容器 tmp 的唯一运行目录初始化隔离 Git 仓库，通过既有 GitHub 鉴权环境 required fetch 官方分支，解析 `FETCH_HEAD^{commit}`，并 detached checkout 该固定 SHA。引导器验证快照包含有效身份、manifest、update wrapper 和 apply engine 后，调用快照中的最新 wrapper执行 dry-run、冲突检查和 apply，再执行 convergence dry-run。所有阶段使用同一模板 SHA；成功输出仓库、分支、SHA 和阶段状态，失败以非零退出且不得静默回退项目内旧快照或缓存。

既有 `template.sourceRepo` 与 `AGENT_TEMPLATE_SOURCE_REPO` 继续表示项目向本地模板工作区执行 backfill 的路径，避免将 GitHub URL 传入现有 `path.resolve()` 逻辑。在线官方源使用独立的 `template.identity` 与 `template.upstream` 配置。测试和明确 fork 场景可以通过显式参数注入本地 bare remote，但普通自然语言触发始终采用模板默认官方源。

## 被拒绝方案

- 继续要求用户先手工更新本地模板仓库：步骤不一致，无法由实际项目独立证明来源与新鲜度。
- 直接调用实际项目内的旧 `update-template.js`：存在自引用旧快照和执行器无法自升级的问题。
- 将官方仓库作为实际项目 Git submodule/subtree：会侵入项目 Git 历史、增加初始化和冲突处理负担。
- GitHub archive/API 下载：私有仓库鉴权、内容完整性和跨平台实现将形成第二套网络协议；Git fetch 已具备 SHA 与凭据封装。
- fetch 失败后自动使用持久缓存：会把陈旧来源伪装成“最新模板”，违反用户语义。
- 对实际项目主 worktree 直接写入：绕过 Worktree-First、TDD 和 QA 生命周期。

## 后果

- 正向：一句自然语言和一个稳定命令具有相同确定语义；模板来源、版本和执行器均可审计；旧项目可通过最新快照中的执行器升级自身；fetch 或来源异常不会修改目标 tracked 文件。
- 代价：普通同步依赖 GitHub 可用性并产生一次 shallow fetch；用户首次采用本版本前仍需通过现有方式应用一次模板，之后才能获得自然语言和 CLI 自更新入口。
- 安全：凭据仅由进程级 Git extraheader 注入；临时快照位于经校验容器 tmp 内并以 no-follow 精确清理；输出不包含 token 或敏感 header。
- 验证：本地 bare remote 覆盖远端前进、旧目标/新源自举、fetch/ref/source 失败零写入、冲突保护、固定 SHA、重复同步收敛和 project-owned sentinel。
