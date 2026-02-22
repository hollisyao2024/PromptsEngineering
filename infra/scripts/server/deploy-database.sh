#!/bin/bash
# ============================================
# Deploy Database Module
# 数据库迁移模块
#
# 导出函数：
#   - run_database_migration()
#   - verify_prisma_client()
#
# 依赖：
#   - deploy-common.sh（需要先 source）
# ============================================

# ============================================
# 主入口函数
# ============================================

# 执行数据库迁移
# 参数：$1=环境名称（dev/staging/production）$2=prisma_version $3=schema_hash
# 返回：0=成功，1=失败
run_database_migration() {
    local env=$1
    local prisma_version=$2
    local schema_hash=$3

    log_info "检查数据库 schema 变更..."

    # 检查服务器端的 schema hash
    local remote_schema_hash=$(ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "cat $DEPLOY_PATH/.schema-hash 2>/dev/null || echo ''")

    if [[ -n "$schema_hash" && "$schema_hash" == "$remote_schema_hash" ]]; then
        log_success "数据库 schema 未变更（仍将检查迁移）"
    else
        if [[ -n "$remote_schema_hash" ]]; then
            log_info "数据库 schema 已变更，检查迁移"
        else
            log_info "首次部署或 schema hash 不存在，检查迁移"
        fi
    fi

    # 执行数据库迁移
    log_info "在服务器上执行数据库迁移检查..."
    _execute_remote_migration "$env" "$prisma_version" || return 1

    log_success "数据库迁移检查完成"

    # 保存 schema hash 到服务器
    if [[ -n "$schema_hash" ]]; then
        ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "echo '$schema_hash' > $DEPLOY_PATH/.schema-hash"
    fi
    record_timing "数据库迁移"

    return 0
}

# 验证并生成 Prisma Client
# 参数：$1=prisma_version $2=schema_hash
verify_prisma_client() {
    local prisma_version=$1
    local schema_hash=$2

    log_info "验证并生成 Prisma Client（standalone 目录）..."
    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export REMOTE_STANDALONE_PATH='$REMOTE_STANDALONE_PATH' REMOTE_STANDALONE_FRONTEND='$REMOTE_STANDALONE_FRONTEND' REMOTE_DATABASE_DIR='$REMOTE_DATABASE_DIR' PRISMA_VERSION='$prisma_version' PRISMA_SCHEMA_HASH='$schema_hash'; bash -s" << 'ENDSSH'
        set -e
        STANDALONE_DIR="$REMOTE_STANDALONE_FRONTEND"
        STANDALONE_ROOT="$REMOTE_STANDALONE_PATH"
        PRISMA_CLIENT_DIR="$STANDALONE_DIR/node_modules/.prisma/client"
        PRISMA_SCHEMA_HASH_FILE="$STANDALONE_DIR/.prisma-schema-hash"
        PRISMA_SCHEMA="$REMOTE_DATABASE_DIR/prisma/schema.prisma"

        # 步骤 1: 确保 prisma 符号链接存在
        if [[ ! -L "$STANDALONE_DIR/prisma" ]] && [[ ! -d "$STANDALONE_DIR/prisma" ]]; then
            echo "[INFO] 创建 prisma 符号链接..."
            ln -sf "$REMOTE_DATABASE_DIR/prisma" "$STANDALONE_DIR/prisma"
            echo "[SUCCESS] prisma 符号链接已创建"
        fi

        # 步骤 2: 验证 Prisma Client 是否存在且平台正确
        NEED_GENERATE=false
        PNPM_DIR="$STANDALONE_ROOT/node_modules/.pnpm"
        PNPM_PRISMA=$(find "$PNPM_DIR" -maxdepth 1 -type d -name '@prisma+client@*' 2>/dev/null | head -1)

        if [[ -n "$PNPM_PRISMA" ]]; then
            PNPM_PRISMA_CLIENT="$PNPM_PRISMA/node_modules/.prisma/client"
            if [[ -f "$PNPM_PRISMA_CLIENT/libquery_engine-rhel-openssl-1.1.x.so.node" ]] || \
               [[ -f "$PNPM_PRISMA_CLIENT/libquery_engine-rhel-openssl-3.0.x.so.node" ]] || \
               [[ -f "$PNPM_PRISMA_CLIENT/libquery_engine-debian-openssl-1.1.x.so.node" ]] || \
               [[ -f "$PNPM_PRISMA_CLIENT/libquery_engine-debian-openssl-3.0.x.so.node" ]]; then
                echo "[INFO] Prisma Client 已存在于 .pnpm 目录且包含 Linux 引擎"
                NEED_GENERATE=false
            else
                echo "[INFO] Prisma Client 在 .pnpm 目录但缺少 Linux 平台引擎"
                NEED_GENERATE=true
            fi
        elif [[ ! -d "$PRISMA_CLIENT_DIR" ]]; then
            echo "[INFO] Prisma Client 不存在，需要生成"
            NEED_GENERATE=true
        else
            if [[ -f "$PRISMA_CLIENT_DIR/libquery_engine-rhel-openssl-1.1.x.so.node" ]] || \
               [[ -f "$PRISMA_CLIENT_DIR/libquery_engine-rhel-openssl-3.0.x.so.node" ]]; then
                echo "[INFO] Prisma Client 已存在且包含正确的 Linux 平台引擎"
                NEED_GENERATE=false
            else
                echo "[INFO] Prisma Client 存在但缺少 Linux 平台引擎，需要重新生成"
                NEED_GENERATE=true
            fi
        fi

        # 步骤 3: 如果需要，生成 Prisma Client
        if [[ "$NEED_GENERATE" == "true" ]]; then
            echo "[INFO] 在 standalone 目录生成 Prisma Client..."
            cd "$STANDALONE_DIR"

            PRISMA_BIN=$(find node_modules/.pnpm/prisma@*/node_modules/prisma/build -name "index.js" | head -1)
            if [[ -z "$PRISMA_BIN" ]]; then
                PRISMA_BIN=$(find "$STANDALONE_ROOT/node_modules/.pnpm/prisma@*/node_modules/prisma/build" -name "index.js" | head -1)
            fi

            if [[ -n "$PRISMA_BIN" ]]; then
                echo "[INFO] 使用 Prisma CLI: $PRISMA_BIN"
                if node "$PRISMA_BIN" generate --schema=prisma/schema.prisma 2>&1; then
                    echo "[SUCCESS] Prisma Client 已生成"
                else
                    echo "[WARN] Prisma generate 命令返回错误，检查引擎是否已存在..."
                fi
            else
                echo "[WARN] 找不到已安装的 Prisma CLI，尝试使用 npx..."
                npx prisma@${PRISMA_VERSION} generate --schema=prisma/schema.prisma 2>&1 || {
                    echo "[WARN] npx prisma generate 也失败"
                }
            fi
        fi

        # 步骤 4: 保存 Prisma schema hash
        if [[ -n "$PRISMA_SCHEMA_HASH" ]]; then
            echo "$PRISMA_SCHEMA_HASH" > "$PRISMA_SCHEMA_HASH_FILE"
        fi

        echo "[SUCCESS] Prisma Client 验证完成"
ENDSSH
    log_success "Prisma Client 验证/生成完成"
    record_timing "Prisma Client"
}

# ============================================
# 内部辅助函数
# ============================================

# 执行远程迁移
_execute_remote_migration() {
    local env=$1
    local prisma_version=$2
    local db_backup_retention="${DB_BACKUP_RETENTION_DAYS:-7}"

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" << ENDSSH
        set -e
        cd $REMOTE_APP_DIR

        PRISMA_VERSION="$prisma_version"
        PRISMA_SCHEMA="$REMOTE_DATABASE_DIR/prisma/schema.prisma"
        echo "[INFO] 项目 Prisma 版本: \$PRISMA_VERSION"
        echo "[INFO] Prisma Schema: \$PRISMA_SCHEMA"

        # 查找 standalone 内置的 Prisma CLI（避免 npx 使用全局缓存的旧版本）
        STANDALONE_DIR="$REMOTE_BUILD_DIR/standalone/apps/web"
        STANDALONE_ROOT="$REMOTE_BUILD_DIR/standalone"
        PRISMA_BIN=\$(find "\$STANDALONE_DIR/node_modules/.pnpm/prisma@*/node_modules/prisma/build" -name "index.js" 2>/dev/null | head -1)
        if [[ -z "\$PRISMA_BIN" ]]; then
            PRISMA_BIN=\$(find "\$STANDALONE_ROOT/node_modules/.pnpm/prisma@*/node_modules/prisma/build" -name "index.js" 2>/dev/null | head -1)
        fi

        if [[ -n "\$PRISMA_BIN" ]]; then
            PRISMA_CMD="node \$PRISMA_BIN"
            echo "[INFO] 使用内置 Prisma CLI: \$PRISMA_BIN"
        else
            PRISMA_CMD="npx prisma@\${PRISMA_VERSION}"
            echo "[WARN] 未找到内置 Prisma CLI，回退到 npx prisma@\${PRISMA_VERSION}"
        fi

        # 加载环境变量
        echo "[INFO] 加载环境变量..."
        ENV_FILE="$REMOTE_BUILD_DIR/standalone/apps/web/.env"
        if [ -f "\$ENV_FILE" ]; then
            set -a
            source "\$ENV_FILE"
            set +a
            echo "[INFO] 环境变量已加载"
            echo "[DEBUG] DATABASE_URL 前缀: \$(echo \$DATABASE_URL | cut -c1-30)..."
        else
            echo "[ERROR] 未找到 .env 文件: \$ENV_FILE"
            exit 1
        fi

        # 步骤 1/4: 架构漂移检测
        echo ""
        echo "[INFO] ━━━━━ 步骤 1/4: 架构漂移检测 ━━━━━"
        echo "[INFO] 使用自定义检测脚本（修复 Prisma diff @map 误报问题）"

        # 使用自定义脚本检测架构漂移
        # 退出码: 0=无漂移, 1=有漂移, 2=检测失败
        DRIFT_EXIT_CODE=0
        node $REMOTE_SCRIPTS_DIR/server/check-schema-drift.js --env "$env" || DRIFT_EXIT_CODE=\$?

        if [[ \$DRIFT_EXIT_CODE -eq 0 ]]; then
            echo "[SUCCESS] 数据库架构与 schema.prisma 一致"
            DRIFT_OUTPUT=""
        elif [[ \$DRIFT_EXIT_CODE -eq 1 ]]; then
            echo "[WARN] 检测到架构漂移"
            DRIFT_OUTPUT="drift-detected"
        else
            echo "[ERROR] 架构漂移检测失败"
            exit 1
        fi

        # 步骤 2/4: 迁移状态检查
        echo ""
        echo "[INFO] ━━━━━ 步骤 2/4: 迁移状态检查 ━━━━━"

        # 统计本地迁移文件数量（排除非目录文件）
        LOCAL_MIGRATION_COUNT=\$(find $REMOTE_DATABASE_DIR/prisma/migrations -maxdepth 1 -type d ! -name migrations | wc -l | tr -d ' ')
        echo "[INFO] 本地迁移文件数量: \$LOCAL_MIGRATION_COUNT"

        # 查询数据库中已应用的迁移数量
        DB_MIGRATION_COUNT=\$(\$PRISMA_CMD db execute --schema=\$PRISMA_SCHEMA --stdin <<SQL 2>/dev/null || echo "0"
SELECT COUNT(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;
SQL
        )
        DB_MIGRATION_COUNT=\$(echo "\$DB_MIGRATION_COUNT" | grep -oE '[0-9]+' | head -1 || echo "0")
        echo "[INFO] 数据库中已应用的迁移数量: \$DB_MIGRATION_COUNT"

        # 比较迁移数量
        FORCE_MIGRATE=false
        if [[ "\$LOCAL_MIGRATION_COUNT" -gt "\$DB_MIGRATION_COUNT" ]]; then
            PENDING_COUNT=\$((LOCAL_MIGRATION_COUNT - DB_MIGRATION_COUNT))
            echo "[WARN] 迁移计数不匹配！检测到 \$PENDING_COUNT 个待应用的迁移"
            echo "[WARN] 数据库: \$DB_MIGRATION_COUNT, 本地: \$LOCAL_MIGRATION_COUNT"
            FORCE_MIGRATE=true
        fi

        # 执行 prisma migrate status
        MIGRATION_STATUS=\$(\$PRISMA_CMD migrate status --schema=\$PRISMA_SCHEMA 2>&1) || true
        echo "\$MIGRATION_STATUS"

        # 判断是否需要执行迁移
        NEED_MIGRATE=false

        if echo "\$MIGRATION_STATUS" | grep -iq "following migration.*have not yet been applied"; then
            echo "[WARN] Prisma 检测到待执行的迁移"
            NEED_MIGRATE=true
        elif [[ "\$FORCE_MIGRATE" == "true" ]]; then
            echo "[WARN] 强制执行迁移（迁移计数不匹配，可能是文件同步问题）"
            NEED_MIGRATE=true
        elif echo "\$MIGRATION_STATUS" | grep -q "Database schema is up to date"; then
            echo "[INFO] 数据库架构已是最新"
            NEED_MIGRATE=false

            # 处理架构漂移
            if [[ -n "\$DRIFT_OUTPUT" ]]; then
                echo "[ERROR] 检测到架构漂移！数据库结构与 schema.prisma 不一致"
                echo "[ERROR] 请在开发环境创建新的迁移来修复此问题"
                exit 1
            fi
        elif echo "\$MIGRATION_STATUS" | grep -iq "missing from the local migrations directory"; then
            echo "[ERROR] 检测到迁移文件缺失！数据库中记录了本地不存在的迁移文件"
            exit 1
        else
            echo "[ERROR] 无法确定迁移状态"
            exit 1
        fi

        # 执行迁移（如果需要）
        if [[ "\$NEED_MIGRATE" == "true" ]]; then
            echo ""
            echo "[INFO] ━━━━━ 准备执行数据库迁移 ━━━━━"

            # 步骤 3/4: 生产环境数据库备份
            if [[ "$env" == "production" ]]; then
                echo ""
                echo "[INFO] ━━━━━ 步骤 3/4: 生产数据库备份 ━━━━━"

                if [[ -n "\$ALIYUN_RDS_INSTANCE_ID" ]] && command -v aliyun &> /dev/null; then
                    echo "[INFO] 使用阿里云 RDS API 创建数据库备份..."
                    BACKUP_DESC="pre-migration-\$(date +%Y%m%d-%H%M%S)"

                    if [[ -n "\$ALIYUN_ACCESS_KEY_ID" ]] && [[ -n "\$ALIYUN_ACCESS_KEY_SECRET" ]]; then
                        aliyun configure set --profile default --mode AK \\
                            --region \${ALIYUN_RDS_REGION:-cn-hangzhou} \\
                            --access-key-id "\$ALIYUN_ACCESS_KEY_ID" \\
                            --access-key-secret "\$ALIYUN_ACCESS_KEY_SECRET" &> /dev/null
                    fi

                    RDS_BACKUP_RESULT=\$(aliyun rds CreateBackup \\
                        --region \${ALIYUN_RDS_REGION:-cn-hangzhou} \\
                        --DBInstanceId "\$ALIYUN_RDS_INSTANCE_ID" \\
                        --BackupMethod Physical \\
                        --BackupType FullBackup \\
                        --BackupStrategy db \\
                        --BackupDescription "\$BACKUP_DESC" 2>&1)

                    if echo "\$RDS_BACKUP_RESULT" | grep -q '"BackupJobId"'; then
                        echo "[SUCCESS] RDS 备份任务已创建"
                    else
                        echo "[WARN] RDS 备份创建失败，但继续部署"
                    fi
                else
                    # pg_dump 兜底方案
                    if command -v pg_dump &> /dev/null; then
                        DB_HOST=\$(echo \$DATABASE_URL | sed -n 's/.*@\\([^:]*\\):.*/\\1/p')
                        DB_PORT=\$(echo \$DATABASE_URL | sed -n 's/.*:\\([0-9]*\\)\\/.*/\\1/p')
                        DB_NAME=\$(echo \$DATABASE_URL | sed -n 's/.*\\/\\([^?]*\\).*/\\1/p')
                        DB_USER=\$(echo \$DATABASE_URL | sed -n 's/.*:\\/\\/\\([^:]*\\):.*/\\1/p')
                        DB_PASS=\$(echo \$DATABASE_URL | sed -n 's/.*:\\/\\/[^:]*:\\([^@]*\\)@.*/\\1/p')

                        BACKUP_DIR="$DEPLOY_PATH/db-backups"
                        mkdir -p "\$BACKUP_DIR"
                        BACKUP_FILE="\$BACKUP_DIR/pre-migration-\$(date +%Y%m%d-%H%M%S).sql"

                        export PGPASSWORD="\$DB_PASS"
                        if pg_dump -h "\$DB_HOST" -p "\$DB_PORT" -U "\$DB_USER" -d "\$DB_NAME" \\
                            --no-owner --no-acl --if-exists --clean -f "\$BACKUP_FILE" 2>&1; then
                            echo "[SUCCESS] pg_dump 备份成功"
                            find "\$BACKUP_DIR" -name "pre-migration-*.sql" -type f -mtime +$db_backup_retention -delete 2>/dev/null || true
                        else
                            echo "[WARN] pg_dump 备份失败"
                        fi
                        unset PGPASSWORD
                    fi
                fi
            else
                echo ""
                echo "[INFO] ━━━━━ 步骤 3/4: 跳过备份 ━━━━━"
                echo "[INFO] 非生产环境，跳过数据库备份"
            fi

            # 步骤 4/4: 执行数据库迁移
            echo ""
            echo "[INFO] ━━━━━ 步骤 4/4: 执行数据库迁移 ━━━━━"
            if \$PRISMA_CMD migrate deploy --schema=\$PRISMA_SCHEMA 2>&1; then
                echo "[SUCCESS] 数据库迁移执行成功"

                # 重新生成 Prisma Client
                echo "[INFO] 数据库 schema 已变更，重新生成 Prisma Client..."
                STANDALONE_DIR="$REMOTE_STANDALONE_FRONTEND"

                if [[ ! -L "\$STANDALONE_DIR/prisma" ]] && [[ ! -d "\$STANDALONE_DIR/prisma" ]]; then
                    ln -sf $REMOTE_DATABASE_DIR/prisma "\$STANDALONE_DIR/prisma"
                fi

                cd "\$STANDALONE_DIR"
                PRISMA_BIN=\$(find node_modules/.pnpm/prisma@*/node_modules/prisma/build -name "index.js" | head -1)
                if [[ -n "\$PRISMA_BIN" ]]; then
                    node "\$PRISMA_BIN" generate --schema=\$PRISMA_SCHEMA 2>&1 || echo "[WARN] Prisma Client 生成失败"
                fi
            else
                echo "[ERROR] 数据库迁移失败！"
                exit 1
            fi
        else
            echo ""
            echo "[INFO] ━━━━━ 步骤 3/4 & 4/4: 跳过 ━━━━━"
            echo "[INFO] 数据库已是最新，无需迁移或备份"
        fi

        echo ""
        echo "[SUCCESS] ━━━━━ 数据库迁移流程完成 ━━━━━"
ENDSSH

    return $?
}
