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

If you want `serve.sh` to echo the current tunnel URL, start the tunnel first,
then start/restart the server:

```bash
# terminal 1
bash scripts/tunnel.sh

# terminal 2
bash scripts/serve.sh
```

Tunnel lifecycle:

```bash
bash scripts/tunnel.sh start
bash scripts/tunnel.sh status
bash scripts/tunnel.sh restart
bash scripts/tunnel.sh stop
bash scripts/tunnel.sh logs
```

The script downloads `cloudflared` automatically (no account needed) and prints
a `https://*.trycloudflare.com` URL — open that on your Android device.
The URL changes each session; no self-signed certificates are involved.

## API quick checks

```bash
curl http://localhost:8000/health
curl http://localhost:8000/api/dimensions/default
```

## Data layout

- `data/meta.json` - dimension metadata
- `data/items/<uuid>.json` - item documents
- `data/cells/{dimension_root_id}__{cell_id}.json` - H3 cell membership index
- `data/uploads/<uuid>-<filename>` - uploaded photos
