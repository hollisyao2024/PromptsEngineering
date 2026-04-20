#!/bin/bash
# ============================================
# Deploy Common Functions
# 部署脚本共享函数库
#
# 包含：
#   - 静态常量和可配置变量
#   - 环境变量加载和验证
#   - 数据库迁移
#   - SSH 连接复用
#   - Nginx 配置生成
#   - PM2 配置生成
#   - rsync 排除规则
# ============================================

# 防止重复加载
if [[ -n "${_DEPLOY_COMMON_LOADED:-}" ]]; then
    return 0 2>/dev/null || exit 0
fi
_DEPLOY_COMMON_LOADED=true

# ============================================
# 第一部分：静态常量（不会变化）
# ============================================
COMMON_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$COMMON_SCRIPT_DIR/../../.." && pwd)"
CONTAINER_ROOT="$(cd "$PROJECT_ROOT/.." && pwd)"
FRONTEND_DIR="$PROJECT_ROOT/apps/web"
DATABASE_DIR="$PROJECT_ROOT/packages/database"

# 构建产物目录名
BUILD_DIR_DEFAULT=".next-deploy"
BUILD_DIR_DEV=".next"

# Hash 文件名（相对于 BUILD_DIR）
BUILD_HASH_FILENAME=".build-commit-hash"
BUILD_FINGERPRINT_FILENAME=".build-fingerprint"
ENV_HASH_FILENAME=".build-env-hash"
PRISMA_HASH_FILENAME=".prisma-schema-hash"
CRON_HASH_FILENAME=".cron-build-hash"
DEPS_HASH_FILENAME=".deps-hash"
RUNTIME_DEPS_FINGERPRINT_FILENAME=".runtime-deps-fingerprint"
SCHEMA_HASH_FILENAME=".schema-hash"
ARTIFACT_MANIFEST_FILENAME="artifact-manifest.env"

# ============================================
# 第二部分：可配置常量（全部可通过环境变量覆盖）
# ============================================
# 这些变量都可以在 .env 文件中配置，不配置则使用默认值

# --- CI 检查配置 ---
TYPECHECK_TIMEOUT="${TYPECHECK_TIMEOUT:-60}"           # TypeScript 检查超时（秒）
LINT_TIMEOUT="${LINT_TIMEOUT:-300}"                     # Lint 检查超时（秒）
DEPLOY_CHECK_MODE="${DEPLOY_CHECK_MODE:-}"             # 部署前检查模式（full|reuse）
DEPLOY_CHECK_TTL_MINUTES="${DEPLOY_CHECK_TTL_MINUTES:-180}"  # 预检缓存有效期（分钟）
BUILD_PUBLIC_ENV_KEYS="${BUILD_PUBLIC_ENV_KEYS:-}"     # 参与 build fingerprint 的 NEXT_PUBLIC_* 白名单（逗号分隔，为空则使用全部）

# --- SSH 连接配置 ---
SSH_KEY="${SSH_KEY:-}"                                   # SSH 私钥路径（staging/prod 必填）
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-10}"        # SSH 连接超时（秒）
SSH_CONTROL_PERSIST="${SSH_CONTROL_PERSIST:-1800}"      # SSH 连接复用保持时间（秒）

# --- 健康检查配置 ---
HEALTH_CHECK_RETRIES="${HEALTH_CHECK_RETRIES:-3}"       # 健康检查重试次数
HEALTH_CHECK_INTERVAL="${HEALTH_CHECK_INTERVAL:-3}"     # 健康检查间隔（秒）
HEALTH_CHECK_PATH="${HEALTH_CHECK_PATH:-/api/health}"   # HTTP 健康检查路径

# --- 备份配置 ---
BACKUP_KEEP_STAGING="${BACKUP_KEEP_STAGING:-2}"         # Staging 备份保留数量
BACKUP_KEEP_PRODUCTION="${BACKUP_KEEP_PRODUCTION:-3}"   # Production 备份保留数量

# --- WebSocket 依赖版本 ---
BUFFERUTIL_VERSION="${BUFFERUTIL_VERSION:-^4.1.0}"
UTF8_VALIDATE_VERSION="${UTF8_VALIDATE_VERSION:-^6.0.6}"

# --- 应用配置 ---
APP_PORT="${APP_PORT:-3000}"                            # 应用监听端口
APP_STARTUP_WAIT="${APP_STARTUP_WAIT:-3}"               # 应用启动等待时间（秒）
APP_READY_WAIT="${APP_READY_WAIT:-5}"                   # 应用完全就绪等待时间（秒）

# --- 本地部署缓存/产物配置 ---
DEPLOY_CACHE_DIR="${DEPLOY_CACHE_DIR:-$CONTAINER_ROOT/artifacts/deploy-cache}"
DEPLOY_CHECK_CACHE_DIR="${DEPLOY_CHECK_CACHE_DIR:-$DEPLOY_CACHE_DIR/checks}"
DEPLOY_ARTIFACT_CACHE_DIR="${DEPLOY_ARTIFACT_CACHE_DIR:-$DEPLOY_CACHE_DIR/artifacts}"

# --- Nginx 配置 ---
NGINX_CLIENT_MAX_BODY_SIZE="${NGINX_CLIENT_MAX_BODY_SIZE:-50M}"       # 上传文件大小限制
NGINX_PROXY_TIMEOUT="${NGINX_PROXY_TIMEOUT:-300s}"                    # 代理超时时间（需覆盖 AI 同步生成场景）
NGINX_SSL_SESSION_CACHE="${NGINX_SSL_SESSION_CACHE:-shared:SSL:50m}"  # SSL 会话缓存

# --- 数据库备份配置 ---
DB_BACKUP_RETENTION_DAYS="${DB_BACKUP_RETENTION_DAYS:-7}"  # pg_dump 备份保留天数

# --- 运行时版本门禁 ---
REQUIRED_NODE_VERSION="${REQUIRED_NODE_VERSION:-}"
REQUIRED_NEXT_VERSION="${REQUIRED_NEXT_VERSION:-}"

# ============================================
# 第三部分：环境相关变量（运行时设置）
# ============================================
# 这些变量将在 load_deploy_config() 中设置
# 部署目标配置由以下环境变量控制：
#
# Staging 环境:
#   STAGING_SERVER_HOST     - 服务器地址
#   STAGING_SERVER_PORT     - SSH 端口（必填）
#   STAGING_SERVER_USER     - SSH 用户（必填）
#   STAGING_DEPLOY_PATH     - 部署路径（必填）
#   STAGING_DOMAIN          - 域名（可选）
#
# Production 环境:
#   PRODUCTION_SERVER_HOST  - 服务器地址
#   PRODUCTION_SERVER_PORT  - SSH 端口（必填）
#   PRODUCTION_SERVER_USER  - SSH 用户（必填）
#   PRODUCTION_DEPLOY_PATH  - 部署路径（必填）
#   PRODUCTION_DOMAIN       - 域名（可选）

# ============================================
# 环境配置加载函数
# ============================================

# 加载环境特定变量
# 参数：$1=环境名称（dev/staging/production）
load_deploy_config() {
    local env=$1

    case "$env" in
        "dev")
            IS_LOCAL_DEPLOY=true
            SERVER_HOST="localhost"
            SERVER_USER="$USER"
            SERVER_PORT=""
            DEPLOY_PATH="$CONTAINER_ROOT/artifacts/next-dev-deploy"
            APP_NAME="${DEV_SERVER_NAME:-frontend-dev}"
            DOMAIN_NAME=""
            BUILD_DIR="$BUILD_DIR_DEV"
            REMOTE_BUILD_DIR="$BUILD_DIR_DEV"
            BACKUP_KEEP_COUNT=1
            ;;
        "staging")
            IS_LOCAL_DEPLOY=false
            SERVER_HOST="${STAGING_SERVER_HOST:-}"
            SERVER_PORT="${STAGING_SERVER_PORT:-}"
            SERVER_USER="${STAGING_SERVER_USER:-}"
            DEPLOY_PATH="${STAGING_DEPLOY_PATH:-}"
            APP_NAME="staging-app"
            DOMAIN_NAME="${STAGING_DOMAIN:-staging.linghuiai.net}"
            BUILD_DIR="$BUILD_DIR_DEFAULT"
            REMOTE_BUILD_DIR="$BUILD_DIR_DEFAULT"
            BACKUP_KEEP_COUNT="${BACKUP_KEEP_STAGING:-2}"
            ;;
        "production")
            IS_LOCAL_DEPLOY=false
            SERVER_HOST="${PRODUCTION_SERVER_HOST:-}"
            SERVER_PORT="${PRODUCTION_SERVER_PORT:-}"
            SERVER_USER="${PRODUCTION_SERVER_USER:-}"
            DEPLOY_PATH="${PRODUCTION_DEPLOY_PATH:-}"
            APP_NAME="production-app"
            DOMAIN_NAME="${PRODUCTION_DOMAIN:-linghuiai.net}"
            BUILD_DIR="$BUILD_DIR_DEFAULT"
            REMOTE_BUILD_DIR="$BUILD_DIR_DEFAULT"
            BACKUP_KEEP_COUNT="${BACKUP_KEEP_PRODUCTION:-3}"
            ;;
        *)
            log_error "未知环境: $env"
            return 1
            ;;
    esac

    # 远端目录结构（与本地 monorepo 对齐）
    REMOTE_APP_DIR="$DEPLOY_PATH/apps/web"
    REMOTE_DATABASE_DIR="$DEPLOY_PATH/packages/database"
    REMOTE_SCRIPTS_DIR="$DEPLOY_PATH/infra/scripts"

    # 派生路径（自动计算，无需手动配置）
    REMOTE_STANDALONE_PATH="$REMOTE_APP_DIR/$REMOTE_BUILD_DIR/standalone"
    REMOTE_STANDALONE_FRONTEND="$REMOTE_STANDALONE_PATH/apps/web"

    # Hash 文件完整路径
    BUILD_HASH_FILE="$BUILD_DIR/$BUILD_HASH_FILENAME"
    ENV_HASH_FILE="$BUILD_DIR/$ENV_HASH_FILENAME"
    PRISMA_HASH_FILE="$BUILD_DIR/$PRISMA_HASH_FILENAME"
    CRON_HASH_FILE="$BUILD_DIR/$CRON_HASH_FILENAME"

    return 0
}

# 验证部署配置
# 参数：$1=环境名称
# 返回：0=验证通过，1=验证失败
validate_deploy_config() {
    local env=$1
    local errors=()

    # 远程部署必须完整配置（禁止硬编码回退）
    if [[ "$IS_LOCAL_DEPLOY" != "true" ]]; then
        local env_prefix=$(echo "$env" | tr '[:lower:]' '[:upper:]')
        [[ -z "$SERVER_HOST" ]] && errors+=("${env_prefix}_SERVER_HOST 未配置")
        [[ -z "$SERVER_PORT" ]] && errors+=("${env_prefix}_SERVER_PORT 未配置")
        [[ -z "$SERVER_USER" ]] && errors+=("${env_prefix}_SERVER_USER 未配置")
        [[ -z "$DEPLOY_PATH" ]] && errors+=("${env_prefix}_DEPLOY_PATH 未配置")
        [[ -z "$SSH_KEY" ]] && errors+=("SSH_KEY 未配置")
        [[ -n "$SSH_KEY" && "$SSH_KEY" == "~/"* ]] && SSH_KEY="$HOME/${SSH_KEY#~/}"
        # 相对路径统一解析为项目根下的绝对路径，避免子进程切换 cwd 后 scp/ssh 找不到密钥
        [[ -n "$SSH_KEY" && "$SSH_KEY" != /* ]] && SSH_KEY="$PROJECT_ROOT/$SSH_KEY"
        [[ -n "$SSH_KEY" && ! -f "$SSH_KEY" ]] && errors+=("SSH 密钥不存在: $SSH_KEY")
    fi

    # dev 环境与本地开发脚本一致，统一使用 .env.local
    local env_file="$PROJECT_ROOT/.env.$env"
    if [[ "$env" == "dev" ]]; then
        env_file="$PROJECT_ROOT/.env.local"
    fi
    [[ ! -f "$env_file" ]] && errors+=("环境变量文件不存在: $env_file")

    # 输出错误
    if [[ ${#errors[@]} -gt 0 ]]; then
        log_error "配置验证失败："
        for err in "${errors[@]}"; do
            log_error "  - $err"
        done
        return 1
    fi

    return 0
}

normalize_semver() {
    local version="${1:-}"
    version="${version#v}"
    version="${version#V}"
    printf '%s' "$version" | tr -d '[:space:]'
}

version_gte() {
    local current required first
    current=$(normalize_semver "$1")
    required=$(normalize_semver "$2")

    if [[ -z "$current" || -z "$required" ]]; then
        return 1
    fi

    first=$(printf '%s\n%s\n' "$required" "$current" | sort -V | head -n1)
    [[ "$first" == "$required" ]]
}

resolve_required_runtime_versions() {
    if [[ -z "$REQUIRED_NODE_VERSION" ]]; then
        if [[ -f "$PROJECT_ROOT/.nvmrc" ]]; then
            REQUIRED_NODE_VERSION=$(tr -d '[:space:]' < "$PROJECT_ROOT/.nvmrc")
        else
            REQUIRED_NODE_VERSION="24.14.1"
        fi
    fi

    if [[ -z "$REQUIRED_NEXT_VERSION" ]]; then
        REQUIRED_NEXT_VERSION=$(node -p "(() => {
          const pkg = require('$FRONTEND_DIR/package.json');
          const value = (pkg.dependencies && pkg.dependencies.next) || (pkg.devDependencies && pkg.devDependencies.next) || '';
          return String(value).replace(/^[\^~]/, '');
        })()" 2>/dev/null)
    fi

    if [[ -z "$REQUIRED_NEXT_VERSION" ]]; then
        REQUIRED_NEXT_VERSION="16.2.3"
    fi
}

verify_remote_node_runtime_preflight() {
    resolve_required_runtime_versions

    log_info "检查目标服务器 Node.js 运行时版本..."

    local remote_node_version
    remote_node_version=$(ssh ${SSH_OPTS} "$SERVER_USER@$SERVER_HOST" "node -v 2>/dev/null || true" 2>/dev/null | tr -d '\r\n')

    if [[ -z "$remote_node_version" ]]; then
        log_error "目标服务器未安装 Node.js，无法继续部署"
        return 1
    fi

    if ! version_gte "$remote_node_version" "$REQUIRED_NODE_VERSION"; then
        log_error "目标服务器 Node.js 版本过低：当前 ${remote_node_version}，要求 >= v${REQUIRED_NODE_VERSION}"
        log_error "请先升级服务器 Node.js，再执行 /ship staging 或 /ship prod"
        return 1
    fi

    log_success "目标服务器 Node.js 版本满足要求：${remote_node_version} (required >= v${REQUIRED_NODE_VERSION})"
    return 0
}

# 显示当前部署配置（用于调试）
show_deploy_config() {
    log_info "当前部署配置："
    log_info "  环境: $ENV"
    log_info "  服务器: $SERVER_USER@$SERVER_HOST:${SERVER_PORT:-22}"
    log_info "  部署路径: $DEPLOY_PATH"
    log_info "  域名: ${DOMAIN_NAME:-N/A}"
    log_info "  构建目录: $BUILD_DIR"
    log_info "  SSH 密钥: $SSH_KEY"
    log_info "  备份保留: $BACKUP_KEEP_COUNT"
}

ensure_deploy_cache_dirs() {
    mkdir -p "$DEPLOY_CACHE_DIR" "$DEPLOY_CHECK_CACHE_DIR" "$DEPLOY_ARTIFACT_CACHE_DIR"
}

deploy_hash_string() {
    if [[ "$(uname)" == "Darwin" ]]; then
        printf '%s' "$1" | /sbin/md5 -q
    elif command -v md5sum &> /dev/null; then
        printf '%s' "$1" | md5sum | cut -d' ' -f1
    else
        printf '%s' "$1"
    fi
}

deploy_hash_file_if_exists() {
    local file_path=$1

    if [[ ! -f "$file_path" ]]; then
        echo "missing:$file_path"
        return 0
    fi

    if [[ "$(uname)" == "Darwin" ]]; then
        /sbin/md5 -q "$file_path"
    elif command -v md5sum &> /dev/null; then
        md5sum "$file_path" | cut -d' ' -f1
    else
        wc -c < "$file_path" | tr -d ' '
    fi
}

deploy_repo_is_clean() {
    [[ -z "$(git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null)" ]]
}

deploy_hash_tracked_paths() {
    local path_hash
    path_hash=$(git -C "$PROJECT_ROOT" ls-files -s -- "$@" 2>/dev/null || true)
    deploy_hash_string "$path_hash"
}

compute_public_env_hash() {
    local env_snapshot
    env_snapshot=$(env | grep '^NEXT_PUBLIC_' | sort || true)
    deploy_hash_string "$env_snapshot"
}

compute_build_public_env_hash() {
    if [[ -z "$BUILD_PUBLIC_ENV_KEYS" ]]; then
        compute_public_env_hash
        return 0
    fi

    local filtered_snapshot=""
    local key
    local value
    IFS=',' read -r -a _build_env_keys <<< "$BUILD_PUBLIC_ENV_KEYS"
    for key in "${_build_env_keys[@]}"; do
        key="${key// /}"
        [[ -n "$key" ]] || continue
        value="${!key-}"
        filtered_snapshot="${filtered_snapshot}${key}=${value}"$'\n'
    done

    deploy_hash_string "$filtered_snapshot"
}

compute_lockfile_hash() {
    deploy_hash_file_if_exists "$PROJECT_ROOT/pnpm-lock.yaml"
}

compute_prisma_schema_hash() {
    deploy_hash_tracked_paths \
        packages/database/prisma/schema.prisma \
        packages/database/prisma/migrations
}

compute_deploy_check_mode() {
    local env=$1

    if [[ -n "$DEPLOY_CHECK_MODE" ]]; then
        echo "$DEPLOY_CHECK_MODE"
        return 0
    fi

    if [[ "$env" == "staging" ]]; then
        echo "reuse"
    else
        echo "full"
    fi
}

compute_check_input_fingerprint() {
    local check_name=$1
    local public_env_hash=${2:-$(compute_public_env_hash)}
    local lockfile_hash=${3:-$(compute_lockfile_hash)}
    local prisma_hash=${4:-$(compute_prisma_schema_hash)}
    local source_hash=""

    case "$check_name" in
        "lint")
            source_hash=$(deploy_hash_tracked_paths \
                apps/web/src \
                apps/web/.eslintrc.json \
                apps/web/package.json \
                package.json \
                pnpm-lock.yaml)
            ;;
        "typecheck")
            source_hash=$(deploy_hash_tracked_paths \
                apps/web/src \
                apps/web/package.json \
                apps/web/tsconfig.json \
                apps/web/next.config.js \
                package.json \
                pnpm-lock.yaml \
                packages/database/prisma/schema.prisma \
                packages/database/prisma/migrations)
            ;;
        "test")
            source_hash=$(deploy_hash_tracked_paths \
                apps/web/src \
                apps/web/scripts \
                apps/web/jest.config.js \
                apps/web/jest.setup.js \
                apps/web/package.json \
                package.json \
                pnpm-lock.yaml \
                packages/database/prisma/schema.prisma \
                packages/database/prisma/migrations)
            ;;
        *)
            source_hash=$(deploy_hash_tracked_paths apps/web/src apps/web/package.json package.json)
            ;;
    esac

    deploy_hash_string "check=$check_name|src=$source_hash|public=$public_env_hash|lock=$lockfile_hash|prisma=$prisma_hash"
}

compute_build_input_fingerprint() {
    local public_env_hash=${1:-$(compute_build_public_env_hash)}
    local lockfile_hash=${2:-$(compute_lockfile_hash)}
    local prisma_hash=${3:-$(compute_prisma_schema_hash)}
    local source_hash

    source_hash=$(deploy_hash_tracked_paths \
        apps/web/src \
        apps/web/public \
        apps/web/scripts \
        apps/web/package.json \
        apps/web/next.config.js \
        apps/web/tsconfig.json \
        package.json \
        pnpm-lock.yaml \
        packages/database/prisma/schema.prisma \
        packages/database/prisma/migrations \
        infra/scripts/cron \
        infra/scripts/server/deploy-build.sh)

    deploy_hash_string "build=$source_hash|public=$public_env_hash|lock=$lockfile_hash|prisma=$prisma_hash"
}

artifact_cache_dir_for_fingerprint() {
    local fingerprint=$1
    echo "$DEPLOY_ARTIFACT_CACHE_DIR/$fingerprint"
}

artifact_manifest_path_for_fingerprint() {
    local fingerprint=$1
    echo "$(artifact_cache_dir_for_fingerprint "$fingerprint")/$ARTIFACT_MANIFEST_FILENAME"
}

# ============================================
# 部署耗时统计（兼容 bash 3.x）
# ============================================

# 全局变量：记录各阶段耗时（使用普通数组，兼容 bash 3）
DEPLOY_TIMING_STAGES=""
DEPLOY_TIMING_VALUES=""
DEPLOY_START_TIME=""

# 开始计时
start_deploy_timer() {
    DEPLOY_START_TIME=$(date +%s)
    DEPLOY_TIMING_STAGES=""
    DEPLOY_TIMING_VALUES=""
}

# 记录阶段耗时
# 参数：$1=阶段名称
record_timing() {
    local stage=$1
    local current_time=$(date +%s)
    local elapsed=$((current_time - DEPLOY_START_TIME))

    # 追加到阶段列表（用换行分隔）
    if [[ -z "$DEPLOY_TIMING_STAGES" ]]; then
        DEPLOY_TIMING_STAGES="$stage"
        DEPLOY_TIMING_VALUES="$elapsed"
    else
        DEPLOY_TIMING_STAGES="$DEPLOY_TIMING_STAGES
$stage"
        DEPLOY_TIMING_VALUES="$DEPLOY_TIMING_VALUES
$elapsed"
    fi
}

# 显示耗时统计
show_timing_summary() {
    echo ""
    log_info "============================================"
    log_info "  ⏱️  部署耗时统计"
    log_info "============================================"

    local prev=0
    local total=0
    local -a durations=()
    local -a stages_arr=()

    # 先计算所有阶段的耗时
    while IFS= read -r stage && IFS= read -r time <&3; do
        if [[ -n "$stage" ]]; then
            local duration=$((time - prev))
            stages_arr+=("$stage")
            durations+=("$duration")
            prev=$time
            total=$time
        fi
    done < <(echo "$DEPLOY_TIMING_STAGES") 3< <(echo "$DEPLOY_TIMING_VALUES")

    # 显示各阶段耗时（带高亮）
    for i in "${!stages_arr[@]}"; do
        local stage="${stages_arr[$i]}"
        local duration="${durations[$i]}"

        # 根据耗时决定显示样式
        if [[ $duration -ge 30 ]]; then
            # 耗时长的阶段用黄色警告
            printf "  ${YELLOW}%-28s %4ds${NC}\n" "$stage:" "$duration"
        elif [[ $duration -eq 0 ]]; then
            # 0 秒的用绿色（缓存命中）
            printf "  ${GREEN}%-28s %4ds  ⚡${NC}\n" "$stage:" "$duration"
        else
            # 正常耗时
            printf "  %-30s %3ds\n" "$stage:" "$duration"
        fi
    done

    # 计算总耗时
    echo "  ----------------------------------------"
    if [[ $total -lt 90 ]]; then
        printf "  ${GREEN}%-28s %4ds  🚀${NC}\n" "总耗时:" "$total"
    elif [[ $total -lt 150 ]]; then
        printf "  %-30s %3ds\n" "总耗时:" "$total"
    else
        printf "  ${YELLOW}%-28s %4ds${NC}\n" "总耗时:" "$total"
    fi
    echo ""
}

# ============================================
# rsync 配置
# ============================================

# rsync 带宽限制（KB/s，0=不限制）
# 可通过环境变量 RSYNC_BWLIMIT 覆盖
RSYNC_BWLIMIT="${RSYNC_BWLIMIT:-0}"

# 获取 rsync 带宽限制参数
get_rsync_bwlimit() {
    if [[ "$RSYNC_BWLIMIT" -gt 0 ]]; then
        echo "--bwlimit=$RSYNC_BWLIMIT"
    else
        echo ""
    fi
}

# ============================================
# rsync 排除规则
# ============================================

RSYNC_EXCLUDES=(
    # 开发相关
    '*.map'
    '*.d.ts'
    '*.tsbuildinfo'
    '.DS_Store'
    '*.swp'
    '*.swo'
    '*.orig'

    # 文档
    '*.md'
    'LICENSE*'
    'CHANGELOG*'

    # 锁文件（已在 standalone 中处理）
    '*.lock'

    # 测试文件
    '*.test.js'
    '*.test.ts'
    '*.spec.js'
    '*.spec.ts'
    '__tests__/'
    '__mocks__/'
    'coverage/'

    # Storybook
    '*.stories.js'
    '*.stories.tsx'
    '.storybook/'

    # 缓存
    '.git/'
    'node_modules/.cache/'
    '.turbo/'

    # pnpm 专用（忽略的依赖）
    'node_modules/.ignored/'

    # 日志
    '*.log'
    'logs/'
)

# 生成 rsync 排除参数
get_rsync_excludes() {
    local excludes=""
    for pattern in "${RSYNC_EXCLUDES[@]}"; do
        excludes="$excludes --exclude='$pattern'"
    done
    echo "$excludes"
}

# ============================================
# 环境变量验证
# ============================================

# 验证构建时必需的环境变量
# 参数：$1=环境名称（dev/staging/production）
# 返回：缺失变量列表（空格分隔），空字符串表示全部通过
validate_env_vars() {
    local env=$1
    local missing_vars=()

    # 基础配置（所有环境必需）
    [[ -z "$NEXT_PUBLIC_APP_URL" ]] && missing_vars+=("NEXT_PUBLIC_APP_URL")

    # 模型配置（控制前端可用模型）
    [[ -z "$NEXT_PUBLIC_ENABLED_IMAGE_MODELS" ]] && missing_vars+=("NEXT_PUBLIC_ENABLED_IMAGE_MODELS")
    [[ -z "$NEXT_PUBLIC_ENABLED_VIDEO_MODELS" ]] && missing_vars+=("NEXT_PUBLIC_ENABLED_VIDEO_MODELS")
    [[ -z "$NEXT_PUBLIC_ENABLED_AUDIO_MODELS" ]] && missing_vars+=("NEXT_PUBLIC_ENABLED_AUDIO_MODELS")

    # 生产环境额外检查
    if [[ "$env" == "production" ]]; then
        [[ -z "$NEXT_PUBLIC_BAIDU_TONGJI_ID" ]] && missing_vars+=("NEXT_PUBLIC_BAIDU_TONGJI_ID")
        [[ -z "$NEXT_PUBLIC_CLARITY_PROJECT_ID" ]] && missing_vars+=("NEXT_PUBLIC_CLARITY_PROJECT_ID")
    fi

    echo "${missing_vars[*]}"
}

# 显示环境变量验证结果
# 参数：$1=环境名称
# 返回：0=通过，1=有缺失（生产环境会退出）
show_env_validation() {
    local env=$1
    local missing

    log_info "验证构建时环境变量..."
    missing=$(validate_env_vars "$env")

    if [[ -n "$missing" ]]; then
        log_warn "⚠️  以下 NEXT_PUBLIC_* 环境变量未设置："
        for var in $missing; do
            log_warn "    - $var"
        done
        log_warn "这些变量需要在构建时可用，否则功能可能无法正常工作"

        if [[ "$env" == "production" ]]; then
            log_error "生产环境必须设置所有必需的环境变量"
            return 1
        fi
    else
        log_success "关键 NEXT_PUBLIC_* 环境变量已验证"
    fi

    return 0
}

# ============================================
# SSH 连接复用
# ============================================

# SSH ControlMaster 路径（全局变量）
SSH_CONTROL_PATH=""
SSH_CONTROL_OPTS=""

# 建立 SSH 主连接（复用后续连接）
# 参数：$1=host $2=port $3=user $4=ssh_key（可选）
setup_ssh_control_master() {
    local host=$1
    local port=$2
    local user=$3
    local ssh_key=${4:-}

    SSH_CONTROL_PATH="/tmp/ssh-deploy-${user}@${host}:${port}"

    # 基础 SSH 选项
    SSH_CONTROL_OPTS="-o ControlMaster=auto -o ControlPath=$SSH_CONTROL_PATH -o ControlPersist=1800 -p $port"

    # 如果提供了 SSH 密钥
    if [[ -n "$ssh_key" ]] && [[ -f "$ssh_key" ]]; then
        SSH_CONTROL_OPTS="$SSH_CONTROL_OPTS -i $ssh_key"
    fi

    # 如果已有连接，复用
    if [[ -S "$SSH_CONTROL_PATH" ]]; then
        log_info "复用已有 SSH 连接"
        return 0
    fi

    # 建立新的主连接（后台运行）
    log_info "建立 SSH 主连接..."
    if ssh -o ControlMaster=yes \
        -o ControlPath="$SSH_CONTROL_PATH" \
        -o ControlPersist=1800 \
        -o ConnectTimeout=10 \
        -o StrictHostKeyChecking=accept-new \
        ${ssh_key:+-i "$ssh_key"} \
        -p "$port" \
        -fN "$user@$host" 2>/dev/null; then
        log_success "SSH 主连接已建立（后续命令将复用此连接）"
        return 0
    else
        log_warn "无法建立 SSH 主连接，将使用普通连接"
        SSH_CONTROL_OPTS="-p $port"
        [[ -n "$ssh_key" ]] && SSH_CONTROL_OPTS="$SSH_CONTROL_OPTS -i $ssh_key"
        return 1
    fi
}

# 清理 SSH 主连接
cleanup_ssh_control_master() {
    if [[ -n "$SSH_CONTROL_PATH" ]] && [[ -S "$SSH_CONTROL_PATH" ]]; then
        ssh -o ControlPath="$SSH_CONTROL_PATH" -O exit localhost 2>/dev/null || true
        log_info "SSH 主连接已关闭"
    fi
}

# 获取当前 SSH 选项
get_ssh_opts() {
    echo "$SSH_CONTROL_OPTS"
}

# ============================================
# 数据库迁移
# ============================================

# 在远程服务器执行数据库迁移
# 参数：$1=ssh_opts $2=user@host $3=deploy_path $4=prisma_version
run_remote_prisma_migration() {
    local ssh_opts=$1
    local remote=$2
    local deploy_path=$3
    local prisma_version=$4

    log_info "在服务器上执行数据库迁移..."

    ssh $ssh_opts "$remote" << ENDSSH
        set -e
        cd $deploy_path/apps/web

        # 使用传递的 Prisma 版本
        PRISMA_VERSION="$prisma_version"
        echo "[INFO] 项目 Prisma 版本: \$PRISMA_VERSION"

        # 加载环境变量
        echo "[INFO] 加载环境变量..."
        ENV_FILE=".next/standalone/apps/web/.env"
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

        # 检查迁移状态
        echo "[INFO] 检查数据库迁移状态..."
        MIGRATION_STATUS=\$(npx prisma@\${PRISMA_VERSION} migrate status 2>&1) || true
        echo "\$MIGRATION_STATUS"

        if echo "\$MIGRATION_STATUS" | grep -q "Database schema is up to date"; then
            echo "[SUCCESS] 数据库架构已是最新，无需迁移"
        elif echo "\$MIGRATION_STATUS" | grep -iq "following migration.*have not yet been applied"; then
            echo "[WARN] 检测到待执行的数据库迁移"
            echo "[INFO] 执行数据库迁移..."

            if npx prisma@\${PRISMA_VERSION} migrate deploy 2>&1; then
                echo "[SUCCESS] 数据库迁移执行成功"
            else
                echo "[ERROR] 数据库迁移失败！"
                exit 1
            fi
        else
            echo "[ERROR] 无法确定迁移状态，中断部署"
            echo "\$MIGRATION_STATUS"
            exit 1
        fi
ENDSSH

    if [[ $? -eq 0 ]]; then
        log_success "数据库迁移检查完成"
        return 0
    else
        log_error "数据库迁移失败"
        return 1
    fi
}

# ============================================
# Nginx 配置生成
# ============================================

# 生成 Nginx 配置（HTTP 或 HTTPS）
# 参数：$1=domain $2=with_ssl（true/false）
# 输出：Nginx 配置内容
generate_nginx_config() {
    local domain=$1
    local with_ssl=${2:-false}

    # 使用可配置变量
    local max_body_size="${NGINX_CLIENT_MAX_BODY_SIZE:-50M}"
    local proxy_timeout="${NGINX_PROXY_TIMEOUT:-300s}"
    local ssl_cache="${NGINX_SSL_SESSION_CACHE:-shared:SSL:50m}"
    local app_port="${APP_PORT:-3000}"

    if [[ "$with_ssl" == "true" ]]; then
        cat << NGINX
server {
    listen 80;
    server_name $domain;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $domain;

    ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache $ssl_cache;

    add_header Strict-Transport-Security "max-age=63072000" always;

    client_max_body_size $max_body_size;

    location / {
        proxy_pass http://127.0.0.1:$app_port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_connect_timeout $proxy_timeout;
        proxy_send_timeout $proxy_timeout;
        proxy_read_timeout $proxy_timeout;
    }
}
NGINX
    else
        cat << NGINX
server {
    listen 80;
    server_name $domain;

    client_max_body_size $max_body_size;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        proxy_pass http://127.0.0.1:$app_port;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        proxy_connect_timeout $proxy_timeout;
        proxy_send_timeout $proxy_timeout;
        proxy_read_timeout $proxy_timeout;
    }
}
NGINX
    fi
}

# ============================================
# PM2 配置生成
# ============================================

# 生成 PM2 ecosystem.config.js
# 参数：$1=app_name $2=cron_script_path（可选）$3=transformers_cache（可选）$4=node_path（可选）
# 输出：ecosystem.config.js 内容
generate_pm2_ecosystem() {
    local app_name=$1
    local cron_script=${2:-}
    local cache_dir=${3:-/var/cache/transformers}
    local node_path=${4:-}

    cat << 'EOFCONFIG'
const fs = require("fs");
const path = require("path");

function loadEnvFile(envPath) {
  const envVars = {};
  try {
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIndex = trimmed.indexOf("=");
      if (eqIndex === -1) continue;
      const key = trimmed.substring(0, eqIndex).trim();
      let value = trimmed.substring(eqIndex + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      envVars[key] = value;
    }
  } catch (e) {
    console.error("Failed to load .env file:", e.message);
  }
  return envVars;
}

const envPath = path.join(__dirname, ".env");
const envVars = loadEnvFile(envPath);

module.exports = {
  apps: [
    {
EOFCONFIG

    # 主应用配置
    if [[ -n "$node_path" ]]; then
        # 包含 NODE_PATH 的配置
        cat << EOFAPP
      name: "$app_name",
      script: "server.js",
      cwd: __dirname,
      instances: parseInt(envVars.PM2_INSTANCES || '1', 10),
      exec_mode: "cluster",
      node_args: "--max-old-space-size=512 --expose-gc",
      env: Object.assign({
        HOSTNAME: "0.0.0.0",
        NODE_ENV: "production",
        TRANSFORMERS_CACHE: "$cache_dir",
        NODE_PATH: "$node_path"
      }, envVars)
    }
EOFAPP
    else
        # 不包含 NODE_PATH 的配置
        cat << EOFAPP
      name: "$app_name",
      script: "server.js",
      cwd: __dirname,
      instances: parseInt(envVars.PM2_INSTANCES || '1', 10),
      exec_mode: "cluster",
      node_args: "--max-old-space-size=512 --expose-gc",
      env: Object.assign({
        HOSTNAME: "0.0.0.0",
        NODE_ENV: "production",
        TRANSFORMERS_CACHE: "$cache_dir"
      }, envVars)
    }
EOFAPP
    fi

    # 如果有 cron 脚本，添加 cron 配置
    if [[ -n "$cron_script" ]]; then
        cat << EOFCRON
    ,
    {
      name: "${app_name}-cron",
      script: "$cron_script",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      cwd: path.dirname("$cron_script"),
      env: Object.assign({
        NODE_ENV: "production",
        TZ: "Asia/Shanghai"
      }, envVars)
    }
EOFCRON
    fi

    # 结束配置
    cat << 'EOFEND'
  ]
};
EOFEND
}

# ============================================
# PM2 零停机重启
# ============================================

# 重启 PM2 应用（优先使用 reload 实现零停机）
# 参数：$1=ecosystem_config_path
pm2_smart_restart() {
    local config_path=$1
    local app_name

    # 从配置中提取应用名
    app_name=$(grep -m1 'name:' "$config_path" | sed 's/.*name: *"\([^"]*\)".*/\1/')

    if pm2 list 2>/dev/null | grep -q "$app_name"; then
        # 应用已存在，使用 reload 实现零停机
        log_info "使用 PM2 reload 重启应用（零停机）..."
        pm2 reload "$config_path" --update-env
    else
        # 首次启动
        log_info "首次启动 PM2 应用..."
        pm2 start "$config_path"
    fi

    pm2 save
}

# ============================================
# 部署回滚支持
# ============================================

# 全局变量：备份路径
ROLLBACK_BACKUP_PATH=""

# 创建部署备份（用于回滚）
# 参数：$1=standalone_dir
# 返回：备份路径
create_deployment_backup() {
    local standalone_dir=$1
    local backup_dir="${standalone_dir}.backup.$(date +%s)"

    if [[ -d "$standalone_dir" ]]; then
        log_info "创建部署备份用于回滚..."
        if cp -r "$standalone_dir" "$backup_dir" 2>/dev/null; then
            ROLLBACK_BACKUP_PATH="$backup_dir"
            log_success "备份已创建: $(basename "$backup_dir")"
            return 0
        else
            log_warn "无法创建备份，跳过回滚支持"
            return 1
        fi
    else
        log_info "首次部署，无需备份"
        return 0
    fi
}

# 执行回滚（恢复备份）
# 参数：$1=standalone_dir
perform_rollback() {
    local standalone_dir=$1

    if [[ -z "$ROLLBACK_BACKUP_PATH" ]] || [[ ! -d "$ROLLBACK_BACKUP_PATH" ]]; then
        log_error "无可用备份，无法回滚"
        return 1
    fi

    log_warn "============================================"
    log_warn "  🔄 执行自动回滚..."
    log_warn "============================================"

    # 删除失败的部署
    rm -rf "$standalone_dir" 2>/dev/null || true

    # 恢复备份
    if mv "$ROLLBACK_BACKUP_PATH" "$standalone_dir"; then
        log_success "回滚完成，已恢复到上一版本"

        # 重启应用（使用旧版本）
        if [[ -f "$standalone_dir/apps/web/ecosystem.config.js" ]]; then
            cd "$standalone_dir/apps/web"
            pm2 reload ecosystem.config.js --update-env 2>/dev/null || pm2 restart all
            pm2 save
            log_success "应用已使用旧版本重启"
        fi

        return 0
    else
        log_error "回滚失败！"
        return 1
    fi
}

# 清理备份（部署成功后调用）
cleanup_deployment_backup() {
    if [[ -n "$ROLLBACK_BACKUP_PATH" ]] && [[ -d "$ROLLBACK_BACKUP_PATH" ]]; then
        rm -rf "$ROLLBACK_BACKUP_PATH" 2>/dev/null || true
        log_info "已清理旧版本备份"
        ROLLBACK_BACKUP_PATH=""
    fi
}

# 健康检查并处理回滚
# 参数：$1=app_name $2=standalone_dir $3=max_retries
health_check_with_rollback() {
    local app_name=$1
    local standalone_dir=$2
    local max_retries=${3:-3}
    local retry=0

    log_info "执行部署健康检查..."

    while [[ $retry -lt $max_retries ]]; do
        sleep 3

        # 检查 PM2 状态
        if pm2 list 2>/dev/null | grep -q "${app_name}.*online"; then
            log_success "✅ 应用健康检查通过"
            cleanup_deployment_backup
            return 0
        fi

        ((retry++))
        if [[ $retry -lt $max_retries ]]; then
            log_warn "健康检查失败，重试 ($retry/$max_retries)..."
        fi
    done

    # 健康检查失败，执行回滚
    log_error "健康检查失败，应用未能正常启动"
    perform_rollback "$standalone_dir"
    return 1
}

# ============================================
# 并行 rsync
# ============================================

# 并行执行多个 rsync 操作
# 用法：parallel_rsync "cmd1" "cmd2" "cmd3"
parallel_rsync() {
    local pids=()
    local cmd
    local failed=0

    log_info "并行同步文件..."

    for cmd in "$@"; do
        eval "$cmd" &
        pids+=($!)
    done

    # 等待所有完成
    for pid in "${pids[@]}"; do
        if ! wait "$pid"; then
            ((failed++))
        fi
    done

    if [[ $failed -eq 0 ]]; then
        log_success "文件同步完成"
        return 0
    else
        log_error "$failed 个同步任务失败"
        return 1
    fi
}
