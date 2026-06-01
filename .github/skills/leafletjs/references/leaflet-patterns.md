# Leaflet Patterns

## Initial View Restore
When a prior user or GPS position exists, initialize the map at that position immediately instead of creating the map at a global default and recentering later.

Checklist:
- derive initial center before `L.map(...).setView(...)`
- use a close-in initial zoom when the user location is known
- mark initial centering state so later refresh logic does not fight startup

## Follow Mode vs Transient Focus
Do not use one persisted boolean for both normal follow mode and temporary deep-link focus.

Recommended split:
- persisted follow preference
- transient shared-link or deep-link focus flag
- programmatic move guard

## Shared Portal or Deep Link Handling
For links that pan the map to a location:
- validate that both params are present before parsing
- do not auto-select or mutate other app state unless requested
- after handling, remove params from the URL with `history.replaceState`
- avoid saving the temporary deep-link state into persisted follow preferences

## Theme-Aware Tile Styling
For filtered dark mode on standard OSM tiles:
- assign a stable class name to the tile layer such as `map-tiles`
- drive the filter from a CSS variable
- keep light mode filter as `none`
- retune filter values per tile source rather than assuming one formula fits all

Example pattern:

```js
L.tileLayer(url, {
  className: "map-tiles",
  attribution,
}).addTo(map);
```

```css
:root {
  --map-tiles-filter: none;
}

:root[data-theme="dark"] {
  --map-tiles-filter: brightness(0.62) invert(1) contrast(2.4) hue-rotate(185deg) saturate(0.45) brightness(0.88);
}

.map-tiles {
  filter: var(--map-tiles-filter);
}
```

## Built-in Leaflet Controls and Attribution
Leaflet's default controls are outside your app component styles, so theme them explicitly.

Key selectors:
- `.leaflet-control-zoom.leaflet-bar`
- `.leaflet-control-zoom.leaflet-bar a`
- `.leaflet-control-attribution`

Recommended approach:
- create control and attribution theme tokens for background, border, ink, hover, and shadow
- style zoom controls and attribution using those tokens
- include `:hover`, `:focus`, and disabled states for zoom anchors

Example pattern:

```css
:root {
  --leaflet-control-bg: #fff;
  --leaflet-control-bg-hover: #f1f1f1;
  --leaflet-control-border: #101010;
  --leaflet-control-ink: #050505;
  --leaflet-control-shadow: none;
  --leaflet-attrib-bg: rgba(255, 255, 255, 0.96);
  --leaflet-attrib-border: #101010;
}

:root[data-theme="dark"] {
  --leaflet-control-bg: rgba(3, 3, 3, 0.98);
  --leaflet-control-bg-hover: rgba(14, 14, 14, 0.99);
  --leaflet-control-border: rgba(39, 244, 255, 0.92);
  --leaflet-control-ink: #f7fbff;
  --leaflet-control-shadow: 0 0 0 1px rgba(39, 244, 255, 0.2), 0 0 14px rgba(39, 244, 255, 0.14);
  --leaflet-attrib-bg: rgba(3, 3, 3, 0.9);
  --leaflet-attrib-border: rgba(39, 244, 255, 0.82);
}

.leaflet-control-zoom.leaflet-bar {
  border: 1px solid var(--leaflet-control-border);
  background: var(--leaflet-control-bg);
  box-shadow: var(--leaflet-control-shadow);
}

.leaflet-control-zoom.leaflet-bar a {
  background: var(--leaflet-control-bg);
  color: var(--leaflet-control-ink);
  border-bottom: 1px solid var(--leaflet-control-border);
}

.leaflet-control-zoom.leaflet-bar a:hover,
.leaflet-control-zoom.leaflet-bar a:focus,
.leaflet-control-zoom.leaflet-bar a:active {
  background: var(--leaflet-control-bg-hover);
}

.leaflet-control-attribution {
  background: var(--leaflet-attrib-bg) !important;
  color: var(--leaflet-control-ink);
  border: 1px solid var(--leaflet-attrib-border);
}
```

## Overlay Colors
Map overlays often need different contrast rules from the app shell.

Recommended approach:
- store ring, marker, and line colors as theme tokens
- read those values from one helper
- update circle/marker/polyline styles when the theme changes

## Mobile Action Rows Around Maps
If a map-related modal includes button rows:
- inspect narrow portrait layout explicitly
- allow text buttons to shrink with `min-width: 0`
- do not let mobile media queries accidentally collapse a two-action row into a broken layout
- use equal-width columns when two actions are peers

## Performance Notes
- CSS tile filters are visually useful but can be expensive on lower-end devices
- repeated `setView()` plus `moveend` reloads can amplify cost
- if performance is poor, first reduce duplicated reloads before abandoning theme-aware tiles
