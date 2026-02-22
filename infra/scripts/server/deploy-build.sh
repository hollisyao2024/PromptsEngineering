#!/bin/bash
# ============================================
# Deploy Build Module
# 本地构建流程模块
#
# 导出函数：
#   - run_build()
#   - check_incremental_build()
#
# 依赖：
#   - deploy-common.sh（需要先 source）
# ============================================

# 全局变量（模块内使用）
NEED_BUILD=true
NEED_INSTALL=false
NEED_PRISMA_GENERATE=false
CURRENT_ENV_HASH=""
PRISMA_SCHEMA_HASH=""

# ============================================
# 主入口函数
# ============================================

# 执行本地构建流程
# 参数：$1=环境名称（dev/staging/production）
# 返回：0=成功，1=失败
run_build() {
    local env=$1

    cd "$FRONTEND_DIR"

    # 1. 增量构建检查
    _check_incremental_build

    # 2. 清理旧构建
    _clean_old_build

    # 3. 安装依赖
    _install_dependencies

    # 4. 生成 Prisma Client
    _generate_prisma_client

    # 5. 构建应用
    _build_application "$env" || return 1

    # 6. 准备 standalone 包
    _prepare_standalone_package "$env"

    # 7. 创建 pnpm 符号链接
    _create_pnpm_symlinks

    # 8. 保存构建 hash
    _save_build_hashes

    # 9. 显示包大小分析
    _show_package_analysis

    record_timing "本地构建"
    echo ""

    return 0
}

# ============================================
# 内部辅助函数
# ============================================

# 增量构建检查
_check_incremental_build() {
    log_info "检查代码变更以确定是否需要重新构建..."

    NEED_BUILD=true
    local build_hash_file="$BUILD_DIR/$BUILD_HASH_FILENAME"
    local env_hash_file="$BUILD_DIR/$ENV_HASH_FILENAME"

    # 计算环境变量 hash（NEXT_PUBLIC_* 变量会影响构建结果）
    if [[ "$(uname)" == "Darwin" ]]; then
        CURRENT_ENV_HASH=$(env | grep "^NEXT_PUBLIC_" | sort | /sbin/md5 -q)
    elif command -v md5sum &> /dev/null; then
        CURRENT_ENV_HASH=$(env | grep "^NEXT_PUBLIC_" | sort | md5sum | cut -d' ' -f1)
    else
        log_warn "md5 or md5sum command not found. Skipping env hash check."
        CURRENT_ENV_HASH=""
    fi

    # 验证构建产物完整性
    _verify_build_artifacts() {
        local dir="$1"
        [[ -d "$dir/standalone" ]] && \
        [[ -d "$dir/standalone/apps/web" ]] && \
        [[ -d "$dir/standalone/apps/web/$dir/server" ]] && \
        [[ -f "$dir/standalone/deploy-info.json" ]] && \
        [[ -f "$dir/$BUILD_HASH_FILENAME" ]]
    }

    # 如果构建目录存在且代码未变更，则跳过构建
    if [[ -d "$BUILD_DIR" ]] && _verify_build_artifacts "$BUILD_DIR"; then
        local last_build_hash=""
        local last_env_hash=""

        if [[ -f "$build_hash_file" ]]; then
            last_build_hash=$(cat "$build_hash_file")
        fi
        if [[ -f "$env_hash_file" ]]; then
            last_env_hash=$(cat "$env_hash_file")
        fi

        local current_hash=$(git rev-parse HEAD)

        # 首先检查环境变量是否变更
        if [[ -n "$last_env_hash" ]] && [[ "$last_env_hash" != "$CURRENT_ENV_HASH" ]]; then
            log_info "检测到 NEXT_PUBLIC_* 环境变量变更，需要重新构建"
        elif [[ -n "$last_build_hash" ]] && [[ "$last_build_hash" == "$current_hash" ]]; then
            # 同一个 commit，检查关键文件是否有未提交的变更
            if git diff --quiet -- src/ public/ package.json next.config.js ../../packages/database/prisma/schema.prisma 2>/dev/null; then
                log_success "代码和环境变量均未变更（commit: ${current_hash:0:7}），跳过构建"
                NEED_BUILD=false
            else
                log_info "检测到未提交的代码变更，需要重新构建"
            fi
        elif [[ -n "$last_build_hash" ]]; then
            # 不同 commit，检查关键文件是否变更
            if git diff --quiet "$last_build_hash" HEAD -- src/ public/ package.json next.config.js ../../packages/database/prisma/schema.prisma 2>/dev/null; then
                log_success "关键文件未变更（${last_build_hash:0:7}..${current_hash:0:7}），跳过构建"
                NEED_BUILD=false
            else
                log_info "检测到代码变更（${last_build_hash:0:7}..${current_hash:0:7}），需要重新构建"
            fi
        else
            log_info "未找到上次构建记录，需要重新构建"
        fi
    else
        log_info "$BUILD_DIR 目录不存在或构建产物不完整，需要重新构建"
    fi
    echo ""
}

# 清理旧构建
_clean_old_build() {
    if [[ "$NEED_BUILD" == "true" ]]; then
        log_info "Step 1/6: 清理旧构建..."
    else
        log_info "Step 1/6: 跳过清理（使用缓存构建）"
    fi

    # 只在需要重新构建时执行清理
    if [[ "$NEED_BUILD" == "true" ]]; then
        if [[ -d "$BUILD_DIR" ]]; then
            # 先尝试修复权限，然后删除
            chmod -R u+rwX "$BUILD_DIR" 2>/dev/null || true
            rm -rf "$BUILD_DIR" 2>/dev/null || {
                log_warn "普通删除失败，尝试强制清理..."
                find "$BUILD_DIR" -type f -delete 2>/dev/null || true
                find "$BUILD_DIR" -type d -empty -delete 2>/dev/null || true
                rm -rf "$BUILD_DIR" 2>/dev/null || true
            }

            if [[ -d "$BUILD_DIR" ]]; then
                log_warn "无法完全清理 $BUILD_DIR 目录，尝试重命名后继续..."
                mv "$BUILD_DIR" "$BUILD_DIR.bak.$(date +%s)" 2>/dev/null || true
            fi
        fi
        log_success "清理完成"
    fi
    echo ""
}

# 安装依赖
_install_dependencies() {
    log_info "Step 2/6: 检查依赖变更..."

    NEED_INSTALL=false

    if [[ ! -d "node_modules" ]]; then
        log_info "node_modules 不存在，需要安装依赖"
        NEED_INSTALL=true
    else
        if git diff --quiet HEAD~1 HEAD -- package.json pnpm-lock.yaml 2>/dev/null; then
            log_success "依赖文件未变更，跳过安装（节省 ~2-3秒）"
        else
            log_info "检测到依赖变更（package.json 或 pnpm-lock.yaml），需要重新安装"
            NEED_INSTALL=true
        fi
    fi

    if [[ "$NEED_INSTALL" == "true" ]]; then
        log_info "执行依赖安装..."
        pnpm install --frozen-lockfile
        log_success "依赖安装完成"
    fi
    echo ""
}

# 生成 Prisma Client
_generate_prisma_client() {
    local prisma_schema_hash_file="$BUILD_DIR/$PRISMA_HASH_FILENAME"

    # 计算 Prisma schema hash
    PRISMA_SCHEMA_HASH=""
    if [[ -f "$DATABASE_DIR/prisma/schema.prisma" ]]; then
        local schema_file_hash migrations_hash
        if [[ "$(uname)" == "Darwin" ]]; then
            schema_file_hash=$(/sbin/md5 -q "$DATABASE_DIR/prisma/schema.prisma")
            if [[ -d "$DATABASE_DIR/prisma/migrations" ]]; then
                migrations_hash=$(find "$DATABASE_DIR/prisma/migrations" -type f -exec /sbin/md5 -q {} \; | sort | /sbin/md5 -q)
            else
                migrations_hash="no-migrations"
            fi
        elif command -v md5sum &> /dev/null; then
            schema_file_hash=$(md5sum "$DATABASE_DIR/prisma/schema.prisma" | cut -d' ' -f1)
            if [[ -d "$DATABASE_DIR/prisma/migrations" ]]; then
                migrations_hash=$(find "$DATABASE_DIR/prisma/migrations" -type f -exec md5sum {} \; | sort | md5sum | cut -d' ' -f1)
            else
                migrations_hash="no-migrations"
            fi
        else
            log_warn "md5 or md5sum command not found. Skipping prisma schema hash check."
            PRISMA_SCHEMA_HASH=""
        fi
        PRISMA_SCHEMA_HASH="${schema_file_hash}-${migrations_hash}"
    fi

    local last_prisma_schema_hash=""
    if [[ -f "$prisma_schema_hash_file" ]]; then
        last_prisma_schema_hash=$(cat "$prisma_schema_hash_file")
    fi

    NEED_PRISMA_GENERATE=false
    if [[ "$NEED_BUILD" == "true" ]] || [[ "$NEED_INSTALL" == "true" ]]; then
        NEED_PRISMA_GENERATE=true
    elif [[ -n "$PRISMA_SCHEMA_HASH" && "$PRISMA_SCHEMA_HASH" != "$last_prisma_schema_hash" ]]; then
        log_info "检测到 Prisma schema 变更，需要重新生成 Prisma Client"
        NEED_PRISMA_GENERATE=true
    fi

    if [[ "$NEED_PRISMA_GENERATE" == "true" ]]; then
        log_info "Step 3/6: 生成 Prisma Client..."
        npx prisma generate --schema=../../packages/database/prisma/schema.prisma
        log_success "Prisma Client 生成完成"
    else
        log_info "Step 3/6: 跳过 Prisma Client 生成（使用缓存）"
    fi
    echo ""
}

# 构建应用
_build_application() {
    local env=$1

    if [[ "$NEED_BUILD" == "true" ]]; then
        log_info "Step 4/6: 构建应用 (APP_ENVIRONMENT=$env, BUILD_DIR=$BUILD_DIR)..."

        # 验证关键的 NEXT_PUBLIC_* 环境变量已加载
        if ! show_env_validation "$env"; then
            return 1
        fi

        # 构建时确保所有环境变量可用（已通过 set -a 导出）
        NEXT_BUILD_DIR=$BUILD_DIR pnpm build
        log_success "构建完成"

        # 构建 Cron 调度器 bundle
        _build_cron_scheduler
    else
        log_info "Step 4/6: 跳过构建（使用缓存的构建产物）"
    fi
    echo ""

    return 0
}

# 构建 Cron 调度器
_build_cron_scheduler() {
    local cron_bundle_file="$PROJECT_ROOT/infra/scripts/cron/scheduler.bundle.js"
    local cron_hash_file="$BUILD_DIR/$CRON_HASH_FILENAME"
    local need_cron_build=true

    if [[ -f "$cron_bundle_file" ]] && [[ -f "$cron_hash_file" ]]; then
        local last_cron_hash=$(cat "$cron_hash_file")
        local current_cron_hash

        if [[ "$(uname)" == "Darwin" ]]; then
            current_cron_hash=$(git -C "$PROJECT_ROOT" ls-files -s infra/scripts/cron/ apps/web/src/services/credit-cache.ts apps/web/src/services/order-lifecycle.ts apps/web/src/lib/order-sms.ts 2>/dev/null | /sbin/md5 -q)
        elif command -v md5sum &> /dev/null; then
            current_cron_hash=$(git -C "$PROJECT_ROOT" ls-files -s infra/scripts/cron/ apps/web/src/services/credit-cache.ts apps/web/src/services/order-lifecycle.ts apps/web/src/lib/order-sms.ts 2>/dev/null | md5sum | cut -d' ' -f1)
        else
            log_warn "md5 or md5sum command not found. Skipping cron hash check."
            current_cron_hash=""
        fi

        if [[ "$last_cron_hash" == "$current_cron_hash" ]]; then
            log_success "Cron 调度器源码未变更，跳过重新打包（节省 ~10-15s）"
            need_cron_build=false
        fi
    fi

    if [[ "$need_cron_build" == "true" ]]; then
        log_info "构建 Cron 调度器 bundle..."
        pnpm cron:build

        # 保存 cron hash
        local current_cron_hash
        if [[ "$(uname)" == "Darwin" ]]; then
            current_cron_hash=$(git -C "$PROJECT_ROOT" ls-files -s infra/scripts/cron/ apps/web/src/services/credit-cache.ts apps/web/src/services/order-lifecycle.ts apps/web/src/lib/order-sms.ts 2>/dev/null | /sbin/md5 -q)
        elif command -v md5sum &> /dev/null; then
            current_cron_hash=$(git -C "$PROJECT_ROOT" ls-files -s infra/scripts/cron/ apps/web/src/services/credit-cache.ts apps/web/src/services/order-lifecycle.ts apps/web/src/lib/order-sms.ts 2>/dev/null | md5sum | cut -d' ' -f1)
        else
            log_warn "md5 or md5sum command not found. Skipping cron hash check."
            current_cron_hash=""
        fi
        echo "$current_cron_hash" > "$cron_hash_file"
        log_success "Cron 调度器 bundle 构建完成"
    fi
}

# 准备 standalone 包
_prepare_standalone_package() {
    local env=$1

    log_info "Step 5/6: 准备 standalone 包..."
    if [[ ! -d "$BUILD_DIR/standalone" ]]; then
        log_error "standalone 目录不存在，请检查 next.config.js 中是否配置了 output: 'standalone'"
        exit 1
    fi

    if [[ "$NEED_BUILD" == "true" ]]; then
        log_info "复制构建产物到 standalone 目录..."
        mkdir -p "$BUILD_DIR/standalone/apps/web/$BUILD_DIR"

        # 复制 server 目录
        if [[ -d "$BUILD_DIR/server" ]]; then
            cp -r "$BUILD_DIR/server" "$BUILD_DIR/standalone/apps/web/$BUILD_DIR/"
        fi

        # 复制 static 目录
        if [[ -d "$BUILD_DIR/static" ]]; then
            cp -r "$BUILD_DIR/static" "$BUILD_DIR/standalone/apps/web/$BUILD_DIR/"
        fi

        # 复制 public 目录
        if [[ -d "public" ]]; then
            cp -r public "$BUILD_DIR/standalone/apps/web/"
        fi
    else
        log_info "使用缓存的构建产物（无需重新复制）"
    fi

    # 始终更新部署信息
    local deploy_info="{\"commit\": \"$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')\", \"built_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\", \"env\": \"$env\", \"built_by\": \"$(whoami)\", \"trigger\": \"local\"}"
    echo "$deploy_info" > "$BUILD_DIR/standalone/deploy-info.json"

    log_success "standalone 包准备完成"
}

# 创建 pnpm 符号链接
_create_pnpm_symlinks() {
    log_info "Step 5.5/6: 创建 pnpm 符号链接（standalone 模式）..."
    if node scripts/post-build-standalone.js 2>&1; then
        log_success "符号链接创建完成"
    else
        log_error "符号链接创建失败，中止部署"
        return 1
    fi

    # 验证 standalone/node_modules 确实存在且包含关键模块
    if [ ! -d "$BUILD_DIR/standalone/node_modules" ]; then
        log_error "standalone/node_modules 目录不存在，中止部署"
        return 1
    fi
    if [ ! -e "$BUILD_DIR/standalone/node_modules/next" ]; then
        log_error "standalone/node_modules/next 不存在（符号链接可能损坏），中止部署"
        return 1
    fi
    echo ""
}

# 保存构建 hash
_save_build_hashes() {
    local build_hash_file="$BUILD_DIR/$BUILD_HASH_FILENAME"
    local env_hash_file="$BUILD_DIR/$ENV_HASH_FILENAME"
    local prisma_hash_file="$BUILD_DIR/$PRISMA_HASH_FILENAME"

    if [[ "$NEED_BUILD" == "true" ]]; then
        local current_hash=$(git rev-parse HEAD)
        echo "$current_hash" > "$build_hash_file"
        echo "$CURRENT_ENV_HASH" > "$env_hash_file"
        log_info "记录构建版本: ${current_hash:0:7}, 环境 hash: ${CURRENT_ENV_HASH:0:8}"
    fi

    if [[ "$NEED_PRISMA_GENERATE" == "true" ]] && [[ -n "$PRISMA_SCHEMA_HASH" ]]; then
        mkdir -p "$BUILD_DIR"
        echo "$PRISMA_SCHEMA_HASH" > "$prisma_hash_file"
        log_info "记录 Prisma schema hash: ${PRISMA_SCHEMA_HASH:0:8}"
    fi
}

# 显示包大小分析
_show_package_analysis() {
    local total_size=$(du -sh $BUILD_DIR/standalone | cut -f1)
    log_info "📦 包大小分析:"
    log_info "  总大小: $total_size"
    du -sh $BUILD_DIR/standalone/* 2>/dev/null | sort -hr | head -5 | while read size path; do
        local name=$(basename "$path")
        echo "    - $name: $size"
    done
}
