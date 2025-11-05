"""
TEMPLATE.py — Alembic-like migration scaffold (幂等性模板)

⚠️  幂等性要求：本脚本必须可以安全地重复执行！
    - upgrade() 中检查列/表是否已存在再添加
    - data_migrate() 中使用 WHERE 条件仅处理未迁移的数据
    - downgrade() 也应满足幂等性（可安全重复执行）
    - 提交前必须在本地执行 3 次验证（首次、重复、回滚+重新执行）

📝 命名规范：YYYYMMDD_HHMMSS_description.py
📖 详细指南：/AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md §2.1

使用方式：
    alembic upgrade head      # 执行 upgrade + data_migrate
    alembic downgrade -1      # 执行 downgrade
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session


def upgrade():
    """
    EXPAND 阶段：添加新表/列/索引，不删除任何内容

    ✅ 幂等性要求：检查列/表是否已存在再添加
    """
    connection = op.get_bind()
    inspector = inspect(connection)

    # --------------------------------------------------
    # 示例 1：创建新表（幂等）
    # --------------------------------------------------
    if 'orders' not in inspector.get_table_names():
        op.create_table(
            'orders',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('order_number', sa.String(255), unique=True, nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('status', sa.String(50), server_default='pending'),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now())
        )
        print("✓ Created table 'orders'")
    else:
        print("⊘ Table 'orders' already exists, skipping...")

    # --------------------------------------------------
    # 示例 2：添加新列（幂等）
    # --------------------------------------------------
    users_columns = [c['name'] for c in inspector.get_columns('users')]

    if 'email' not in users_columns:
        op.add_column('users', sa.Column('email', sa.String(255)))
        print("✓ Added column 'users.email'")
    else:
        print("⊘ Column 'users.email' already exists, skipping...")

    if 'phone_number' not in users_columns:
        op.add_column('users', sa.Column('phone_number', sa.String(20)))
        print("✓ Added column 'users.phone_number'")
    else:
        print("⊘ Column 'users.phone_number' already exists, skipping...")

    # --------------------------------------------------
    # 示例 3：创建索引（幂等）
    # --------------------------------------------------
    existing_indexes = [idx['name'] for idx in inspector.get_indexes('users')]

    if 'idx_users_email' not in existing_indexes:
        op.create_index('idx_users_email', 'users', ['email'])
        print("✓ Created index 'idx_users_email'")
    else:
        print("⊘ Index 'idx_users_email' already exists, skipping...")

    # --------------------------------------------------
    # 示例 4：添加约束（幂等）
    # --------------------------------------------------
    # 注意：Alembic 没有直接的 IF NOT EXISTS，需要手动检查
    existing_constraints = [
        c['name'] for c in inspector.get_unique_constraints('users')
    ]

    if 'users_email_unique' not in existing_constraints:
        op.create_unique_constraint('users_email_unique', 'users', ['email'])
        print("✓ Created constraint 'users_email_unique'")
    else:
        print("⊘ Constraint 'users_email_unique' already exists, skipping...")


def data_migrate():
    """
    MIGRATE/BACKFILL 阶段：数据迁移与填充（后台作业）

    ✅ 幂等性要求：
       - 使用 WHERE 条件仅处理未迁移的数据
       - 分批处理，避免长时间锁表
       - 可以安全地重复执行

    注意：对于大表（>100万行），建议使用独立的后台脚本，而非在迁移中直接执行
    """
    connection = op.get_bind()
    session = Session(bind=connection)

    # --------------------------------------------------
    # 示例 1：数据填充（幂等）
    # --------------------------------------------------
    # 仅更新尚未迁移的行（email 为 NULL）
    batch_size = 1000
    total_migrated = 0

    while True:
        # 使用原生 SQL 以获得更好的性能和控制
        result = connection.execute(text("""
            UPDATE users
            SET email = legacy_email_field
            WHERE email IS NULL
              AND legacy_email_field IS NOT NULL
              AND id IN (
                  SELECT id FROM users
                  WHERE email IS NULL
                    AND legacy_email_field IS NOT NULL
                  LIMIT :batch_size
              )
        """), {"batch_size": batch_size})

        rows_affected = result.rowcount
        if rows_affected == 0:
            break  # 所有数据已迁移

        total_migrated += rows_affected
        session.commit()
        print(f"  Migrated {rows_affected} rows (total: {total_migrated})...")

    print(f"✓ Data migration completed: {total_migrated} rows migrated")

    # --------------------------------------------------
    # 示例 2：跨表数据迁移（幂等）
    # --------------------------------------------------
    # 仅插入不存在的订单（避免重复）
    result = connection.execute(text("""
        INSERT INTO orders (order_number, user_id, status, created_at)
        SELECT
            legacy_order_number,
            user_id,
            CASE
                WHEN legacy_status = 'complete' THEN 'delivered'
                WHEN legacy_status = 'pending' THEN 'pending'
                ELSE 'shipped'
            END,
            created_at
        FROM legacy_orders
        WHERE legacy_order_number NOT IN (
            SELECT order_number FROM orders
        )
        LIMIT :batch_size
    """), {"batch_size": batch_size})

    print(f"✓ Inserted {result.rowcount} orders from legacy_orders")
    session.commit()


def downgrade():
    """
    ROLLBACK 阶段：回滚脚本（完全逆转 upgrade）

    ✅ 幂等性要求：回滚脚本本身也应该幂等

    注意：数据回滚可能导致数据丢失，需要谨慎评估
    """
    connection = op.get_bind()
    inspector = inspect(connection)

    # --------------------------------------------------
    # 回滚 EXPAND 阶段（删除新增的表/列/索引/约束）
    # --------------------------------------------------

    # 删除索引（幂等）
    existing_indexes = [idx['name'] for idx in inspector.get_indexes('users')]
    if 'idx_users_email' in existing_indexes:
        op.drop_index('idx_users_email', 'users')
        print("✓ Dropped index 'idx_users_email'")
    else:
        print("⊘ Index 'idx_users_email' does not exist, skipping...")

    # 删除约束（幂等）
    existing_constraints = [
        c['name'] for c in inspector.get_unique_constraints('users')
    ]
    if 'users_email_unique' in existing_constraints:
        op.drop_constraint('users_email_unique', 'users', type_='unique')
        print("✓ Dropped constraint 'users_email_unique'")
    else:
        print("⊘ Constraint 'users_email_unique' does not exist, skipping...")

    # 删除列（幂等）
    users_columns = [c['name'] for c in inspector.get_columns('users')]

    if 'phone_number' in users_columns:
        op.drop_column('users', 'phone_number')
        print("✓ Dropped column 'users.phone_number'")
    else:
        print("⊘ Column 'users.phone_number' does not exist, skipping...")

    if 'email' in users_columns:
        op.drop_column('users', 'email')
        print("✓ Dropped column 'users.email'")
    else:
        print("⊘ Column 'users.email' does not exist, skipping...")

    # 删除表（幂等）
    if 'orders' in inspector.get_table_names():
        op.drop_table('orders')
        print("✓ Dropped table 'orders'")
    else:
        print("⊘ Table 'orders' does not exist, skipping...")

    # --------------------------------------------------
    # 回滚 BACKFILL 阶段（如需要，清理迁移的数据）
    # --------------------------------------------------
    # ⚠️  注意：数据回滚可能导致数据丢失，需要谨慎评估
    #
    # connection = op.get_bind()
    # connection.execute(text("UPDATE users SET email = NULL WHERE email IS NOT NULL"))
    # print("✓ Cleared migrated email data")


# ==============================================================
# 验证脚本（提交前本地执行）
# ==============================================================
# 请在测试数据库中执行以下验证：
#
# 1. 首次执行：
#    alembic upgrade head
#    验证：表/列/索引已创建，数据已迁移
#
# 2. 重复执行：
#    alembic upgrade head
#    验证：无报错，输出"已存在，跳过"提示
#
# 3. 回滚+重新执行：
#    alembic downgrade -1
#    alembic upgrade head
#    验证：最终状态与第一次执行相同
#
# ✅ 确认所有 3 次验证通过后，才可以提交！


# ==============================================================
# 相关文档更新清单
# ==============================================================
# 提交本迁移脚本时，请同步更新以下文档：
#
# [ ] /docs/data/ERD.mmd                - 更新实体关系图
# [ ] /docs/data/dictionary.md          - 更新数据字典
# [ ] /docs/ARCHITECTURE.md             - 更新数据视图（如有设计变更）
# [ ] /CHANGELOG.md                     - 添加迁移条目
# [ ] /docs/adr/NNN-*.md                - 补充架构决策（如有）
#
# 详见：/AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md §6
