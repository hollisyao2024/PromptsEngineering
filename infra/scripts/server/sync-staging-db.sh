#!/bin/bash
# ============================================
# 同步 Prisma Schema 到 Staging 数据库
# 非交互式自动化脚本
# ============================================
# 用法:
#   ./scripts/server/sync-staging-db.sh [options]
#
# 选项:
#   --dry-run     仅显示将要执行的操作，不实际执行
#   --skip-clean  跳过清理临时文件步骤
#   --verbose     显示详细输出
#
# 前提条件:
#   1. 已配置 SSH 免密登录到 staging 服务器
#   2. 服务器已安装 Node.js 和 npx
#   3. 服务器已安装 psql (可选，用于验证)
# ============================================

set -euo pipefail

# ============================================
# 配置变量
# ============================================
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
readonly FRONTEND_DIR="$PROJECT_ROOT/apps/web"
readonly PRISMA_DIR="$PROJECT_ROOT/packages/database/prisma"

# Staging 服务器配置
readonly SERVER_HOST="47.101.56.184"
readonly SERVER_USER="root"
readonly REMOTE_WORK_DIR="/tmp/prisma-sync-$$"
readonly DATABASE_URL="postgresql://dbadmin:linghuiai_2025@linghuiai-db.pg.rds.aliyuncs.com:5432/linghuiai_db_staging?schema=public"
readonly PRISMA_VERSION="5.22.0"

# 选项默认值
DRY_RUN=false
SKIP_CLEAN=false
VERBOSE=false

# ============================================
# 颜色输出
# ============================================
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly NC='\033[0m'

# ============================================
# 日志函数
# ============================================
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1" >&2; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }
log_verbose() { [[ "$VERBOSE" == "true" ]] && echo -e "${BLUE}[VERBOSE]${NC} $1" || true; }

# ============================================
# 错误处理
# ============================================
cleanup_on_error() {
    local exit_code=$?
    if [[ $exit_code -ne 0 ]]; then
        log_error "脚本执行失败 (exit code: $exit_code)"
        # 尝试清理远程临时目录
        if [[ "$DRY_RUN" == "false" ]]; then
            ssh -o ConnectTimeout=5 "$SERVER_USER@$SERVER_HOST" "rm -rf $REMOTE_WORK_DIR" 2>/dev/null || true
        fi
    fi
    exit $exit_code
}
trap cleanup_on_error EXIT

# ============================================
# 参数解析
# ============================================
parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-clean)
                SKIP_CLEAN=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            -h|--help)
                show_help
                exit 0
                ;;
            *)
                log_error "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
    done
}

show_help() {
    cat << EOF
用法: $(basename "$0") [options]

同步 Prisma Schema 到 Staging 数据库（非交互式自动化脚本）

选项:
  --dry-run     仅显示将要执行的操作，不实际执行
  --skip-clean  跳过清理临时文件步骤
  --verbose     显示详细输出
  -h, --help    显示此帮助信息

示例:
  $(basename "$0")                    # 正常执行迁移
  $(basename "$0") --dry-run          # 预览模式
  $(basename "$0") --verbose          # 详细输出模式
EOF
}

# ============================================
# 前置检查
# ============================================
check_prerequisites() {
    log_step "检查前置条件..."

    # 检查 prisma 目录
    if [[ ! -d "$PRISMA_DIR" ]]; then
        log_error "找不到 prisma 目录: $PRISMA_DIR"
        exit 1
    fi
    log_verbose "Prisma 目录存在: $PRISMA_DIR"

    # 检查 schema.prisma 文件
    if [[ ! -f "$PRISMA_DIR/schema.prisma" ]]; then
        log_error "找不到 schema.prisma 文件: $PRISMA_DIR/schema.prisma"
        exit 1
    fi
    log_verbose "Schema 文件存在: $PRISMA_DIR/schema.prisma"

    # 检查 migrations 目录
    if [[ ! -d "$PRISMA_DIR/migrations" ]]; then
        log_error "找不到 migrations 目录: $PRISMA_DIR/migrations"
        exit 1
    fi

    # 统计迁移文件数量
    local migration_count
    migration_count=$(find "$PRISMA_DIR/migrations" -name "migration.sql" | wc -l | tr -d ' ')
    log_info "发现 $migration_count 个迁移文件"

    # 检查 SSH 连接
    log_verbose "检查 SSH 连接到 $SERVER_USER@$SERVER_HOST..."
    if ! ssh -o ConnectTimeout=10 -o BatchMode=yes "$SERVER_USER@$SERVER_HOST" "echo 'SSH连接成功'" > /dev/null 2>&1; then
        log_error "无法通过 SSH 连接到 $SERVER_USER@$SERVER_HOST"
        log_error "请确保已配置 SSH 免密登录"
        exit 1
    fi
    log_success "SSH 连接检查通过"
}

# ============================================
# 上传 Prisma 文件
# ============================================
upload_prisma_files() {
    log_step "上传 Prisma Schema 和迁移文件..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] 将上传文件到: $SERVER_USER@$SERVER_HOST:$REMOTE_WORK_DIR"
        return 0
    fi

    # 创建远程工作目录
    ssh "$SERVER_USER@$SERVER_HOST" "mkdir -p $REMOTE_WORK_DIR"
    log_verbose "创建远程目录: $REMOTE_WORK_DIR"

    # 使用 rsync 同步文件（静默模式）
    rsync -az --delete \
        --exclude='.DS_Store' \
        --exclude='*.log' \
        "$PRISMA_DIR/" "$SERVER_USER@$SERVER_HOST:$REMOTE_WORK_DIR/"

    log_success "Schema 和迁移文件上传完成"
}

# ============================================
# 执行 Prisma 迁移
# ============================================
run_prisma_migrate() {
    log_step "执行 Prisma 数据库迁移 (migrate deploy)..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] 将执行: npx prisma@$PRISMA_VERSION migrate deploy"
        return 0
    fi

    # 在远程服务器上执行 Prisma 迁移
    # 使用 migrate deploy 用于生产环境，它只应用待定的迁移
    ssh "$SERVER_USER@$SERVER_HOST" bash << ENDSSH
set -euo pipefail

cd "$REMOTE_WORK_DIR"

echo "[INFO] 当前目录: \$(pwd)"
echo "[INFO] Prisma 版本: $PRISMA_VERSION"

# 设置环境变量
export DATABASE_URL='$DATABASE_URL'

# 执行 Prisma migrate deploy
# --skip-generate: 跳过 Prisma Client 生成（部署时不需要）
echo "[INFO] 执行 prisma migrate deploy..."
npx prisma@$PRISMA_VERSION migrate deploy

echo "[INFO] 迁移执行完成"

# 显示迁移状态
echo "[INFO] 检查迁移状态..."
npx prisma@$PRISMA_VERSION migrate status || true
ENDSSH

    log_success "Prisma 迁移执行完成"
}

# ============================================
# 验证数据库状态
# ============================================
verify_database() {
    log_step "验证数据库状态..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] 将验证数据库状态"
        return 0
    fi

    # 使用 Prisma 验证数据库状态
    ssh "$SERVER_USER@$SERVER_HOST" bash << ENDSSH
set -euo pipefail

cd "$REMOTE_WORK_DIR"
export DATABASE_URL='$DATABASE_URL'

echo "[INFO] 验证 Schema 与数据库同步状态..."

# 使用 prisma db pull --print 来验证（不会修改任何文件）
# 如果 schema 和数据库不同步，会显示差异
npx prisma@$PRISMA_VERSION migrate status

echo "[INFO] 数据库验证完成"
ENDSSH

    log_success "数据库状态验证完成"
}

# ============================================
# 清理临时文件
# ============================================
cleanup_remote() {
    if [[ "$SKIP_CLEAN" == "true" ]]; then
        log_info "跳过清理步骤 (--skip-clean)"
        return 0
    fi

    log_step "清理远程临时文件..."

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "[DRY-RUN] 将清理目录: $REMOTE_WORK_DIR"
        return 0
    fi

    ssh "$SERVER_USER@$SERVER_HOST" "rm -rf $REMOTE_WORK_DIR"
    log_success "临时文件清理完成"
}

# ============================================
# 主函数
# ============================================
main() {
    parse_args "$@"

    echo ""
    log_info "============================================"
    log_info "  同步 Prisma Schema 到 Staging 数据库"
    log_info "============================================"
    log_info "服务器: $SERVER_USER@$SERVER_HOST"
    log_info "数据库: linghuiai_db_staging"
    log_info "Prisma 版本: $PRISMA_VERSION"
    [[ "$DRY_RUN" == "true" ]] && log_warn "运行模式: DRY-RUN (仅预览)"
    echo ""

    # 执行步骤
    check_prerequisites
    echo ""

    upload_prisma_files
    echo ""

    run_prisma_migrate
    echo ""

    verify_database
    echo ""

    cleanup_remote
    echo ""

    log_success "============================================"
    log_success "  Staging 数据库同步完成!"
    log_success "============================================"
}

# 执行主函数
main "$@"
