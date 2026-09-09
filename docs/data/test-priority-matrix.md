# 全局测试矩阵

历史模块沿各自 QA 维护，本轮 3.3 增量如下。

| 模块 | 优先级 / 风险 | 验证策略与证据 |
| --- | --- | --- |
| [开源公共组件](../qa-modules/open-source-components/QA.md) | P0 身份/数据/升级；P1 UI/队列 | 源回归、PG/SQLite、三类队列、Chrome、k6、SAST/SCA |
| [统一文件存储](../qa-modules/file-storage/QA.md) | P0 主体/双写/路径/签名；P1 SDK/交互 | Node 协议、Go race/构建、CAS/恢复/重放、浏览器文件内容一致性 |

外部服务和生产容量的未验证项在各模块 nfr-tracking.md 记录；不以本地测试替代云账号/SSO 验收。
