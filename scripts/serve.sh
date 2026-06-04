#!/usr/bin/env bash
# scripts/serve.sh
#
# Single lifecycle script for Quipu API server.
#
# Examples:
#   bash scripts/serve.sh            # default: start
#   bash scripts/serve.sh start
#   bash scripts/serve.sh restart
#   bash scripts/serve.sh stop
#   bash scripts/serve.sh status
#   bash scripts/serve.sh logs
#   bash scripts/serve.sh run        # foreground
#
# Optional environment variables (all have built-in defaults):
#   QUIPU_HOST      Bind address          default: 0.0.0.0  (all interfaces)
#   QUIPU_PORT      Port                  default: 8000
#   QUIPU_DATA_DIR  Data storage root     default: ./data
#   QUIPU_PID_FILE  PID file              default: /tmp/quipu-server.pid
#   QUIPU_LOG_FILE  Server log            default: /tmp/quipu-server.log
#   QUIPU_STARTUP_TIMEOUT_SECONDS         default: 12
#
# NOTE: Plain HTTP is fine for localhost browser testing. For GPS / geolocation
# to work on a real Android device over your LAN you need HTTPS. Use
# scripts/tunnel.sh alongside this script to get a real CA-signed HTTPS URL.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ ! -d ".venv" ]]; then
  echo "ERROR: .venv not found. Run scripts/setup.sh first." >&2
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate

HOST="${QUIPU_HOST:-0.0.0.0}"
PORT="${QUIPU_PORT:-8000}"
PID_FILE="${QUIPU_PID_FILE:-/tmp/quipu-server.pid}"
LOG_FILE="${QUIPU_LOG_FILE:-/tmp/quipu-server.log}"
STARTUP_TIMEOUT_SECONDS="${QUIPU_STARTUP_TIMEOUT_SECONDS:-12}"
COMMAND="${1:-start}"

is_running() {
  if [[ ! -f "$PID_FILE" ]]; then
    return 1
  fi
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [[ -z "$pid" ]]; then
    return 1
  fi
  kill -0 "$pid" >/dev/null 2>&1
}

print_connect_info() {
  echo "Connect (local): http://127.0.0.1:${PORT}"
  echo "Tunnel: run scripts/tunnel.sh or scripts/named-tunnel.sh separately"
}

start_server() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "Server already running (pid=${pid})"
    print_connect_info
    return 0
  fi

  mkdir -p "$(dirname "$LOG_FILE")"

  nohup uvicorn app.main:app --host "$HOST" --port "$PORT" > "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  local started=0
  for _ in $(seq 1 "$STARTUP_TIMEOUT_SECONDS"); do
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      started=1
      break
    fi
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if [[ "$started" -ne 1 ]]; then
    echo "ERROR: server failed to start." >&2
    echo "Log tail (${LOG_FILE}):" >&2
    tail -n 80 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    return 1
  fi

  echo "Server started (pid=${pid})"
  echo "Log file: ${LOG_FILE}"
  print_connect_info
}

stop_server() {
  if ! is_running; then
    echo "Server is not running."
    rm -f "$PID_FILE"
    return 0
  fi

  local pid
  pid="$(cat "$PID_FILE")"
  kill "$pid" >/dev/null 2>&1 || true

  for _ in $(seq 1 10); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  if kill -0 "$pid" >/dev/null 2>&1; then
    kill -9 "$pid" >/dev/null 2>&1 || true
  fi

  rm -f "$PID_FILE"
  echo "Server stopped."
}

status_server() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "Server running (pid=${pid})"
    print_connect_info
    return 0
  fi
  echo "Server not running."
  return 1
}

run_foreground() {
  echo "Starting Quipu MVP on http://${HOST}:${PORT} (foreground)"
  echo "Data dir: ${QUIPU_DATA_DIR:-./data}"
  echo "Stop with: Ctrl-C"
  echo ""
  exec uvicorn app.main:app --host "$HOST" --port "$PORT"
}

case "$COMMAND" in
  start)
    start_server
    ;;
  stop)
    stop_server
    ;;
  restart)
    stop_server
    start_server
    ;;
  status)
    status_server
    ;;
  logs)
    tail -n 120 -f "$LOG_FILE"
    ;;
  run)
    run_foreground
    ;;
  *)
    echo "Usage: bash scripts/serve.sh [start|stop|restart|status|logs|run]" >&2
    exit 2
    ;;
esac
