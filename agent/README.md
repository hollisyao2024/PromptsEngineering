# 模型作业能力包

本包管理需求、架构、任务、TDD、QA、交付、worktree 和长任务恢复。manifest.json 是能力入口，applyManifest 引用唯一分发规则。公开执行路径继续为 AgentRoles、infra/scripts、infra/templates，避免破坏现有项目入口。

技术选型、组件源、初始化与技术检查位于 ../architecture；文件更新机制位于 ../tooling/xirang。只采用本包不会生成 apps、数据库或 UI 业务文件。`template update --scope agent` 仅更新本包；`template update --scope all` 更新本包及已经采用的架构资产。
