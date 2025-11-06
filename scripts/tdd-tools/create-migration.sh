#!/bin/bash

# ============================================================
# 数据库迁移文件生成脚本
# 用途: 创建符合命名规范的 Supabase 迁移文件
# 用法: ./scripts/create-migration.sh <description>
# 示例: ./scripts/create-migration.sh add_user_roles
# ============================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查是否提供了描述
if [ -z "$1" ]; then
  echo -e "${RED}❌ 错误: 缺少迁移描述${NC}"
  echo ""
  echo "用法: ./scripts/create-migration.sh <description>"
  echo ""
  echo "示例:"
  echo "  ./scripts/create-migration.sh add_user_roles"
  echo "  ./scripts/create-migration.sh fix_subscription_functions"
  echo "  ./scripts/create-migration.sh create_audit_logs_table"
  echo ""
  exit 1
fi

# 验证描述格式（只允许小写字母、数字和下划线）
DESCRIPTION=$1
if ! [[ "$DESCRIPTION" =~ ^[a-z0-9_]+$ ]]; then
  echo -e "${RED}❌ 错误: 描述格式不正确${NC}"
  echo ""
  echo "描述必须:"
  echo "  - 只包含小写字母、数字和下划线"
  echo "  - 使用下划线分隔单词"
  echo "  - 使用英文"
  echo ""
  echo "示例:"
  echo "  ✅ add_user_roles"
  echo "  ✅ fix_subscription_functions"
  echo "  ❌ AddUserRoles (不要使用驼峰命名)"
  echo "  ❌ add-user-roles (不要使用连字符)"
  echo ""
  exit 1
fi

# 生成时间戳 (格式: YYYYMMDDHHmmss)
TIMESTAMP=$(date +%Y%m%d%H%M%S)
READABLE_DATE=$(date +%Y-%m-%d)
FILENAME="${TIMESTAMP}_${DESCRIPTION}.sql"
FILEPATH="supabase/migrations/${FILENAME}"

# 检查文件是否已存在
if [ -f "$FILEPATH" ]; then
  echo -e "${RED}❌ 错误: 文件已存在: ${FILEPATH}${NC}"
  exit 1
fi

# 确保目录存在
mkdir -p "supabase/migrations"

# 创建文件并添加模板
cat > "$FILEPATH" << EOF
-- ============================================================
-- ${DESCRIPTION}
-- 日期: ${READABLE_DATE}
-- 目标: [请描述此迁移的目的]
-- ============================================================

BEGIN;

-- ============================================================
-- 在此处添加 SQL 语句
-- ============================================================

-- 示例:
-- CREATE TABLE IF NOT EXISTS example_table (
--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--   created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('UTC', NOW())
-- );

COMMIT;

-- ============================================================
-- 回滚提示
-- ============================================================
-- 如需回滚此迁移，请执行以下操作:
-- [描述如何安全回滚此迁移]
--
-- 示例:
-- DROP TABLE IF EXISTS example_table;
EOF

echo ""
echo -e "${GREEN}✅ 迁移文件创建成功!${NC}"
echo ""
echo "📄 文件路径: ${FILEPATH}"
echo "📅 时间戳: ${TIMESTAMP}"
echo "📝 描述: ${DESCRIPTION}"
echo ""
echo -e "${YELLOW}下一步:${NC}"
echo "  1. 编辑文件并添加 SQL 语句"
echo "  2. 填写迁移目标和回滚提示"
echo "  3. 测试迁移可以正确执行和回滚"
echo ""
