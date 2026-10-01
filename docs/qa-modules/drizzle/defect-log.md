# Drizzle 缺陷与验证限制

| ID | 级别 | 复现/影响 | 处置 | 状态 |
| --- | --- | --- | --- | --- |
| FIX-DRIZZLE-001 | major | 新任务 API 使用旧 PrismaClient 类型导致编译失败 | 使用已选 ORM Database 类型；三个新消费者构建/API 回归 | Closed |
| FIX-DRIZZLE-002 | major | PG Kit 外键显式 public，search_path 无法隔离 | 使用独立数据库/public，拒绝非 public schema；PG 实测 | Closed |
| FIX-DRIZZLE-003 | major | libSQL 原生历史 SERIAL id 可空 | 原生 rowid 排序校验，不改账本；两迁移追加/异常历史回归 | Closed |

无未解决的本范围 P0/P1 实现缺陷。回流规则见 [QA](QA.md)。
