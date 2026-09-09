# 缺陷与复验

范围：macOS arm64、3.3 生成消费者。以下问题均在最终源码冻结前修复；无未关闭 P0/P1。

| ID / 严重度 | 复现与预期/实际 | 修复与复验 |
| --- | --- | --- |
| D1 / P1 | strict peer 安装：Better Auth utils 最新与 adapter 精确 peer 冲突 | 固定 0.4.2，auth-client 与 Vitest 5 分包；严格安装/类型通过 |
| D2 / P1 | CASL/SDK/BullMQ/编辑器新版本 API 与旧声明不同，消费构建失败 | 按实际类型接入并运行 PG/SQLite/三队列/组件测试 |
| D3 / P0 | 原始 3.2 workspace 再采用 agent，根 package/ignore 两个 owner 冲突 | 基线贡献合并、项目三方保护；双向采用与各 scope 5/5 |
| D4 / P1 | scoped auth 生成了模块但遗漏 consumer 依赖/Prisma 多文件配置 | 依赖闭包生成并更新配置基线；原始 3.2 采用后零差异 |
| D5 / P1 | 上传签名未绑定声明长度、非法可选配置被默认值吞掉 | Node/Go 三 SDK 签名长度与负例验证；浏览器 Blob 上传通过 |
| D6 / P2 | 登录错误重复 role=alert，错误播报与 E2E 定位重复 | 去除 AlertDescription 冗余 role；真实错密码重试通过 |
| D7 / P1 | template sync 遗漏 fileStorage 新选型前置检查 | 与其他模块一样要求显式采用；5/5 生成器测试 |
| D8 / P2 | 发布版本断言仍为 3.2，3.3 完整回归失败 | 同步发布协议断言并复验 release/consumer 契约 |

D3/D4 是本轮实际旧版升级发现的问题；首次失败日志保存在运行目录，文档只记录稳定结论。QA 回流沿任务状态机记录，不修改原验收范围。
