# 模板安装与升级标准

模型作业包和应用架构包独立选择，共用 tooling/xirang 引擎。项目选型为 architecture.config.json；作业配置为 agent.config.json；安装版本、文件归属和生成参数为 xirang.lock.json；原始模板内容位于 .xirang/baselines。后两者一同提交，允许跨电脑升级。

3.4 起，实际项目的 architecture/ 只保存轻量入口、metadata 与 runtime.json 固定来源。完整运行源码保留在息壤源或容器 cache，按提交和摘要校验；缺失时可匿名重建同一版本。template sync 才获取最新 main；固定缓存命中不代表最新。仅采用作业包的项目不创建架构目录。

- overwrite：模板自有文件；覆盖前校验本地是否偏离已安装基线。
- update：比较基线 B、当前 L、新版 U，三方合并保留项目定制；重叠修改报冲突。
- merge-json：按字段三方合并，项目独有键保留；冲突叶级明确报告。
- merge-yaml：workspace 结构三方合并，保留项目注释和键；成员/构建允许列表按集合合并，其他冲突阻断。
- append / append-json / append-lines：文件或稳定 ID 条目只追加，重复去重，既有迁移不可改写。
- managed-block：只更新指定标记块，块外文本保持原样。
- init-if-missing：只在缺失时创建；之后归项目维护。
- 应用和共享包的 lib/utils.ts 只初始化，防止组件升级覆盖项目 helper。shadcn 基础控件直接引用固定版本的 cn 包；保留 clsx/tailwind-merge 兼容既有业务导入。
- project-owned：永不写入，如 RULES.md、真实业务文件与未被选中资产。
- remove：只用于明确登记的旧模板自有文件；必须核对本地与基线一致，不递归删除未知文件或业务目录。3.3 完整 runtime 可按此规则缩减到轻量清单。

先生成完整计划、校验来源/目标/lock/基线、确认无冲突，再写入；执行日志位于容器 tmp。中断用 resume 逐项核对 before/after 哈希，出现第三种状态即阻断。日志和 Git worktree 保留审查/恢复证据。未选中模块不得自动启用，已有文件不得因上游目录消失而静默删除。

冻结计划列出旧 lock 引用、而新 lock 全部 owner 均不再引用的 baseline。新 lock 持久化后才复验并删除这些基线；中断后可续跑，不删除仍被引用或未知来源的孤立基线。缓存准备成功才开始项目写入，缓存的失败恢复与项目更新日志各自保留边界。

首次接管没有历史基线时输出 adoption-required。显式 adopt 表示维护者已经查看差异，并接受当前文件作为相对于所选上游的项目定制；保留当前字节并记录新基线。它不证明历史文件未修改。后续 upstream 改变仍进行合并/冲突检查；恢复计划不重新联网选择新版本。

Prisma schema、业务服务、OpenAPI 和架构选择仅初始化；SQL 历史只追加；Prisma/API 生成物不回灌。pnpm-lock.yaml/Cargo.lock 由实际包管理器维护。预置组合只展开一次，后续以 architecture.config.json 为准，不自动把 v1 项目转为 v2。

新增开源模块沿用同一所有权协议：公共实现三方更新，依赖清单结构合并；policy/resources/handlers、身份与文件 Schema 和业务接线仅初始化；SQL 只追加。单模块更新包含相关应用与数据库的依赖闭包，避免生成不可运行的半套依赖；无关应用不展开。取消选择不等于卸载，删除历史文件或切换已采用后端必须由项目独立迁移。
