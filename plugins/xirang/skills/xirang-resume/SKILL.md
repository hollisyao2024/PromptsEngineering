---
name: xirang-resume
description: "恢复或接手息壤 Xirang 的既有任务，读取断点和证据并继续授权工作。用于已知任务 ID 或明确的息壤断点恢复；普通聊天历史回顾不触发。"
---

先读[共同执行边界](../../references/workflow.md)，完整加载目标项目的基础规则。确认当前项目、任务 ID 与工作区归属；不根据相似名字猜选另一个人的任务。

已知任务 ID 时依次执行 `pnpm agent -- task resume --task <任务ID>` 和 `pnpm agent -- task context --task <任务ID>`。仅未知 ID 时用 `resume --auto`；若返回多候选，向用户列出最少辨别信息再选择。resume 可能写锁与状态，用户仅要求看状态时用只读 context，不启动恢复。

读取胶囊指向的当前规则、步骤、必要代码和证据。对 push、merge、部署等未知结果，先核实真实状态与固定 SHA，保留 verify_required；不要重放成功可能已发生的副作用。政策拒绝、未知结果和普通工具错误按项目规则分别处理。

按输出的 WORKTREE/NEXT_CWD 进入正确目录，继续 CONTINUATION_ACTION。需要 worktree 恢复时用项目提供的显式入口；禁止手工伪造 state.json、删除锁或覆盖别人未提交的文件。没有状态文件时核实任务是否已结束或已迁移，不重建一个假断点。

报告已证实的断点、剩余验收与实际下一动作。只读取胶囊不等于任务已恢复完成。
