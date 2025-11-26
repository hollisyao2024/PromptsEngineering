#!/bin/bash
# ============================================
# LinghuiAI 手动 Cron 任务脚本
# ============================================
# 说明：
# - 在没有启用 Cron 容器时，使用此脚本手动执行定时任务
# - 建议每周日执行一次
#
# 使用方式：
#   export ECS_HOST=123.456.789.0
#   ./scripts/server/manual-cron.sh all           # 执行所有任务
#   ./scripts/server/manual-cron.sh credit        # 仅数据一致性检查
#   ./scripts/server/manual-cron.sh cleanup       # 仅账号清理
#   ./scripts/server/manual-cron.sh warmup        # 仅缓存预热

set -e

# 配置
ECS_HOST="${ECS_HOST:-}"
ECS_USER="${ECS_USER:-root}"

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_env() {
    if [ -z "$ECS_HOST" ]; then
        log_error "环境变量 ECS_HOST 未设置"
        log_info "请执行：export ECS_HOST=your-ecs-ip"
        exit 1
    fi
}

# ============================================
# 1. 数据一致性检查
# ============================================
credit_check() {
    log_info "执行数据一致性检查..."

    ssh ${ECS_USER}@${ECS_HOST} << 'EOF'
        echo "=== 数据一致性检查（只读） ==="
        docker exec linghuiai-frontend npm run credit:check

        echo ""
        echo "是否需要修复不一致的数据？(y/n)"
        read -r answer
        if [ "$answer" = "y" ]; then
            echo "=== 修复数据不一致 ==="
            docker exec linghuiai-frontend npm run credit:fix
        fi
EOF

    log_info "✅ 数据一致性检查完成"
}

# ============================================
# 2. 账号冻结清理
# ============================================
cleanup() {
    log_info "清理过期账号冻结申请..."

    ssh ${ECS_USER}@${ECS_HOST} << 'EOF'
        echo "=== 账号冻结清理 ==="
        docker exec linghuiai-frontend npm run account:cleanup
EOF

    log_info "✅ 账号清理完成"
}

# ============================================
# 3. Redis 缓存预热
# ============================================
warmup() {
    log_info "预热 Redis 缓存..."

    ssh ${ECS_USER}@${ECS_HOST} << 'EOF'
        echo "=== Redis 缓存预热 ==="
        docker exec linghuiai-frontend npm run credit:warmup
EOF

    log_info "✅ 缓存预热完成"
}

# ============================================
# 4. 健康检查
# ============================================
health() {
    log_info "执行健康检查..."

    ssh ${ECS_USER}@${ECS_HOST} << 'EOF'
        echo "=== 容器状态 ==="
        docker ps | grep linghuiai

        echo ""
        echo "=== Frontend 健康检查 ==="
        docker exec linghuiai-frontend curl -f http://localhost:3000/api/health || echo "❌ 健康检查失败"

        echo ""
        echo "=== 数据库连接测试 ==="
        docker exec linghuiai-frontend npx prisma db pull --print || echo "❌ 数据库连接失败"

        echo ""
        echo "=== Redis 连接测试 ==="
        # 需要在容器内安装 redis-cli，或通过应用 API 测试

        echo ""
        echo "=== 容器资源使用 ==="
        docker stats --no-stream linghuiai-frontend
EOF

    log_info "✅ 健康检查完成"
}

# ============================================
# 5. 执行所有任务
# ============================================
all() {
    log_info "执行所有维护任务..."
    echo ""

    credit_check
    echo ""

    cleanup
    echo ""

    warmup
    echo ""

    health
    echo ""

    log_info "✅ 所有任务执行完成！"
    log_info "建议每周日执行一次此脚本"
}

# ============================================
# 主函数
# ============================================
main() {
    check_env

    case "$1" in
        credit)
            credit_check
            ;;
        cleanup)
            cleanup
            ;;
        warmup)
            warmup
            ;;
        health)
            health
            ;;
        all)
            all
            ;;
        *)
            echo "LinghuiAI 手动 Cron 任务脚本"
            echo ""
            echo "使用方式："
            echo "  ./scripts/server/manual-cron.sh all           # 执行所有任务"
            echo "  ./scripts/server/manual-cron.sh credit        # 数据一致性检查"
            echo "  ./scripts/server/manual-cron.sh cleanup       # 账号清理"
            echo "  ./scripts/server/manual-cron.sh warmup        # 缓存预热"
            echo "  ./scripts/server/manual-cron.sh health        # 健康检查"
            echo ""
            echo "环境变量："
            echo "  ECS_HOST               # ECS 服务器 IP（必需）"
            echo ""
            echo "示例："
            echo "  export ECS_HOST=123.456.789.0"
            echo "  ./scripts/server/manual-cron.sh all"
            echo ""
            echo "建议频率："
            echo "  - 数据一致性检查：每周一次（周日凌晨）"
            echo "  - 账号清理：每月一次"
            echo "  - 缓存预热：应用重启后执行"
            exit 1
            ;;
    esac
}

main "$@"
