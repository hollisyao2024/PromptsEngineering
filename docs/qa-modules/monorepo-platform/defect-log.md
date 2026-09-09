# 缺陷与复验

| 编号 | 问题与影响 | 修复及复验 | 状态 |
| --- | --- | --- | --- |
| MP-001 | NodeNext 导入形态和共享 UI rootDir 导致消费者类型检查失败 | Ajv/格式库使用已验证的具名导出；UI rootDir 包含 lib；所有消费者类型通过 | Closed |
| MP-002 | OpenAPI 3.1 校验使用旧 draft 且忽略日期格式 | Ajv 2020-12 + 格式库；嵌套元组、非法日期负例先红后绿 | Closed |
| MP-003 | 表格多列排序只传第一列，令牌切换可复用旧列表缓存 | 有界排序列表穿过 API；客户端身份分区缓存；真实 DB/浏览器验证 | Closed |
| MP-004 | 请求体超限流提前销毁使错误响应不可靠 | 有界读取返回 413；真实 HTTP 70 KiB 负例通过 | Closed |
| MP-005 | 工具链间接依赖 3 high/1 moderate 审计告警 | 选择式生成安全 overrides，安装/generate/迁移复验，最终 audit 0 | Closed |
| MP-006 | 新 schema 文档门禁发现 ERD/字典遗漏 | 补充 Task、索引、约束及 Prisma 账本边界，tdd sync 通过 | Closed |

MP-007：宽屏 AppShell 样式未进入 Tailwind 扫描。新增 1280px 浏览器用例失败后，回流 TDD，增加共享 UI src 根扫描；全部 8 条浏览器旅程和 k6、29 项 UI 测试通过，桌面重新构建。状态 Closed。

SAST 规则首次 YAML 引号错误属于验证配置问题，修正后实际扫描 25 文件、0 错误。升级收敛测试曾与源编辑并行导致漂移；固定源后全量 420 测试通过，没有绕过冻结计划门禁。无未处理 P0/P1 缺陷。
