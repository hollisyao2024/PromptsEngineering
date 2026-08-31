# ADR-005：全新 worktree 使用已验证远端基线与固定 SHA

- 状态：Accepted
- 日期：2026-09-01
- 关联：US-CMDSURF-007

## 背景

模板创建全新 worktree 时会尝试 `git fetch --prune origin`，但当前允许 fetch 失败并继续。随后基线解析依次回退缓存 `origin/<base>`、本地 base 与任意 `HEAD`。因此成功输出不能证明任务从最新 configured base 开始；网络或鉴权失败也可能被包装成正常创建。使用可变的 `origin/<base>` 直接创建还会让并发 fetch 改变实际起点与记录证据之间的对应关系。

## 决策

全新 worktree 的默认路径在 branch、worktree 与 session 副作用前必须成功执行 `git fetch --prune origin`，并严格解析 `refs/remotes/origin/<base>^{commit}`。创建新分支时使用该解析结果的 commit SHA，而不是可变 remote-tracking ref。fetch 或远端 base 解析失败立即阻断。现有 `--skip-fetch` 与对应环境变量保留为显式离线入口，只允许缓存 remote base 或本地 base；输出未验证新鲜度，两类 base 均不存在时阻断。dry-run 与已有 worktree resume 不触发 fetch，也不自动 rebase。

## 被拒绝方案

- 继续 best-effort fetch：可用性更高，但无法建立最新基线保证，且会把远端故障延迟到开发或合并阶段。
- 仅把 `allowFailure` 改为 false：fetch 成功但远端 base 缺失时仍可能回退本地 base/HEAD，也没有固定 SHA 与结构化证据。
- 为本次修复新增 remote、policy、重试和 session schema：可扩展性更强，但超出当前最小目标并扩大模板兼容面。
- resume 时自动 fetch/rebase：会在恢复已有工作时引入隐式分支变更，不符合恢复边界。

## 后果

- 正向：默认新 worktree 起点可由 fetch 结果、base commit 与实际 HEAD 三者一致证明；失败发生在创建副作用前；显式离线能力仍保留。
- 代价：网络、鉴权或远端 base 故障会阻断默认创建；本地无 remote 项目必须显式使用 `--skip-fetch` 并具备本地 base。
- 风险控制：使用本地 bare remote 覆盖远端前进、fetch 失败、base 缺失、skip 缓存/local base、无任意 HEAD fallback、dry-run 与 resume 无网络回归。
