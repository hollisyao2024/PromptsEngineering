#!/bin/bash
# ============================================
# CI/CD Deployment Mode
# Deploy from GitHub Actions or other CI/CD platforms
# ============================================

deploy_from_ci() {
    local ENV=$1

    log_info "============================================"
    log_info "  CI/CD 部署到 $ENV 环境"
    log_info "============================================"
    echo ""

    # Check if running in CI environment
    if [[ -z "$CI" && -z "$GITHUB_ACTIONS" ]]; then
        log_warn "警告: 未检测到 CI 环境变量"
        log_warn "当前可能不在 CI/CD 环境中运行"
        echo ""
    fi

    # Get CI-specific environment variables
    if [[ -n "$GITHUB_ACTIONS" ]]; then
        CI_PLATFORM="GitHub Actions"
        CI_COMMIT="${GITHUB_SHA:-unknown}"
        CI_BRANCH="${GITHUB_REF_NAME:-unknown}"
        CI_RUN_ID="${GITHUB_RUN_ID:-unknown}"
    else
        CI_PLATFORM="Generic CI"
        CI_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')
        CI_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')
        CI_RUN_ID="manual"
    fi

    log_info "CI Platform: $CI_PLATFORM"
    log_info "Commit:      $CI_COMMIT"
    log_info "Branch:      $CI_BRANCH"
    log_info "Run ID:      $CI_RUN_ID"
    echo ""

    # Set environment-specific variables
    if [[ "$ENV" == "production" ]]; then
        SERVER_HOST="${PRODUCTION_SERVER_HOST:-}"
        SERVER_USER="${PRODUCTION_SERVER_USER:-root}"
        DEPLOY_PATH="${PRODUCTION_DEPLOY_PATH:-/var/www/production}"
        APP_NAME="production-app"
    elif [[ "$ENV" == "staging" ]]; then
        SERVER_HOST="${STAGING_SERVER_HOST:-}"
        SERVER_USER="${STAGING_SERVER_USER:-root}"
        DEPLOY_PATH="${STAGING_DEPLOY_PATH:-/var/www/staging}"
        APP_NAME="staging-app"
    else
        log_error "CI/CD 不支持 dev 环境部署"
        log_error "dev 环境请使用 local 模式: ./deploy.sh local dev"
        exit 1
    fi

    if [[ -z "$SERVER_HOST" ]]; then
        log_error "未配置服务器地址"
        log_error "请在 GitHub Secrets 中设置 ${ENV^^}_SERVER_HOST"
        exit 1
    fi

    log_info "目标服务器: $SERVER_USER@$SERVER_HOST"
    log_info "部署路径: $DEPLOY_PATH"
    echo ""

    # Confirmation for production
    if [[ "$ENV" == "production" ]]; then
        log_warn "⚠️  即将通过 CI/CD 部署到生产环境！"
        # In CI, we skip manual confirmation but add extra logging
        log_warn "确保此次部署已通过以下检查:"
        log_warn "  ✓ 代码已通过 Code Review"
        log_warn "  ✓ 所有测试已通过"
        log_warn "  ✓ Staging 环境验证成功"
        echo ""
    fi

    # Project root directory
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
    FRONTEND_DIR="$PROJECT_ROOT/apps/web"

    cd "$FRONTEND_DIR"

    # Step 1: Install dependencies
    log_info "Step 1/5: 安装依赖..."
    pnpm install --frozen-lockfile
    log_success "依赖安装完成"
    echo ""

    # Step 2: Generate Prisma Client
    log_info "Step 2/5: 生成 Prisma Client..."
    npx prisma generate --schema=../../packages/database/prisma/schema.prisma
    log_success "Prisma Client 生成完成"
    echo ""

    # Step 3: Build application
    log_info "Step 3/5: 构建应用 (APP_ENVIRONMENT=$ENV)..."
    APP_ENVIRONMENT=$ENV pnpm build
    log_success "构建完成"
    echo ""

    # Step 4: Prepare standalone package
    log_info "Step 4/5: 准备 standalone 包..."
    if [[ ! -d ".next/standalone" ]]; then
        log_error "standalone 目录不存在"
        exit 1
    fi

    # Copy static files
    cp -r .next/static .next/standalone/.next/
    if [[ -d "public" ]]; then
        cp -r public .next/standalone/
    fi

    # Create deployment info
    DEPLOY_INFO="{\"commit\": \"$CI_COMMIT\", \"built_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"env\": \"$ENV\", \"trigger\": \"ci\", \"platform\": \"$CI_PLATFORM\", \"run_id\": \"$CI_RUN_ID\", \"branch\": \"$CI_BRANCH\"}"
    echo "$DEPLOY_INFO" > .next/standalone/deploy-info.json

    log_success "standalone 包准备完成"
    log_info "包大小: $(du -sh .next/standalone | cut -f1)"
    echo ""

    # Step 5: Deploy to server
    log_info "Step 5/5: 部署到服务器..."

    # Setup SSH key for CI (if SSH_PRIVATE_KEY is set)
    if [[ -n "$SSH_PRIVATE_KEY" ]]; then
        log_info "配置 SSH 密钥..."
        mkdir -p ~/.ssh
        echo "$SSH_PRIVATE_KEY" > ~/.ssh/id_rsa
        chmod 600 ~/.ssh/id_rsa
        ssh-keyscan -H "$SERVER_HOST" >> ~/.ssh/known_hosts 2>/dev/null
    fi

    # Check SSH connection
    log_info "检查 SSH 连接..."
    if ! ssh -o ConnectTimeout=10 "$SERVER_USER@$SERVER_HOST" "echo 'SSH 连接成功'" 2>/dev/null; then
        log_error "无法连接到服务器 $SERVER_HOST"
        exit 1
    fi

    # Create target directory
    log_info "创建目标目录..."
    ssh "$SERVER_USER@$SERVER_HOST" "mkdir -p $DEPLOY_PATH/frontend/.next"

    # Sync files
    log_info "同步文件到服务器..."
    rsync -avz --delete \
        --exclude='*.map' \
        .next/standalone/ \
        "$SERVER_USER@$SERVER_HOST:$DEPLOY_PATH/frontend/.next/standalone/"

    rsync -avz \
        .next/static/ \
        "$SERVER_USER@$SERVER_HOST:$DEPLOY_PATH/frontend/.next/standalone/apps/web/.next/static/"

    log_success "文件同步完成"

    # Restart application
    log_info "重启应用..."
    ssh "$SERVER_USER@$SERVER_HOST" << ENDSSH
        set -e
        cd $DEPLOY_PATH/frontend/.next/standalone/apps/web

        # Stop old process
        pm2 delete $APP_NAME 2>/dev/null || true

        # Start new process
        HOSTNAME=0.0.0.0 pm2 start server.js --name $APP_NAME
        pm2 save

        # Wait and check status
        sleep 3
        if pm2 list | grep -q "$APP_NAME.*online"; then
            echo "✅ 应用已启动"
            pm2 status $APP_NAME
        else
            echo "❌ 应用启动失败"
            pm2 logs $APP_NAME --lines 20 --nostream
            exit 1
        fi
ENDSSH

    echo ""
    log_success "============================================"
    log_success "  🎉 CI/CD 部署完成!"
    log_success "============================================"
    log_info "Platform:    $CI_PLATFORM"
    log_info "Environment: $ENV"
    log_info "Commit:      $CI_COMMIT"
    log_info "Branch:      $CI_BRANCH"
    log_info "Run ID:      $CI_RUN_ID"
    echo ""
}
