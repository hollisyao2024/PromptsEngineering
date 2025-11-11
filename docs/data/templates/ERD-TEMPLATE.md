# ERD 模板（Mermaid ER 图）

## 文档头（必填）
- 版本：vX（格式 `v1`/`v1.0`）
- 维护人：xx（ARCH 专家）
- 日期：YYYY-MM-DD
- 关联模块/域：xxx

## Mermaid ER 图
```mermaid
erDiagram
  /* 实体名 */ ||--o{ /* 关联实体 */ : 描述关系
  /* 说明：用 Mermaid 的 `erDiagram` 语法，保持实体/关系逻辑一致。 */
```

## 实体摘要表（示例）
| 实体/表 | 说明 | ATM（依赖模块） |
|---------|------|-----------------|
| User | 平台用户主记录 | auth |
| Order | 订单信息 | commerce |

## 更新校验清单
- 实体变更是否同步更新 `/docs/data/dictionary.md`（字段/约束条目）？
- 数据关系是否反映在 `/docs/ARCH.md` 的“数据视图”节？
- 结构调整是否需要新增 ADR（如分区、脱敏、审计）？
- 是否使用 `/arch data-view` 或 `npm run arch:sync -- --report` 重新生成追溯输出？

## 版本记录
- `v1` 初始版本
