# Claude Desktop 提交息壤插件提示词

在能访问本地源仓库与 shell 的 Claude Desktop Code 会话中使用；网页操作还需要浏览器或 Computer Use 能力。普通聊天不能仅靠这段提示词获得本地执行权限。

复制以下内容，先将工作目录定位到息壤官方源：

```text
请实际执行息壤 Xirang 的 Claude 插件目录提交，不要只给方案。

官方仓库：https://github.com/hollisyao2024/PromptsEngineering.git，分支 main。
插件目录：plugins/xirang。保留“模板核心＋四个 Skills＋插件包”结构，不为上架新增 MCP、hook 或代理调度。

先核实当前仓库来源，完整读取 AGENTS.md 与 docs/CONVENTIONS.md。只有确认是官方模板源且 RULES.md 不存在时才能免读它。遵守仓库任务状态、worktree、测试、QA、合并规则；不要直接修改主工作区。先检查是否已有本次 Claude 提交任务，存在时按精确 task id 恢复，避免重复提交或另建同一插件。

验收：双清单版本一致；本地严格校验通过；从市场实际安装后确认四个 Skills 可用，在可丢弃的 Git 项目验证接入、隔离任务、恢复和只读交付检查；卸载后恢复本次变更的个人插件配置。记录真实客户端版本与结果，不扩大权限、不覆盖现有项目或其他任务。

读取 plugins/xirang/README.md、docs/guides/plugin-quickstart.md、docs/promotion/distribution.md。核对 MIT 正文、图标、描述与反馈入口。插件不包含完整模板；首次接入须从官方源核实 commit，dry-run 后应用，再验证收敛。需要本地文件与 shell；纯网页不能运行本地 Git/pnpm。

当前插件版本从 portable 与 Claude 双清单读取，不沿用历史验证版本号。首次接入使用源中的 template update "<目标绝对路径>" --scope agent --initialize，先 dry-run、安装后复查；源与目标均不为文件安装创建 worktree，不操作目标 Git 生命周期。已有接入项目升级仍需任务与干净专属 worktree，通过官方 template sync 取得固定来源 SHA。

先查最新官方发布要求：https://code.claude.com/docs/en/plugins/publish 。进入 https://claude.ai/directory/manage ，确认付费账号与提交权限。选择插件 bundle 路径，按门户支持的方式指定上述 GitHub 仓库内 plugins/xirang 子目录；门户不支持子目录时先报告具体限制并准备可审查的分发方案，不把仓库根目录或整套模板误交为插件。

完成能够依据仓库事实填写的字段、校验与扫描，修复真实问题后提交审核。已授权本次目录提交，不必重复询问是否继续；涉及验证码、身份材料或需本人接受的法律条款时，展示具体页面并交给我处理，保留草稿与唯一恢复动作。不要宣称已通过审核或已经公开上架，除非有实际回执。

插件 0.1.0 在历史 Codex CLI 环境中的安装与技能调用、下游 GitHub PR→QA→合并已有证据；0.1.0 是插件版本，不是 Codex CLI 版本。当前插件与 Claude 客户端必须独立验证，不可借用历史 Codex 结果冒充。没有浏览器控制能力时完成本地准备，给我精确字段和剩余操作，不伪造提交成功。

协作介绍使用多模型接力、多人多机和单机多任务并行的项目流程；不保证零冲突或自动调度，不声称 Git 同步本机任务、未提交修改、锁或 QA 回执。共享端口、服务、数据库需协调，跨电脑合并重做本机 QA。发布素材与模型生成文案不算实际试用证据。

最终用中文简短报告：插件版本、来源 SHA、验证结果、提交 ID/状态/链接、尚需本人操作的事项；有源码修改则另给 MAIN_COMMIT、REMOTE_MAIN_COMMIT、MERGE_STATUS、PUSH_STATUS、MODIFIED_FILES 和 TEMPLATE_APPLY_CHECKLIST。
```
