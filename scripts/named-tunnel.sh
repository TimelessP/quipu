#!/usr/bin/env bash
# scripts/named-tunnel.sh
#
# Persistent named Cloudflare Tunnel for Quipu.
# Unlike tunnel.sh (Quick Tunnels), this script binds a stable hostname to
# your Cloudflare account — the URL never changes between restarts.
#
# ── First-time setup ─────────────────────────────────────────────────────────
#
#   bash scripts/named-tunnel.sh init
#
#   This is interactive and will:
#     1. Ensure cloudflared is present (auto-downloads if not)
#     2. Open your browser for Cloudflare login (cloudflared tunnel login)
#     3. Prompt you for a tunnel name  (default: quipu)
#     4. Prompt you for the hostname   (e.g. quipu.yourdomain.com)
#     5. Create the tunnel and DNS CNAME record
#     6. Write scripts/.cloudflared/config.yml
#
#   After init, everything is stored in scripts/.cloudflared/ and is safe
#   to commit - EXCEPT the credentials JSON, which is ignored by
#   scripts/.cloudflared/.gitignore.
#
# ── Day-to-day lifecycle ──────────────────────────────────────────────────────
#
#   bash scripts/named-tunnel.sh            # default: start
#   bash scripts/named-tunnel.sh start
#   bash scripts/named-tunnel.sh restart
#   bash scripts/named-tunnel.sh stop
#   bash scripts/named-tunnel.sh status
#   bash scripts/named-tunnel.sh logs
#   bash scripts/named-tunnel.sh run        # foreground (Ctrl-C to stop)
#
# ── Teardown ─────────────────────────────────────────────────────────────────
#
#   bash scripts/named-tunnel.sh teardown
#
#   Stops the tunnel, deletes the Cloudflare tunnel object and its DNS record,
#   and removes scripts/.cloudflared/. Prompts for confirmation first.
#
# ── Optional environment variables ───────────────────────────────────────────
#
#   QUIPU_PORT                  Local app port      default: 8000
#   QUIPU_TUNNEL_PID            PID file            default: /tmp/quipu-named-tunnel.pid
#   QUIPU_TUNNEL_LOG            Log file            default: /tmp/quipu-named-tunnel.log
#   QUIPU_STARTUP_TIMEOUT_SECONDS                   default: 20
#   QUIPU_CF_API_TOKEN          Cloudflare API token (optional; for harden)
#   QUIPU_CF_ZONE_ID            Cloudflare Zone ID  (optional; for harden)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BIN_DIR="$REPO_ROOT/scripts/.bin"
CF_DIR="$REPO_ROOT/scripts/.cloudflared"
CONFIG_FILE="$CF_DIR/config.yml"
STATE_FILE="$CF_DIR/tunnel.state"     # key=value: TUNNEL_NAME, TUNNEL_UUID, HOSTNAME

PORT="${QUIPU_PORT:-8000}"
LOCAL_URL="http://127.0.0.1:${PORT}"
PID_FILE="${QUIPU_TUNNEL_PID:-/tmp/quipu-named-tunnel.pid}"
LOG_FILE="${QUIPU_TUNNEL_LOG:-/tmp/quipu-named-tunnel.log}"
STARTUP_TIMEOUT_SECONDS="${QUIPU_STARTUP_TIMEOUT_SECONDS:-20}"
CF_API_TOKEN="${QUIPU_CF_API_TOKEN:-}"
CF_ZONE_ID="${QUIPU_CF_ZONE_ID:-}"
COMMAND="${1:-start}"

mkdir -p "$BIN_DIR" "$CF_DIR"

# ── Detect or download cloudflared ───────────────────────────────────────────

CLOUDFLARED="$BIN_DIR/cloudflared"
ORIGIN_CERT="$CF_DIR/cert.pem"

ensure_origin_cert() {
  if [[ -s "$ORIGIN_CERT" ]]; then
    return 0
  fi

  local default_cert="$HOME/.cloudflared/cert.pem"
  if [[ -s "$default_cert" ]]; then
    cp "$default_cert" "$ORIGIN_CERT"
    chmod 600 "$ORIGIN_CERT" || true
    echo "Using Cloudflare origin cert from $default_cert"
    return 0
  fi

  echo "ERROR: Cloudflare origin cert not found." >&2
  echo "  Expected: $ORIGIN_CERT" >&2
  echo "  Also checked: $default_cert" >&2
  echo "  Run: cloudflared tunnel login" >&2
  exit 1
}

ensure_cloudflared() {
  if [[ -x "$CLOUDFLARED" ]]; then
    return 0
  fi

  echo "cloudflared not found – downloading from Cloudflare's release CDN ..."

  local arch os cf_arch cf_os
  arch="$(uname -m)"
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"

  case "$arch" in
    x86_64)  cf_arch="amd64" ;;
    aarch64) cf_arch="arm64" ;;
    armv7l)  cf_arch="arm"   ;;
    *)
      echo "ERROR: unsupported CPU architecture: $arch" >&2
      echo "  Place cloudflared manually at: $CLOUDFLARED" >&2
      exit 1
      ;;
  esac

  case "$os" in
    linux)  cf_os="linux"  ;;
    darwin) cf_os="darwin" ;;
    *)
      echo "ERROR: unsupported OS: $os" >&2
      exit 1
      ;;
  esac

  local url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-${cf_os}-${cf_arch}"
  echo "  URL: $url"

  if command -v curl &>/dev/null; then
    curl -fsSL "$url" -o "$CLOUDFLARED"
  elif command -v wget &>/dev/null; then
    wget -q "$url" -O "$CLOUDFLARED"
  else
    echo "ERROR: neither curl nor wget found." >&2
    exit 1
  fi

  chmod +x "$CLOUDFLARED"
  echo "cloudflared downloaded: $CLOUDFLARED"
  echo ""
}

# ── State helpers ─────────────────────────────────────────────────────────────

load_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "ERROR: tunnel not initialised. Run: bash scripts/named-tunnel.sh init" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$STATE_FILE"
}

save_state() {
  local name="$1" uuid="$2" hostname="$3"
  cat > "$STATE_FILE" <<EOF
TUNNEL_NAME=${name}
TUNNEL_UUID=${uuid}
HOSTNAME=${hostname}
EOF
}

# ── PID / process helpers ─────────────────────────────────────────────────────

is_running() {
  [[ -f "$PID_FILE" ]] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  [[ -n "$pid" ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

cf_api_request() {
  local method="$1"
  local endpoint="$2"
  local payload="${3:-}"
  local body_file http_code

  body_file="$(mktemp)"
  if [[ -n "$payload" ]]; then
    http_code="$(curl -sS -X "$method" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      -o "$body_file" \
      -w "%{http_code}" \
      "https://api.cloudflare.com/client/v4${endpoint}")"
  else
    http_code="$(curl -sS -X "$method" \
      -H "Authorization: Bearer ${CF_API_TOKEN}" \
      -o "$body_file" \
      -w "%{http_code}" \
      "https://api.cloudflare.com/client/v4${endpoint}")"
  fi

  if [[ "$http_code" != 2* ]]; then
    echo "Cloudflare API request failed (${method} ${endpoint}, HTTP ${http_code})." >&2
    cat "$body_file" >&2 || true
    rm -f "$body_file"
    return 1
  fi

  if ! python3 - "$body_file" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

if isinstance(data, dict) and data.get("success", True):
    sys.exit(0)

errors = data.get("errors") if isinstance(data, dict) else None
if errors:
    print("Cloudflare API error:", errors, file=sys.stderr)
sys.exit(1)
PY
  then
    rm -f "$body_file"
    return 1
  fi

  rm -f "$body_file"
  return 0
}

detect_challenge_injection() {
  local url="$1"
  curl -s "$url" | grep -qi '/cdn-cgi/challenge-platform'
}

resolve_cf_zone_id() {
  local value="$1"

  # Cloudflare Zone IDs are 32-char hex strings.
  if [[ "$value" =~ ^[a-fA-F0-9]{32}$ ]]; then
    printf '%s\n' "$value"
    return 0
  fi

  local name result_file http_code
  name="$value"
  result_file="$(mktemp)"
  http_code="$(curl -sS \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -o "$result_file" \
    -w "%{http_code}" \
    "https://api.cloudflare.com/client/v4/zones?name=${name}&status=active&per_page=1")"

  if [[ "$http_code" != 2* ]]; then
    echo "ERROR: Failed to resolve zone ID for '${name}' (HTTP ${http_code})." >&2
    cat "$result_file" >&2 || true
    rm -f "$result_file"
    return 1
  fi

  if ! python3 - "$result_file" <<'PY'
import json
import sys

path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

if not data.get("success"):
    print(data, file=sys.stderr)
    sys.exit(1)

result = data.get("result") or []
if not result:
    print("", end="")
    sys.exit(2)

zone_id = result[0].get("id", "")
if not zone_id:
    sys.exit(3)

print(zone_id, end="")
PY
  then
    local status=$?
    rm -f "$result_file"
    if [[ "$status" -eq 2 ]]; then
      echo "ERROR: No active zone found matching '${name}'." >&2
    else
      echo "ERROR: Could not parse zone ID for '${name}'." >&2
    fi
    return 1
  fi

  rm -f "$result_file"
}

# ── Commands ──────────────────────────────────────────────────────────────────

cmd_init() {
  ensure_cloudflared

  if [[ -f "$STATE_FILE" ]]; then
    echo "Tunnel is already initialised."
    # shellcheck disable=SC1090
    source "$STATE_FILE"
    echo "  Name:     ${TUNNEL_NAME}"
    echo "  UUID:     ${TUNNEL_UUID}"
    echo "  Hostname: https://${HOSTNAME}"
    echo ""
    echo "To start it:    bash scripts/named-tunnel.sh start"
    echo "To replace it:  bash scripts/named-tunnel.sh teardown  then  init again"
    return 0
  fi

  echo "════════════════════════════════════════════════════════"
  echo "  Quipu — Named Cloudflare Tunnel Initialisation"
  echo "════════════════════════════════════════════════════════"
  echo ""
  echo "Step 1/4  Login to Cloudflare"
  local default_cert="$HOME/.cloudflared/cert.pem"
  if [[ -s "$ORIGIN_CERT" || -s "$default_cert" ]]; then
    echo "  Existing Cloudflare login credentials detected."
    echo "  Reusing certificate and skipping browser login."
    ensure_origin_cert
  else
    echo "  Your browser will open. Select the domain you want to"
    echo "  use. cloudflared will save credentials to:"
    echo "  ${ORIGIN_CERT}"
    echo ""
    read -rp "Press Enter to open the browser login …"
    "$CLOUDFLARED" tunnel login
    ensure_origin_cert
  fi
  echo ""

  echo "Step 2/4  Tunnel name"
  read -rp "  Tunnel name [quipu]: " TUNNEL_NAME
  TUNNEL_NAME="${TUNNEL_NAME:-quipu}"
  echo ""

  echo "Step 3/4  Public hostname"
  echo "  This must be a subdomain of the domain you just authenticated."
  echo "  Example: quipu.yourdomain.com"
  read -rp "  Hostname: " HOSTNAME
  if [[ -z "$HOSTNAME" ]]; then
    echo "ERROR: hostname is required." >&2
    exit 1
  fi
  echo ""

  echo "Step 4/4  Creating tunnel and DNS record …"
  "$CLOUDFLARED" tunnel \
    --origincert "$ORIGIN_CERT" \
    create \
    --credentials-file "$CF_DIR/${TUNNEL_NAME}.json" \
    "$TUNNEL_NAME"

  # Extract UUID from the credentials file
  TUNNEL_UUID="$(python3 -c "import json,sys; print(json.load(open('$CF_DIR/${TUNNEL_NAME}.json'))['TunnelID'])" 2>/dev/null \
    || python3 -c "import json,sys; print(json.load(open('$CF_DIR/${TUNNEL_NAME}.json'))['tunnelID'])" 2>/dev/null \
    || grep -o '"TunnelID":"[^"]*"' "$CF_DIR/${TUNNEL_NAME}.json" | cut -d'"' -f4)"

  if [[ -z "$TUNNEL_UUID" ]]; then
    echo "ERROR: could not read tunnel UUID from credentials file." >&2
    exit 1
  fi

  "$CLOUDFLARED" tunnel \
    --origincert "$ORIGIN_CERT" \
    route dns \
    "$TUNNEL_NAME" \
    "$HOSTNAME"

  # Write config.yml
  cat > "$CONFIG_FILE" <<EOF
# Quipu — named Cloudflare tunnel configuration
# Generated by scripts/named-tunnel.sh init
# Safe to commit; the credentials JSON is gitignored.

tunnel: ${TUNNEL_UUID}
credentials-file: ${CF_DIR}/${TUNNEL_NAME}.json
origincert: ${CF_DIR}/cert.pem

ingress:
  - hostname: ${HOSTNAME}
    service: ${LOCAL_URL}
  - service: http_status:404
EOF

  save_state "$TUNNEL_NAME" "$TUNNEL_UUID" "$HOSTNAME"

  echo ""
  echo "════════════════════════════════════════════════════════"
  echo "  Initialisation complete."
  echo ""
  echo "  Tunnel:   ${TUNNEL_NAME}  (${TUNNEL_UUID})"
  echo "  URL:      https://${HOSTNAME}"
  echo "  Config:   ${CONFIG_FILE}"
  echo ""
  echo "  DNS propagation may take a minute or two on first use."
  echo ""
  echo "  Start with:"
  echo "    bash scripts/named-tunnel.sh start"
  echo "════════════════════════════════════════════════════════"
}

cmd_start() {
  load_state
  ensure_cloudflared

  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "Tunnel already running (pid=${pid})"
    echo "Connect: https://${HOSTNAME}"
    return 0
  fi

  mkdir -p "$(dirname "$LOG_FILE")"
  : > "$LOG_FILE"

  "$CLOUDFLARED" tunnel \
    --no-autoupdate \
    --config "$CONFIG_FILE" \
    run \
    > "$LOG_FILE" 2>&1 &
  local pid=$!
  echo "$pid" > "$PID_FILE"

  # Wait for the tunnel to register connections
  local started=0
  for _ in $(seq 1 "$STARTUP_TIMEOUT_SECONDS"); do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      break
    fi
    if grep -q "Connection registered" "$LOG_FILE" 2>/dev/null \
        || grep -q "Registered tunnel connection" "$LOG_FILE" 2>/dev/null \
        || grep -q "connsWaiting" "$LOG_FILE" 2>/dev/null; then
      started=1
      break
    fi
    sleep 1
  done

  if [[ "$started" -ne 1 ]]; then
    echo "ERROR: tunnel failed to start." >&2
    echo "Log tail (${LOG_FILE}):" >&2
    tail -n 40 "$LOG_FILE" >&2 || true
    rm -f "$PID_FILE"
    return 1
  fi

  echo "Tunnel started (pid=${pid})"
  echo "Forwarding: ${LOCAL_URL}  →  https://${HOSTNAME}"
  echo "Log file:   ${LOG_FILE}"
}

cmd_stop() {
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

cmd_status() {
  load_state
  if is_running; then
    local pid
    pid="$(cat "$PID_FILE")"
    echo "Tunnel running (pid=${pid})"
    echo "Connect: https://${HOSTNAME}"
    return 0
  fi
  echo "Tunnel not running."
  echo "  Name:     ${TUNNEL_NAME}"
  echo "  URL:      https://${HOSTNAME}"
  return 1
}

cmd_logs() {
  tail -n 120 -f "$LOG_FILE"
}

cmd_run() {
  load_state
  ensure_cloudflared
  echo "Starting named tunnel in foreground."
  echo "  Tunnel:  ${TUNNEL_NAME}"
  echo "  URL:     https://${HOSTNAME}"
  echo "  Press Ctrl-C to stop."
  echo ""
  exec "$CLOUDFLARED" tunnel \
    --no-autoupdate \
    --config "$CONFIG_FILE" \
    run
}

cmd_harden() {
  load_state

  if [[ -z "$CF_API_TOKEN" || -z "$CF_ZONE_ID" ]]; then
    echo "ERROR: QUIPU_CF_API_TOKEN and QUIPU_CF_ZONE_ID are required for harden." >&2
    echo "Set both env vars and rerun: bash scripts/named-tunnel.sh harden" >&2
    return 1
  fi

  if ! CF_ZONE_ID="$(resolve_cf_zone_id "$CF_ZONE_ID")"; then
    echo "ERROR: QUIPU_CF_ZONE_ID must be a 32-char zone ID or a resolvable zone name." >&2
    return 1
  fi

  echo "Applying Cloudflare hardening for ${HOSTNAME} ..."
  echo "  Using zone ID: ${CF_ZONE_ID}"

  if cf_api_request PATCH "/zones/${CF_ZONE_ID}/settings/rocket_loader" '{"value":"off"}'; then
    echo "  OK: Rocket Loader disabled"
  else
    echo "  WARN: Unable to disable Rocket Loader via API" >&2
  fi

  # Cloudflare challenge behavior is currently configured through bot/rules products
  # that do not expose a stable, zone-setting API toggle across plans. Keep this
  # script focused on stable API operations and guide the remaining hardening step.
  echo "  INFO: Bot challenge and JS detection controls require dashboard rule changes per host"

  echo ""
  echo "Verifying challenge injection state ..."
  if detect_challenge_injection "https://${HOSTNAME}"; then
    echo "  WARN: Cloudflare challenge platform script is still injected." >&2
    echo ""
    echo "Manual dashboard follow-up required:" >&2
    echo "  1) Security -> Bots: disable JavaScript Detections / JS Challenges for ${HOSTNAME}" >&2
    echo "  2) Security -> WAF -> Custom Rules: add host rule for ${HOSTNAME} with action Skip challenge-related checks" >&2
    echo "  3) Rules -> Configuration Rules: ensure Rocket Loader is Off for ${HOSTNAME}" >&2
    echo "  4) (Optional) Disable Zaraz for ${HOSTNAME} if enabled in your zone" >&2
    return 2
  fi

  echo "  OK: No challenge-platform injection detected."
  echo "Hardening complete."
}

cmd_teardown() {
  if [[ ! -f "$STATE_FILE" ]]; then
    echo "Nothing to tear down (no state file found)."
    return 0
  fi

  # shellcheck disable=SC1090
  source "$STATE_FILE"

  echo "════════════════════════════════════════════════════════"
  echo "  Teardown will:"
  echo "    1. Stop the tunnel process (if running)"
  echo "    2. Delete the Cloudflare tunnel object: ${TUNNEL_NAME}"
  echo "    3. Delete the DNS record:               ${HOSTNAME}"
  echo "    4. Remove scripts/.cloudflared/"
  echo ""
  echo "  This is irreversible. You will need to run init again."
  echo "════════════════════════════════════════════════════════"
  read -rp "Type 'yes' to confirm: " CONFIRM
  if [[ "$CONFIRM" != "yes" ]]; then
    echo "Aborted."
    return 0
  fi
  echo ""

  # Stop if running
  if is_running; then
    echo "Stopping tunnel process …"
    cmd_stop
  fi

  ensure_cloudflared
  ensure_origin_cert

  echo "Deleting Cloudflare tunnel (this also removes the DNS record) …"
  "$CLOUDFLARED" tunnel \
    --origincert "$ORIGIN_CERT" \
    delete \
    --credentials-file "$CF_DIR/${TUNNEL_NAME}.json" \
    --force \
    "$TUNNEL_NAME" \
    || echo "  Warning: cloudflared delete returned an error (tunnel may already be gone)."

  echo "Removing scripts/.cloudflared/ …"
  rm -rf "$CF_DIR"

  rm -f "$PID_FILE" "$LOG_FILE"

  echo ""
  echo "Teardown complete."
}

# ── Dispatch ──────────────────────────────────────────────────────────────────

case "$COMMAND" in
  init)
    cmd_init
    ;;
  start)
    cmd_start
    ;;
  stop)
    cmd_stop
    ;;
  restart)
    cmd_stop
    cmd_start
    ;;
  status)
    cmd_status
    ;;
  logs)
    cmd_logs
    ;;
  run)
    cmd_run
    ;;
  harden)
    cmd_harden
    ;;
  teardown)
    cmd_teardown
    ;;
  *)
    cat >&2 <<'EOF'
Usage: bash scripts/named-tunnel.sh [COMMAND]

Commands:
  init      First-time setup: login, create tunnel, configure hostname
  start     Start tunnel in background  (default)
  stop      Stop background tunnel
  restart   Stop then start
  status    Show running state and URL
  logs      Tail the tunnel log
  run       Run in foreground (Ctrl-C to stop)
  harden    Apply Cloudflare security hardening and verify no challenge injection
  teardown  Delete tunnel from Cloudflare and remove local config
EOF
    exit 2
    ;;
esac
