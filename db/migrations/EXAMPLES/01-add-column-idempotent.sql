-- 01-add-column-idempotent.sql
-- 示例：安全地为现有表添加新列（幂等）
--
-- 场景：需要为 users 表添加 email 和 phone_number 列
-- 要求：可以安全地重复执行，不会报错或产生副作用

-- ============================================================
-- EXPAND 阶段：添加新列
-- ============================================================

-- 方案 1：使用 IF NOT EXISTS（PostgreSQL 9.6+）
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE;

-- 方案 2：使用 DO 块处理复杂情况（如需要默认值或约束）
DO $$
BEGIN
    -- 检查列是否已存在
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'created_at'
    ) THEN
        -- 添加列，并设置默认值
        ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    END IF;
END $$;

-- 方案 3：添加 NOT NULL 列（需要先提供默认值）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'users'
          AND column_name = 'user_type'
    ) THEN
        -- 先添加列，允许 NULL
        ALTER TABLE users ADD COLUMN user_type VARCHAR(50);
        -- 填充默认值
        UPDATE users SET user_type = 'regular' WHERE user_type IS NULL;
        -- 再设置 NOT NULL 约束
        ALTER TABLE users ALTER COLUMN user_type SET NOT NULL;
    END IF;
END $$;

-- ============================================================
-- 验证脚本
-- ============================================================

-- 查看新添加的列
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'users'
  AND column_name IN ('email', 'phone_number', 'is_verified', 'created_at', 'user_type')
ORDER BY ordinal_position;

-- 验证数据行数未变化
SELECT COUNT(*) AS user_count FROM users;

-- ============================================================
-- ROLLBACK 脚本
-- ============================================================

-- 删除添加的列（幂等）
ALTER TABLE users DROP COLUMN IF EXISTS email;
ALTER TABLE users DROP COLUMN IF EXISTS phone_number;
ALTER TABLE users DROP COLUMN IF EXISTS is_verified;
ALTER TABLE users DROP COLUMN IF EXISTS created_at;
ALTER TABLE users DROP COLUMN IF EXISTS user_type;

-- ============================================================
-- 重复执行验证
-- ============================================================
-- 1. 首次执行本脚本 → 应成功添加列
-- 2. 重复执行本脚本 → 应输出 "skipping (column already exists)" 提示
-- 3. 执行 ROLLBACK 脚本 → 删除所有新列
-- 4. 再次执行本脚本 → 应成功添加列（结果与第1次相同）
