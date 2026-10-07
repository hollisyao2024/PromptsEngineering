# NFR 验证

| 约束 | 证据与边界 | 状态 |
| --- | --- | --- |
| 有界输入、列表、TTL、失败恢复 | 存储与队列协议、CAS 与虚拟表测试 | Pass |
| 敏感数据隔离 | owner/CASL/日志测试、浏览器 SDK 检查、SAST/SCA | Pass |
| 响应与数据一致 | 3 VU 10 秒本机 k6、真实 DB 与浏览器；不外推生产 | Pass |
| 驱动脚手架的确定性 | 重试为 0、不下载浏览器、不写 `agent.config.json`、报告路径被忽略；真实 Playwright 1.62.1 + Chrome 154 取证 | Pass |
| 外部环境 | 云/SSO/邮件/原生回调需项目环境 | Unverified / 项目验收 |
| 驱动脚手架的外部依赖 | 真实 react-vite、react-next 开发服务器的端口参数处理、`@playwright/test` 1.63.0、iOS 与 Android 驱动 | Unverified / 项目验收 |
