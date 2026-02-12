#!/bin/bash
# ============================================
# CLIP Model Manager
# 预检查并下载 CLIP 模型（使用 curl 并行下载）
#
# 用途：在部署时确保 CLIP 模型已缓存，避免运行时首次下载
# 特性：
#   - 智能缓存检测（已缓存则跳过）
#   - 网络测速和下载时间估算
#   - curl 并行下载（4 线程）
#   - 断点续传支持
#   - 下载进度显示
#
# 使用：
#   source ensure-clip-model.sh
#   ensure_clip_model  # 自动检测并按需下载
# ============================================

# ============================================
# 模型配置
# ============================================

CLIP_MODEL_NAME="Xenova/clip-vit-base-patch32"
CLIP_MODEL_BASE_URL="https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/main"
CLIP_MODEL_SIZE_MB=300

# 获取平台兼容的缓存目录（与 clip-embedding.ts 保持一致）
get_clip_cache_dir() {
    # 1. 优先使用环境变量
    if [[ -n "$TRANSFORMERS_CACHE" ]]; then
        echo "$TRANSFORMERS_CACHE"
        return
    fi

    # 2. 生产环境：使用项目目录（与网站部署路径同一位置）
    if [[ "$NODE_ENV" == "production" ]] || [[ "$ENV" == "production" ]]; then
        local production_paths=(
            "$(pwd)/models/transformers-cache"        # 项目目录（推荐）
            "/home/admin/models/transformers-cache"   # 用户目录
            "/opt/models/transformers-cache"          # 系统级目录
        )

        for dir in "${production_paths[@]}"; do
            local parent_dir=$(dirname "$dir")
            if [[ -d "$parent_dir" ]] && [[ -w "$parent_dir" ]]; then
                echo "$dir"
                return
            fi
        done

        # 如果都失败，使用用户目录
        echo "$HOME/models/transformers-cache"
    else
        # 开发/预发环境：使用用户目录
        echo "$HOME/.claude-models/transformers-cache"
    fi
}

CLIP_CACHE_DIR=$(get_clip_cache_dir)
CLIP_MODEL_DIR="${CLIP_CACHE_DIR}/${CLIP_MODEL_NAME}"

# 需要下载的文件列表（格式：路径:大小）
# 按大小排序，大文件优先下载
CLIP_MODEL_FILES=(
    "onnx/vision_model.onnx:300MB"
    "config.json:2KB"
    "preprocessor_config.json:1KB"
)

# ============================================
# 颜色定义（如果未从 deploy.sh 继承）
# ============================================

if [[ -z "$RED" ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[1;33m'
    BLUE='\033[0;34m'
    CYAN='\033[0;36m'
    NC='\033[0m'
fi

# 日志函数（如果未从 deploy.sh 继承）
if ! type log_info &>/dev/null; then
    log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
    log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
    log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
    log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }
fi

# ============================================
# 核心函数
# ============================================

# 检查模型是否已完整缓存
# 返回：0=已缓存（stdout 输出大小），1=未缓存
check_model_cached() {
    local main_model="${CLIP_MODEL_DIR}/onnx/vision_model.onnx"

    if [[ -f "$main_model" ]]; then
        # 检查文件大小是否合理（至少 100MB）
        local file_size
        if [[ "$OSTYPE" == "darwin"* ]]; then
            file_size=$(stat -f%z "$main_model" 2>/dev/null || echo 0)
        else
            file_size=$(stat -c%s "$main_model" 2>/dev/null || echo 0)
        fi

        if [[ $file_size -gt 100000000 ]]; then
            # 计算整个目录大小
            local dir_size
            dir_size=$(du -sh "$CLIP_MODEL_DIR" 2>/dev/null | cut -f1)
            echo "$dir_size"
            return 0
        fi
    fi

    return 1
}

# 估算下载时间
# 通过下载小文件测试网络速度
estimate_download_time() {
    local size_mb=$1

    # 快速测速：下载 config.json（约 2KB）
    local test_url="${CLIP_MODEL_BASE_URL}/config.json"
    local test_start test_end test_time

    test_start=$(date +%s.%N 2>/dev/null || date +%s)

    # 静默下载测试
    if curl -s -o /dev/null --max-time 10 --connect-timeout 5 "$test_url" 2>/dev/null; then
        test_end=$(date +%s.%N 2>/dev/null || date +%s)

        # 计算耗时（兼容不支持 %N 的系统）
        if command -v bc &>/dev/null; then
            test_time=$(echo "$test_end - $test_start" | bc 2>/dev/null || echo "1")
        else
            test_time=1
        fi

        # 根据测试结果估算
        if (( $(echo "$test_time < 0.5" | bc -l 2>/dev/null || echo 0) )); then
            echo "< 1 分钟（网络良好）"
        elif (( $(echo "$test_time < 2" | bc -l 2>/dev/null || echo 0) )); then
            echo "1-3 分钟"
        else
            echo "3-10 分钟（网络较慢）"
        fi
    else
        echo "未知（网络测试失败）"
    fi
}

# 下载单个文件（带进度条和断点续传）
# 参数：$1=文件路径 $2=文件大小描述
download_file_with_progress() {
    local file_path=$1
    local file_size=$2
    local url="${CLIP_MODEL_BASE_URL}/${file_path}"
    local dest="${CLIP_MODEL_DIR}/${file_path}"

    # 创建目录
    mkdir -p "$(dirname "$dest")"

    echo -e "  ${CYAN}📥${NC} 下载 ${file_path} (${file_size})..."

    # 使用 curl 下载（支持断点续传、重试、进度条）
    if curl -L --progress-bar \
        --retry 3 \
        --retry-delay 2 \
        --connect-timeout 30 \
        -C - \
        -o "$dest" \
        "$url" 2>&1; then
        echo -e "  ${GREEN}✓${NC} ${file_path}"
        return 0
    else
        echo -e "  ${RED}✗${NC} ${file_path} 下载失败"
        return 1
    fi
}

# 并行下载所有文件（使用后台进程）
download_all_parallel() {
    local failed_count=0
    local start_time end_time total_time
    local pids=()
    local results=()

    start_time=$(date +%s)

    log_info "开始并行下载..."
    echo ""

    # 创建模型目录
    mkdir -p "$CLIP_MODEL_DIR"
    mkdir -p "$CLIP_MODEL_DIR/onnx"

    # 导出必要的变量
    export CLIP_MODEL_BASE_URL CLIP_MODEL_DIR

    # 并行下载所有文件（使用后台进程）
    local i=0
    for file_info in "${CLIP_MODEL_FILES[@]}"; do
        local file_path="${file_info%%:*}"
        local file_size="${file_info##*:}"

        # 后台下载
        (
            download_file_with_progress "$file_path" "$file_size"
        ) &
        pids[$i]=$!
        ((i++))
    done

    # 等待所有下载完成
    for idx in "${!pids[@]}"; do
        if ! wait ${pids[$idx]}; then
            ((failed_count++))
        fi
    done

    end_time=$(date +%s)
    total_time=$((end_time - start_time))

    echo ""
    log_info "下载耗时: ${total_time}s"

    if [[ $failed_count -eq 0 ]]; then
        return 0
    else
        return 1
    fi
}

# 主入口函数：确保 CLIP 模型可用
ensure_clip_model() {
    echo ""
    log_info "============================================"
    log_info "  🤖 CLIP 模型检查"
    log_info "============================================"

    # 检查缓存
    local cached_size
    if cached_size=$(check_model_cached); then
        log_success "CLIP 模型已缓存 (${cached_size})"
        log_info "缓存位置: ${CLIP_MODEL_DIR}"
        echo ""
        return 0
    fi

    # 需要下载
    echo ""
    log_warn "============================================"
    log_warn "  📦 需要下载 CLIP 模型"
    log_warn "============================================"
    echo ""
    log_info "模型名称: ${CLIP_MODEL_NAME}"
    log_info "模型大小: ~${CLIP_MODEL_SIZE_MB}MB"
    log_info "模型用途: 角色锁定功能（图像特征提取）"
    log_info "缓存位置: ${CLIP_MODEL_DIR}"
    log_info "预计时间: $(estimate_download_time $CLIP_MODEL_SIZE_MB)"
    echo ""

    # 确保缓存目录存在且有写入权限
    if [[ ! -d "$CLIP_CACHE_DIR" ]]; then
        log_info "创建缓存目录: $CLIP_CACHE_DIR"
        if ! mkdir -p "$CLIP_CACHE_DIR" 2>/dev/null; then
            # 尝试使用 sudo
            if sudo mkdir -p "$CLIP_CACHE_DIR" && sudo chown -R "$(whoami):$(whoami)" "$CLIP_CACHE_DIR"; then
                log_success "缓存目录已创建"
            else
                log_error "无法创建缓存目录: $CLIP_CACHE_DIR"
                return 1
            fi
        fi
    fi

    # 执行下载
    local download_start download_end download_time
    download_start=$(date +%s)

    if download_all_parallel; then
        download_end=$(date +%s)
        download_time=$((download_end - download_start))

        # 验证下载结果
        if cached_size=$(check_model_cached); then
            log_success "============================================"
            log_success "  ✅ CLIP 模型下载完成!"
            log_success "============================================"
            log_info "总大小: ${cached_size}"
            log_info "总耗时: ${download_time} 秒"
            echo ""
            return 0
        else
            log_error "下载完成但验证失败，模型可能不完整"
            return 1
        fi
    else
        log_error "部分文件下载失败"
        log_warn "应用仍可启动，但首次使用角色锁定功能时会重新尝试下载"
        echo ""
        return 1
    fi
}

# ============================================
# 直接运行支持
# ============================================

# 如果直接运行此脚本（而非被 source）
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    ensure_clip_model
    exit $?
fi
