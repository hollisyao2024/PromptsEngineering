# 数据库迁移脚本示例

本目录包含多个幂等性迁移脚本示例，用于演示如何编写可安全重复执行的数据库迁移。

## 📚 示例清单

| 文件 | 说明 | 适用场景 |
|------|------|---------|
| [01-add-column-idempotent.sql](01-add-column-idempotent.sql) | 添加列的幂等示例 | 需要为现有表添加新字段 |
| [02-backfill-with-condition.sql](02-backfill-with-condition.sql) | 数据填充的幂等示例 | 需要迁移或填充大表数据 |
| [03-safe-constraint-add.sql](03-safe-constraint-add.sql) | 安全添加约束的幂等示例 | 需要添加唯一约束或外键 |
| [04-python-migration-example.py](04-python-migration-example.py) | Python 迁移的幂等示例 | 使用 Alembic 进行迁移 |

## ✅ 幂等性验证方法

每个示例都可以通过以下步骤验证幂等性：

```bash
# 1. 首次执行
psql test_db -f EXAMPLES/01-add-column-idempotent.sql
# 或
alembic upgrade head

# 2. 重复执行（验证幂等性）
psql test_db -f EXAMPLES/01-add-column-idempotent.sql
# 应该成功执行，无报错或输出"已存在，跳过"

# 3. 验证数据一致性
psql test_db -c "SELECT COUNT(*) FROM table_name"
# 第1次和第2次的结果应该相同
```

## 📖 相关文档

- 完整指南：[/AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md](../../AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md) §2.1
- SQL 模板：[../TEMPLATE.sql](../TEMPLATE.sql)
- Python 模板：[../TEMPLATE.py](../TEMPLATE.py)

## ⚠️  注意事项

- 这些示例仅用于学习和参考，不应直接在生产环境中执行
- 实际迁移脚本应根据项目的具体需求进行调整
- 所有迁移脚本都应在测试环境中充分验证后才能应用到生产环境
