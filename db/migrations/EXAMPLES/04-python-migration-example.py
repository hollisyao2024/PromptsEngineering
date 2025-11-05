"""
04-python-migration-example.py
示例：使用 Alembic 进行幂等性数据库迁移（完整示例）

场景：为 users 表添加 email 列，迁移旧数据，并添加唯一约束
要求：可以安全地重复执行，处理各种边界情况

执行方式：
    alembic upgrade head      # 执行 upgrade
    alembic downgrade -1      # 执行 downgrade
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError


# ============================================================
# 辅助函数：检查列/表/约束是否存在
# ============================================================

def column_exists(table_name, column_name):
    """检查列是否存在（幂等性辅助函数）"""
    connection = op.get_bind()
    inspector = inspect(connection)
    columns = [c['name'] for c in inspector.get_columns(table_name)]
    return column_name in columns


def table_exists(table_name):
    """检查表是否存在（幂等性辅助函数）"""
    connection = op.get_bind()
    inspector = inspect(connection)
    return table_name in inspector.get_table_names()


def constraint_exists(table_name, constraint_name):
    """检查约束是否存在（幂等性辅助函数）"""
    connection = op.get_bind()
    inspector = inspect(connection)

    # 检查唯一约束
    unique_constraints = [c['name'] for c in inspector.get_unique_constraints(table_name)]
    if constraint_name in unique_constraints:
        return True

    # 检查外键约束
    foreign_keys = [fk['name'] for fk in inspector.get_foreign_keys(table_name)]
    if constraint_name in foreign_keys:
        return True

    # 检查主键约束
    pk = inspector.get_pk_constraint(table_name)
    if pk and pk.get('name') == constraint_name:
        return True

    return False


def index_exists(table_name, index_name):
    """检查索引是否存在（幂等性辅助函数）"""
    connection = op.get_bind()
    inspector = inspect(connection)
    indexes = [idx['name'] for idx in inspector.get_indexes(table_name)]
    return index_name in indexes


# ============================================================
# EXPAND 阶段：添加新表/列/索引
# ============================================================

def upgrade():
    """
    EXPAND 阶段：添加新表/列/索引，不删除任何内容

    ✅ 幂等性要求：检查列/表是否已存在再添加
    """

    # --------------------------------------------------
    # 示例 1：创建新表（幂等）
    # --------------------------------------------------
    if not table_exists('user_profiles'):
        op.create_table(
            'user_profiles',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('bio', sa.Text()),
            sa.Column('avatar_url', sa.String(500)),
            sa.Column('created_at', sa.DateTime(), server_default=sa.func.now()),
            sa.Column('updated_at', sa.DateTime(), onupdate=sa.func.now())
        )
        print("✓ Created table 'user_profiles'")
    else:
        print("⊘ Table 'user_profiles' already exists, skipping...")

    # --------------------------------------------------
    # 示例 2：添加新列（幂等）
    # --------------------------------------------------
    if not column_exists('users', 'email'):
        op.add_column('users', sa.Column('email', sa.String(255)))
        print("✓ Added column 'users.email'")
    else:
        print("⊘ Column 'users.email' already exists, skipping...")

    if not column_exists('users', 'phone_number'):
        op.add_column('users', sa.Column('phone_number', sa.String(20)))
        print("✓ Added column 'users.phone_number'")
    else:
        print("⊘ Column 'users.phone_number' already exists, skipping...")

    if not column_exists('users', 'is_verified'):
        op.add_column('users', sa.Column('is_verified', sa.Boolean(), server_default='false'))
        print("✓ Added column 'users.is_verified'")
    else:
        print("⊘ Column 'users.is_verified' already exists, skipping...")

    # --------------------------------------------------
    # 示例 3：创建索引（幂等）
    # --------------------------------------------------
    if not index_exists('users', 'idx_users_email'):
        op.create_index('idx_users_email', 'users', ['email'])
        print("✓ Created index 'idx_users_email'")
    else:
        print("⊘ Index 'idx_users_email' already exists, skipping...")

    if not index_exists('user_profiles', 'idx_user_profiles_user_id'):
        op.create_index('idx_user_profiles_user_id', 'user_profiles', ['user_id'])
        print("✓ Created index 'idx_user_profiles_user_id'")
    else:
        print("⊘ Index 'idx_user_profiles_user_id' already exists, skipping...")

    # --------------------------------------------------
    # 示例 4：添加唯一约束前清理重复数据（幂等）
    # --------------------------------------------------
    connection = op.get_bind()

    # 检查是否存在重复的 email
    result = connection.execute(text("""
        SELECT email, COUNT(*) as duplicate_count
        FROM users
        WHERE email IS NOT NULL
        GROUP BY email
        HAVING COUNT(*) > 1
    """))

    duplicates = result.fetchall()
    if duplicates:
        print(f"⚠️  Found {len(duplicates)} duplicate emails, cleaning up...")

        # 保留每个 email 的最早记录，删除其他重复项
        connection.execute(text("""
            DELETE FROM users
            WHERE id NOT IN (
                SELECT MIN(id)
                FROM users
                WHERE email IS NOT NULL
                GROUP BY email
            ) AND email IN (
                SELECT email
                FROM users
                WHERE email IS NOT NULL
                GROUP BY email
                HAVING COUNT(*) > 1
            )
        """))
        print("✓ Cleaned up duplicate emails")
    else:
        print("⊘ No duplicate emails found")

    # --------------------------------------------------
    # 示例 5：添加唯一约束（幂等）
    # --------------------------------------------------
    if not constraint_exists('users', 'users_email_unique'):
        op.create_unique_constraint('users_email_unique', 'users', ['email'])
        print("✓ Created constraint 'users_email_unique'")
    else:
        print("⊘ Constraint 'users_email_unique' already exists, skipping...")

    # --------------------------------------------------
    # 示例 6：添加外键约束（幂等）
    # --------------------------------------------------
    # 先清理孤儿数据
    result = connection.execute(text("""
        SELECT COUNT(*) as orphan_count
        FROM user_profiles up
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = up.user_id)
    """))

    orphan_count = result.scalar()
    if orphan_count > 0:
        print(f"⚠️  Found {orphan_count} orphan profiles, cleaning up...")
        connection.execute(text("""
            DELETE FROM user_profiles
            WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = user_profiles.user_id)
        """))
        print("✓ Cleaned up orphan profiles")

    # 添加外键
    if not constraint_exists('user_profiles', 'user_profiles_user_id_fkey'):
        op.create_foreign_key(
            'user_profiles_user_id_fkey',
            'user_profiles', 'users',
            ['user_id'], ['id'],
            ondelete='CASCADE'
        )
        print("✓ Created foreign key 'user_profiles_user_id_fkey'")
    else:
        print("⊘ Foreign key 'user_profiles_user_id_fkey' already exists, skipping...")


# ============================================================
# MIGRATE/BACKFILL 阶段：数据迁移
# ============================================================

def data_migrate():
    """
    MIGRATE/BACKFILL 阶段：数据迁移与填充

    ✅ 幂等性要求：
       - 使用 WHERE 条件仅处理未迁移的数据
       - 分批处理，避免长时间锁表
       - 可以安全地重复执行
    """
    connection = op.get_bind()
    session = Session(bind=connection)

    # --------------------------------------------------
    # 示例 1：简单数据填充（幂等）
    # --------------------------------------------------
    print("\n=== Data Migration Started ===")

    # 统计需要迁移的数据
    result = connection.execute(text("""
        SELECT COUNT(*) as need_migration
        FROM users
        WHERE email IS NULL AND legacy_email IS NOT NULL
    """))
    need_migration = result.scalar()
    print(f"📊 Found {need_migration} rows need migration")

    if need_migration == 0:
        print("⊘ No data needs migration, skipping...")
        return

    # --------------------------------------------------
    # 示例 2：分批处理大表（幂等）
    # --------------------------------------------------
    batch_size = 1000
    total_migrated = 0

    while True:
        # 使用子查询+LIMIT 分批处理
        result = connection.execute(text("""
            UPDATE users
            SET email = legacy_email
            WHERE id IN (
                SELECT id
                FROM users
                WHERE email IS NULL
                  AND legacy_email IS NOT NULL
                LIMIT :batch_size
            )
        """), {"batch_size": batch_size})

        rows_affected = result.rowcount
        if rows_affected == 0:
            break  # 所有数据已迁移

        total_migrated += rows_affected
        session.commit()
        print(f"  ✓ Migrated {rows_affected} rows (total: {total_migrated})...")

    print(f"\n✅ Data migration completed: {total_migrated} rows migrated")

    # --------------------------------------------------
    # 示例 3：复杂数据转换（幂等）
    # --------------------------------------------------
    # 生成用户简介（如果不存在）
    result = connection.execute(text("""
        INSERT INTO user_profiles (user_id, bio, created_at)
        SELECT
            u.id,
            CONCAT('User since ', TO_CHAR(u.created_at, 'YYYY')),
            NOW()
        FROM users u
        WHERE NOT EXISTS (
            SELECT 1 FROM user_profiles up WHERE up.user_id = u.id
        )
    """))

    profiles_created = result.rowcount
    session.commit()
    print(f"✓ Created {profiles_created} user profiles")

    # --------------------------------------------------
    # 验证迁移结果
    # --------------------------------------------------
    result = connection.execute(text("""
        SELECT
            COUNT(*) as total_users,
            COUNT(email) as users_with_email,
            COUNT(*) - COUNT(email) as not_migrated
        FROM users
    """))

    stats = result.fetchone()
    print(f"\n📊 Migration Statistics:")
    print(f"   Total users: {stats.total_users}")
    print(f"   Users with email: {stats.users_with_email}")
    print(f"   Not migrated: {stats.not_migrated}")


# ============================================================
# ROLLBACK 阶段：回滚脚本
# ============================================================

def downgrade():
    """
    ROLLBACK 阶段：回滚脚本（完全逆转 upgrade）

    ✅ 幂等性要求：回滚脚本本身也应该幂等
    """

    # --------------------------------------------------
    # 删除外键约束（幂等）
    # --------------------------------------------------
    if constraint_exists('user_profiles', 'user_profiles_user_id_fkey'):
        op.drop_constraint('user_profiles_user_id_fkey', 'user_profiles', type_='foreignkey')
        print("✓ Dropped foreign key 'user_profiles_user_id_fkey'")
    else:
        print("⊘ Foreign key 'user_profiles_user_id_fkey' does not exist, skipping...")

    # --------------------------------------------------
    # 删除唯一约束（幂等）
    # --------------------------------------------------
    if constraint_exists('users', 'users_email_unique'):
        op.drop_constraint('users_email_unique', 'users', type_='unique')
        print("✓ Dropped constraint 'users_email_unique'")
    else:
        print("⊘ Constraint 'users_email_unique' does not exist, skipping...")

    # --------------------------------------------------
    # 删除索引（幂等）
    # --------------------------------------------------
    if index_exists('user_profiles', 'idx_user_profiles_user_id'):
        op.drop_index('idx_user_profiles_user_id', 'user_profiles')
        print("✓ Dropped index 'idx_user_profiles_user_id'")
    else:
        print("⊘ Index 'idx_user_profiles_user_id' does not exist, skipping...")

    if index_exists('users', 'idx_users_email'):
        op.drop_index('idx_users_email', 'users')
        print("✓ Dropped index 'idx_users_email'")
    else:
        print("⊘ Index 'idx_users_email' does not exist, skipping...")

    # --------------------------------------------------
    # 删除列（幂等）
    # --------------------------------------------------
    if column_exists('users', 'is_verified'):
        op.drop_column('users', 'is_verified')
        print("✓ Dropped column 'users.is_verified'")
    else:
        print("⊘ Column 'users.is_verified' does not exist, skipping...")

    if column_exists('users', 'phone_number'):
        op.drop_column('users', 'phone_number')
        print("✓ Dropped column 'users.phone_number'")
    else:
        print("⊘ Column 'users.phone_number' does not exist, skipping...")

    if column_exists('users', 'email'):
        op.drop_column('users', 'email')
        print("✓ Dropped column 'users.email'")
    else:
        print("⊘ Column 'users.email' does not exist, skipping...")

    # --------------------------------------------------
    # 删除表（幂等）
    # --------------------------------------------------
    if table_exists('user_profiles'):
        op.drop_table('user_profiles')
        print("✓ Dropped table 'user_profiles'")
    else:
        print("⊘ Table 'user_profiles' does not exist, skipping...")


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
