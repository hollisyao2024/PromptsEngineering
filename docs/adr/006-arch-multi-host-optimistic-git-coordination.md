# ADR-006：多电脑使用远端 SHA 与普通非快进更新协调

- 状态：Accepted
- 日期：2026-09-05
- 关联：US-CMDSURF-008、CR-20260905-001

## 背景

模板应用到共享 GitHub 项目后，每台电脑都可能执行 PRD、ARCH、TASK、TDD、QA 或 DEVOPS。现有 worktree session 与 PID 锁只存在于单个容器，无法发现另一台电脑的同名分支、QA 状态或合并临界区；当前 QA merge 还包含硬编码 `main`、MERGEABLE 快路、自动 rebase/force-push 功能分支和未绑定 head SHA 的合并请求。项目同时明确禁止 GitHub CI，并要求所有授权协作者都能合并 PR和普通更新主干。

## 决策

专家阶段与授权身份完全解耦，不设置机器角色、QA 专用账号或远程锁。new 在 required fetch 后检查远端同名分支并阻断误建；显式 resume 可从远端分支固定 SHA 建立本机 worktree/session。`qa verify` 产生只属于本机的 base/head SHA 通过回执；`qa merge` 重新 fetch 并要求二者未漂移，GitHub squash merge 绑定 expected head SHA，本地 fallback 只使用配置主干的普通非快进 push。远端确认前禁止清理。`.github/workflows` 保持 project-owned，模板不创建、触发或依赖 GitHub CI。

## 被拒绝方案

- 固定 QA 电脑或账号：与每台电脑可承担任意专家阶段的事实冲突，并增加凭据管理复杂度。
- 分布式锁服务：能串行化合并，但引入新服务、可用性和恢复问题；Git 的原子引用更新已能防止非快进覆盖。
- 自动随机分支后缀：可以减少碰撞，但改变现有命名与恢复习惯；最小方案先阻断并给出显式 resume/更名动作。
- 独立最终候选 worktree与三 SHA 证明：能消除 PR merge 前后的极小 base 竞态，但实现和依赖成本显著增加，留作后续加固。
- 依赖 GitHub CI 或 merge queue：违反项目明确约束。

## 后果

- 正向：所有电脑能力相同；远端同名分支不会被误建；QA 后 base/head 漂移可检测；并发本地 push 不会覆盖先到提交；保留现有 squash merge 和配置结构。
- 代价：换电脑继续 QA 时需在新电脑重新运行验证；GitHub PR merge 在最终 base 检查与服务端 merge 之间仍有极小竞态窗口。
- 信任边界：允许所有协作者直接普通 push 且无服务端 CI 时，模板不能证明原始 Git 命令运行过本地 QA，只提供防误操作而不是零信任强制。
- 验证：以 mock GitHub API/CLI 和三份独立 clone + 本地 bare remote 覆盖分支碰撞、跨机恢复、SHA 漂移、并发更新、非快进拒绝和配置主干。

