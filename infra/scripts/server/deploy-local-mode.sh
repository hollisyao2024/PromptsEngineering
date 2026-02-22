#!/bin/bash
# ============================================
# Local Deployment Mode - Main Entry Point
# Deploy from local machine to remote server via SSH + rsync
# ============================================
#
# 模块化重构 (2026-01-28):
# 本脚本从原 2362 行重构为 ~250 行的主入口
# 功能已拆分到以下模块：
#   - deploy-common.sh     : 共享变量和函数
#   - deploy-ci-checks.sh  : CI 检查（Git/Lint/TypeScript/Test）
#   - deploy-build.sh      : 本地构建流程
#   - deploy-sync.sh       : 文件同步（tar/rsync）
#   - deploy-database.sh   : 数据库迁移
#   - deploy-nginx-ssl.sh  : PM2/Nginx/SSL 配置
#
# 性能优化历史 (Performance Optimization History):
# ------------------------------------------------
# 2026-01-25 优化 - 部署速度提升 60-400 秒
#   1. 移除 Transformers 和 CLIP 模型检查 (60-400s)
#   2. 启用 Turbopack 构建 (预计节省 40-50s)
#   3. 清理未使用的依赖 (11个包)
#   4. 修复 Prisma 符号链接和版本一致性
#
# 数据库迁移增强 (2026-01-26):
# ------------------------------------------------
#   1. 架构漂移检测 (Schema Drift Detection)
#   2. 迁移状态检查 (Migration Status Check)
#   3. 生产环境自动备份 (RDS API / pg_dump)
#   4. 执行迁移并验证 (Deploy and Verify)
#
# ============================================

# 获取脚本目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 加载所有模块
source "$SCRIPT_DIR/deploy-common.sh"
source "$SCRIPT_DIR/deploy-ci-checks.sh"
source "$SCRIPT_DIR/deploy-build.sh"
source "$SCRIPT_DIR/deploy-sync.sh"
source "$SCRIPT_DIR/deploy-database.sh"
source "$SCRIPT_DIR/deploy-nginx-ssl.sh"

# ============================================
# 主部署函数
# ============================================

deploy_from_local() {
    local ENV=$1
    local TARGET_ENV=$ENV  # 供子模块使用

    # 开始计时
    start_deploy_timer

    # 禁用输出缓冲，确保实时显示进度
    export PYTHONUNBUFFERED=1
    stty -onlcr 2>/dev/null || true

    log_info "============================================"
    log_info "  本地构建 + 部署到 $ENV 环境"
    log_info "============================================"
    log_info "项目根目录: $PROJECT_ROOT"
    log_info "前端目录: $FRONTEND_DIR"
    echo ""

    # ========================================
    # Step 0: 加载环境变量
    # ========================================
    _load_env_file "$ENV"

    # ========================================
    # Step 1: 加载部署配置
    # ========================================
    load_deploy_config "$ENV"

    # 验证配置
    if ! validate_deploy_config "$ENV"; then
        exit 1
    fi

    # 显示配置
    show_deploy_config

    # ========================================
    # Step 2: 设置 SSH 连接
    # ========================================
    if [[ "$IS_LOCAL_DEPLOY" != "true" ]]; then
        _setup_remote_connection
    else
        SSH_OPTS=""
        SCP_OPTS=""
        log_info "部署模式: 本地部署（无需 SSH）"
    fi
    echo ""

    # ========================================
    # Step 3: 部署确认
    # ========================================
    _confirm_deployment "$ENV"

    # ========================================
    # Step 4: 设置构建目录
    # ========================================
    _setup_build_directory

    # ========================================
    # Step 5: CI 检查
    # ========================================
    run_ci_checks "$ENV" || exit 1

    # ========================================
    # Step 6: 本地构建
    # ========================================
    run_build "$ENV" || exit 1

    # 获取 Prisma 版本用于数据库迁移
    PRISMA_VERSION=$(node -p "require('$FRONTEND_DIR/package.json').dependencies.prisma || require('$FRONTEND_DIR/package.json').devDependencies.prisma" 2>/dev/null | sed 's/[\^~]//g')
    log_info "Prisma 版本: $PRISMA_VERSION"

    # ========================================
    # Step 7: 部署
    # ========================================
    if [[ "$IS_LOCAL_DEPLOY" == "true" ]]; then
        # 本地部署（dev 环境）
        _deploy_local
    else
        # 远程部署（staging/production 环境）
        _deploy_remote "$ENV"
    fi

    # ========================================
    # Step 8: 完成
    # ========================================
    record_timing "部署完成"
    _show_completion_message "$ENV"

    # 清理 SSH 主连接
    if [[ "$IS_LOCAL_DEPLOY" != "true" ]]; then
        cleanup_ssh_control_master
    fi
}

# ============================================
# 内部辅助函数
# ============================================

# 加载环境变量文件
_load_env_file() {
    local env=$1

    if [[ "$env" == "dev" ]]; then
        ENV_FILE="$PROJECT_ROOT/.env.local"
    else
        ENV_FILE="$PROJECT_ROOT/.env.$env"
    fi

    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "找不到环境变量文件: $ENV_FILE"
        exit 1
    fi

    log_info "加载环境变量: $ENV_FILE"
    set -a
    source "$ENV_FILE"
    set +a
    log_success "环境变量已加载并导出（包括 NEXT_PUBLIC_* 变量）"
}

# 设置远程连接
_setup_remote_connection() {
    if [[ -z "$SERVER_HOST" ]]; then
        log_error "未配置服务器地址"
        exit 1
    fi

    # 使用 SSH ControlMaster 实现连接复用
    setup_ssh_control_master "$SERVER_HOST" "${SERVER_PORT:-22}" "$SERVER_USER" "$SSH_KEY"
    SSH_OPTS="$(get_ssh_opts)"
    SCP_OPTS="-P ${SERVER_PORT:-22} -i ${SSH_KEY}"

    log_info "目标服务器: $SERVER_USER@$SERVER_HOST"
    log_info "部署路径: $DEPLOY_PATH"
}

# 部署确认
_confirm_deployment() {
    local env=$1

    if [[ "$env" == "production" ]]; then
        if [[ "$SKIP_CONFIRM" == "true" ]] || [[ ! -t 0 ]]; then
            log_warn "即将部署到生产环境（非交互式模式）"
        else
            log_warn "即将部署到生产环境！"
            log_info "提示: 设置 SKIP_CONFIRM=true 或通过管道可跳过确认"
            read -p "确认继续? (输入 YES): " CONFIRM
            if [[ "$CONFIRM" != "YES" ]]; then
                log_error "部署已取消"
                exit 1
            fi
        fi
    fi
}

# 设置构建目录
_setup_build_directory() {
    if [[ "$IS_LOCAL_DEPLOY" == "true" ]]; then
        BUILD_DIR="$BUILD_DIR_DEV"
        REMOTE_BUILD_DIR="$BUILD_DIR_DEV"

        log_info "Step 0: 检查本地 dev server..."
        DEV_PIDS=$(lsof -t -i:$APP_PORT 2>/dev/null || true)
        if [[ -n "$DEV_PIDS" ]]; then
            log_warn "检测到本地 dev server 正在运行 (PID: $DEV_PIDS)"
            log_info "正在停止 dev server..."
            echo "$DEV_PIDS" | xargs kill -9 2>/dev/null || true
            sleep 2
            log_success "dev server 已停止"
        else
            log_success "没有检测到运行中的 dev server"
        fi
    else
        BUILD_DIR="$BUILD_DIR_DEFAULT"
        REMOTE_BUILD_DIR="$BUILD_DIR_DEFAULT"
        log_info "Step 0: 使用独立构建目录 ($BUILD_DIR)，dev server 继续运行"
    fi
    echo ""
}

# 本地部署（dev 环境）
_deploy_local() {
    log_info "本地部署模式"

    # 创建部署目录
    mkdir -p "$DEPLOY_PATH"

    # 复制 standalone 包
    log_info "复制构建产物到部署目录..."
    rm -rf "$DEPLOY_PATH/standalone" 2>/dev/null || true
    cp -r "$FRONTEND_DIR/$BUILD_DIR/standalone" "$DEPLOY_PATH/"

    # 复制环境变量文件
    cp "$ENV_FILE" "$DEPLOY_PATH/standalone/apps/web/.env"
    log_success "环境变量文件已复制"

    # 重启应用
    log_info "重启应用..."
    cd "$DEPLOY_PATH/standalone/apps/web"

    pm2 delete $APP_NAME 2>/dev/null || true

    set -a
    source .env
    set +a

    HOSTNAME=0.0.0.0 pm2 start server.js --name $APP_NAME -i max
    pm2 save

    sleep $APP_STARTUP_WAIT

    if pm2 list | grep -q "$APP_NAME.*online"; then
        log_success "应用已启动"
        pm2 status $APP_NAME
    else
        log_error "应用启动失败"
        pm2 logs $APP_NAME --lines 20 --nostream
        exit 1
    fi
}

# 远程部署（staging/production 环境）
_deploy_remote() {
    local env=$1

    log_info "远程部署模式（使用 SSH）"

    # 计算派生路径
    REMOTE_STANDALONE_PATH="$DEPLOY_PATH/frontend/$REMOTE_BUILD_DIR/standalone"
    REMOTE_STANDALONE_FRONTEND="$REMOTE_STANDALONE_PATH/apps/web"

    # 文件同步
    run_file_sync "$env" || exit 1

    # 数据库迁移
    run_database_migration "$env" "$PRISMA_VERSION" "$PRISMA_SCHEMA_HASH" || exit 1

    # 验证 Prisma Client
    verify_prisma_client "$PRISMA_VERSION" "$PRISMA_SCHEMA_HASH" || exit 1

    # PM2 重启（包含 Prisma 符号链接修复、WebSocket 依赖、健康检查）
    run_pm2_restart "$env" || exit 1

    # Nginx 配置
    run_nginx_config || exit 1

    # SSL 配置
    run_ssl_config || exit 1
}

# 显示完成信息
_show_completion_message() {
    local env=$1

    echo ""
    log_success "============================================"
    if [[ "$IS_LOCAL_DEPLOY" == "true" ]]; then
        log_success "  本地部署完成!"
    else
        log_success "  远程部署完成!"
    fi
    log_success "============================================"
    log_info "环境: $env"
    log_info "部署路径: $DEPLOY_PATH"

    # 显示耗时统计
    show_timing_summary

    # 显示访问信息
    if [[ "$env" == "dev" ]]; then
        log_info "访问地址: $NEXT_PUBLIC_APP_URL"
        log_info "PM2 管理: pm2 status $APP_NAME"
        log_info "PM2 日志: pm2 logs $APP_NAME"
    elif [[ "$env" == "staging" ]]; then
        log_info "访问地址: http://$SERVER_HOST"
    elif [[ "$env" == "production" ]]; then
        log_info "访问地址: https://$DOMAIN_NAME"
    fi

    # staging/prod 使用独立构建目录，dev server 无需重启
    if [[ "$env" != "dev" ]]; then
        if lsof -i:$APP_PORT > /dev/null 2>&1; then
            log_success "本地 dev server 仍在运行 (http://localhost:$APP_PORT)"
        else
            log_info "本地 dev server 未运行，如需启动请执行: cd frontend && pnpm dev"
        fi
    fi
}
