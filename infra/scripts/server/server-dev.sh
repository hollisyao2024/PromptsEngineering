#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
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
MAX_MEMORY="${DEV_SERVER_MAX_MEMORY:-1500M}"
MAX_RESTARTS="${DEV_SERVER_MAX_RESTARTS:-10}"
HEALTH_RETRIES="${DEV_SERVER_HEALTH_RETRIES:-20}"
HEALTH_INTERVAL="${DEV_SERVER_HEALTH_INTERVAL:-1}"
CACHE_DIR="${DEV_SERVER_NEXT_CACHE_DIR:-apps/web/.next}"

# 需传递给 PM2 子进程（必须 export）
export PORT="${DEV_SERVER_PORT:-3000}"
export APP_ENVIRONMENT="${APP_ENVIRONMENT:-development}"
export NODE_TLS_REJECT_UNAUTHORIZED="${NODE_TLS_REJECT_UNAUTHORIZED:-1}"

HEALTH_URL="http://127.0.0.1:${PORT}"

run_pm2() {
  pnpm exec pm2 "$@"
}

ensure_pm2() {
  if ! pnpm exec pm2 --version >/dev/null 2>&1; then
    echo "PM2 is not installed. Run: pnpm add -Dw pm2"
    exit 1
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
    -- --filter frontend dev
}

start_with_auto_heal() {
  local attempt

  for attempt in 1 2; do
    free_port
    run_pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    start_app

    if healthcheck; then
      return 0
    fi

    if [ "$attempt" -eq 1 ] && has_turbopack_cache_corruption; then
      echo "Auto-heal: stopping app and retrying after cache cleanup..."
      run_pm2 stop "$APP_NAME" >/dev/null 2>&1 || true
      run_pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
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

ensure_pm2

case "${1:-restart}" in
  start)
    start_with_auto_heal
    ;;
  restart)
    start_with_auto_heal
    ;;
  stop)
    run_pm2 stop "$APP_NAME" || true
    echo "${APP_NAME} stopped"
    ;;
  delete)
    run_pm2 delete "$APP_NAME" || true
    echo "${APP_NAME} deleted"
    ;;
  status)
    run_pm2 describe "$APP_NAME" || true
    ;;
  logs)
    run_pm2 logs "$APP_NAME" --lines 120 --nostream
    ;;
  *)
    echo "Usage: $0 {start|restart|stop|delete|status|logs}"
    exit 1
    ;;
esac
