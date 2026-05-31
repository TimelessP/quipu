# Scaling gap: viewport portal loading still via bbox endpoint

**Date noted:** 2026-05-31  
**Status:** Known gap — server-side violation replaced with bounded lookup, client-side contract not yet complete.

---

## What we fixed

Both `iter_items_in_dimension` call sites in `main.py` are gone:

- `_validate_portal_spacing` → bounded `h3.grid_disk(center, k=2)` cell-ring lookup (≤19 cell GETs).
- `get_items_in_bbox` → `h3.h3shape_to_cells(bbox_polygon, H3_RESOLUTION)` cell enumeration, capped at `MAX_BBOX_CELLS = 500`.

Neither scans all objects any more. The server only does keyed GETs.

---

## The remaining gap

`loadViewportPortals()` in `app.js` still calls `/api/dimensions/{root}/items-in-bbox`, sending `min_lat / max_lat / min_lng / max_lng` as query parameters. The server then computes which H3 cells intersect the bbox on every request.

This violates the scale contract in a softer but real way:

1. **The server is doing spatial computation** (`h3shape_to_cells`) that the client could do deterministically with the same H3 library it already has (`window.h3`). At planetary scale, edge nodes should be pure object-store GETs — no query logic at all.
2. **The `/items-in-bbox` endpoint exists as a crutch.** Once the client drives its own cell fan-out the endpoint becomes dead code and should be deleted.
3. **The bbox → cell computation is not cached client-side.** `loadNearby` caches per cell key; `loadViewportPortals` does not get that benefit because it issues one composite request.

---

## What the complete fix looks like

Mirror what `loadNearby` already does, but for the viewport bounds:

```js
// In loadViewportPortals():
const bounds = map.getBounds();
const poly = [
  [bounds.getSouth(), bounds.getWest()],
  [bounds.getSouth(), bounds.getEast()],
  [bounds.getNorth(), bounds.getEast()],
  [bounds.getNorth(), bounds.getWest()],
];
const cells = h3Api.polygonToCells(poly, H3_RESOLUTION);   // deterministic, client-side

// Guard against accidental global fan-out (same spirit as server MAX_BBOX_CELLS)
if (cells.length > MAX_VIEWPORT_CELLS) { /* skip or warn */ }

// One cached GET per cell — identical pattern to loadNearby
const cellPayloads = await Promise.all(
  cells.map((cellId) =>
    fetchJsonWithCache(
      `${state.dimensionRootId}:cell:${cellId}`,
      `/api/dimensions/${state.dimensionRootId}/cells/${cellId}/item-ids`,
      preferCache,
    ).catch(() => ({ item_ids: [] }))
  )
);
// … dedupe item IDs, fetch items, filter to portal_marker type
```

Once this is in place, `/api/dimensions/{root_id}/items-in-bbox` can be deleted from `main.py`.

---

## Constants to add when implementing

| Constant | Suggested value | Notes |
|---|---|---|
| `MAX_VIEWPORT_CELLS` (JS) | `200` | At res 12, a zoom-18 viewport is ~10–40 cells; 200 is a comfortable ceiling. |
| `H3_RESOLUTION` (JS, already exists) | `12` | Must match server `config.H3_RESOLUTION`. |

---

## Why we haven't done it yet

The endpoint fix (`h3shape_to_cells` on the server) was the fast path that removed the O(N) scan today. The client refactor is correct but touches more frontend code and needs the `polygonToCells` API confirmed in the browser H3 build. Deferred to avoid scope creep mid-session.
