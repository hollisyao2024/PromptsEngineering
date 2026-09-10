# 架构按需获取 ARCH

状态：已定义。依据：[PRD](../../prd-modules/architecture-on-demand/PRD.md) 的 US-LAZYARCH-001~006。决策：[ADR-031](../../adr/031-arch-on-demand-runtime.md)。

## 1. 组件与运行边界

| 组件 | 职责 | Story |
| --- | --- | --- |
| 作业包 | 继续独立安装；普通 agent 更新不启用架构 | 001/006 |
| 轻量 architecture 目录 | README、manifest、schema、选型 metadata、版本指针和 CLI 转发入口 | 002 |
| 固定来源缓存 | 容器 cache 中保存模板运行源码快照；按提交与内容摘要校验、原子落盘、可重建 | 004 |
| 既有生成器 | 从缓存源规划，只向 apps/packages 生成项目选择与依赖闭包 | 003/006 |
| 所有权更新引擎 | 缩减旧 runtime 自有文件、冲突保护及已失去引用的基线清理 | 005 |

实际项目的 CLI 先读取受版本管理的 runtime 指针，再验证或重建缓存；成功后在项目 cwd 调用固定源码的原有生成器。首次 include 与架构 init/update 在项目写入前准备缓存，保障生成后入口可用。catalog/help 读取轻量 metadata；其他命令可按需获取固定版本。业务数据库、SDK 与应用进程不进入缓存服务。

## 2. 数据与来源

architecture/runtime.json 保存 schemaVersion、息壤身份、官方 repository、commit、版本和 runtime 内容摘要，不保存本机绝对路径或密钥。xirang.lock.json 继续记录已采用模块与文件 baseline。容器 cache 依据项目主 worktree 解析；standalone 使用同一安全路径约定。缓存可保存未选模板源码，不会被提交到实际业务仓库。

官方获取复用匿名 Git 凭据隔离协议，按固定 commit 获取，不把 main 的新提交当作当前已采用版本。校验源码身份、预期摘要、文件路径和符号链接后才执行。普通 template sync 继续 required fetch main 并更新指针；缓存命中只证明固定版本完整，不证明最新。显式本地源码可用于验证和预览，但摘要不一致不能替代已固定源。

缓存填充使用独立暂存目录、写锁与原子发布，已有损坏内容明确阻断而不执行；并发命中重新验证，中断残留不作为有效快照。缺失缓存可匿名重新获取固定源；网络/身份/摘要失败不修改项目 tracked 文件。安全边界为受信任的模板提交与本地项目维护者，不防御同账号任意替换进程的攻击者。

## 3. 旧版升级与一致性

缩减仅枚举 lock 中 owner=architecture:runtime 的旧文件，保留轻量清单内路径，对其余路径使用 remove 策略。可靠基线缺失或本地修改一律冲突；未登记文件和业务生成代码不删除。覆盖旧 README/CLI 同样检查基线。共享的 tooling/xirang 引擎保持原有 owner。

只删除旧 lock 引用、而新 lock 已无引用的 baseline；内容摘要复验、冻结计划记录、写入新 lock 后清理，并支持恢复。仍被任意 owner 使用的 baseline、未知孤立文件均保留。不能只清理 architecture 而留下对应的原始源码 baseline 副本。

单模块 scope 仍沿既有依赖闭包补齐消费者；普通模板更新拒绝新选择和选型改变。include architecture 只启用工具，不生成应用。agent scope 不顺带升级或移除架构。减少 modules/componentSets 不自动卸载业务能力。

## 4. 验证与运维

验证空项目/agent-only/轻量项目、最小 Web/API 消费者、原始 3.3 完整包升级、真实本地 Git 固定源与匿名 fetch 协议。覆盖缓存命中/丢失/损坏/并发、漂移/路径/恢复负例、freeze/apply、作用域与二次零差异。记录实际项目架构文件数及字节变化，不把 Git 缓存大小说成网络按模块下载量。

不新增依赖、网络服务、CI 或生产部署。缓存可重建，工程配置和业务源码仍是项目事实源。容量优化关注业务仓库体积；传输可复用整份 Git 快照，未承诺远端按单组件分包下载。无数据库 schema 变化。
