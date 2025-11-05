-- 03-safe-constraint-add.sql
-- 示例：安全地添加约束（幂等）
--
-- 场景：为现有表添加唯一约束、外键约束、检查约束
-- 要求：可以安全地重复执行，处理数据冲突

-- ============================================================
-- 方案 1：添加唯一约束（幂等）
-- ============================================================

-- 步骤 1：检查并清理重复数据
DO $$
BEGIN
    -- 检查是否存在重复的 email
    IF EXISTS (
        SELECT email
        FROM users
        WHERE email IS NOT NULL
        GROUP BY email
        HAVING COUNT(*) > 1
    ) THEN
        RAISE NOTICE 'Found duplicate emails, cleaning up...';

        -- 保留每个 email 的最早记录，删除其他重复项
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
        );
    END IF;
END $$;

-- 步骤 2：添加唯一约束（幂等）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'users_email_unique'
          AND table_name = 'users'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE(email);
        RAISE NOTICE 'Added constraint users_email_unique';
    ELSE
        RAISE NOTICE 'Constraint users_email_unique already exists, skipping...';
    END IF;
END $$;

-- ============================================================
-- 方案 2：添加外键约束（幂等）
-- ============================================================

-- 步骤 1：检查并清理孤儿数据（外键不存在的数据）
DO $$
BEGIN
    -- 检查是否存在孤儿订单（user_id 不存在于 users 表）
    IF EXISTS (
        SELECT 1
        FROM orders o
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id)
    ) THEN
        RAISE WARNING 'Found orphan orders, marking for review...';

        -- 选项 1：删除孤儿数据
        -- DELETE FROM orders WHERE user_id NOT IN (SELECT id FROM users);

        -- 选项 2：设置为特殊值（推荐，保留数据用于审计）
        UPDATE orders
        SET user_id = 0, notes = CONCAT(notes, ' [ORPHAN ORDER - user deleted]')
        WHERE NOT EXISTS (SELECT 1 FROM users WHERE id = orders.user_id);
    END IF;
END $$;

-- 步骤 2：添加外键约束（幂等）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'orders_user_id_fkey'
          AND table_name = 'orders'
    ) THEN
        ALTER TABLE orders
        ADD CONSTRAINT orders_user_id_fkey
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE;  -- 或 ON DELETE SET NULL / RESTRICT

        RAISE NOTICE 'Added foreign key constraint orders_user_id_fkey';
    ELSE
        RAISE NOTICE 'Foreign key constraint orders_user_id_fkey already exists, skipping...';
    END IF;
END $$;

-- ============================================================
-- 方案 3：添加检查约束（幂等）
-- ============================================================

-- 步骤 1：修复不符合约束的数据
UPDATE users
SET age = 0
WHERE age IS NOT NULL AND age < 0;

-- 步骤 2：添加检查约束（幂等）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'users_age_positive'
          AND table_name = 'users'
    ) THEN
        ALTER TABLE users
        ADD CONSTRAINT users_age_positive CHECK (age >= 0);

        RAISE NOTICE 'Added check constraint users_age_positive';
    ELSE
        RAISE NOTICE 'Check constraint users_age_positive already exists, skipping...';
    END IF;
END $$;

-- ============================================================
-- 方案 4：添加 NOT NULL 约束（幂等）
-- ============================================================

-- 步骤 1：填充 NULL 值
UPDATE users
SET email = CONCAT('user', id, '@example.com')
WHERE email IS NULL;

-- 步骤 2：添加 NOT NULL 约束（幂等）
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'email'
          AND is_nullable = 'YES'
    ) THEN
        ALTER TABLE users ALTER COLUMN email SET NOT NULL;
        RAISE NOTICE 'Set email column to NOT NULL';
    ELSE
        RAISE NOTICE 'Column email is already NOT NULL, skipping...';
    END IF;
END $$;

-- ============================================================
-- 方案 5：添加复合唯一约束（幂等）
-- ============================================================

-- 步骤 1：检查并清理重复数据
WITH duplicates AS (
    SELECT user_id, product_id, MIN(id) AS keep_id
    FROM cart_items
    GROUP BY user_id, product_id
    HAVING COUNT(*) > 1
)
DELETE FROM cart_items
WHERE (user_id, product_id) IN (
    SELECT user_id, product_id FROM duplicates
) AND id NOT IN (
    SELECT keep_id FROM duplicates
);

-- 步骤 2：添加复合唯一约束（幂等）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.table_constraints
        WHERE constraint_name = 'cart_items_user_product_unique'
          AND table_name = 'cart_items'
    ) THEN
        ALTER TABLE cart_items
        ADD CONSTRAINT cart_items_user_product_unique UNIQUE(user_id, product_id);

        RAISE NOTICE 'Added composite unique constraint cart_items_user_product_unique';
    ELSE
        RAISE NOTICE 'Composite unique constraint already exists, skipping...';
    END IF;
END $$;

-- ============================================================
-- 方案 6：添加部分唯一索引（PostgreSQL）
-- ============================================================

-- 场景：email 可以为 NULL，但非 NULL 值必须唯一
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx
ON users(email)
WHERE email IS NOT NULL;

-- ============================================================
-- 验证脚本
-- ============================================================

-- 查看所有约束
SELECT
    tc.constraint_name,
    tc.constraint_type,
    tc.table_name,
    kcu.column_name
FROM information_schema.table_constraints tc
LEFT JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
WHERE tc.table_name IN ('users', 'orders', 'cart_items')
ORDER BY tc.table_name, tc.constraint_type, tc.constraint_name;

-- 验证唯一约束（不应有重复）
SELECT email, COUNT(*) AS duplicate_count
FROM users
WHERE email IS NOT NULL
GROUP BY email
HAVING COUNT(*) > 1;

-- 验证外键约束（不应有孤儿数据）
SELECT COUNT(*) AS orphan_orders
FROM orders o
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id);

-- 验证检查约束（不应有负数年龄）
SELECT COUNT(*) AS invalid_age_count
FROM users
WHERE age IS NOT NULL AND age < 0;

-- ============================================================
-- ROLLBACK 脚本
-- ============================================================

-- 删除约束（幂等）
DO $$
BEGIN
    -- 删除唯一约束
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'users_email_unique'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_email_unique;
    END IF;

    -- 删除外键约束
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'orders_user_id_fkey'
    ) THEN
        ALTER TABLE orders DROP CONSTRAINT orders_user_id_fkey;
    END IF;

    -- 删除检查约束
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'users_age_positive'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_age_positive;
    END IF;

    -- 删除 NOT NULL 约束
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'email'
          AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
    END IF;

    -- 删除部分唯一索引
    DROP INDEX IF EXISTS users_email_unique_idx;
END $$;

-- ============================================================
-- 常见陷阱与解决方案
-- ============================================================

-- ❌ 错误：直接添加约束，不检查重复数据
-- ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE(email);
-- 问题：如果存在重复数据，会报错失败

-- ✅ 正确：先清理重复数据，再添加约束
-- 1. 检查重复数据
-- 2. 清理或合并重复数据
-- 3. 添加约束

-- ❌ 错误：直接添加外键，不处理孤儿数据
-- ALTER TABLE orders ADD FOREIGN KEY (user_id) REFERENCES users(id);
-- 问题：如果存在孤儿订单，会报错失败

-- ✅ 正确：先处理孤儿数据，再添加外键
-- 1. 查找孤儿数据
-- 2. 删除或标记孤儿数据
-- 3. 添加外键约束

-- ============================================================
-- 重复执行验证
-- ============================================================
-- 1. 首次执行本脚本 → 清理数据，添加所有约束
-- 2. 重复执行本脚本 → 输出"已存在，跳过"提示
-- 3. 执行 ROLLBACK 脚本 → 删除所有约束
-- 4. 再次执行本脚本 → 重新添加约束（结果与第1次相同）
