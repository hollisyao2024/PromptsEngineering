#!/bin/bash
# ============================================
# Deploy Nginx/SSL Module
# PM2、Nginx、SSL 配置模块
#
# 导出函数：
#   - run_pm2_restart()
#   - run_nginx_config()
#   - run_ssl_config()
#   - run_baidu_submit()
#
# 内部辅助函数：
#   - _fix_prisma_symlinks()     - 修复 Prisma 符号链接
#   - _sync_pm2_config()         - 同步 PM2 配置
#   - _cleanup_root_pm2()        - 清理 root PM2 冲突
#   - _install_websocket_deps()  - 安装 WebSocket 原生依赖
#   - _install_clip_deps()       - 安装 CLIP 原生依赖（onnxruntime-node, sharp）
#   - _install_clip_model()      - 下载 CLIP 模型（使用中国镜像 hf-mirror.com）
#   - _restart_application()     - 零停机重启应用
#
# 依赖：
#   - deploy-common.sh（需要先 source）
# ============================================

# ============================================
# 主入口函数
# ============================================

# PM2 配置和重启
# 参数：$1=环境名称
# 返回：0=成功，1=失败
run_pm2_restart() {
    local env=$1

    # 修复 Prisma 符号链接（在服务器上）
    _fix_prisma_symlinks || return 1

    # 生成并同步 PM2 配置
    _sync_pm2_config || return 1

    # 清理 root PM2 冲突进程
    _cleanup_root_pm2

    # 检测并安装 WebSocket 原生依赖
    _install_websocket_deps || return 1

    # 检测并安装 CLIP 原生依赖（onnxruntime-node, sharp）
    _install_clip_deps || return 1

    # 检测并下载 CLIP 模型（使用中国镜像）
    _install_clip_model || return 1

    # 重启应用（零停机）
    _restart_application || return 1

    # 百度收录提交（仅生产环境）
    if [[ "$env" == "production" ]]; then
        run_baidu_submit
    fi

    return 0
}

# 配置 Nginx
# 返回：0=成功，1=失败
run_nginx_config() {
    log_info "检查 Nginx 配置..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export DOMAIN_NAME='$DOMAIN_NAME' APP_PORT='$APP_PORT' NGINX_CLIENT_MAX_BODY_SIZE='$NGINX_CLIENT_MAX_BODY_SIZE' NGINX_PROXY_TIMEOUT='$NGINX_PROXY_TIMEOUT'; bash -s" << 'ENDSSH'
        set -e

        DOMAIN="$DOMAIN_NAME"
        NGINX_CONF="/etc/nginx/conf.d/${DOMAIN}.conf"

        # 检查 Nginx 是否安装
        if ! command -v nginx &> /dev/null; then
            echo "[INFO] Nginx 未安装，正在安装..."
            sudo yum install -y nginx
        else
            echo "[INFO] Nginx 已安装"
        fi

        # 检查 Nginx 配置是否存在
        if [[ ! -f "$NGINX_CONF" ]]; then
            echo "[INFO] 创建 Nginx 配置: $NGINX_CONF"

            # 先创建 HTTP 配置（用于 Let's Encrypt 验证）
            sudo tee "$NGINX_CONF" > /dev/null << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    # 客户端请求体大小限制（用于上传）
    client_max_body_size $NGINX_CLIENT_MAX_BODY_SIZE;

    # Let's Encrypt 验证路径
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # 超时设置
        proxy_connect_timeout $NGINX_PROXY_TIMEOUT;
        proxy_send_timeout $NGINX_PROXY_TIMEOUT;
        proxy_read_timeout $NGINX_PROXY_TIMEOUT;
    }
}
NGINX

            # 删除默认配置中的冲突 server 块
            sudo sed -i '/server {/,/^    }/d' /etc/nginx/nginx.conf 2>/dev/null || true
        else
            echo "[INFO] Nginx 配置已存在: $NGINX_CONF"
        fi

        # 测试配置
        sudo nginx -t

        # 确保 Nginx 运行并开机自启
        sudo systemctl enable nginx
        sudo systemctl reload nginx || sudo systemctl start nginx

        echo "[SUCCESS] Nginx 配置完成"
ENDSSH

    log_success "Nginx 配置完成"
    return 0
}

# 配置 SSL 证书
# 返回：0=成功，1=失败
run_ssl_config() {
    log_info "检查 SSL 证书配置..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export DOMAIN_NAME='$DOMAIN_NAME' APP_PORT='$APP_PORT' NGINX_CLIENT_MAX_BODY_SIZE='$NGINX_CLIENT_MAX_BODY_SIZE' NGINX_PROXY_TIMEOUT='$NGINX_PROXY_TIMEOUT' NGINX_SSL_SESSION_CACHE='$NGINX_SSL_SESSION_CACHE'; bash -s" << 'ENDSSH'
        set -e

        DOMAIN="$DOMAIN_NAME"
        CERT_PATH="/etc/letsencrypt/live/$DOMAIN"
        NGINX_CONF="/etc/nginx/conf.d/${DOMAIN}.conf"

        # 检查证书是否已存在
        if [[ -d "$CERT_PATH" ]]; then
            echo "[INFO] SSL 证书已存在: $CERT_PATH"

            # 检查 Nginx 配置是否已包含正确的 HTTP → HTTPS 重定向
            if grep -q "listen 443 ssl" "$NGINX_CONF" 2>/dev/null && grep -q "return 301 https" "$NGINX_CONF" 2>/dev/null; then
                echo "[INFO] Nginx HTTPS 配置已存在且包含 HTTP → HTTPS 重定向"
            else
                echo "[INFO] 更新 Nginx 配置以启用 HTTPS..."
                # 配置已存在证书的情况下更新 Nginx
                sudo tee "$NGINX_CONF" > /dev/null << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    # Let's Encrypt 验证路径
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 重定向 HTTP 到 HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache $NGINX_SSL_SESSION_CACHE;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # 客户端请求体大小限制（用于上传）
    client_max_body_size $NGINX_CLIENT_MAX_BODY_SIZE;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # 超时设置
        proxy_connect_timeout $NGINX_PROXY_TIMEOUT;
        proxy_send_timeout $NGINX_PROXY_TIMEOUT;
        proxy_read_timeout $NGINX_PROXY_TIMEOUT;
    }
}
NGINX
                sudo nginx -t && sudo systemctl reload nginx
                echo "[SUCCESS] Nginx HTTPS 配置已更新"
            fi
        else
            echo "[INFO] SSL 证书不存在，尝试申请..."

            # 安装 certbot
            if ! command -v certbot &> /dev/null; then
                echo "[INFO] 安装 certbot..."
                sudo yum install -y epel-release || true
                sudo yum install -y certbot python3-certbot-nginx
            fi

            # 创建 webroot 目录
            sudo mkdir -p /var/www/certbot

            # 申请证书（使用 webroot 方式，非交互式）
            echo "[INFO] 申请 Let's Encrypt 证书..."
            if sudo certbot certonly --webroot -w /var/www/certbot -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --no-eff-email 2>&1; then
                echo "[SUCCESS] SSL 证书申请成功"

                # 更新 Nginx 配置启用 HTTPS
                sudo tee "$NGINX_CONF" > /dev/null << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    # Let's Encrypt 验证路径
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    # 重定向 HTTP 到 HTTPS
    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL 证书
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    # SSL 安全配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache $NGINX_SSL_SESSION_CACHE;

    # HSTS
    add_header Strict-Transport-Security "max-age=63072000" always;

    # 客户端请求体大小限制（用于上传）
    client_max_body_size $NGINX_CLIENT_MAX_BODY_SIZE;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # 超时设置
        proxy_connect_timeout $NGINX_PROXY_TIMEOUT;
        proxy_send_timeout $NGINX_PROXY_TIMEOUT;
        proxy_read_timeout $NGINX_PROXY_TIMEOUT;
    }
}
NGINX
                sudo nginx -t && sudo systemctl reload nginx
                echo "[SUCCESS] Nginx HTTPS 配置已启用"

                # 设置证书自动续期
                if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
                    (crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
                    echo "[SUCCESS] 证书自动续期已配置"
                fi
            else
                echo "[WARN] SSL 证书申请失败，继续使用 HTTP"
                echo "[WARN] 请检查域名 DNS 配置是否正确指向此服务器"
            fi
        fi
ENDSSH

    log_success "SSL 证书配置完成"
    return 0
}

# 百度收录提交（仅生产环境）
run_baidu_submit() {
    log_info "自动提交页面到百度收录..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export APP_PORT='$APP_PORT' APP_READY_WAIT='$APP_READY_WAIT'; bash -s" << 'ENDSSH'
        set +e  # 百度提交失败不影响部署

        # 等待应用完全就绪
        sleep $APP_READY_WAIT

        # 调用百度提交 API（内部 API，无需认证 header）
        SUBMIT_RESULT=$(curl -s -X POST http://localhost:$APP_PORT/api/internal/baidu-submit \
            -H "Content-Type: application/json" \
            -d '{"type": "all"}' \
            --max-time 30)

        if echo "$SUBMIT_RESULT" | grep -q '"success":true'; then
            # 提取统计信息
            SUBMITTED=$(echo "$SUBMIT_RESULT" | grep -o '"submitted":[0-9]*' | cut -d':' -f2)
            SKIPPED=$(echo "$SUBMIT_RESULT" | grep -o '"skipped":[0-9]*' | cut -d':' -f2)
            REMAIN=$(echo "$SUBMIT_RESULT" | grep -o '"remain":[0-9]*' | cut -d':' -f2)

            echo "[SUCCESS] 百度收录提交成功："
            echo "   - 新提交：${SUBMITTED:-0} 个页面"
            echo "   - 已跳过：${SKIPPED:-0} 个页面"
            echo "   - 剩余配额：${REMAIN:-0}"
        else
            ERROR_MSG=$(echo "$SUBMIT_RESULT" | grep -o '"error":"[^"]*"' | cut -d'"' -f4)
            echo "[WARN] 百度收录提交失败：${ERROR_MSG:-未知错误}"
            echo "   （不影响部署，可稍后在管理后台手动提交）"
        fi
ENDSSH

    log_success "百度收录提交完成"
}

# ============================================
# 内部辅助函数
# ============================================

# 修复 Prisma 符号链接
_fix_prisma_symlinks() {
    log_info "修复服务器端 Prisma 符号链接..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export REMOTE_STANDALONE_PATH='$REMOTE_STANDALONE_PATH' REMOTE_STANDALONE_FRONTEND='$REMOTE_STANDALONE_FRONTEND'; bash -s" << 'ENDSSH'
        set -e
        STANDALONE_DIR="$REMOTE_STANDALONE_FRONTEND"
        STANDALONE_ROOT="$REMOTE_STANDALONE_PATH"

        # 找到 pnpm 安装的 @prisma/client 包
        PRISMA_PKG=$(find "$STANDALONE_ROOT/node_modules/.pnpm" -maxdepth 1 -type d -name '@prisma+client@*' 2>/dev/null | head -1)

        if [ -n "$PRISMA_PKG" ]; then
            echo "[INFO] Found Prisma package at: $PRISMA_PKG"

            # ============================================
            # 验证 pnpm store 完整性
            # pnpm store 中的 @prisma/client 应该是真实目录，不是符号链接
            # 如果是符号链接，说明之前的部署脚本损坏了 pnpm store
            # ============================================
            PRISMA_CLIENT_IN_PNPM="$PRISMA_PKG/node_modules/@prisma/client"
            DOTPRISMA_CLIENT_IN_PNPM="$PRISMA_PKG/node_modules/.prisma/client"

            # 检查 @prisma/client 是否是真实目录
            if [ -L "$PRISMA_CLIENT_IN_PNPM" ]; then
                echo "[ERROR] pnpm store corrupted: $PRISMA_CLIENT_IN_PNPM is a symlink, not a directory!"
                echo "[INFO] Symlink target: $(readlink $PRISMA_CLIENT_IN_PNPM)"
                echo "[INFO] This indicates a previous deployment corrupted the pnpm store."
                echo "[INFO] Will use hoisted @prisma/client at $STANDALONE_ROOT/node_modules/@prisma/client instead."

                # 尝试使用 hoisted 位置的 @prisma/client
                PRISMA_CLIENT_SOURCE="$STANDALONE_ROOT/node_modules/@prisma/client"
                if [ -d "$PRISMA_CLIENT_SOURCE" ] && [ ! -L "$PRISMA_CLIENT_SOURCE" ]; then
                    echo "[INFO] Found valid @prisma/client at hoisted location"
                else
                    echo "[ERROR] No valid @prisma/client found. Deployment may fail."
                    PRISMA_CLIENT_SOURCE=""
                fi
            else
                echo "[INFO] pnpm store @prisma/client is valid directory"
                PRISMA_CLIENT_SOURCE="$PRISMA_CLIENT_IN_PNPM"
            fi

            # 检查 .prisma/client 是否是真实目录
            if [ -L "$DOTPRISMA_CLIENT_IN_PNPM" ]; then
                echo "[WARN] pnpm store .prisma/client is a symlink, not a directory"
                DOTPRISMA_CLIENT_SOURCE=""
            elif [ -d "$DOTPRISMA_CLIENT_IN_PNPM" ]; then
                echo "[INFO] pnpm store .prisma/client is valid directory"
                DOTPRISMA_CLIENT_SOURCE="$DOTPRISMA_CLIENT_IN_PNPM"
            else
                echo "[INFO] .prisma/client not found in pnpm store (will be generated)"
                DOTPRISMA_CLIENT_SOURCE=""
            fi

            # ============================================
            # 关键修复：检查 node_modules/@prisma 是否是符号链接
            # pnpm 会创建 node_modules/@prisma -> .pnpm/@prisma+client@.../node_modules/@prisma
            # 如果我们在这个符号链接下创建新的符号链接，会损坏 pnpm store！
            # ============================================
            FRONTEND_PRISMA_DIR="$STANDALONE_DIR/node_modules/@prisma"
            FRONTEND_DOTPRISMA_DIR="$STANDALONE_DIR/node_modules/.prisma"

            if [ -L "$FRONTEND_PRISMA_DIR" ]; then
                echo "[INFO] $FRONTEND_PRISMA_DIR is a symlink (pnpm structure)"
                echo "[INFO] Symlink target: $(readlink $FRONTEND_PRISMA_DIR)"
                echo "[INFO] Skipping symlink creation to avoid corrupting pnpm store"
                # pnpm 的符号链接结构已经正确指向 @prisma/client，无需额外操作
                SKIP_FRONTEND_PRISMA_SYMLINK=true
            else
                echo "[INFO] $FRONTEND_PRISMA_DIR is a real directory, will create symlinks"
                mkdir -p "$FRONTEND_PRISMA_DIR"
                SKIP_FRONTEND_PRISMA_SYMLINK=false
            fi

            if [ -L "$FRONTEND_DOTPRISMA_DIR" ]; then
                echo "[INFO] $FRONTEND_DOTPRISMA_DIR is a symlink (pnpm structure)"
                SKIP_FRONTEND_DOTPRISMA_SYMLINK=true
            else
                mkdir -p "$FRONTEND_DOTPRISMA_DIR"
                SKIP_FRONTEND_DOTPRISMA_SYMLINK=false
            fi

            # 只在目标不是符号链接时创建 @prisma/client 符号链接
            if [ "$SKIP_FRONTEND_PRISMA_SYMLINK" != "true" ] && [ -n "$PRISMA_CLIENT_SOURCE" ]; then
                rm -rf "$FRONTEND_PRISMA_DIR/client" 2>/dev/null || true
                ln -sf "$PRISMA_CLIENT_SOURCE" "$FRONTEND_PRISMA_DIR/client"
                echo "[SUCCESS] Created @prisma/client symlink -> $PRISMA_CLIENT_SOURCE"
            elif [ "$SKIP_FRONTEND_PRISMA_SYMLINK" == "true" ]; then
                echo "[INFO] Skipped @prisma/client symlink (parent is pnpm symlink)"
            else
                echo "[WARN] Skipping @prisma/client symlink (no valid source)"
            fi

            # 只在目标不是符号链接时创建 .prisma/client 符号链接
            if [ "$SKIP_FRONTEND_DOTPRISMA_SYMLINK" != "true" ] && [ -n "$DOTPRISMA_CLIENT_SOURCE" ]; then
                rm -rf "$FRONTEND_DOTPRISMA_DIR/client" 2>/dev/null || true
                ln -sf "$DOTPRISMA_CLIENT_SOURCE" "$FRONTEND_DOTPRISMA_DIR/client"
                echo "[SUCCESS] Created .prisma/client symlink -> $DOTPRISMA_CLIENT_SOURCE"
            elif [ "$SKIP_FRONTEND_DOTPRISMA_SYMLINK" == "true" ]; then
                echo "[INFO] Skipped .prisma/client symlink (parent is pnpm symlink)"
            fi

            # ============================================
            # Turbopack Hash 符号链接修复
            # Turbopack 构建时会生成带 hash 的模块引用，如 @prisma/client-83df23397df98989
            # 需要在多个 node_modules 位置创建符号链接：
            #   1. standalone/frontend/node_modules/@prisma/
            #   2. standalone/frontend/.next-deploy/node_modules/@prisma/ (Turbopack 嵌套目录)
            # ============================================
            echo "[INFO] Checking for Turbopack hashed Prisma references..."

            # 从构建产物中提取 Prisma client hash
            PRISMA_HASH=""
            for chunk in "$STANDALONE_DIR/.next-deploy/server/chunks/"*server*.js; do
                if [ -f "$chunk" ]; then
                    PRISMA_HASH=$(grep -oP '@prisma/client-[a-f0-9]{16}' "$chunk" 2>/dev/null | head -1 | sed 's/@prisma\///' || true)
                    if [ -n "$PRISMA_HASH" ]; then
                        break
                    fi
                fi
            done

            if [ -n "$PRISMA_HASH" ]; then
                echo "[INFO] Found Turbopack Prisma hash: $PRISMA_HASH"

                # 位置 1: standalone/frontend/node_modules/@prisma/
                # 检查是否是 pnpm 符号链接结构
                if [ -L "$FRONTEND_PRISMA_DIR" ]; then
                    # 父目录是 pnpm 符号链接，不能在这里创建符号链接
                    echo "[INFO] Skipping Turbopack hash symlink at frontend/node_modules/@prisma (pnpm symlink)"

                    # 验证 pnpm 符号链接指向的目录中是否有 client
                    PNPM_TARGET=$(readlink -f "$FRONTEND_PRISMA_DIR" 2>/dev/null || true)
                    if [ -d "$PNPM_TARGET/client" ]; then
                        echo "[INFO] pnpm symlink target has client directory: $PNPM_TARGET/client"
                        # 在 pnpm 目标目录中创建 hash 符号链接（如果它是真实目录）
                        if [ ! -L "$PNPM_TARGET" ]; then
                            rm -f "$PNPM_TARGET/$PRISMA_HASH" 2>/dev/null || true
                            ln -sfn client "$PNPM_TARGET/$PRISMA_HASH"
                            echo "[SUCCESS] Created Turbopack hash symlink in pnpm target: $PRISMA_HASH -> client"
                        fi
                    fi
                elif [ -L "$FRONTEND_PRISMA_DIR/client" ] || [ -d "$FRONTEND_PRISMA_DIR/client" ]; then
                    # 父目录是真实目录，可以创建符号链接
                    rm -f "$FRONTEND_PRISMA_DIR/$PRISMA_HASH" 2>/dev/null || true
                    ln -sfn client "$FRONTEND_PRISMA_DIR/$PRISMA_HASH"
                    echo "[SUCCESS] Created Turbopack hash symlink (frontend): @prisma/$PRISMA_HASH -> client"
                else
                    echo "[WARN] Cannot create hash symlink: @prisma/client does not exist"
                fi

                # 位置 2: standalone/frontend/.next-deploy/node_modules/@prisma/ (Turbopack 嵌套目录)
                NESTED_PRISMA_DIR="$STANDALONE_DIR/.next-deploy/node_modules/@prisma"

                # 检查嵌套目录是否存在且是否是符号链接
                if [ -L "$NESTED_PRISMA_DIR" ]; then
                    echo "[INFO] Nested @prisma dir is a symlink, skipping to avoid pnpm store corruption"
                elif [ -d "$NESTED_PRISMA_DIR" ]; then
                    # 嵌套目录是真实目录，可以安全地创建符号链接
                    if [ -n "$PRISMA_CLIENT_SOURCE" ]; then
                        if [ ! -L "$NESTED_PRISMA_DIR/client" ] && [ ! -d "$NESTED_PRISMA_DIR/client" ]; then
                            ln -sfn "$PRISMA_CLIENT_SOURCE" "$NESTED_PRISMA_DIR/client"
                            echo "[SUCCESS] Created nested @prisma/client symlink -> $PRISMA_CLIENT_SOURCE"
                        elif [ -L "$NESTED_PRISMA_DIR/client" ]; then
                            # 更新现有 symlink 以指向正确位置
                            rm -f "$NESTED_PRISMA_DIR/client"
                            ln -sfn "$PRISMA_CLIENT_SOURCE" "$NESTED_PRISMA_DIR/client"
                            echo "[SUCCESS] Updated nested @prisma/client symlink -> $PRISMA_CLIENT_SOURCE"
                        fi
                    fi

                    # 创建 Turbopack hash 符号链接
                    rm -f "$NESTED_PRISMA_DIR/$PRISMA_HASH" 2>/dev/null || true
                    if [ -L "$NESTED_PRISMA_DIR/client" ] || [ -d "$NESTED_PRISMA_DIR/client" ]; then
                        ln -sfn client "$NESTED_PRISMA_DIR/$PRISMA_HASH"
                        echo "[SUCCESS] Created Turbopack hash symlink (nested): @prisma/$PRISMA_HASH -> client"
                    fi

                    # 确保 .prisma/client 也存在
                    NESTED_DOTPRISMA_DIR="$STANDALONE_DIR/.next-deploy/node_modules/.prisma"
                    if [ -d "$NESTED_DOTPRISMA_DIR" ] && [ ! -L "$NESTED_DOTPRISMA_DIR" ] && [ -n "$DOTPRISMA_CLIENT_SOURCE" ]; then
                        if [ ! -L "$NESTED_DOTPRISMA_DIR/client" ] && [ ! -d "$NESTED_DOTPRISMA_DIR/client" ]; then
                            ln -sfn "$DOTPRISMA_CLIENT_SOURCE" "$NESTED_DOTPRISMA_DIR/client"
                            echo "[SUCCESS] Created nested .prisma/client symlink"
                        fi
                    fi
                else
                    echo "[INFO] Nested .next-deploy/node_modules/@prisma not found (may use different resolution)"
                fi
            else
                echo "[INFO] No Turbopack Prisma hash found (using standard Prisma resolution)"
            fi
        fi

        # 验证引擎文件
        # 尝试多个位置查找引擎
        ENGINE=""
        for ENGINE_DIR in \
            "$PRISMA_PKG/node_modules/.prisma/client" \
            "$STANDALONE_ROOT/node_modules/.prisma/client" \
            "$STANDALONE_DIR/node_modules/.prisma/client"; do
            if [ -d "$ENGINE_DIR" ] && [ ! -L "$ENGINE_DIR" ]; then
                ENGINE=$(find "$ENGINE_DIR" -name "libquery_engine-*.so.node" 2>/dev/null | head -1)
                if [ -n "$ENGINE" ] && [ -f "$ENGINE" ]; then
                    echo "[SUCCESS] Prisma engine verified: $(basename $ENGINE) (from $ENGINE_DIR)"
                    break
                fi
            fi
        done

        if [ -z "$ENGINE" ]; then
            echo "[WARN] Prisma engine not found in standard locations"
            echo "[INFO] Searching all possible locations..."
            ENGINE=$(find "$STANDALONE_ROOT/node_modules" "$STANDALONE_DIR/node_modules" -name "libquery_engine-*.so.node" 2>/dev/null | head -1)
            if [ -n "$ENGINE" ] && [ -f "$ENGINE" ]; then
                echo "[SUCCESS] Prisma engine found: $ENGINE"
            else
                echo "[WARN] Prisma engine not found - will be generated during prisma generate"
            fi
        fi
ENDSSH

    log_success "Prisma symlinks 修复完成"
    return 0
}

# 同步 PM2 配置
_sync_pm2_config() {
    log_info "生成 PM2 ecosystem.config.js..."

    CRON_SCRIPT="$REMOTE_STANDALONE_FRONTEND/scripts/cron/scheduler.bundle.js"
    NODE_PATH_VALUE="$REMOTE_STANDALONE_FRONTEND/node_modules"
    # TRANSFORMERS_CACHE 使用部署目录下的 .transformers-cache，与 _install_clip_model 保持一致
    TRANSFORMERS_CACHE_DIR="$DEPLOY_PATH/.transformers-cache"
    PM2_CONFIG_CONTENT=$(generate_pm2_ecosystem "$APP_NAME" "$CRON_SCRIPT" "$TRANSFORMERS_CACHE_DIR" "$NODE_PATH_VALUE")

    # 将配置写入临时文件
    PM2_TEMP_FILE=$(mktemp)
    echo "$PM2_CONFIG_CONTENT" > "$PM2_TEMP_FILE"

    # 同步配置到服务器
    scp ${SCP_OPTS} "$PM2_TEMP_FILE" "$SERVER_USER@$SERVER_HOST:$REMOTE_STANDALONE_FRONTEND/ecosystem.config.js"
    rm -f "$PM2_TEMP_FILE"

    log_success "PM2 配置已同步"
    record_timing "PM2 配置"
    return 0
}

# 清理 root PM2 冲突进程
_cleanup_root_pm2() {
    log_info "检查并清理 root PM2 冲突进程..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export APP_NAME='$APP_NAME' SERVER_USER='$SERVER_USER'; bash -s" << 'ENDSSH'
        # 检查 root 用户是否有同名的 PM2 进程
        if sudo -u root pm2 list 2>/dev/null | grep -q "$APP_NAME"; then
            echo "[WARN] 检测到 root 用户存在 $APP_NAME 进程，正在清理..."
            sudo -u root pm2 delete "$APP_NAME" 2>/dev/null || true
            sudo -u root pm2 delete "${APP_NAME}-cron" 2>/dev/null || true
            sudo -u root pm2 save --force 2>/dev/null || true
            echo "[SUCCESS] root PM2 冲突进程已清理"
        fi

        # 检查并禁用 pm2-root 开机自启服务
        if systemctl is-enabled pm2-root 2>/dev/null | grep -q "enabled"; then
            echo "[WARN] 检测到 pm2-root 服务已启用，正在禁用..."
            sudo systemctl disable pm2-root 2>/dev/null || true
            sudo systemctl stop pm2-root 2>/dev/null || true
            echo "[SUCCESS] pm2-root 服务已禁用"
        fi

        # 确保 pm2-deploy 开机自启服务已启用
        if ! systemctl is-enabled pm2-deploy 2>/dev/null | grep -q "enabled"; then
            echo "[INFO] 设置 pm2-deploy 开机自启..."
            sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u $SERVER_USER --hp /home/$SERVER_USER 2>/dev/null || true
        fi
ENDSSH

    log_success "PM2 冲突检查完成"
}

# 安装 WebSocket 原生依赖
_install_websocket_deps() {
    log_info "检测 WebSocket 原生依赖..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export DEPLOY_PATH='$DEPLOY_PATH' REMOTE_STANDALONE_FRONTEND='$REMOTE_STANDALONE_FRONTEND' BUFFERUTIL_VERSION='$BUFFERUTIL_VERSION' UTF8_VALIDATE_VERSION='$UTF8_VALIDATE_VERSION'; bash -s" << 'ENDSSH'
        set -e
        cd $REMOTE_STANDALONE_FRONTEND

        # 缓存目录（存储已编译的 Linux 原生模块）
        NATIVE_CACHE_DIR="$DEPLOY_PATH/.native-cache"
        CACHE_VERSION_FILE="$NATIVE_CACHE_DIR/.version"
        CURRENT_VERSION="node-$(node --version)-$(uname -m)"

        # 检查是否需要重新编译原生依赖
        NEED_REBUILD=false

        # 检查缓存目录是否存在
        if [ ! -d "$NATIVE_CACHE_DIR/bufferutil" ] || [ ! -d "$NATIVE_CACHE_DIR/utf-8-validate" ]; then
            echo "[INFO] 原生依赖缓存不存在，需要首次编译"
            NEED_REBUILD=true
        elif [ ! -f "$CACHE_VERSION_FILE" ]; then
            echo "[INFO] 缓存版本文件缺失，需要重新编译"
            NEED_REBUILD=true
        else
            CACHED_VERSION=$(cat "$CACHE_VERSION_FILE")
            if [ "$CACHED_VERSION" != "$CURRENT_VERSION" ]; then
                echo "[INFO] Node.js 版本已变更 ($CACHED_VERSION -> $CURRENT_VERSION)，需要重新编译"
                NEED_REBUILD=true
            fi
        fi

        # 检查当前是否缺少原生依赖
        NEED_INSTALL=false
        if ! node -e "require('bufferutil')" 2>/dev/null; then
            echo "[INFO] 缺少 bufferutil"
            NEED_INSTALL=true
        fi
        if ! node -e "require('utf-8-validate')" 2>/dev/null; then
            echo "[INFO] 缺少 utf-8-validate"
            NEED_INSTALL=true
        fi

        # 如果需要重新编译或首次安装
        if [ "$NEED_REBUILD" = true ]; then
            echo "[INFO] 开始编译 WebSocket 原生依赖（Linux 平台）..."
            echo "[INFO] 这是一次性操作，后续部署将直接使用缓存（节省 70-80 秒）"

            # 创建缓存目录
            mkdir -p "$NATIVE_CACHE_DIR"

            # 使用 pnpm 强制重新安装并编译原生依赖
            pnpm add --force bufferutil@${BUFFERUTIL_VERSION} utf-8-validate@${UTF8_VALIDATE_VERSION} 2>&1 || {
                echo "[ERROR] pnpm 安装失败"
                exit 1
            }

            # 复制编译好的原生模块到缓存目录（使用 -L 跟随符号链接）
            echo "[INFO] 缓存编译好的原生模块..."
            cp -rL node_modules/bufferutil "$NATIVE_CACHE_DIR/"
            cp -rL node_modules/utf-8-validate "$NATIVE_CACHE_DIR/"

            # 记录缓存版本
            echo "$CURRENT_VERSION" > "$CACHE_VERSION_FILE"

            echo "[SUCCESS] WebSocket 原生依赖编译完成并已缓存"
        elif [ "$NEED_INSTALL" = true ]; then
            echo "[INFO] 从缓存复制 WebSocket 原生依赖（快速模式，节省 70-80 秒）..."

            # 从缓存复制已编译的原生模块
            mkdir -p node_modules
            cp -r "$NATIVE_CACHE_DIR/bufferutil" node_modules/
            cp -r "$NATIVE_CACHE_DIR/utf-8-validate" node_modules/

            # 验证复制是否成功
            if node -e "require('bufferutil')" 2>/dev/null && node -e "require('utf-8-validate')" 2>/dev/null; then
                echo "[SUCCESS] WebSocket 原生依赖已从缓存恢复（耗时 < 2s）"
            else
                echo "[ERROR] 缓存复制失败，需要重新编译"
                exit 1
            fi
        else
            echo "[SUCCESS] WebSocket 原生依赖已存在且有效，跳过安装"
        fi
ENDSSH

    log_success "WebSocket 依赖检查完成"
    record_timing "WebSocket 依赖"
    return 0
}

# 安装 CLIP 模型相关的原生依赖（onnxruntime-node, sharp）
_install_clip_deps() {
    log_info "检测 CLIP 原生依赖（onnxruntime-node, sharp）..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export DEPLOY_PATH='$DEPLOY_PATH' REMOTE_STANDALONE_FRONTEND='$REMOTE_STANDALONE_FRONTEND' REMOTE_STANDALONE_PATH='$REMOTE_STANDALONE_PATH'; bash -s" << 'ENDSSH'
        set -e
        cd $REMOTE_STANDALONE_FRONTEND

        # ============================================
        # 1. 检测并安装 onnxruntime-node Linux 原生绑定
        # ============================================
        echo "[INFO] 检查 onnxruntime-node Linux 绑定..."

        # 查找 onnxruntime-node 的安装位置
        ONNX_BINDING_DIR=""
        for dir in \
            "$REMOTE_STANDALONE_PATH/node_modules/onnxruntime-node/bin/napi-v3/linux/x64" \
            "$REMOTE_STANDALONE_FRONTEND/node_modules/onnxruntime-node/bin/napi-v3/linux/x64"; do
            if [ -d "$(dirname "$(dirname "$(dirname "$dir")")")" ]; then
                ONNX_BINDING_DIR="$dir"
                break
            fi
        done

        # 检查是否有 Linux x64 原生绑定
        NEED_ONNX_INSTALL=false
        if [ -z "$ONNX_BINDING_DIR" ]; then
            # 尝试通过查找 onnxruntime-node 目录
            ONNX_PKG=$(find "$REMOTE_STANDALONE_PATH/node_modules" -maxdepth 3 -type d -name "onnxruntime-node" 2>/dev/null | head -1)
            if [ -n "$ONNX_PKG" ]; then
                ONNX_BINDING_DIR="$ONNX_PKG/bin/napi-v3/linux/x64"
            fi
        fi

        if [ -n "$ONNX_BINDING_DIR" ]; then
            if [ ! -f "$ONNX_BINDING_DIR/onnxruntime_binding.node" ]; then
                echo "[WARN] onnxruntime-node 缺少 Linux x64 绑定"
                NEED_ONNX_INSTALL=true
            else
                echo "[SUCCESS] onnxruntime-node Linux x64 绑定已存在"
            fi
        else
            echo "[INFO] 未找到 onnxruntime-node 目录（可能未使用 CLIP 功能）"
        fi

        if [ "$NEED_ONNX_INSTALL" = true ]; then
            echo "[INFO] 从 npm 下载 onnxruntime-node Linux 绑定..."

            # 获取当前安装的版本
            ONNX_VERSION=$(node -p "require('$REMOTE_STANDALONE_PATH/node_modules/onnxruntime-node/package.json').version" 2>/dev/null || echo "1.21.0")
            echo "[INFO] onnxruntime-node 版本: $ONNX_VERSION"

            # 创建临时目录下载
            TEMP_DIR=$(mktemp -d)
            cd "$TEMP_DIR"

            # 使用淘宝镜像下载
            npm pack "onnxruntime-node@$ONNX_VERSION" --registry=https://registry.npmmirror.com 2>/dev/null || \
            npm pack "onnxruntime-node@$ONNX_VERSION" 2>/dev/null

            # 解压并复制 Linux 绑定
            tar -xzf onnxruntime-node-*.tgz
            # onnxruntime-node@1.21.0+ 目录结构: package/bin/napi-v3/linux/linux/x64/
            # 旧版目录结构: package/bin/napi-v3/linux/x64/
            # 需要确保最终路径为 .../napi-v3/linux/x64/onnxruntime_binding.node
            PACK_BINDING_DIR=$(find package/bin -name "onnxruntime_binding.node" -path "*/linux*x64*" -exec dirname {} \; 2>/dev/null | head -1)
            if [ -n "$PACK_BINDING_DIR" ]; then
                mkdir -p "$ONNX_BINDING_DIR"
                cp "$PACK_BINDING_DIR"/* "$ONNX_BINDING_DIR/"
                echo "[SUCCESS] onnxruntime-node Linux 绑定安装完成: $(ls "$ONNX_BINDING_DIR/")"
            elif [ -d "package/bin/napi-v3/linux" ]; then
                mkdir -p "$(dirname "$ONNX_BINDING_DIR")"
                cp -r package/bin/napi-v3/linux "$(dirname "$ONNX_BINDING_DIR")/"
                echo "[SUCCESS] onnxruntime-node Linux 绑定安装完成（目录复制）"
            else
                echo "[WARN] 下载的包中未找到 Linux 绑定"
            fi

            # 清理临时文件
            cd $REMOTE_STANDALONE_FRONTEND
            rm -rf "$TEMP_DIR"
        fi

        # ============================================
        # 2. 检测并安装 sharp Linux 原生绑定
        # ============================================
        echo "[INFO] 检查 sharp Linux 绑定..."

        # sharp 使用 @img/sharp-linux-x64 包
        SHARP_LINUX_DIR="$REMOTE_STANDALONE_PATH/node_modules/@img/sharp-linux-x64"
        NEED_SHARP_INSTALL=false

        if [ ! -d "$SHARP_LINUX_DIR" ]; then
            # 检查其他可能的位置
            SHARP_LINUX_DIR=$(find "$REMOTE_STANDALONE_PATH/node_modules" -maxdepth 3 -type d -name "sharp-linux-x64" 2>/dev/null | head -1)
        fi

        if [ -z "$SHARP_LINUX_DIR" ] || [ ! -f "$SHARP_LINUX_DIR/lib/sharp-linux-x64.node" ]; then
            echo "[WARN] sharp 缺少 Linux x64 绑定"
            NEED_SHARP_INSTALL=true
        else
            echo "[SUCCESS] sharp Linux x64 绑定已存在"
        fi

        if [ "$NEED_SHARP_INSTALL" = true ]; then
            echo "[INFO] 安装 sharp Linux 绑定..."

            # 使用临时目录下载并手动复制（不在 standalone 目录中运行包管理器，
            # 避免 pnpm add/npm install 覆盖 .pnpm 虚拟存储导致 next 等依赖丢失）
            TEMP_DIR=$(mktemp -d)
            cd "$TEMP_DIR"

            # 下载 sharp Linux 原生绑定包
            npm pack @img/sharp-linux-x64@0.34.5 --registry=https://registry.npmmirror.com 2>/dev/null || \
            npm pack @img/sharp-linux-x64@0.34.5 2>/dev/null

            npm pack @img/sharp-libvips-linux-x64@1.2.4 --registry=https://registry.npmmirror.com 2>/dev/null || \
            npm pack @img/sharp-libvips-linux-x64@1.2.4 2>/dev/null

            # 解压并复制到 standalone node_modules
            SHARP_TARGET="$REMOTE_STANDALONE_PATH/node_modules/@img/sharp-linux-x64"
            LIBVIPS_TARGET="$REMOTE_STANDALONE_PATH/node_modules/@img/sharp-libvips-linux-x64"

            # 确保 @img 是目录而非符号链接
            IMG_DIR="$REMOTE_STANDALONE_PATH/node_modules/@img"
            if [ -L "$IMG_DIR" ]; then
                rm -f "$IMG_DIR"
            fi
            mkdir -p "$IMG_DIR"

            # 解压 sharp-linux-x64
            SHARP_TGZ=$(ls img-sharp-linux-x64-*.tgz 2>/dev/null | head -1)
            if [ -n "$SHARP_TGZ" ]; then
                mkdir -p sharp-extract && tar -xzf "$SHARP_TGZ" -C sharp-extract
                rm -rf "$SHARP_TARGET"
                mv sharp-extract/package "$SHARP_TARGET"
                echo "[SUCCESS] sharp-linux-x64 绑定已复制"
            fi

            # 解压 sharp-libvips-linux-x64
            LIBVIPS_TGZ=$(ls img-sharp-libvips-linux-x64-*.tgz 2>/dev/null | head -1)
            if [ -n "$LIBVIPS_TGZ" ]; then
                mkdir -p libvips-extract && tar -xzf "$LIBVIPS_TGZ" -C libvips-extract
                rm -rf "$LIBVIPS_TARGET"
                mv libvips-extract/package "$LIBVIPS_TARGET"
                echo "[SUCCESS] sharp-libvips-linux-x64 绑定已复制"
            fi

            # 创建符号链接确保 sharp 能找到原生模块
            SHARP_LINUX_DIR="$SHARP_TARGET"
            if [ -d "$SHARP_LINUX_DIR" ]; then
                SHARP_BUILD_DIR="$REMOTE_STANDALONE_PATH/node_modules/sharp/build/Release"
                mkdir -p "$SHARP_BUILD_DIR"

                # 查找 .node 文件并创建符号链接
                SHARP_NODE_FILE=$(find "$SHARP_LINUX_DIR" -name "*.node" 2>/dev/null | head -1)
                if [ -n "$SHARP_NODE_FILE" ]; then
                    ln -sf "$SHARP_NODE_FILE" "$SHARP_BUILD_DIR/sharp-linux-x64.node" 2>/dev/null || true
                    echo "[SUCCESS] sharp Linux 绑定安装完成"
                fi
            fi

            # 清理临时文件
            cd $REMOTE_STANDALONE_FRONTEND
            rm -rf "$TEMP_DIR"
        fi
ENDSSH

    log_success "CLIP 原生依赖检查完成"
    record_timing "CLIP 原生依赖"
    return 0
}

# 下载 CLIP 模型（使用中国镜像）
_install_clip_model() {
    log_info "检测 CLIP 模型..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export DEPLOY_PATH='$DEPLOY_PATH'; bash -s" << 'ENDSSH'
        set -e

        # CLIP 模型缓存目录
        CACHE_DIR="$DEPLOY_PATH/.transformers-cache"
        MODEL_DIR="$CACHE_DIR/Xenova/clip-vit-base-patch32"
        ONNX_MODEL="$MODEL_DIR/onnx/vision_model.onnx"

        # 检查模型是否已存在
        if [ -f "$ONNX_MODEL" ]; then
            echo "[SUCCESS] CLIP 模型已存在: $ONNX_MODEL"
            echo "[INFO] 模型大小: $(ls -lh "$ONNX_MODEL" | awk '{print $5}')"
            exit 0
        fi

        echo "[INFO] CLIP 模型不存在，开始下载..."

        # 创建目录结构
        mkdir -p "$MODEL_DIR/onnx"

        # 使用中国镜像下载
        HF_MIRROR="https://hf-mirror.com"
        MODEL_BASE="$HF_MIRROR/Xenova/clip-vit-base-patch32/resolve/main"

        # 模型配置文件列表
        CONFIG_FILES=(
            "config.json"
            "preprocessor_config.json"
            "tokenizer.json"
            "tokenizer_config.json"
            "special_tokens_map.json"
            "vocab.json"
            "merges.txt"
        )

        # 下载配置文件
        echo "[INFO] 下载模型配置文件..."
        for file in "${CONFIG_FILES[@]}"; do
            if [ ! -f "$MODEL_DIR/$file" ]; then
                echo "  下载 $file..."
                curl -sL "$MODEL_BASE/$file" -o "$MODEL_DIR/$file" 2>/dev/null || \
                wget -q "$MODEL_BASE/$file" -O "$MODEL_DIR/$file" 2>/dev/null || \
                echo "  [WARN] 无法下载 $file（可能是可选文件）"
            fi
        done

        # 下载 ONNX 模型（这是核心文件，约 336MB）
        echo "[INFO] 下载 ONNX 模型（约 336MB，请耐心等待）..."
        ONNX_URL="$MODEL_BASE/onnx/vision_model.onnx"

        if command -v curl &> /dev/null; then
            curl -L --progress-bar "$ONNX_URL" -o "$ONNX_MODEL"
        elif command -v wget &> /dev/null; then
            wget --progress=bar:force "$ONNX_URL" -O "$ONNX_MODEL"
        else
            echo "[ERROR] 未找到 curl 或 wget，无法下载模型"
            exit 1
        fi

        # 验证下载是否成功
        if [ -f "$ONNX_MODEL" ]; then
            SIZE=$(stat -c%s "$ONNX_MODEL" 2>/dev/null || stat -f%z "$ONNX_MODEL" 2>/dev/null || echo "0")
            if [ "$SIZE" -gt 100000000 ]; then  # 大于 100MB
                echo "[SUCCESS] CLIP 模型下载完成"
                echo "[INFO] 模型大小: $(ls -lh "$ONNX_MODEL" | awk '{print $5}')"
            else
                echo "[ERROR] 模型文件过小，下载可能不完整"
                rm -f "$ONNX_MODEL"
                exit 1
            fi
        else
            echo "[ERROR] 模型下载失败"
            exit 1
        fi

        # 设置正确的权限
        chmod -R 755 "$CACHE_DIR"
ENDSSH

    log_success "CLIP 模型检查完成"
    record_timing "CLIP 模型"
    return 0
}

# 重启应用（零停机）
_restart_application() {
    log_info "重启应用（零停机模式）..."

    ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export REMOTE_STANDALONE_FRONTEND='$REMOTE_STANDALONE_FRONTEND' APP_NAME='$APP_NAME' APP_PORT='$APP_PORT' APP_STARTUP_WAIT='$APP_STARTUP_WAIT' HEALTH_CHECK_RETRIES='$HEALTH_CHECK_RETRIES' HEALTH_CHECK_INTERVAL='$HEALTH_CHECK_INTERVAL'; bash -s" << 'ENDSSH'
        set -e
        cd $REMOTE_STANDALONE_FRONTEND

        # ============================================
        # 清理端口占用（防止 EADDRINUSE 错误）
        # 如果之前有 crash loop，可能有僵尸进程占用端口
        # ============================================
        echo "[INFO] 检查端口 $APP_PORT 占用情况..."
        if command -v fuser &> /dev/null; then
            PIDS=$(fuser $APP_PORT/tcp 2>/dev/null || true)
            if [ -n "$PIDS" ]; then
                echo "[WARN] 发现进程占用端口 $APP_PORT: $PIDS"
                echo "[INFO] 清理占用端口的进程..."
                fuser -k $APP_PORT/tcp 2>/dev/null || true
                sleep 1
                echo "[SUCCESS] 端口清理完成"
            fi
        elif command -v ss &> /dev/null; then
            # 使用 ss 作为备选
            PORT_PID=$(ss -tlnp 2>/dev/null | grep ":$APP_PORT " | grep -oP 'pid=\K[0-9]+' | head -1 || true)
            if [ -n "$PORT_PID" ]; then
                echo "[WARN] 发现进程 $PORT_PID 占用端口 $APP_PORT"
                kill -9 $PORT_PID 2>/dev/null || true
                sleep 1
                echo "[SUCCESS] 端口清理完成"
            fi
        fi

        # 检查应用是否已存在
        if pm2 list 2>/dev/null | grep -q "$APP_NAME"; then
            # 获取当前运行的工作目录
            CURRENT_CWD=$(pm2 show "$APP_NAME" 2>/dev/null | grep "exec cwd" | awk -F'│' '{print $2}' | xargs)

            # 检查工作目录是否匹配
            if [[ "$CURRENT_CWD" != "$REMOTE_STANDALONE_FRONTEND" ]]; then
                # 工作目录不匹配，需要删除并重新启动
                echo "[WARN] PM2 工作目录已变更"
                echo "[WARN]   旧目录: $CURRENT_CWD"
                echo "[WARN]   新目录: $REMOTE_STANDALONE_FRONTEND"
                echo "[INFO] 删除旧进程并从新目录启动..."
                pm2 delete "$APP_NAME" "${APP_NAME}-cron" 2>/dev/null || true
                pm2 start ecosystem.config.js
            else
                # 工作目录匹配，使用 reload 实现零停机
                echo "[INFO] 使用 PM2 reload 重启应用（零停机）..."
                pm2 reload ecosystem.config.js --update-env
            fi
        else
            # 首次启动
            echo "[INFO] 首次启动 PM2 应用..."
            pm2 start ecosystem.config.js
        fi
        pm2 save

        # 等待启动
        sleep $APP_STARTUP_WAIT

        # 健康检查（带重试）
        HEALTH_CHECK_PASSED=false
        for retry in $(seq 1 $HEALTH_CHECK_RETRIES); do
            if pm2 list | grep -q "$APP_NAME.*online"; then
                echo "[SUCCESS] 应用已启动"
                pm2 status $APP_NAME
                HEALTH_CHECK_PASSED=true
                break
            fi
            echo "[WARN] 健康检查失败，重试 ($retry/$HEALTH_CHECK_RETRIES)..."
            sleep $HEALTH_CHECK_INTERVAL
        done

        if [ "$HEALTH_CHECK_PASSED" = false ]; then
            echo "[ERROR] 应用启动失败，健康检查未通过"
            pm2 logs $APP_NAME --lines 20 --nostream 2>/dev/null || true
            exit 1
        fi

        # 检查 Cron 调度器状态
        if pm2 list | grep -q "${APP_NAME}-cron.*online"; then
            echo "[SUCCESS] Cron 调度器已启动"
        else
            echo "[WARN] Cron 调度器可能启动失败"
            pm2 logs ${APP_NAME}-cron --lines 20 --nostream 2>/dev/null || true
        fi
ENDSSH

    # 健康检查结果处理（在本地）
    if [[ $? -ne 0 ]]; then
        _handle_health_check_failure
        return 1
    else
        # 健康检查通过，清理备份
        if [[ -n "$REMOTE_BACKUP_PATH" ]]; then
            log_info "健康检查通过，清理旧版本备份..."
            ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "rm -rf $REMOTE_BACKUP_PATH" 2>/dev/null || true
        fi
    fi

    record_timing "应用重启"
    return 0
}

# 处理健康检查失败（执行回滚）
_handle_health_check_failure() {
    if [[ -n "$REMOTE_BACKUP_PATH" ]]; then
        log_warn "============================================"
        log_warn "  执行自动回滚..."
        log_warn "============================================"

        ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "export REMOTE_STANDALONE_PATH='$REMOTE_STANDALONE_PATH' REMOTE_BACKUP_PATH='$REMOTE_BACKUP_PATH'; bash -s" << 'ENDSSH'
            set -e
            echo "[INFO] 恢复备份..."
            rm -rf $REMOTE_STANDALONE_PATH
            mv $REMOTE_BACKUP_PATH $REMOTE_STANDALONE_PATH
            echo "[INFO] 重启旧版本应用..."
            cd $REMOTE_STANDALONE_PATH/frontend
            pm2 reload ecosystem.config.js --update-env 2>/dev/null || pm2 restart all
            pm2 save
            echo "[SUCCESS] 回滚完成"
ENDSSH
        log_success "已回滚到上一版本"
    else
        log_error "无可用备份，无法回滚"
    fi
}
