#!/bin/bash
# ============================================
# Deploy CI Checks Module
# 部署前 CI 检查模块
#
# 导出函数：
#   - run_ci_checks()
#
# 依赖：
#   - deploy-common.sh（需要先 source）
# ============================================

# 执行 CI 检查
# 参数：$1=环境名称（dev/staging/production）
# 环境变量：
#   - SKIP_CI=true 跳过所有检查
#   - TYPECHECK_TIMEOUT 类型检查超时（秒，默认 60）
#   - LINT_TIMEOUT Lint 检查超时（秒，默认 300）
# 返回：0=通过，1=失败
run_ci_checks() {
    local env=$1

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
        return 0
    fi

    log_info "============================================"
    log_info "  执行部署前 CI 检查"
    log_info "============================================"
    echo ""

    # 1. Git 状态检查
    _check_git_status "$env" || return 1

    # 2 & 3. 并行执行 Lint 和 Type-check
    _check_lint_and_typecheck "$env" || return 1

    # 4. 单元测试
    _check_unit_tests "$env" || return 1

    log_info "[4/4] 检查完成"

    log_success "============================================"
    log_success "  ✅ CI 检查完成"
    log_success "============================================"
    record_timing "CI 检查"
    echo ""

    return 0
}

# ============================================
# 内部辅助函数
# ============================================

# Git 状态检查
_check_git_status() {
    local env=$1

    log_info "[1/4] 检查 Git 状态..."
    if [[ -n "$(git status --porcelain)" ]]; then
        log_warn "存在未提交的更改："
        git status --short
        if [[ "$env" == "production" ]]; then
            log_error "生产环境不允许部署未提交的更改"
            return 1
        else
            log_warn "继续部署（非生产环境）"
        fi
    else
        log_success "Git 工作区干净"
    fi
    echo ""
    return 0
}

# 并行执行 Lint 和 Type-check
_check_lint_and_typecheck() {
    local env=$1

    log_info "[2/4] 并行执行 Lint + Type-check..."

    # 创建临时文件存储各任务的输出和退出状态
    local temp_dir=$(mktemp -d)
    local type_check_output="$temp_dir/typecheck.log"
    local lint_output="$temp_dir/lint.log"
    local type_check_exit="$temp_dir/typecheck.exit"
    local lint_exit="$temp_dir/lint.exit"

    # 后台执行 Type-check（增量模式）
    (
        if [[ -f "$FRONTEND_DIR/tsconfig.json" ]]; then
            cd "$FRONTEND_DIR"
            if pnpm exec tsc --noEmit --incremental --pretty > "$type_check_output" 2>&1; then
                echo "0" > "$type_check_exit"
            else
                echo "1" > "$type_check_exit"
            fi
        else
            echo "TypeScript 配置未找到，跳过类型检查" > "$type_check_output"
            echo "0" > "$type_check_exit"
        fi
    ) &
    local type_check_pid=$!

    # 后台执行 Lint
    (
        if grep -q '"lint"' "$PROJECT_ROOT/package.json"; then
            if pnpm lint > "$lint_output" 2>&1; then
                echo "0" > "$lint_exit"
            else
                echo "1" > "$lint_exit"
            fi
        else
            echo "Lint script 未找到，跳过检查" > "$lint_output"
            echo "0" > "$lint_exit"
        fi
    ) &
    local lint_pid=$!

    # 等待两个任务完成（带超时保护）
    log_info "等待 Type-check (PID: $type_check_pid) 和 Lint (PID: $lint_pid) 完成..."

    # 使用可配置的超时时间
    local typecheck_timeout="${TYPECHECK_TIMEOUT:-60}"
    local lint_timeout="${LINT_TIMEOUT:-300}"

    # 等待 Type-check（带超时）
    local typecheck_elapsed=0
    while kill -0 $type_check_pid 2>/dev/null; do
        if [ $typecheck_elapsed -ge $typecheck_timeout ]; then
            log_error "❌ TypeScript 类型检查超时（${typecheck_timeout}秒），强制终止"
            kill -9 $type_check_pid 2>/dev/null || true
            echo "1" > "$type_check_exit"
            break
        fi
        sleep 1
        typecheck_elapsed=$((typecheck_elapsed + 1))
    done
    wait $type_check_pid 2>/dev/null || true

    # 等待 Lint（带超时）
    local lint_elapsed=0
    while kill -0 $lint_pid 2>/dev/null; do
        if [ $lint_elapsed -ge $lint_timeout ]; then
            log_error "❌ Lint 检查超时（${lint_timeout}秒 / 5分钟），强制终止"
            kill -9 $lint_pid 2>/dev/null || true
            echo "1" > "$lint_exit"
            break
        fi
        # 每10秒显示一次进度
        if [ $((lint_elapsed % 10)) -eq 0 ] && [ $lint_elapsed -gt 0 ]; then
            log_info "Lint 检查进行中... (${lint_elapsed}/${lint_timeout}秒)"
        fi
        sleep 1
        lint_elapsed=$((lint_elapsed + 1))
    done
    wait $lint_pid 2>/dev/null || true

    # 读取退出状态
    local type_check_result=$(cat "$type_check_exit" 2>/dev/null || echo "1")
    local lint_result=$(cat "$lint_exit" 2>/dev/null || echo "1")

    # 显示 Type-check 结果
    echo ""
    log_info "TypeScript 类型检查结果:"
    cat "$type_check_output"
    if [[ "$type_check_result" == "0" ]]; then
        log_success "✅ TypeScript 类型检查通过"
    else
        log_error "❌ TypeScript 类型检查失败"
        log_error "请先修复类型错误再部署，避免浪费构建时间"
        rm -rf "$temp_dir"
        return 1
    fi
    echo ""

    # 显示 Lint 结果
    log_info "Lint 检查结果:"
    cat "$lint_output"
    if [[ "$lint_result" == "0" ]]; then
        log_success "✅ Lint 检查通过"
    else
        log_error "❌ Lint 检查失败"
        if [[ "$env" == "production" ]]; then
            log_error "生产环境必须通过 Lint 检查"
            rm -rf "$temp_dir"
            return 1
        else
            log_warn "继续部署（非生产环境）"
        fi
    fi
    echo ""

    # 清理临时文件
    rm -rf "$temp_dir"
    return 0
}

# 单元测试检查
_check_unit_tests() {
    local env=$1

    log_info "[3/4] 运行单元测试..."
    if grep -q '"test"' "$PROJECT_ROOT/package.json"; then
        if grep -q '"test:ci"' "$PROJECT_ROOT/package.json"; then
            if pnpm test:ci 2>&1; then
                log_success "测试通过"
            else
                log_warn "测试失败"
                if [[ "$env" == "production" ]]; then
                    log_error "生产环境必须通过所有测试"
                    return 1
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
    return 0
}
