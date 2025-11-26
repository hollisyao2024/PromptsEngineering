#!/bin/bash
# ============================================
# Local Deployment Mode
# Deploy from local machine to remote server via SSH + rsync
# ============================================

deploy_from_local() {
    local ENV=$1

    # 禁用输出缓冲，确保实时显示进度
    export PYTHONUNBUFFERED=1
    stty -onlcr 2>/dev/null || true

    # 项目根目录
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
    FRONTEND_DIR="$PROJECT_ROOT/frontend"

    log_info "============================================"
    log_info "  本地构建 + 部署到 $ENV 环境"
    log_info "============================================"
    log_info "项目根目录: $PROJECT_ROOT"
    log_info "前端目录: $FRONTEND_DIR"
    echo ""

    # 加载环境变量
    ENV_FILE="$PROJECT_ROOT/.env.$ENV"
    if [[ ! -f "$ENV_FILE" ]]; then
        log_error "找不到环境变量文件: $ENV_FILE"
        log_error "请先创建 .env.$ENV 文件"
        exit 1
    fi

    log_info "加载环境变量: $ENV_FILE"
    source "$ENV_FILE"

    # 从环境变量获取服务器信息
    if [[ "$ENV" == "dev" ]]; then
        SERVER_HOST="${DEV_SERVER_HOST:-localhost}"
        SERVER_USER="${DEV_SERVER_USER:-$USER}"
        DEPLOY_PATH="${DEV_DEPLOY_PATH:-/tmp/dev-deploy}"
        APP_NAME="dev-app"
    elif [[ "$ENV" == "staging" ]]; then
        SERVER_HOST="${STAGING_SERVER_HOST:-}"
        SERVER_USER="${STAGING_SERVER_USER:-root}"
        DEPLOY_PATH="${STAGING_DEPLOY_PATH:-/var/www/staging}"
        APP_NAME="staging-app"
    else
        SERVER_HOST="${PRODUCTION_SERVER_HOST:-}"
        SERVER_USER="${PRODUCTION_SERVER_USER:-root}"
        DEPLOY_PATH="${PRODUCTION_DEPLOY_PATH:-/var/www/production}"
        APP_NAME="production-app"
    fi

    if [[ -z "$SERVER_HOST" ]]; then
        log_error "未配置服务器地址"
        log_error "请在 $ENV_FILE 中设置 ${ENV^^}_SERVER_HOST"
        exit 1
    fi

    log_info "目标服务器: $SERVER_USER@$SERVER_HOST"
    log_info "部署路径: $DEPLOY_PATH"
    echo ""

    # 确认部署
    if [[ "$ENV" == "production" ]]; then
        log_warn "⚠️  即将部署到生产环境！"
        read -p "确认继续? (输入 YES): " CONFIRM
        if [[ "$CONFIRM" != "YES" ]]; then
            log_error "部署已取消"
            exit 1
        fi
    fi

    # Step 0: 检查并停止本地 dev server
    log_info "Step 0: 检查本地 dev server..."
    cd "$FRONTEND_DIR"

    # 检查是否有 Next.js dev server 在运行（监听 3000 端口）
    DEV_PIDS=$(lsof -t -i:3000 2>/dev/null || true)
    if [[ -n "$DEV_PIDS" ]]; then
        log_warn "检测到本地 dev server 正在运行 (PID: $DEV_PIDS)"
        log_info "正在停止 dev server..."
        echo "$DEV_PIDS" | xargs kill -9 2>/dev/null || true
        sleep 2
        log_success "dev server 已停止"
    else
        log_success "没有检测到运行中的 dev server"
    fi
    echo ""

    # Step 0.5: CI 检查（可选，根据 SKIP_CI 环境变量）
    if [[ "${SKIP_CI:-false}" == "true" ]]; then
        log_warn "============================================"
        log_warn "  ⚠️  跳过 CI 检查（SKIP_CI=true）"
        log_warn "============================================"
        log_warn "以下检查已跳过："
        log_warn "  - Git 状态检查"
        log_warn "  - 代码格式检查（Lint）"
        log_warn "  - 单元测试"
        log_warn "  - 类型检查"
        log_warn ""
        log_warn "⚠️  警告：跳过检查可能导致部署失败或运行时错误"
        log_warn "⚠️  建议：仅在开发环境或紧急情况下使用"
        echo ""
    else
        log_info "============================================"
        log_info "  执行部署前 CI 检查"
        log_info "============================================"
        echo ""

        # 1. Git 状态检查
        log_info "[1/4] 检查 Git 状态..."
        if [[ -n "$(git status --porcelain)" ]]; then
            log_warn "存在未提交的更改："
            git status --short
            if [[ "$ENV" == "production" ]]; then
                log_error "生产环境不允许部署未提交的更改"
                exit 1
            else
                log_warn "继续部署（非生产环境）"
            fi
        else
            log_success "Git 工作区干净"
        fi
        echo ""

        # 2. 代码格式检查（如果存在 lint script）
        log_info "[2/4] 代码格式检查..."
        if grep -q '"lint"' "$PROJECT_ROOT/package.json"; then
            if pnpm lint 2>&1; then
                log_success "Lint 检查通过"
            else
                log_warn "Lint 检查失败"
                if [[ "$ENV" == "production" ]]; then
                    log_error "生产环境必须通过 Lint 检查"
                    exit 1
                else
                    log_warn "继续部署（非生产环境）"
                fi
            fi
        else
            log_warn "未找到 lint script，跳过"
        fi
        echo ""

        # 3. 单元测试（如果存在 test script）
        log_info "[3/4] 运行单元测试..."
        if grep -q '"test"' "$PROJECT_ROOT/package.json"; then
            # 检查是否有 test:ci 或 test:unit
            if grep -q '"test:ci"' "$PROJECT_ROOT/package.json"; then
                if pnpm test:ci 2>&1; then
                    log_success "测试通过"
                else
                    log_warn "测试失败"
                    if [[ "$ENV" == "production" ]]; then
                        log_error "生产环境必须通过所有测试"
                        exit 1
                    else
                        log_warn "继续部署（非生产环境）"
                    fi
                fi
            else
                log_warn "未找到 test:ci script，跳过测试"
            fi
        else
            log_warn "未找到 test script，跳过"
        fi
        echo ""

        # 4. 类型检查（如果是 TypeScript 项目）
        log_info "[4/4] TypeScript 类型检查..."
        if [[ -f "$PROJECT_ROOT/tsconfig.json" ]]; then
            if grep -q '"type-check"' "$PROJECT_ROOT/package.json"; then
                if pnpm type-check 2>&1; then
                    log_success "类型检查通过"
                else
                    log_warn "类型检查失败"
                    if [[ "$ENV" == "production" ]]; then
                        log_error "生产环境必须通过类型检查"
                        exit 1
                    else
                        log_warn "继续部署（非生产环境）"
                    fi
                fi
            else
                # 尝试直接运行 tsc
                if command -v tsc &> /dev/null; then
                    if npx tsc --noEmit 2>&1; then
                        log_success "类型检查通过"
                    else
                        log_warn "类型检查失败"
                        if [[ "$ENV" == "production" ]]; then
                            log_error "生产环境必须通过类型检查"
                            exit 1
                        else
                            log_warn "继续部署（非生产环境）"
                        fi
                    fi
                else
                    log_warn "未找到 TypeScript 编译器，跳过"
                fi
            fi
        else
            log_warn "非 TypeScript 项目，跳过"
        fi
        echo ""

        log_success "============================================"
        log_success "  ✅ CI 检查完成"
        log_success "============================================"
        echo ""
    fi

    # Step 1: 清理旧构建
    log_info "Step 1/6: 清理旧构建..."
    rm -rf .next
    log_success "清理完成"
    echo ""

    # Step 2: 安装依赖
    log_info "Step 2/6: 安装依赖..."
    pnpm install --frozen-lockfile
    log_success "依赖安装完成"
    echo ""

    # Step 3: 生成 Prisma Client
    log_info "Step 3/6: 生成 Prisma Client..."
    npx prisma generate
    log_success "Prisma Client 生成完成"
    echo ""

    # Step 4: 构建应用
    log_info "Step 4/6: 构建应用 (APP_ENVIRONMENT=$ENV)..."
    APP_ENVIRONMENT=$ENV pnpm build
    log_success "构建完成"
    echo ""

    # Step 5: 准备 standalone 包
    log_info "Step 5/6: 准备 standalone 包..."
    if [[ ! -d ".next/standalone" ]]; then
        log_error "standalone 目录不存在，请检查 next.config.js 中是否配置了 output: 'standalone'"
        exit 1
    fi

    # 复制静态文件
    cp -r .next/static .next/standalone/.next/
    if [[ -d "public" ]]; then
        cp -r public .next/standalone/
    fi

    # 创建部署信息
    DEPLOY_INFO="{\"commit\": \"$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')\", \"built_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"env\": \"$ENV\", \"built_by\": \"$(whoami)\", \"trigger\": \"local\"}"
    echo "$DEPLOY_INFO" > .next/standalone/deploy-info.json

    log_success "standalone 包准备完成"
    log_info "包大小: $(du -sh .next/standalone | cut -f1)"
    echo ""

    # Step 6: 部署到服务器
    log_info "Step 6/6: 部署到服务器..."

    # 检查 SSH 连接
    log_info "检查 SSH 连接..."
    if ! ssh -o ConnectTimeout=10 "$SERVER_USER@$SERVER_HOST" "echo 'SSH 连接成功'" 2>/dev/null; then
        log_error "无法连接到服务器 $SERVER_HOST"
        log_error "请检查:"
        log_error "  1. 服务器地址是否正确"
        log_error "  2. SSH 密钥是否已配置 (~/.ssh/config 或 ssh-copy-id)"
        log_error "  3. 服务器安全组是否允许 SSH 访问"
        exit 1
    fi

    # 创建目标目录
    log_info "创建目标目录..."
    ssh "$SERVER_USER@$SERVER_HOST" "mkdir -p $DEPLOY_PATH/frontend/.next"

    # 同步文件
    log_info "同步 standalone 包到服务器 (rsync)..."
    rsync -avz --delete \
        --exclude='*.map' \
        .next/standalone/ \
        "$SERVER_USER@$SERVER_HOST:$DEPLOY_PATH/frontend/.next/standalone/"

    # 同步静态文件 (CSS/JS) - Next.js standalone 需要手动复制
    log_info "同步静态文件..."
    rsync -avz \
        .next/static/ \
        "$SERVER_USER@$SERVER_HOST:$DEPLOY_PATH/frontend/.next/standalone/frontend/.next/static/"

    # 同步环境变量文件（必须在 rsync 之后，否则会被 --delete 删除）
    log_info "同步环境变量文件到服务器..."
    scp "$ENV_FILE" "$SERVER_USER@$SERVER_HOST:$DEPLOY_PATH/frontend/.next/standalone/frontend/.env"
    log_success "环境变量文件已同步: .env.$ENV -> standalone/frontend/.env"

    log_success "文件同步完成"

    # 重启应用
    log_info "重启应用..."
    ssh "$SERVER_USER@$SERVER_HOST" << ENDSSH
        set -e
        cd $DEPLOY_PATH/frontend/.next/standalone/frontend

        # 停止旧进程
        pm2 delete $APP_NAME 2>/dev/null || true

        # 启动新进程（设置 HOSTNAME=0.0.0.0 确保 Next.js 正确绑定）
        HOSTNAME=0.0.0.0 pm2 start server.js --name $APP_NAME
        pm2 save

        # 等待启动
        sleep 3

        # 检查状态
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
    log_success "  🎉 本地部署完成!"
    log_success "============================================"
    log_info "环境: $ENV"
    log_info "服务器: $SERVER_HOST"
    log_info "部署信息: $DEPLOY_INFO"
    echo ""

    # 显示访问信息
    if [[ "$ENV" == "staging" ]]; then
        log_info "访问地址: http://$SERVER_HOST"
    elif [[ "$ENV" == "production" ]]; then
        log_info "访问地址: https://linghuiai.net"
    else
        log_info "访问地址: http://$SERVER_HOST:3000"
    fi

    # 重启本地 dev server（后台运行）
    if [[ "$ENV" != "dev" ]]; then
        log_info "重新启动本地 dev server..."
        cd "$FRONTEND_DIR"
        nohup pnpm dev > /dev/null 2>&1 &
        sleep 2
        if lsof -i:3000 > /dev/null 2>&1; then
            log_success "本地 dev server 已在后台启动 (http://localhost:3000)"
        else
            log_warn "本地 dev server 启动失败，请手动运行: cd frontend && pnpm dev"
        fi
    fi
}
