# Quipu MVP

Small MVP implementation of Quipu using FastAPI + static web client.

## Features in this slice

- Sparse quadtree-like spatial storage (filesystem JSON)
- Item types: letter, photograph upload, portal marker
- Session-only portal links on client (not persisted to server)
- Mobile-friendly map UI (Leaflet)
- Offline read cache + queued writes for letter/portal placement

## Quick start

```bash
# 1. One-time setup (creates .venv, installs deps, creates data/ dirs)
bash scripts/setup.sh

# 2. Start the server
bash scripts/serve.sh
```

Server lifecycle (single script):

```bash
bash scripts/serve.sh start
bash scripts/serve.sh status
bash scripts/serve.sh restart
bash scripts/serve.sh stop
bash scripts/serve.sh logs
```

`start` is the default command, so `bash scripts/serve.sh` is equivalent to `start`.

Open:

- Desktop: http://localhost:8000
- Phone on same LAN: http://\<your-computer-lan-ip\>:8000

### GPS on Android (requires HTTPS)

Geolocation requires a secure context.

Run the server and tunnel as separate lifecycles:

```bash
# terminal 1
bash scripts/serve.sh

# terminal 2
bash scripts/tunnel.sh start
```

Quick tunnel lifecycle (ephemeral `https://*.trycloudflare.com` URL):

```bash
bash scripts/tunnel.sh start
bash scripts/tunnel.sh status
bash scripts/tunnel.sh restart
bash scripts/tunnel.sh stop
bash scripts/tunnel.sh logs
```

Warning about ephemeral tunnel hostnames:

- Each `scripts/tunnel.sh` start usually gets a new `*.trycloudflare.com` FQDN.
- Browser local storage is origin-scoped, so each new FQDN gets a separate local storage bucket.
- Over time, local storage entries can accumulate across old tunnel origins.
- Inventory/items cached or queued in one tunnel origin may appear inaccessible after the FQDN changes.
- For stable origin behavior, use `scripts/named-tunnel.sh` with a fixed hostname.

Named tunnel lifecycle (stable custom hostname via Cloudflare account):

```bash
bash scripts/named-tunnel.sh init
bash scripts/named-tunnel.sh start
bash scripts/named-tunnel.sh status
bash scripts/named-tunnel.sh restart
bash scripts/named-tunnel.sh stop
bash scripts/named-tunnel.sh logs
```

The script downloads `cloudflared` automatically (no account needed) and prints
a `https://*.trycloudflare.com` URL — open that on your Android device.
The URL changes each session; no self-signed certificates are involved.

`scripts/serve.sh` does not manage tunnel startup/shutdown; use one of the tunnel
scripts above explicitly.

## API quick checks

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/dimensions/default
```

## CSP and Cloudflare

For stable and low-maintenance security, keep app CSP strict and stop edge-side
inline script injection instead of hash-chasing rotating payloads.

Recommended posture:

- Keep `script-src 'self'` as the baseline policy.
- Leave `QUIPU_CSP_SCRIPT_HASHES` unset by default.
- Disable Cloudflare features that inject inline JS for this hostname:
	- JavaScript Detections / JS Challenge (set skip rule for `quipu.timelessprototype.com`)
	- Bot Fight mode challenge actions on this host/path
	- Rocket Loader
	- Zaraz (if enabled)

If you need temporary compatibility while changing Cloudflare settings, set
`QUIPU_CSP_SCRIPT_HASHES` explicitly to known hashes, then remove it once edge
injection is disabled.

Verification workflow:

```bash
# 1) Confirm CSP (expect script-src 'self' with no rotating hash maintenance)
curl -sI https://quipu.timelessprototype.com/ | grep -i content-security-policy

# 2) Check for Cloudflare challenge platform injection (should return nothing)
curl -s https://quipu.timelessprototype.com/ | grep -i '/cdn-cgi/challenge-platform' || true
```

## Data layout

- `data/meta.json` - dimension metadata
- `data/items/<uuid>.json` - item documents
- `data/cells/{dimension_root_id}__{cell_id}.json` - H3 cell membership index
- `data/uploads/<uuid>-<filename>` - uploaded photos
