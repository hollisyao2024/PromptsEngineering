# ADR Changelog

| ADR | 日期 | 状态 | 摘要 |
| --- | --- | --- | --- |
| [ADR-001](001-arch-template-command-dispatch.md) | 2026-08-23 | Accepted | 扩展现有模板命令执行面，避免第二套命令系统 |
| [ADR-002](002-arch-environment-file-init-if-missing.md) | 2026-08-24 | Accepted | 六个环境文件仅首次初始化，已有内容永久由项目持有 |
| [ADR-003](003-arch-container-directory-initialization.md) | 2026-08-26 | Accepted | 容器目录由写入命令显式按需初始化，配置读取保持无副作用 |
| [ADR-005](005-arch-worktree-required-base-sync.md) | 2026-09-01 | Accepted | 全新 worktree 默认要求远端基线刷新成功并从固定 commit SHA 创建 |
| [ADR-006](006-arch-multi-host-optimistic-git-coordination.md) | 2026-09-05 | Accepted | 所有电脑同权；本机状态只管本机，跨电脑以远端 SHA 和普通非快进更新协调 |
