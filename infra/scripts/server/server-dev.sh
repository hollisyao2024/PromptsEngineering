#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
CONTAINER_ROOT="$(cd "$ROOT_DIR/.." && pwd)"
cd "$ROOT_DIR"

# 加载 .env.local（若存在）
ENV_FILE="${ROOT_DIR}/.env.local"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

# 脚本内部使用（无需 export）
APP_NAME="${DEV_SERVER_NAME:-frontend-dev}"
LOG_FILE="${DEV_SERVER_LOG_FILE:-/tmp/frontend-dev.log}"
WORKER_NAME="${DEV_WORKER_NAME:-frontend-background-jobs-dev}"
WORKER_LOG_FILE="${DEV_WORKER_LOG_FILE:-/tmp/frontend-background-jobs-dev.log}"
WORKER_CWD="${DEV_WORKER_CWD:-apps/web}"
MAX_MEMORY="${DEV_SERVER_MAX_MEMORY:-1500M}"
MAX_RESTARTS="${DEV_SERVER_MAX_RESTARTS:-10}"
HEALTH_RETRIES="${DEV_SERVER_HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${DEV_SERVER_HEALTH_INTERVAL:-1}"
CACHE_DIR="${DEV_SERVER_NEXT_CACHE_DIR:-apps/web/.next}"
WORKER_POLL_INTERVAL="${DEV_WORKER_POLL_INTERVAL:-5}"
DEV_START_BACKGROUND_WORKER="${DEV_START_BACKGROUND_WORKER:-false}"

# 需传递给 PM2 子进程（必须 export）
export PORT="${DEV_SERVER_PORT:-3000}"
export APP_ENVIRONMENT="${APP_ENVIRONMENT:-development}"
export NODE_TLS_REJECT_UNAUTHORIZED="${NODE_TLS_REJECT_UNAUTHORIZED:-1}"
# Scheduler 状态目录（Scalar 容器级外置；生产保持 CWD 相对，无需设此环境变量）
export SCHEDULER_STATE_DIR="${SCHEDULER_STATE_DIR:-$CONTAINER_ROOT/tmp/scheduler}"

HEALTH_URL="http://127.0.0.1:${PORT}"
REQUIRED_NODE_VERSION="$(tr -d '[:space:]' < "$ROOT_DIR/.nvmrc" 2>/dev/null || printf '24.14.1')"
REQUIRED_NEXT_VERSION="$(node -p "(() => {
  const pkg = require('${ROOT_DIR}/apps/web/package.json');
  const value = (pkg.dependencies && pkg.dependencies.next) || (pkg.devDependencies && pkg.devDependencies.next) || '';
  return String(value).replace(/^[\\^~]/, '');
})()" 2>/dev/null)"

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

run_pm2() {
  pnpm exec pm2 "$@"
}

try_switch_node_version() {
  local target="$1"

  # fnm（优先，启动更快）
  if command -v fnm >/dev/null 2>&1; then
    eval "$(fnm env --shell bash 2>/dev/null)" 2>/dev/null || true
    if fnm use "$target" >/dev/null 2>&1 || fnm use --install-if-missing "$target" >/dev/null 2>&1; then
      return 0
    fi
  fi

  # nvm
  local nvm_script="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
  if [ -s "$nvm_script" ]; then
    # shellcheck disable=SC1090
    source "$nvm_script"
    if nvm use "$target" >/dev/null 2>&1 || nvm install "$target" >/dev/null 2>&1; then
      return 0
    fi
  fi

  return 1
}

ensure_runtime_versions() {
  local current_node_version current_next_version

  current_node_version="$(node -v 2>/dev/null || true)"

  # 版本不满足时尝试自动切换
  if [[ -z "$current_node_version" ]] || ! version_gte "$current_node_version" "$REQUIRED_NODE_VERSION"; then
    echo "Node.js version ${current_node_version:-missing} < v${REQUIRED_NODE_VERSION}，尝试自动切换..."
    if try_switch_node_version "$REQUIRED_NODE_VERSION"; then
      current_node_version="$(node -v 2>/dev/null || true)"
      echo "已切换到 Node ${current_node_version}"
    else
      echo "自动切换失败：当前 ${current_node_version:-missing}，需要 >= v${REQUIRED_NODE_VERSION}"
      echo "请在项目目录执行 source ~/.zshrc 后重新运行"
      exit 1
    fi
  fi

  if [[ -z "$current_node_version" ]]; then
    echo "Node.js is not available in current shell"
    exit 1
  fi

  current_next_version="$(node -p "require('${ROOT_DIR}/apps/web/node_modules/next/package.json').version" 2>/dev/null || true)"
  if [[ -n "$REQUIRED_NEXT_VERSION" && "$current_next_version" != "$REQUIRED_NEXT_VERSION" ]]; then
    echo "Next.js runtime version mismatch: current=${current_next_version:-missing}, required=${REQUIRED_NEXT_VERSION}"
    exit 1
  fi

  echo "Runtime check passed: Node ${current_node_version}, Next ${current_next_version}"
}

ensure_pm2() {
  if ! pnpm exec pm2 --version >/dev/null 2>&1; then
    echo "PM2 is not installed. Run: pnpm add -Dw pm2"
    exit 1
  fi
}

check_prisma_migrations() {
  # 非阻断的 Prisma 迁移状态检查
  # 目的: 本地 dev 启动前提示是否有待应用的迁移
  # 失败处理: 连不上 DB / 无 DATABASE_URL 时静默跳过，不阻止 dev server 启动
  if [[ -z "${DATABASE_URL:-}" ]]; then
    return 0
  fi

  local db_dir="$ROOT_DIR/packages/database"
  if [[ ! -f "$db_dir/prisma/schema.prisma" ]]; then
    return 0
  fi

  local status_output
  status_output=$(cd "$db_dir" && pnpm exec prisma migrate status 2>&1) || true

  if echo "$status_output" | grep -qi "have not yet been applied"; then
    echo ""
    echo "⚠️  [WARN] 检测到待应用的 Prisma 迁移 —— 本地数据库 schema 与 prisma/schema.prisma 不同步"
    echo "$status_output" | grep -iE "have not yet been applied|^[0-9]{14}_" | sed 's/^/       /'
    echo ""
    echo "       执行以下命令同步本地数据库:"
    echo "         cd packages/database && pnpm exec prisma migrate deploy"
    echo ""
    echo "       (此警告不阻断启动, 但相关 API 可能会报表不存在)"
    echo ""
  fi
}

healthcheck() {
  local attempt
  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "${APP_NAME} is healthy on ${HEALTH_URL}"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done

  return 1
}

has_turbopack_cache_corruption() {
  if [ ! -f "$LOG_FILE" ]; then
    return 1
  fi

  tail -n 300 "$LOG_FILE" 2>/dev/null | grep -Eiq \
    'TurbopackInternalError|Failed to restore task data|Unable to open static sorted file|app-paths-manifest\.json|Persisting failed: Another write batch or compaction is already active'
}

cleanup_next_cache() {
  echo "Detected Turbopack cache corruption. Cleaning ${CACHE_DIR} ..."
  node -e "const fs=require('fs');fs.rmSync('${CACHE_DIR}',{recursive:true,force:true,maxRetries:5,retryDelay:200});console.log('Cleaned ${CACHE_DIR}');"
}

DEV_TURBOPACK_CACHE_MAX_GB="${DEV_TURBOPACK_CACHE_MAX_GB:-5}"

enforce_cache_size_limit() {
  local tb_dir="${CACHE_DIR}/dev/cache/turbopack"
  [ -d "$tb_dir" ] || return 0

  local current_ver_dir
  current_ver_dir="$(ls -1t "$tb_dir" 2>/dev/null | head -n1)"
  if [ -n "$current_ver_dir" ]; then
    find "$tb_dir" -mindepth 1 -maxdepth 1 -type d ! -name "$current_ver_dir" \
      -exec rm -rf {} + 2>/dev/null || true
  fi

  local size_gb
  size_gb=$(du -sk "$tb_dir" 2>/dev/null | awk '{printf "%.0f", $1/1024/1024}')
  if [ -n "$size_gb" ] && [ "$size_gb" -ge "$DEV_TURBOPACK_CACHE_MAX_GB" ]; then
    echo "Turbopack cache ${size_gb}G >= ${DEV_TURBOPACK_CACHE_MAX_GB}G limit, purging ${tb_dir} ..."
    rm -rf "$tb_dir" 2>/dev/null || true
  fi
}

start_app() {
  run_pm2 start pnpm \
    --name "$APP_NAME" \
    --interpreter none \
    --output "$LOG_FILE" \
    --error "$LOG_FILE" \
    --merge-logs \
    --time \
    --max-memory-restart "$MAX_MEMORY" \
    --max-restarts "$MAX_RESTARTS" \
    --exp-backoff-restart-delay 200 \
    -- --filter frontend dev:fast
}

start_worker() {
  # 将父进程已选定的 Node/pnpm 目录前置到子进程 PATH，避免 PM2 的 bash 子 shell 回退到系统默认 Node。
  local node_bin_dir
  node_bin_dir="$(dirname "$(command -v node)")"

  # 崩溃断路器：连续 3 次 <5s 内退出即停止循环，避免静默重启淹没日志。
  run_pm2 start bash \
    --name "$WORKER_NAME" \
    --output "$WORKER_LOG_FILE" \
    --error "$WORKER_LOG_FILE" \
    --merge-logs \
    --time \
    --max-memory-restart "300M" \
    --max-restarts "$MAX_RESTARTS" \
    --exp-backoff-restart-delay 200 \
    -- -c "export PATH='$node_bin_dir':\$PATH && export NODE_PATH='$ROOT_DIR/apps/web/node_modules' && cd '$ROOT_DIR/$WORKER_CWD' && fail_count=0; while true; do start_ts=\$(date +%s); pnpm exec tsx ../../infra/scripts/cron/process-background-jobs.ts; exit_code=\$?; run_sec=\$((\$(date +%s) - start_ts)); if [ \$exit_code -ne 0 ] && [ \$run_sec -lt 5 ]; then fail_count=\$((fail_count + 1)); if [ \$fail_count -ge 3 ]; then echo 'Worker 连续 3 次 <5s 内崩溃，终止循环' >&2; exit 1; fi; else fail_count=0; fi; sleep '$WORKER_POLL_INTERVAL'; done"
}

start_with_auto_heal() {
  local attempt

  for attempt in 1 2; do
    free_port
    run_pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    run_pm2 delete "$WORKER_NAME" >/dev/null 2>&1 || true
    start_app

    if healthcheck; then
      if [ "$DEV_START_BACKGROUND_WORKER" = "true" ]; then
        start_worker
      fi
      return 0
    fi

    if [ "$attempt" -eq 1 ] && has_turbopack_cache_corruption; then
      echo "Auto-heal: stopping app and retrying after cache cleanup..."
      run_pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
      run_pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
      run_pm2 stop "$WORKER_NAME" >/dev/null 2>&1 || true
      run_pm2 delete "$WORKER_NAME" >/dev/null 2>&1 || true
      cleanup_next_cache
      continue
    fi

    echo "${APP_NAME} failed health check. Recent logs:"
    tail -n 120 "$LOG_FILE" || true
    return 1
  done

  echo "${APP_NAME} failed after auto-heal retry. Recent logs:"
  tail -n 120 "$LOG_FILE" || true
  return 1
}

free_port() {
  local pids=""

  if [ -x /usr/sbin/lsof ]; then
    pids=$(/usr/sbin/lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)
  elif command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)
  fi

  if [ -n "$pids" ]; then
    echo "Releasing port ${PORT} from PID(s): $pids"
    kill $pids 2>/dev/null || true
    sleep 1
  fi
}

ensure_runtime_versions
ensure_pm2

case "${1:-restart}" in
  start)
    enforce_cache_size_limit
    check_prisma_migrations
    start_with_auto_heal
    ;;
  restart)
    enforce_cache_size_limit
    check_prisma_migrations
    start_with_auto_heal
    ;;
  stop)
    run_pm2 stop "$APP_NAME" || true
    run_pm2 stop "$WORKER_NAME" || true
    echo "${APP_NAME} stopped"
    ;;
  delete)
    run_pm2 delete "$APP_NAME" || true
    run_pm2 delete "$WORKER_NAME" || true
    echo "${APP_NAME} deleted"
    ;;
  status)
    run_pm2 describe "$APP_NAME" || true
    run_pm2 describe "$WORKER_NAME" || true
    ;;
  logs)
    run_pm2 logs "$APP_NAME" --lines 120 --nostream
    run_pm2 logs "$WORKER_NAME" --lines 120 --nostream
    ;;
  *)
    echo "Usage: $0 {start|restart|stop|delete|status|logs}"
    exit 1
    ;;
esac
