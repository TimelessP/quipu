# Quipu Spatial Index Update (H3 Migration)

This document records a deliberate divergence from the original concept in `doc/quipu-design-concept.md`.

## Why we changed

The original nearby-item approach relied on degree-bisection quadtree paths plus client-side tree sweeping (`/resolve-node` + node/item fan-out fetches). That design had two practical issues in MVP reality:

1. Stability and request volume:
- frequent GPS updates caused repeated radial sweeps and many API calls
- nearby results could flicker as different sampled leaves were discovered between updates

2. Geographic behavior:
- degree-based subdivision is not uniform over the globe
- behavior near high latitudes can be less predictable than spherical index cells

## New approach

Nearby retrieval now uses an H3 global cell index with client-driven fan-out:

- On item placement, backend computes `cell_id = h3.latlng_to_cell(lat, lng, H3_RESOLUTION)`.
- Item IDs are indexed into cell documents under `data/cells/`.
- Client computes center cell and `grid_disk(k)` around current virtual location.
- Client fetches cell membership with GETs and cache:
  - `/api/dimensions/{root_id}/cells/{cell_id}/item-ids`
  - `/api/items/{item_id}`
- Client applies final haversine radius filter.

The backend no longer computes per-user nearby sets.

## Data model changes

- Added `CELLS_DIR` in backend config.
- Added `H3_RESOLUTION` (default `12`).
- Added file-backed cell index in storage:
  - add/remove item membership per `root_id + cell_id`
  - iterate item IDs from candidate cells

Cell files are stored as:

- `data/cells/{dimension_root_id}__{cell_id}.json`

Each file payload:

```json
{
  "dimension_root_id": "...",
  "cell_id": "...",
  "item_ids": ["item-a", "item-b"]
}
```

## API/behavior impact

- Added `/api/dimensions/{root_id}/cells/{cell_id}/item-ids` for index fan-out.
- Client `loadNearby` now performs GET fan-out with cache and local distance filtering.
- `/api/dimensions/{root_id}/nearby` is no longer part of nearby discovery.
- Legacy `/resolve-node` path is no longer needed for nearby discovery.

## Migration compatibility

No compatibility/backfill path is included in this MVP reset phase.
This project has not released yet, so stale data is discarded and index state starts clean.

## Tradeoffs

Pros:
- much lower request chatter from frontend
- fewer moving parts in nearby loading path
- better globe-safe indexing behavior

Cons:
- additional storage files in `data/cells/`
- small overhead to maintain index on place/pickup operations
- H3 is a new dependency (`h3` package)

## Resolution note

`H3_RESOLUTION=12` is currently chosen as a practical default for a ~30m gameplay radius. If gameplay radius changes substantially, resolution can be revisited and tuned.
