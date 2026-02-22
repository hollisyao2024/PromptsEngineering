#!/bin/bash

# ============================================================
# 通用数据库迁移文件生成脚本
# 用途: 创建符合命名规范、可适配多种数据库（PostgreSQL / MySQL / Oracle / SQLite 等）的迁移文件
# 用法: ./infra/scripts/tdd-tools/create-migration.sh <description> [--dir 路径] [--dialect postgres|mysql|oracle|sqlite|generic]
# 示例: ./infra/scripts/tdd-tools/create-migration.sh add_user_roles --dir packages/database/prisma/migrations --dialect postgres
# ============================================================

set -euo pipefail

TARGET_DIR="packages/database/prisma/migrations"
DIALECT="generic"
DESCRIPTION=""

usage() {
  cat <<'EOF'
用法:
  ./infra/scripts/tdd-tools/create-migration.sh <description> [--dir 路径] [--dialect postgres|mysql|oracle|sqlite|generic]

参数:
  <description>           迁移描述（小写字母/数字/下划线）
  --dir <路径>            输出目录（默认: packages/database/prisma/migrations）
  --dialect <方言>        数据库方言标签，用于模板注释（默认: generic）
  -h, --help              展示帮助

示例:
  ./infra/scripts/tdd-tools/create-migration.sh add_user_roles
  ./infra/scripts/tdd-tools/create-migration.sh add_billing_tables --dir infra/migrations --dialect mysql
  ./infra/scripts/tdd-tools/create-migration.sh shard_user_data --dialect oracle
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir)
      [[ -n "${2:-}" ]] || { echo "❌ 缺少 --dir 参数值"; usage; exit 1; }
      TARGET_DIR="$2"
      shift 2
      ;;
    --dialect)
      [[ -n "${2:-}" ]] || { echo "❌ 缺少 --dialect 参数值"; usage; exit 1; }
      DIALECT="${2,,}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "❌ 未知参数: $1"
      usage
      exit 1
      ;;
    *)
      if [[ -z "$DESCRIPTION" ]]; then
        DESCRIPTION="$1"
        shift
      else
        echo "❌ 多余的位置参数: $1"
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$DESCRIPTION" ]]; then
  echo "❌ 缺少迁移描述"
  usage
  exit 1
fi

if ! [[ "$DESCRIPTION" =~ ^[a-z0-9_]+$ ]]; then
  echo "❌ 描述格式不正确"
  echo "描述必须只包含小写字母、数字和下划线"
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d%H%M%S)
READABLE_DATE=$(date +%Y-%m-%d)
FILENAME="${TIMESTAMP}_${DESCRIPTION}.sql"
FILEPATH="${TARGET_DIR%/}/${FILENAME}"

if [[ -f "$FILEPATH" ]]; then
  echo "❌ 文件已存在: ${FILEPATH}"
  exit 1
fi

mkdir -p "${TARGET_DIR%/}"

cat > "$FILEPATH" << EOF
-- ============================================================
-- ${DESCRIPTION}
-- 日期: ${READABLE_DATE}
-- 数据库方言: ${DIALECT}
-- 目标: [描述此迁移的目的]
-- 幂等性提示:
--   1) 使用 IF EXISTS / IF NOT EXISTS / CREATE OR REPLACE 等条件语句
--   2) 数据变更前执行状态检查，避免重复写入
--   3) 始终遵循 Expand → Migrate/Backfill → Contract 流程
-- ============================================================

BEGIN;

-- ============================================================
-- 在此处添加 SQL 语句
-- 根据所选方言保留相应示例, 删除无关片段
-- ============================================================

-- PostgreSQL 示例:
-- DO \$\$ BEGIN
--   IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'example_table') THEN
--     CREATE TABLE example_table (
--       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
--     );
--   END IF;
-- END \$\$;

-- MySQL 示例:
-- CREATE TABLE IF NOT EXISTS example_table (
--   id CHAR(36) PRIMARY KEY,
--   created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
-- ) ENGINE=InnoDB;

-- Oracle 示例:
-- BEGIN
--   EXECUTE IMMEDIATE 'CREATE TABLE example_table (id VARCHAR2(36) PRIMARY KEY, created_at TIMESTAMP DEFAULT SYSTIMESTAMP)';
-- EXCEPTION
--   WHEN OTHERS THEN
--     IF SQLCODE != -955 THEN RAISE; END IF; -- ORA-00955 = already exists
-- END;

COMMIT;

-- ============================================================
-- 回滚 / Contract 阶段提示
-- ============================================================
-- 在此记录回滚步骤（DROP TABLE / 回滚数据 / 关闭功能开关等）
-- 请确保回滚脚本也具备幂等性

EOF

echo ""
echo "✅ 迁移文件创建成功！"
echo "📄 文件路径: ${FILEPATH}"
echo "📅 时间戳: ${TIMESTAMP}"
echo "📝 描述: ${DESCRIPTION}"
echo "🗃 目录: ${TARGET_DIR%/}"
echo "🧩 方言标签: ${DIALECT}"
echo ""
echo "下一步:"
echo "  1. 编辑文件内容并填写具体 SQL"
echo "  2. 按照 Expand → Migrate/Backfill → Contract 完成实现"
echo "  3. 根据仓库规范执行多次幂等性验证"
echo ""
