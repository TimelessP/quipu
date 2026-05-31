#!/usr/bin/env bash
# scripts/tunnel.sh
#
# Cloudflare Quick Tunnel lifecycle script.
#
# Examples:
#   bash scripts/tunnel.sh            # default: start
#   bash scripts/tunnel.sh start
#   bash scripts/tunnel.sh restart
#   bash scripts/tunnel.sh stop
#   bash scripts/tunnel.sh status
#   bash scripts/tunnel.sh logs
#   bash scripts/tunnel.sh run        # foreground
#
# Optional environment variables:
#   QUIPU_PORT        Local app port             default: 8000
#   QUIPU_TUNNEL_PID  PID file                   default: /tmp/quipu-tunnel.pid
#   QUIPU_TUNNEL_LOG  Tunnel log file            default: /tmp/quipu-tunnel.log
#   QUIPU_STARTUP_TIMEOUT_SECONDS                default: 15

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BIN_DIR="$REPO_ROOT/scripts/.bin"
mkdir -p "$BIN_DIR"

PORT="${QUIPU_PORT:-8000}"
LOCAL_URL="http://127.0.0.1:${PORT}"
PID_FILE="${QUIPU_TUNNEL_PID:-/tmp/quipu-tunnel.pid}"
LOG_FILE="${QUIPU_TUNNEL_LOG:-/tmp/quipu-tunnel.log}"
STARTUP_TIMEOUT_SECONDS="${QUIPU_STARTUP_TIMEOUT_SECONDS:-15}"
COMMAND="${1:-start}"

# ── Detect or download cloudflared ──────────────────────────────────────────

CLOUDFLARED="$BIN_DIR/cloudflared"

if [[ ! -x "$CLOUDFLARED" ]]; then
  echo "cloudflared not found – downloading from Cloudflare's release CDN ..."

  ARCH="$(uname -m)"
  OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

  case "$ARCH" in
    x86_64)   CF_ARCH="amd64" ;;
    aarch64)  CF_ARCH="arm64" ;;
    armv7l)   CF_ARCH="arm"   ;;
    *)
      echo "ERROR: unsupported CPU architecture: $ARCH" >&2
      echo "Download cloudflared manually from https://github.com/cloudflare/cloudflared/releases" >&2
      echo "and place the executable at: $CLOUDFLARED" >&2
      exit 1
      ;;
  esac

  case "$OS" in
    linux)  CF_OS="linux"  ;;
    darwin) CF_OS="darwin" ;;
    *)
      echo "ERROR: unsupported OS: $OS" >&2
      exit 1
      ;;
  esac

  # Direct binary download – no installer, no package manager
  DOWNLOAD_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${CF_OS}-${CF_ARCH}"
  echo "  URL: $DOWNLOAD_URL"

  if command -v curl &>/dev/null; then
    curl -fsSL "$DOWNLOAD_URL" -o "$CLOUDFLARED"
  elif command -v wget &>/dev/null; then
    wget -q "$DOWNLOAD_URL" -O "$CLOUDFLARED"
  else
    echo "ERROR: neither curl nor wget found. Install one and retry." >&2
    exit 1
  fi

  chmod +x "$CLOUDFLARED"
  echo "cloudflared downloaded to $CLOUDFLARED"
fi

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

extract_fqdn() {
  if [[ ! -f "$LOG_FILE" ]]; then
    return 0
  fi
  grep -Eo 'https://[-a-z0-9]+\.trycloudflare\.com' "$LOG_FILE" | tail -n 1 || true
}

start_tunnel() {
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "Tunnel already running (pid=${pid})"
    local fqdn
    fqdn="$(extract_fqdn)"
    if [[ -n "$fqdn" ]]; then
      echo "Connect (tunnel): ${fqdn}"
    fi
    return 0
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  : > "$LOG_FILE"

  "$CLOUDFLARED" tunnel --no-autoupdate --url "$LOCAL_URL" > "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  local fqdn=""
  for _ in $(seq 1 "$STARTUP_TIMEOUT_SECONDS"); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      break
    fi
    fqdn="$(extract_fqdn)"
    if [[ -n "$fqdn" ]]; then
      echo "Tunnel started (pid=${pid})"
      echo "Forwarding: ${LOCAL_URL}"
      echo "Connect (tunnel): ${fqdn}"
      echo "Log file: ${LOG_FILE}"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: tunnel failed to start." >&2
  echo "Log tail (${LOG_FILE}):" >&2
  tail -n 80 "$LOG_FILE" >&2 || true
  rm -f "$PID_FILE"
  return 1
}

stop_tunnel() {
  if ! is_running; then
    echo "Tunnel is not running."
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
  echo "Tunnel stopped."
}

status_tunnel() {
  if is_running; then
    local pid fqdn
    pid="$(cat "$PID_FILE")"
    fqdn="$(extract_fqdn)"
    echo "Tunnel running (pid=${pid})"
    echo "Forwarding: ${LOCAL_URL}"
    if [[ -n "$fqdn" ]]; then
      echo "Connect (tunnel): ${fqdn}"
    else
      echo "Connect (tunnel): URL not seen yet, check logs"
    fi
    return 0
  fi
  echo "Tunnel not running."
  return 1
}

run_foreground() {
  echo "cloudflared $($CLOUDFLARED --version)"
  echo "Opening Quick Tunnel -> ${LOCAL_URL}"
  echo "Press Ctrl-C to stop."
  exec "$CLOUDFLARED" tunnel --no-autoupdate --url "$LOCAL_URL"
}

case "$COMMAND" in
  start)
    start_tunnel
    ;;
  stop)
    stop_tunnel
    ;;
  restart)
    stop_tunnel
    start_tunnel
    ;;
  status)
    status_tunnel
    ;;
  logs)
    tail -n 120 -f "$LOG_FILE"
    ;;
  run)
    run_foreground
    ;;
  *)
    echo "Usage: bash scripts/tunnel.sh [start|stop|restart|status|logs|run]" >&2
    exit 2
    ;;
esac
