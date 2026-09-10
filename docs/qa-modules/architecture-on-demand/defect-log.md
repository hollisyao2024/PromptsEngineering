# 缺陷与复验

环境：macOS arm64、3.4 源/隔离消费者；全部在提交运行源码前修复，无未关闭 P0/P1。负责人：模板维护者；需要实现修复时由 TDD 处理。

| ID / 严重度 | 复现与预期/实际 | 修复与复验 |
| --- | --- | --- |
| D-LAZYARCH-001 / P1 | non-Git 消费者借用源码配置 helper，缓存原本落到 worktrees/cache；应落在目标容器 | 显式区分 Git 主 worktree 与 standalone；清理精确错位缓存；CLI、路径测试和实际 Web 通过 |
| D-LAZYARCH-002 / P1 | 中断在 runtime 指针写入后、lock 写入前，CLI resume 被指针校验阻断 | resume 直接执行冻结日志；先复现 RED，再通过无需源码缓存的恢复测试 |
| D-LAZYARCH-003 / P1 | macOS /var 与 /private/var 对同一目标生成不同日志 key，恢复找不到旧日志 | 新日志规范化路径、兼容旧系统别名；多个候选阻断；CLI 与直接 resume 复验通过 |
| D-LAZYARCH-004 / P2 | 新约定超过始终加载文档的 260 行限制，源与已安装契约失败 | 压缩为 259 行，不放宽测试；最终 447/447 |
| D-LAZYARCH-005 / P2 | 显式外部缓存恰为项目父目录被误认为在项目内 | 区分父级与子级相对路径；边界测试通过 |
| D-LAZYARCH-006 / P2 | PRD/TASK lint 发现新增及 3.3 遗留文档缺少标准标题、WBS 标识 | 规范文档结构和追溯入口，验收范围与技术选型不变；文档门禁复验 |
