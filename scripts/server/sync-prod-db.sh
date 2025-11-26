#!/bin/bash
# ============================================
# 同步 Prisma Schema 到 Production 数据库
# 非交互式自动化脚本
# ============================================
# 用法:
#   ./scripts/server/sync-prod-db.sh [options]
#
# 选项:
#   --dry-run     仅显示将要执行的操作，不实际执行
#   --skip-clean  跳过清理临时文件步骤
#   --verbose     显示详细输出
#   --force       跳过生产环境确认（危险操作，仅用于 CI/CD）
#
# 环境变量:
#   PROD_DATABASE_URL  - 生产数据库连接字符串（必需，用于安全）
#   PROD_SERVER_HOST   - 生产服务器 IP（可选，默认使用内置配置）
#   PROD_SERVER_USER   - 生产服务器用户（可选，默认 root）
#
# 前提条件:
#   1. 已配置 SSH 免密登录到 production 服务器
#   2. 服务器已安装 Node.js 和 npx
#   3. 必须设置 PROD_DATABASE_URL 环境变量
# ============================================

set -euo pipefail

# ============================================
# 配置变量
# ============================================
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
readonly FRONTEND_DIR="$PROJECT_ROOT/frontend"
readonly PRISMA_DIR="$FRONTEND_DIR/prisma"

# Production 服务器配置（可通过环境变量覆盖）
readonly SERVER_HOST="${PROD_SERVER_HOST:-47.101.56.184}"
readonly SERVER_USER="${PROD_SERVER_USER:-root}"
readonly REMOTE_WORK_DIR="/tmp/prisma-sync-prod-$$"
readonly PRISMA_VERSION="5.22.0"

# 选项默认值
DRY_RUN=false
SKIP_CLEAN=false
VERBOSE=false
FORCE=false

# ============================================
# 颜色输出
# ============================================
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly CYAN='\033[0;36m'
readonly MAGENTA='\033[0;35m'
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
log_danger() { echo -e "${RED}[DANGER]${NC} $1"; }

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
            --force)
                FORCE=true
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

同步 Prisma Schema 到 Production 数据库（非交互式自动化脚本）

${RED}警告: 此脚本操作生产数据库，请谨慎使用！${NC}

选项:
  --dry-run     仅显示将要执行的操作，不实际执行
  --skip-clean  跳过清理临时文件步骤
  --verbose     显示详细输出
  --force       跳过生产环境确认（危险，仅用于 CI/CD）
  -h, --help    显示此帮助信息

环境变量:
  PROD_DATABASE_URL  生产数据库连接字符串（必需）
  PROD_SERVER_HOST   生产服务器 IP（可选）
  PROD_SERVER_USER   生产服务器用户（可选，默认 root）

示例:
  # 设置环境变量后执行
  export PROD_DATABASE_URL="postgresql://user:pass@host:5432/db"
  $(basename "$0")

  # 预览模式
  $(basename "$0") --dry-run

  # CI/CD 中使用（跳过确认）
  PROD_DATABASE_URL="\$SECRET" $(basename "$0") --force

安全说明:
  - 数据库连接字符串必须通过环境变量传入，不存储在脚本中
  - 建议先在 staging 环境测试迁移
  - 建议在执行前备份生产数据库
EOF
}

# ============================================
# 生产环境安全确认
# ============================================
confirm_production() {
    if [[ "$FORCE" == "true" ]]; then
        log_warn "跳过生产环境确认 (--force 标志)"
        return 0
    fi

    if [[ "$DRY_RUN" == "true" ]]; then
        log_info "DRY-RUN 模式，跳过确认"
        return 0
    fi

    echo ""
    log_danger "============================================"
    log_danger "  警告: 即将操作 PRODUCTION 数据库!"
    log_danger "============================================"
    echo ""
    log_warn "服务器: $SERVER_USER@$SERVER_HOST"
    log_warn "此操作将执行数据库迁移，可能影响生产服务"
    echo ""

    # 检查是否在终端中运行
    if [[ -t 0 ]]; then
        read -p "确认继续? 输入 'yes' 继续: " confirm
        if [[ "$confirm" != "yes" ]]; then
            log_info "操作已取消"
            exit 0
        fi
    else
        log_error "非交互式环境下必须使用 --force 标志"
        log_error "或使用 --dry-run 预览操作"
        exit 1
    fi
}

# ============================================
# 前置检查
# ============================================
check_prerequisites() {
    log_step "检查前置条件..."

    # 检查数据库 URL 环境变量（安全要求）
    if [[ -z "${PROD_DATABASE_URL:-}" ]]; then
        log_error "必须设置 PROD_DATABASE_URL 环境变量"
        log_error "出于安全考虑，生产数据库连接字符串不存储在脚本中"
        log_error ""
        log_error "示例:"
        log_error "  export PROD_DATABASE_URL=\"postgresql://user:pass@host:5432/db?schema=public\""
        log_error "  $(basename "$0")"
        exit 1
    fi
    log_success "数据库连接字符串已配置"

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
echo "[INFO] 环境: PRODUCTION"

# 设置环境变量（从本地传入）
export DATABASE_URL='$PROD_DATABASE_URL'

# 执行 Prisma migrate deploy
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
export DATABASE_URL='$PROD_DATABASE_URL'

echo "[INFO] 验证 Schema 与数据库同步状态..."

# 使用 prisma migrate status 验证
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
    log_danger "  同步 Prisma Schema 到 PRODUCTION 数据库"
    log_info "============================================"
    log_info "服务器: $SERVER_USER@$SERVER_HOST"
    log_info "Prisma 版本: $PRISMA_VERSION"
    [[ "$DRY_RUN" == "true" ]] && log_warn "运行模式: DRY-RUN (仅预览)"
    echo ""

    # 生产环境安全确认
    confirm_production
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
    log_success "  Production 数据库同步完成!"
    log_success "============================================"
}

# 执行主函数
main "$@"
