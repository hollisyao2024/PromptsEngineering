#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_NAME="frontend-dev"
CONFIG_FILE="${ROOT_DIR}/scripts/server/pm2.frontend.dev.config.cjs"
HEALTH_URL="http://127.0.0.1:3000"

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

  echo "frontend-dev failed health check. Recent logs:"
  tail -n 120 /tmp/frontend-dev.log || true
  exit 1
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
    free_port_3000
    run_pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    run_pm2 start "$CONFIG_FILE" --only "$APP_NAME" --update-env
    healthcheck
    ;;
  restart)
    free_port_3000
    run_pm2 delete "$APP_NAME" >/dev/null 2>&1 || true
    run_pm2 start "$CONFIG_FILE" --only "$APP_NAME" --update-env
    healthcheck
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
