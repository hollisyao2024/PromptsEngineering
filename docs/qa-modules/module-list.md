# QA 模块清单

| 模块 | 文档 | 本轮状态 |
| --- | --- | --- |
| 架构按需获取 | [QA.md](architecture-on-demand/QA.md) | 3.4 六项验收通过 / Go |
| 双能力包与架构落地 | [QA.md](architecture-platform/QA.md) | 公共 UI 3.1、界面视觉契约 3.8 测试通过 / Go（视觉漂移检查后续） |
| 模板命令面 | [QA.md](template-command-surface/QA.md) | 核查记录边界验收通过 / Go，完整回归 510/510 |
| 环境文件初始化 | [QA.md](environment-file-initialization/QA.md) | 兼容回归通过 |
| 多端 Monorepo 与 Prisma | [QA.md](monorepo-platform/QA.md) | 3.2 验收通过 / Go |
| 开源公共组件 | [QA.md](open-source-components/QA.md) | 3.3 功能验收通过 / Go；US-OSSKIT-009 业务测试驱动脚手架通过 / Go（真实 Playwright 1.62.1，边界见 QA §8） |
| 统一文件存储 | [QA.md](file-storage/QA.md) | 3.3 功能验收通过 / Go，真实云未验证 |
| Drizzle 数据访问 | [QA.md](drizzle/QA.md) | 四库矩阵/原生迁移/API/性能及自动源版本通过 |
| 业务测试自动化 | [QA.md](business-testing/QA.md) | 22 条原子 AC 全部通过 / Go，默认关闭；Web 驱动脚手架见开源公共组件 US-OSSKIT-009，其余端的驱动由项目自带 |
