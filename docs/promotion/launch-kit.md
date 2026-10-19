# 推广素材草稿

[推广方案](README.md) · [分发路线](distribution.md)

以下均为待发布草稿，不代表已发帖、已获得用户验证或已上架。发布时链接到经过验证的版本；不要附未实际拍摄的演示或未测量的效率数字。

## 一句话介绍

中文：息壤 Xirang 是面向多人、多 AI 会话并行开发的工程协作模板，把 vibe coding 接入任务、独立 worktree、测试、QA 与恢复流程。

English: Xirang is an engineering workflow template for parallel development with people and AI coding sessions, using explicit tasks, isolated Git worktrees, verification gates, and recovery state.

## 中文社区首发草稿

标题：多个 AI 编程会话一起开发，怎样管理任务、隔离和合并？

当一个项目同时开多个 AI 会话，问题会从“能不能写代码”变成：谁负责哪些文件、什么算完成、QA 检查的是哪次提交、中断后怎么继续。

我在维护息壤 Xirang，尝试用一套项目内协议与脚本处理这些问题：每项修改先明确验收，再进入独立 Git worktree；交付经过测试、QA 和合并前 SHA 复验；长任务保留状态与恢复入口。协作流程可以独立采用，不要求先更换技术栈。

它仍需要开发者拆分业务边界、审阅结果和处理冲突；不承诺零冲突或全自动开发。

如果你已经在用 AI 编程，并准备尝试多人或多会话协作，欢迎从快速上手开始，反馈最先卡住的步骤。复现环境、命令与失败场景比一句“好用”更能帮助改进。

项目与教程：[息壤 GitHub](https://github.com/hollisyao2024/PromptsEngineering)

## 英文社区草稿

Title: Xirang: explicit tasks and isolated worktrees for parallel AI coding

I maintain Xirang, a repository-based workflow template for developers working with multiple AI coding sessions or teammates.

It combines acceptance criteria, per-task Git worktrees, test and QA gates, commit checks before merging, and recoverable task state. The workflow package can be adopted without replacing an existing application stack.

It does not schedule agents automatically or eliminate semantic conflicts. Developers still need to define task boundaries and review results.

The repository includes an English overview and a Chinese setup guide and two-task exercise. I would value reproducible onboarding feedback, especially where the instructions or lifecycle tools fail in a clean environment.

Repository: [Xirang](https://github.com/hollisyao2024/PromptsEngineering)

## 实操文章提纲

建议标题：用两个 AI 会话完成两项修改：息壤的 worktree、QA 和恢复流程。

1. 解释真实协作问题，给出项目环境、模板 commit 与演练验收。
2. 按快速上手安装作业包，展示生成文件与收敛预演。
3. 两个会话各建任务与 worktree，展示路径和差异。
4. 运行各自验证、PR 与 QA，展示固定 base/head 的检查结果。
5. 先合并 A，再展示 B 如何处理新的主干与重新验证。
6. 总结适用边界、操作成本与失败原因，链接实际演练仓库和教程。

没有走通双任务交付前，仅发布“接入体验”，不要使用“完整协作演示”的标题。

## 录屏分镜

目标时长约 2–3 分钟，是剪辑目标，不是接入耗时承诺。加速或省略的步骤明确标注。

| 画面 | 要证明什么 |
| --- | --- |
| README 与本次演示环境 | 用户能定位版本、目标与前提 |
| 首次 dry-run、安装、收敛预演 | 实际输出，且目标文件存在 |
| 两个终端的任务 ID、分支与路径 | 两项修改属于不同 worktree |
| 定向验证、QA 回执、PR | 对应的是实际固定提交 |
| A 合并后 B 的同步与验证 | 隔离工作区仍需处理集成变化 |
| 主干 SHA 与 finish 结果 | 确实走到完成门禁；失败则展示失败结论 |

遮蔽 token、用户信息、私人路径与非公开代码。使用演练仓库录制，不在生产项目中制造故障。

## 试用邀请草稿

我在改进息壤的多人、多 AI 会话协作流程，想邀请你在一个可丢弃的仓库里独立试一次首次接入和双任务演练。重点是找卡点，不需要给好评。

如果愿意参与，请记录工具版本、模板 commit、完成到哪一步、是否需要作者介入，以及最希望删除或简化的一个步骤。耗时由你自愿记录；不采集业务源码、凭据或项目状态。案例公开前会另行征得你的同意。

## 市场提交定位草稿

拟议名称：Xirang / 息壤。拟议类别：Developer Tools（以提交门户实际选项为准）。

拟议描述：帮助开发者在支持项目文件与 shell 的环境中接入息壤，启动隔离任务、恢复工作并检查交付条件。复用项目内 CLI 与规则，不替代宿主权限或自动授予仓库权限。

此描述仅在插件实现并通过适配验收后用于提交。当前发布的是仓库模板与文档，插件功能见[待实现范围](distribution.md#首版插件建议能力)。
