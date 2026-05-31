# Viewport Bbox Scaling Gap — Resolved

**Date noted:** 2026-05-31  
**Date resolved:** 2026-05-31  
**Status:** Complete

The remaining scaling gap was that viewport portal loading still used a composite bbox query.

That is now gone:

- `loadViewportPortals()` computes covering H3 cells on the client with `polygonToCells(...)`.
- The client issues one cached GET per deterministic cell key via `/api/dimensions/{root_id}/cells/{cell_id}/item-ids`.
- Portal item hydration remains direct item GETs via `/api/items/{item_id}`.
- `MAX_VIEWPORT_CELLS = 200` prevents accidental global fan-out from the client.
- `/api/dimensions/{root_id}/items-in-bbox` has been deleted.

With that change, the server-side contract is now clean: gameplay reads are deterministic keyed GETs only, with no spatial query endpoint and no server-side object scans.
