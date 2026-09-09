# ADR Changelog

| ADR | 日期 | 状态 | 摘要 |
| --- | --- | --- | --- |
| [ADR-001](001-arch-template-command-dispatch.md) | 2026-08-23 | Accepted | 扩展现有模板命令执行面，避免第二套命令系统 |
| [ADR-002](002-arch-environment-file-init-if-missing.md) | 2026-08-24 | Accepted | 六个环境文件仅首次初始化，已有内容永久由项目持有 |
| [ADR-003](003-arch-container-directory-initialization.md) | 2026-08-26 | Accepted | 容器目录由写入命令显式按需初始化，配置读取保持无副作用 |
| [ADR-005](005-arch-worktree-required-base-sync.md) | 2026-09-01 | Accepted | 全新 worktree 默认要求远端基线刷新成功并从固定 commit SHA 创建 |
| [ADR-006](006-arch-multi-host-optimistic-git-coordination.md) | 2026-09-05 | Accepted | 所有电脑同权；本机状态只管本机，跨电脑以远端 SHA 和普通非快进更新协调 |
| [ADR-007](007-arch-xirang-official-template-sync.md) | 2026-09-06 | Accepted | 实际项目 required fetch 息壤固定官方源，以不可变 SHA 快照内最新应用器完成模板自更新 |
| [ADR-008](008-arch-xirang-anonymous-fetch.md) | 2026-09-06 | Accepted | 官方公开模板匿名 HTTPS 获取；隔离项目 token 与 Git 凭据，保留项目远端鉴权 |

- 2026-09-08：[ADR 026](026-arch-architecture-platform-packages.md)，独立能力包、架构配置与所有权升级引擎。

## 2026-09-09

- [ADR 028](028-arch-monorepo-prisma.md)：多端 Monorepo、Prisma、按需安装、预置组合与业务所有权。

- [ADR 027](027-arch-ui-component-sets.md)：四组公共 UI、可选择组件集、依赖闭包和日历日期合约。
