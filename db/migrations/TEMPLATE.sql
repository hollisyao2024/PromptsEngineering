-- TEMPLATE.sql
-- Zero-downtime friendly migration scaffold (Expand → Migrate/Backfill → Contract)
--
-- ⚠️  幂等性要求：本脚本必须可以安全地重复执行！
--     - 所有 DDL 操作使用条件判断（IF NOT EXISTS / IF EXISTS）
--     - 数据迁移使用 WHERE 条件过滤已处理的数据
--     - 提交前必须在本地执行 3 次验证（首次、重复、回滚+重新执行）
--
-- 📝 命名规范：YYYYMMDD_HHMMSS_description.sql
-- 📖 详细指南：/AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md §2.1

-- ============================================================
-- 1) EXPAND 阶段：添加新表/列/索引，不删除任何内容
-- ============================================================
-- 目的：使新旧代码可以同时运行（向后兼容）
--
-- ✅ 幂等性要求：使用 IF NOT EXISTS

-- 示例 1：创建新表（幂等）
CREATE TABLE IF NOT EXISTS orders (
    id SERIAL PRIMARY KEY,
    order_number VARCHAR(255) UNIQUE NOT NULL,
    user_id INTEGER NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 示例 2：添加新列（幂等）
ALTER TABLE users
ADD COLUMN IF NOT EXISTS email VARCHAR(255);

ALTER TABLE users
ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);

-- 示例 3：创建索引（幂等）
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);

-- 示例 4：添加约束（PostgreSQL 使用 DO 块）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'users_email_unique'
          AND table_name = 'users'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_email_unique UNIQUE(email);
    END IF;
END $$;

-- 注意：此阶段完成后，旧代码和新代码都可以运行


-- ============================================================
-- 2) MIGRATE/BACKFILL 阶段：数据迁移与填充（后台作业）
-- ============================================================
-- 目的：将旧数据迁移到新字段/表中
--
-- ✅ 幂等性要求：
--    - 使用 WHERE 条件仅处理未迁移的数据
--    - 使用 LIMIT 分批处理，避免长时间锁表
--    - 可以安全地重复执行

-- 示例 1：数据填充（幂等）
-- 仅更新尚未迁移的行（email 为 NULL）
UPDATE users
SET email = legacy_email_field
WHERE email IS NULL
  AND legacy_email_field IS NOT NULL
LIMIT 1000;  -- 分批处理，生产环境建议 1000-5000

-- 示例 2：跨表数据迁移（幂等）
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
WHERE legacy_order_number NOT IN (SELECT order_number FROM orders)  -- 避免重复插入
LIMIT 1000;

-- 注意：大表迁移应使用后台作业/脚本（Python/Bash），而非在迁移脚本中直接执行


-- ============================================================
-- 3) CONTRACT 阶段：删除旧表/列/索引（谨慎！）
-- ============================================================
-- 目的：清理不再使用的旧字段/表
--
-- ⚠️  仅在确认所有代码都已迁移到新字段后执行！
-- ✅ 幂等性要求：使用 IF EXISTS

-- 示例 1：删除旧列（幂等）
ALTER TABLE users
DROP COLUMN IF EXISTS legacy_email_field;

ALTER TABLE users
DROP COLUMN IF EXISTS legacy_status;

-- 示例 2：删除旧索引（幂等）
DROP INDEX IF EXISTS idx_users_legacy_email;

-- 示例 3：删除旧表（幂等）
DROP TABLE IF EXISTS legacy_orders;

-- 注意：删除操作不可逆，确保有备份！


-- ============================================================
-- 4) ROLLBACK 阶段：回滚脚本（完全逆转）
-- ============================================================
-- 目的：在迁移失败或需要回退时执行
--
-- ✅ 幂等性要求：回滚脚本本身也应该幂等

-- 回滚 EXPAND 阶段（删除新增的表/列/索引）
DROP INDEX IF EXISTS idx_orders_user_id;
DROP INDEX IF EXISTS idx_users_email;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'users_email_unique'
    ) THEN
        ALTER TABLE users DROP CONSTRAINT users_email_unique;
    END IF;
END $$;

ALTER TABLE users DROP COLUMN IF EXISTS phone_number;
ALTER TABLE users DROP COLUMN IF EXISTS email;

DROP TABLE IF EXISTS orders;

-- 回滚 BACKFILL 阶段（如需要，清理迁移的数据）
-- 注意：数据回滚可能导致数据丢失，需要谨慎评估
-- UPDATE users SET email = NULL WHERE email IS NOT NULL;

-- 回滚 CONTRACT 阶段（恢复被删除的旧字段/表）
-- 注意：这需要从备份中恢复，或者预先保留旧表
-- ALTER TABLE users ADD COLUMN IF NOT EXISTS legacy_email_field VARCHAR(255);


-- ============================================================
-- 验证脚本（提交前本地执行）
-- ============================================================
-- 请在测试数据库中执行以下验证：
--
-- 1. 首次执行：
--    psql test_db -f db/migrations/YYYYMMDD_HHMMSS_description.sql
--    验证：表/列/索引已创建，数据已迁移
--
-- 2. 重复执行：
--    psql test_db -f db/migrations/YYYYMMDD_HHMMSS_description.sql
--    验证：无报错，或输出"已存在，跳过"提示
--
-- 3. 回滚+重新执行：
--    执行上面的 ROLLBACK 部分
--    再次执行完整迁移
--    验证：最终状态与第一次执行相同
--
-- ✅ 确认所有 3 次验证通过后，才可以提交！


-- ============================================================
-- 相关文档更新清单
-- ============================================================
-- 提交本迁移脚本时，请同步更新以下文档：
--
-- [ ] /docs/data/ERD.mmd                - 更新实体关系图
-- [ ] /docs/data/dictionary.md          - 更新数据字典
-- [ ] /docs/ARCHITECTURE.md             - 更新数据视图（如有设计变更）
-- [ ] /CHANGELOG.md                     - 添加迁移条目
-- [ ] /docs/adr/NNN-*.md                - 补充架构决策（如有）
--
-- 详见：/AgentRoles/Handbooks/TDD-PROGRAMMING-EXPERT.playbook.md §6
