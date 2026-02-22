#!/bin/bash
# ============================================
# Deploy File Sync Module
# 文件同步模块（本地 -> 远程服务器）
#
# 导出函数：
#   - run_file_sync()
#
# 依赖：
#   - deploy-common.sh（需要先 source）
# ============================================

# 全局变量（模块内使用）
REMOTE_BACKUP_PATH=""
NODE_MODULES_RESTORED=false

# ============================================
# 主入口函数
# ============================================

# 执行文件同步到远程服务器
# 参数：$1=环境名称（dev/staging/production）
# 返回：0=成功，1=失败
run_file_sync() {
    local env=$1

    log_info "远程部署模式（使用 SSH）"

    # 1. 检查 SSH 连接
    _check_ssh_connection || return 1

    # 2. 创建目标目录
    _create_remote_directories

    # 3. 创建备份（用于回滚）
    _create_remote_backup "$env"

    # 4. 检查依赖变更
    local local_deps_hash
    local remote_deps_hash
    _check_dependency_changes

    # 5. 同步文件（使用 tar 流式传输）
    _sync_files_with_tar || return 1

    # 6. 同步环境变量和 Cron 脚本
    _sync_env_and_cron

    # 7. 保存依赖 hash
    _save_deps_hash "$local_deps_hash"

    record_timing "文件同步"

    return 0
}

# ============================================
# 内部辅助函数
# ============================================

# 检查 SSH 连接
_check_ssh_connection() {
    local connect_timeout="${SSH_CONNECT_TIMEOUT:-10}"

    log_info "检查 SSH 连接 (端口: $SERVER_PORT)..."
    if ! ssh ${SSH_OPTS} -o ConnectTimeout=$connect_timeout "$SERVER_USER@$SERVER_HOST" "echo 'SSH 连接成功'" 2>/dev/null; then
        log_error "无法连接到服务器 $SERVER_HOST:$SERVER_PORT"
        log_error "请检查:"
        log_error "  1. 服务器地址是否正确"
        log_error "  2. SSH 密钥是否已配置 (~/.ssh/config 或 ssh-copy-id)"
        log_error "  3. 服务器安全组是否允许 SSH 端口 $SERVER_PORT 访问"
        return 1
    fi
    return 0
}

# 创建远程目录
_create_remote_directories() {
    log_info "创建目标目录..."
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "sudo mkdir -p $DEPLOY_PATH/frontend/$REMOTE_BUILD_DIR && sudo chown -R \$(whoami):\$(whoami) $DEPLOY_PATH"
}

# 创建远程备份
_create_remote_backup() {
    local env=$1
    local backup_keep_count="${BACKUP_KEEP_COUNT:-2}"

    REMOTE_BACKUP_PATH=""

    if [[ "$env" == "staging" ]]; then
        # staging 环境：只备份 node_modules
        log_info "Staging 环境：创建轻量级备份（仅 node_modules）..."
        local backup_timestamp=$(date +%Y%m%d_%H%M%S)
        REMOTE_BACKUP_PATH="$DEPLOY_PATH.backup.$backup_timestamp"
        local remote_node_modules_path="$REMOTE_STANDALONE_PATH/apps/web/node_modules"

        if ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
            if [[ -d $remote_node_modules_path ]]; then
                mkdir -p $REMOTE_BACKUP_PATH
                mv $remote_node_modules_path $REMOTE_BACKUP_PATH/node_modules
                echo 'node_modules 已备份'
            else
                echo 'node_modules 不存在，跳过备份'
            fi
        " 2>/dev/null; then
            log_success "轻量级备份完成（仅 node_modules）"
            _cleanup_old_backups "$backup_keep_count"
        else
            log_warn "备份失败（可能是首次部署），继续部署"
            REMOTE_BACKUP_PATH=""
        fi
    else
        # production 环境：创建完整备份
        log_info "创建远程部署备份..."
        local backup_start=$(date +%s)
        if ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "[[ -d $REMOTE_STANDALONE_PATH ]]" 2>/dev/null; then
            REMOTE_BACKUP_PATH="${REMOTE_STANDALONE_PATH}.backup.$(date +%s)"
            if ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "mv $REMOTE_STANDALONE_PATH $REMOTE_BACKUP_PATH" 2>/dev/null; then
                local backup_end=$(date +%s)
                local backup_duration=$((backup_end - backup_start))
                log_success "远程备份已创建: $(basename $REMOTE_BACKUP_PATH) (耗时: ${backup_duration}s)"
                _cleanup_old_backups "$backup_keep_count"
            else
                log_warn "无法创建远程备份，跳过回滚支持"
                REMOTE_BACKUP_PATH=""
            fi
        else
            log_info "首次部署，无需备份"
        fi
    fi
}

# 清理旧备份
_cleanup_old_backups() {
    local keep_count=$1

    # 清理主备份目录
    local old_backups_count=$(ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
        cd $(dirname $DEPLOY_PATH) 2>/dev/null && \
        ls -dt $(basename $DEPLOY_PATH).backup.* 2>/dev/null | wc -l
    " 2>/dev/null || echo "0")

    if [[ "$old_backups_count" -gt "$keep_count" ]]; then
        log_info "清理旧备份（保留最近 $keep_count 个，当前 $old_backups_count 个）..."
        ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
            cd $(dirname $DEPLOY_PATH) && \
            ls -dt $(basename $DEPLOY_PATH).backup.* 2>/dev/null | tail -n +$((keep_count + 1)) | xargs rm -rf
        " 2>/dev/null || true
    fi

    # 清理 standalone 子目录备份
    local old_standalone_backups=$(ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
        cd $(dirname $REMOTE_STANDALONE_PATH) 2>/dev/null && \
        ls -dt standalone.backup.* 2>/dev/null | wc -l
    " 2>/dev/null || echo "0")

    if [[ "$old_standalone_backups" -gt "$keep_count" ]]; then
        log_info "清理 standalone 旧备份（保留最近 $keep_count 个，当前 $old_standalone_backups 个）..."
        ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
            cd $(dirname $REMOTE_STANDALONE_PATH) && \
            ls -dt standalone.backup.* 2>/dev/null | tail -n +$((keep_count + 1)) | xargs rm -rf
        " 2>/dev/null || true
    fi
}

# 检查依赖变更
_check_dependency_changes() {
    log_info "检查依赖变更..."

    # 计算本地 pnpm-lock.yaml 的 hash
    if [[ "$(uname)" == "Darwin" ]]; then
        local_deps_hash=$(cat "$PROJECT_ROOT/pnpm-lock.yaml" 2>/dev/null | /sbin/md5 -q)
    elif command -v md5sum &> /dev/null; then
        local_deps_hash=$(cat "$PROJECT_ROOT/pnpm-lock.yaml" 2>/dev/null | md5sum | cut -d' ' -f1)
    else
        log_warn "md5 or md5sum command not found. Skipping deps hash check."
        local_deps_hash=""
    fi

    # 读取服务器端保存的 hash
    remote_deps_hash=$(ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "cat $DEPLOY_PATH/.deps-hash 2>/dev/null || echo ''")

    # 显示变更信息
    if [[ "$local_deps_hash" != "$remote_deps_hash" ]]; then
        if [[ -z "$remote_deps_hash" ]]; then
            log_info "首次部署或依赖 hash 丢失，使用 tar 全量同步"
        else
            log_info "依赖已变更（hash: ${local_deps_hash:0:8}... → ${remote_deps_hash:0:8}...），使用 tar 全量同步"
        fi
    else
        log_info "依赖未变更，使用 tar 快速同步"
    fi
    log_success "使用 tar 流式传输模式（推荐）⚡"
}

# 使用 tar 同步文件
_sync_files_with_tar() {
    log_info "并行同步文件到服务器..."

    # 获取 rsync 带宽限制参数
    local bwlimit_arg=$(get_rsync_bwlimit)
    [[ -n "$bwlimit_arg" ]] && log_info "带宽限制: $RSYNC_BWLIMIT KB/s"

    # 预创建目标目录
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "mkdir -p $REMOTE_STANDALONE_FRONTEND/$REMOTE_BUILD_DIR/static"

    # 同步 standalone/node_modules（包含本地创建的符号链接）
    if [ -e "$FRONTEND_DIR/$BUILD_DIR/standalone/node_modules/next" ]; then
        log_info "检测到本地 node_modules，将同步 standalone/node_modules"
    else
        log_error "本地 standalone/node_modules/next 不存在，中止同步（请检查 post-build-standalone.js）"
        return 1
    fi

    log_info "使用 tar 流式传输所有文件（排除 frontend/node_modules）..."
    log_info "预计耗时 10-15s（跳过 rsync 文件扫描）⚡"

    local tar_start=$(date +%s)

    # 保护现有 node_modules（如果没有备份）
    local temp_node_modules_path=""
    local remote_node_modules_path="$REMOTE_STANDALONE_PATH/apps/web/node_modules"

    if [[ -z "$REMOTE_BACKUP_PATH" ]]; then
        if ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "[[ -d $remote_node_modules_path ]]" 2>/dev/null; then
            log_info "临时保护 node_modules（避免被覆盖）..."
            temp_node_modules_path="$REMOTE_STANDALONE_PATH.node_modules.tmp"
            if ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "mv $remote_node_modules_path $temp_node_modules_path" 2>/dev/null; then
                log_success "node_modules 已移动到临时位置"
            else
                log_warn "无法保护 node_modules，将在 tar sync 后重新安装"
                temp_node_modules_path=""
            fi
        fi
    fi

    # 清理目标目录中的旧文件
    log_info "清理目标目录中的旧文件..."
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
        cd $REMOTE_STANDALONE_PATH 2>/dev/null || mkdir -p $REMOTE_STANDALONE_PATH
        if [[ -d frontend ]]; then
            find frontend -mindepth 1 -maxdepth 1 ! -name 'node_modules' -exec rm -rf {} \; 2>/dev/null || true
        fi
    "

    # 注意：不再预清理 standalone/node_modules
    # 原因：production 备份已将整个 standalone 移走，预清理是空操作；
    #       若备份未创建（首次部署），预清理会导致 tar 失败时 node_modules 无法恢复。
    #       tar 解压会自动覆盖同名文件/目录，无需预先清理。

    # 创建 tar 包并传输
    log_info "创建并传输 tar 包..."
    local build_dir_path="$FRONTEND_DIR/$BUILD_DIR"

    set -o pipefail
    # 注意：stderr 不能通过 2>&1 混入管道，否则文本会污染 tar 二进制数据流
    # 使用独立文件捕获 tar stderr 以便调试
    local tar_stderr_file=$(mktemp)
    if tar --no-xattrs --no-mac-metadata -czf - \
        -C "$build_dir_path" standalone static \
        -C "$FRONTEND_DIR" prisma \
        -C "$PROJECT_ROOT" pnpm-lock.yaml infra/scripts 2>"$tar_stderr_file" | \
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" \
        "cd $DEPLOY_PATH/frontend/$REMOTE_BUILD_DIR && tar -xzf - && \
         rm -rf $DEPLOY_PATH/frontend/prisma 2>/dev/null; \
         mv prisma $DEPLOY_PATH/frontend/ 2>/dev/null || true && \
         mv pnpm-lock.yaml $DEPLOY_PATH/ 2>/dev/null || true && \
         rm -rf $DEPLOY_PATH/scripts 2>/dev/null || true && \
         mv scripts $DEPLOY_PATH/ 2>/dev/null || true"; then
        local tar_end=$(date +%s)
        local tar_duration=$((tar_end - tar_start))
        log_success "tar 传输和解压成功（耗时: ${tar_duration}s）⚡"
        # 输出 tar 警告信息（如果有）用于调试
        if [[ -s "$tar_stderr_file" ]]; then
            log_info "tar 警告信息（不影响部署）："
            head -5 "$tar_stderr_file" 2>/dev/null || true
        fi
    else
        local tar_end=$(date +%s)
        local tar_duration=$((tar_end - tar_start))
        log_error "tar 传输或解压失败！（耗时: ${tar_duration}s）"
        # 输出 tar 错误信息
        if [[ -s "$tar_stderr_file" ]]; then
            log_error "tar 错误详情："
            cat "$tar_stderr_file" 2>/dev/null || true
        fi
        rm -f "$tar_stderr_file" 2>/dev/null || true
        set +o pipefail
        return 1
    fi
    rm -f "$tar_stderr_file" 2>/dev/null || true
    set +o pipefail

    # 验证关键文件（含 node_modules 深度检查）
    log_info "验证关键文件..."
    local verify_result
    verify_result=$(ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
        PASS=true
        # 基础文件检查
        [[ -f $REMOTE_STANDALONE_FRONTEND/server.js ]] && echo '  server.js: OK' || { echo '  server.js: MISSING'; PASS=false; }
        [[ -d $REMOTE_STANDALONE_FRONTEND/$REMOTE_BUILD_DIR/server ]] && echo '  server dir: OK' || { echo '  server dir: MISSING'; PASS=false; }
        [[ -f $REMOTE_STANDALONE_FRONTEND/$REMOTE_BUILD_DIR/BUILD_ID ]] && echo '  BUILD_ID: OK' || { echo '  BUILD_ID: MISSING'; PASS=false; }

        # node_modules 深度验证：不仅检查目录存在，还检查 .pnpm 目录和关键依赖
        if [[ -d $REMOTE_STANDALONE_PATH/node_modules ]]; then
            NM_COUNT=\$(ls -1 $REMOTE_STANDALONE_PATH/node_modules/ 2>/dev/null | wc -l)
            if [[ \$NM_COUNT -gt 5 ]]; then
                echo \"  standalone/node_modules: OK (\${NM_COUNT} entries)\"
            else
                echo \"  standalone/node_modules: INCOMPLETE (only \${NM_COUNT} entries, expected >5)\"
                PASS=false
            fi
        else
            echo '  standalone/node_modules: MISSING'
            PASS=false
        fi

        if [[ -d $REMOTE_STANDALONE_PATH/node_modules/.pnpm ]]; then
            PNPM_COUNT=\$(ls -1 $REMOTE_STANDALONE_PATH/node_modules/.pnpm/ 2>/dev/null | wc -l)
            echo \"  standalone/node_modules/.pnpm: OK (\${PNPM_COUNT} packages)\"
        else
            echo '  standalone/node_modules/.pnpm: MISSING'
            PASS=false
        fi

        [[ -e $REMOTE_STANDALONE_FRONTEND/node_modules/next ]] && echo '  frontend/node_modules/next: OK' || { echo '  frontend/node_modules/next: MISSING'; PASS=false; }

        \$PASS && echo 'VERIFY_PASS' || echo 'VERIFY_FAIL'
    " 2>/dev/null)

    echo "$verify_result" | grep -v 'VERIFY_' || true

    if echo "$verify_result" | grep -q 'VERIFY_PASS'; then
        log_success "关键文件验证通过"
    else
        log_error "关键文件验证失败！"

        # 尝试从备份恢复 node_modules
        if [[ -n "$REMOTE_BACKUP_PATH" ]]; then
            log_warn "尝试从备份恢复 node_modules..."
            if ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
                if [[ -d $REMOTE_BACKUP_PATH/node_modules/.pnpm ]]; then
                    cp -a $REMOTE_BACKUP_PATH/node_modules $REMOTE_STANDALONE_PATH/node_modules
                    echo 'RESTORE_OK'
                else
                    echo 'RESTORE_FAIL'
                fi
            " 2>/dev/null | grep -q 'RESTORE_OK'; then
                log_success "node_modules 已从备份恢复"
            else
                log_error "备份中也没有可用的 node_modules，中止部署"
                return 1
            fi
        elif [[ -n "$temp_node_modules_path" ]]; then
            log_warn "尝试从临时保护位置恢复 node_modules..."
            if ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "
                if [[ -d $temp_node_modules_path ]]; then
                    mv $temp_node_modules_path $REMOTE_STANDALONE_PATH/node_modules 2>/dev/null
                    echo 'RESTORE_OK'
                else
                    echo 'RESTORE_FAIL'
                fi
            " 2>/dev/null | grep -q 'RESTORE_OK'; then
                log_success "node_modules 已从临时位置恢复"
                temp_node_modules_path=""  # 已使用，清除标记
            else
                log_error "无可用的 node_modules 恢复源，中止部署"
                return 1
            fi
        else
            log_error "无可用备份恢复 node_modules，中止部署"
            return 1
        fi

        # 恢复后重新验证 frontend/node_modules/next
        if ! ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "[[ -e $REMOTE_STANDALONE_FRONTEND/node_modules/next ]]" 2>/dev/null; then
            log_error "恢复后 frontend/node_modules/next 仍然缺失，中止部署"
            return 1
        fi
    fi

    # 确保回到 frontend 目录
    cd "$FRONTEND_DIR"

    # 标记 node_modules 已通过 tar 同步
    NODE_MODULES_RESTORED=true

    # 注意：不在这里清理备份的 node_modules
    # 备份（含 node_modules）保留到健康检查通过后，由 _restart_application() 中的
    # "rm -rf $REMOTE_BACKUP_PATH" 统一清理。这确保回滚时备份仍有完整的 node_modules。
    if [[ -n "$temp_node_modules_path" ]]; then
        log_info "清理临时 node_modules（已通过 tar 同步新版本）..."
        ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "rm -rf $temp_node_modules_path" 2>/dev/null || true
    fi

    log_success "node_modules 已通过 tar 同步（确保版本一致）⚡"
    log_success "所有文件同步完成（tar 快速模式，实际耗时: ${tar_duration}s）"

    return 0
}

# 同步环境变量和 Cron 脚本
_sync_env_and_cron() {
    # 同步环境变量文件
    log_info "同步环境变量文件到服务器..."
    scp ${SCP_OPTS} "$ENV_FILE" "$SERVER_USER@$SERVER_HOST:$REMOTE_STANDALONE_FRONTEND/.env"
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "chmod 644 $REMOTE_STANDALONE_FRONTEND/.env"
    log_success "环境变量文件已同步: .env.$ENV -> standalone/apps/web/.env"

    # 同步 Cron 调度器 bundle
    log_info "同步 Cron 调度器 bundle..."
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "mkdir -p $REMOTE_STANDALONE_FRONTEND/scripts/cron"
    scp ${SCP_OPTS} scripts/cron/scheduler.bundle.js "$SERVER_USER@$SERVER_HOST:$REMOTE_STANDALONE_FRONTEND/scripts/cron/"
    log_success "Cron 调度器 bundle 已同步"

    log_success "文件同步完成"
}

# 保存依赖 hash 到服务器
_save_deps_hash() {
    local deps_hash=$1

    if [[ -n "$deps_hash" ]]; then
        ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "echo '$deps_hash' > $DEPLOY_PATH/.deps-hash"
        log_success "依赖 hash 已保存到服务器（${deps_hash:0:8}...）"
    fi
}

# 验证 Next.js 运行时依赖
verify_nextjs_runtime() {
    log_info "验证 Next.js 运行时依赖（符号链接）..."
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export REMOTE_STANDALONE_PATH='$REMOTE_STANDALONE_PATH'; bash -s" << 'ENDSSH'
        set -e
        cd $REMOTE_STANDALONE_PATH

        if [ -d "node_modules/next" ] && [ -f "node_modules/next/package.json" ]; then
            echo "[SUCCESS] Next.js 运行时依赖已就绪"
        else
            echo "[WARN] Next.js 符号链接缺失，但本地构建应已创建"
            echo "[INFO] 可用的 .pnpm 包："
            ls -la node_modules/.pnpm/ | grep next | head -3 || echo "No Next.js packages found"
        fi
ENDSSH
    log_success "Next.js 运行时依赖验证完成"
    record_timing "Next.js 依赖"
}

# 安装原生模块
install_native_modules() {
    if [[ "$NODE_MODULES_RESTORED" == "true" ]]; then
        log_info "node_modules 已从备份恢复，跳过原生模块检查（节省 ~60s）⚡"
        log_success "原生模块检查完成（使用缓存）"
    else
        log_info "检查并安装 Linux 平台原生模块..."
        ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export REMOTE_STANDALONE_FRONTEND='$REMOTE_STANDALONE_FRONTEND'; bash -s" << 'ENDSSH'
            set -e
            cd $REMOTE_STANDALONE_FRONTEND

            NEED_INSTALL=false

            echo "[INFO] 检查 sharp 模块..."
            if [ -d "node_modules/sharp" ] && [ -f "node_modules/sharp/package.json" ]; then
                SHARP_VERSION=$(grep '"version"' node_modules/sharp/package.json | head -1 | cut -d'"' -f4)
                REQUIRED_VERSION=$(grep '"sharp"' package.json | cut -d'"' -f4 | tr -d '^~')
                if [ "$SHARP_VERSION" = "$REQUIRED_VERSION" ]; then
                    echo "[INFO] sharp 模块已安装 (v$SHARP_VERSION)"
                else
                    NEED_INSTALL=true
                fi
            else
                NEED_INSTALL=true
            fi

            if [ "$NEED_INSTALL" = "true" ]; then
                if command -v pnpm &> /dev/null; then
                    echo "[INFO] 使用 pnpm 安装 sharp..."
                    pnpm add sharp --ignore-scripts 2>&1 || {
                        echo "[WARN] sharp 安装失败"
                    }
                else
                    echo "[ERROR] pnpm 未安装"
                    exit 1
                fi
            fi

            echo "[SUCCESS] 原生模块检查完成"
ENDSSH
        log_success "原生模块检查完成"
    fi
    record_timing "原生模块检查"
}
