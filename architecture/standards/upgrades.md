# 模板安装与升级标准

模型作业包和应用架构包独立选择，共用 tooling/xirang 引擎。项目选型为 architecture.config.json；作业配置为 agent.config.json；安装版本、文件归属和生成参数为 xirang.lock.json；原始模板内容位于 .xirang/baselines。后两者一同提交，允许跨电脑升级。

- overwrite：模板自有文件；覆盖前校验本地是否偏离已安装基线。
- update：比较基线 B、当前 L、新版 U，三方合并保留项目定制；重叠修改报冲突。
- merge-json：按字段三方合并，项目独有键保留；冲突叶级明确报告。
- append / append-json / append-lines：文件或稳定 ID 条目只追加，重复去重，既有迁移不可改写。
- managed-block：只更新指定标记块，块外文本保持原样。
- init-if-missing：只在缺失时创建；之后归项目维护。
- project-owned：永不写入，如 RULES.md、真实业务文件与未被选中资产。

先生成完整计划、校验来源/目标/lock/基线、确认无冲突，再写入；执行日志位于容器 tmp。中断用 resume 逐项核对 before/after 哈希，出现第三种状态即阻断。日志和 Git worktree 保留审查/恢复证据。未选中模块不得自动启用，已有文件不得因上游目录消失而静默删除。

首次接管没有历史基线时输出 adoption-required。显式 adopt 表示维护者已经查看差异，并接受当前文件作为相对于所选上游的项目定制；保留当前字节并记录新基线。它不证明历史文件未修改。后续 upstream 改变仍进行合并/冲突检查；恢复计划不重新联网选择新版本。
