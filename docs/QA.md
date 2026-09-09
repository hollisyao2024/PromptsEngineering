# QA 总纲

息壤源码按功能模块记录验证。当前 3.1 交付覆盖公共表单、选择器、日期、反馈和按需初始化升级；测试结论为 Go。本机 QA receipt、主干同步及 completion guard 决定最终交付状态。

| 模块 | 报告 | 本轮范围 |
| --- | --- | --- |
| 双能力包与架构落地 | [QA](qa-modules/architecture-platform/QA.md) | 第 8 节：公共 UI 新增 5 项 AC、嵌套日期修复、生成与升级矩阵；第 2～7 节保留历史基线 |
| 模板命令面 | [QA](qa-modules/template-command-surface/QA.md) | 既有命令、官方同步和生命周期兼容回归 |
| 环境文件初始化 | [QA](qa-modules/environment-file-initialization/QA.md) | 既有初始化和文件所有权兼容回归 |

索引：[模块清单](qa-modules/module-list.md)。详细证据、缺陷、NFR 只维护在模块报告。
