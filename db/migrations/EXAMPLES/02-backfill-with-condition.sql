-- 02-backfill-with-condition.sql
-- 示例：安全地进行数据填充和迁移（幂等）
--
-- 场景：将旧字段 legacy_email 的数据迁移到新字段 email
-- 要求：可以安全地重复执行，仅处理未迁移的数据

-- ============================================================
-- MIGRATE/BACKFILL 阶段：数据迁移
-- ============================================================

-- 方案 1：简单数据填充（幂等）
-- 仅更新 email 为 NULL 的行
UPDATE users
SET email = legacy_email
WHERE email IS NULL
  AND legacy_email IS NOT NULL;

-- 验证迁移结果
SELECT
    COUNT(*) AS total_users,
    COUNT(email) AS users_with_email,
    COUNT(legacy_email) AS users_with_legacy_email,
    COUNT(*) - COUNT(email) AS not_migrated_count
FROM users;

-- ============================================================
-- 方案 2：分批处理大表（幂等）
-- ============================================================
-- 适用于大表（>100万行），避免长时间锁表

DO $$
DECLARE
    batch_size INT := 1000;
    rows_affected INT;
    total_migrated INT := 0;
BEGIN
    LOOP
        -- 每次处理 1000 行
        UPDATE users
        SET email = legacy_email
        WHERE id IN (
            SELECT id
            FROM users
            WHERE email IS NULL
              AND legacy_email IS NOT NULL
            LIMIT batch_size
        );

        -- 获取受影响的行数
        GET DIAGNOSTICS rows_affected = ROW_COUNT;

        -- 如果没有更多行需要迁移，退出循环
        EXIT WHEN rows_affected = 0;

        total_migrated := total_migrated + rows_affected;
        RAISE NOTICE 'Migrated % rows (total: %)', rows_affected, total_migrated;

        -- 提交当前批次（在事务外部使用）
        -- COMMIT;
    END LOOP;

    RAISE NOTICE 'Data migration completed: % total rows migrated', total_migrated;
END $$;

-- ============================================================
-- 方案 3：复杂数据转换（幂等）
-- ============================================================
-- 场景：需要对数据进行转换或计算

-- 示例：根据旧字段计算新字段
UPDATE users
SET
    full_name = CONCAT(first_name, ' ', last_name),
    display_name = COALESCE(nickname, first_name)
WHERE full_name IS NULL;

-- 示例：根据条件映射枚举值
UPDATE orders
SET status_new = CASE
    WHEN status_old = 'completed' THEN 'delivered'
    WHEN status_old = 'pending' THEN 'processing'
    WHEN status_old = 'cancelled' THEN 'cancelled'
    ELSE 'pending'
END
WHERE status_new IS NULL;

-- ============================================================
-- 方案 4：跨表数据迁移（幂等）
-- ============================================================
-- 场景：从旧表迁移数据到新表

-- 使用 INSERT ... SELECT 和 NOT IN/NOT EXISTS 确保幂等
INSERT INTO orders_new (order_number, user_id, status, created_at)
SELECT
    order_number,
    user_id,
    status,
    created_at
FROM orders_old
WHERE order_number NOT IN (
    SELECT order_number FROM orders_new
)
LIMIT 1000;

-- 更安全的方式：使用 NOT EXISTS
INSERT INTO orders_new (order_number, user_id, status, created_at)
SELECT
    o.order_number,
    o.user_id,
    o.status,
    o.created_at
FROM orders_old o
WHERE NOT EXISTS (
    SELECT 1
    FROM orders_new n
    WHERE n.order_number = o.order_number
)
LIMIT 1000;

-- ============================================================
-- 方案 5：使用临时表进行复杂迁移（幂等）
-- ============================================================

-- 创建临时表（幂等）
CREATE TEMP TABLE IF NOT EXISTS migration_progress (
    user_id INT PRIMARY KEY,
    migrated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 标记已迁移的用户
INSERT INTO migration_progress (user_id)
SELECT id
FROM users
WHERE email IS NOT NULL
ON CONFLICT (user_id) DO NOTHING;  -- 幂等性关键

-- 仅迁移未在 migration_progress 中的用户
UPDATE users u
SET email = u.legacy_email
WHERE u.email IS NULL
  AND u.legacy_email IS NOT NULL
  AND u.id NOT IN (SELECT user_id FROM migration_progress);

-- ============================================================
-- 验证脚本
-- ============================================================

-- 检查迁移完整性
SELECT
    COUNT(*) AS total_rows,
    COUNT(email) AS migrated_rows,
    COUNT(*) - COUNT(email) AS remaining_rows,
    ROUND(100.0 * COUNT(email) / COUNT(*), 2) AS migration_percentage
FROM users;

-- 检查数据一致性（email 应该与 legacy_email 相同）
SELECT COUNT(*) AS inconsistent_rows
FROM users
WHERE email IS NOT NULL
  AND legacy_email IS NOT NULL
  AND email != legacy_email;

-- 检查空值情况
SELECT
    SUM(CASE WHEN email IS NULL AND legacy_email IS NOT NULL THEN 1 ELSE 0 END) AS need_migration,
    SUM(CASE WHEN email IS NULL AND legacy_email IS NULL THEN 1 ELSE 0 END) AS both_null,
    SUM(CASE WHEN email IS NOT NULL THEN 1 ELSE 0 END) AS already_migrated
FROM users;

-- ============================================================
-- 常见陷阱与解决方案
-- ============================================================

-- ❌ 错误示例：无条件更新（非幂等）
-- UPDATE users SET email = legacy_email;
-- 问题：重复执行会覆盖手动修改的 email

-- ✅ 正确示例：使用 WHERE 条件（幂等）
-- UPDATE users SET email = legacy_email WHERE email IS NULL;
-- 优点：仅处理未迁移的数据，重复执行安全

-- ❌ 错误示例：大表一次性更新（性能问题）
-- UPDATE large_table SET ... WHERE ...;
-- 问题：可能导致长时间锁表，影响生产

-- ✅ 正确示例：分批处理（幂等 + 高性能）
-- 使用上面的 DO $$ ... LOOP 方案

-- ============================================================
-- 重复执行验证
-- ============================================================
-- 1. 首次执行本脚本 → 迁移所有符合条件的数据
-- 2. 重复执行本脚本 → rows_affected = 0（无数据需要迁移）
-- 3. 手动修改一些行的 email 为 NULL
-- 4. 再次执行本脚本 → 仅迁移刚才设置为 NULL 的行
