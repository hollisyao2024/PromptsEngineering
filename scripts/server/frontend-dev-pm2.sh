#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_NAME="frontend-dev"
CONFIG_FILE="${ROOT_DIR}/scripts/server/pm2.frontend.dev.config.cjs"
HEALTH_URL="http://127.0.0.1:3000"
LOG_FILE="/tmp/frontend-dev.log"

cd "$ROOT_DIR"

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
  for attempt in $(seq 1 20); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      echo "frontend-dev is healthy on ${HEALTH_URL}"
      return 0
    fi
    sleep 1
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
  echo "Detected Turbopack cache corruption. Cleaning frontend/.next ..."
  node -e "const fs=require('fs');fs.rmSync('frontend/.next',{recursive:true,force:true,maxRetries:5,retryDelay:200});console.log('Cleaned frontend/.next');"
}

start_with_auto_heal() {
  local attempt

  for attempt in 1 2; do
    free_port_3000
    run_pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    run_pm2 start "$CONFIG_FILE" --only "$APP_NAME" --update-env

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

    echo "frontend-dev failed health check. Recent logs:"
    tail -n 120 "$LOG_FILE" || true
    return 1
  done

  echo "frontend-dev failed after auto-heal retry. Recent logs:"
  tail -n 120 "$LOG_FILE" || true
  return 1
}

free_port_3000() {
  local pids=""

  if [ -x /usr/sbin/lsof ]; then
    pids=$(/usr/sbin/lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null || true)
  elif command -v lsof >/dev/null 2>&1; then
    pids=$(lsof -nP -iTCP:3000 -sTCP:LISTEN -t 2>/dev/null || true)
  fi

  if [ -n "$pids" ]; then
    echo "Releasing port 3000 from PID(s): $pids"
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
