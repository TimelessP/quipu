---
name: leafletjs
description: 'Build, integrate, debug, or refine Leaflet.js and React-Leaflet maps. Use for map initialization, tile layers, markers, popups, overlays, viewport loading, follow-location behavior, mobile touch issues, zoom/pan restoration, theme-aware styling, dark-mode tile filtering, and built-in Leaflet control theming.'
argument-hint: 'Describe the Leaflet task, app context, framework, and the behavior you want.'
user-invocable: true
---

# Leaflet.js Skill

Use this skill when working on Leaflet-based maps in vanilla JS, React, or similar web apps.

## Good Triggers
- "Leaflet map"
- "React-Leaflet"
- "tile layer"
- "marker popup"
- "fit bounds"
- "pan or zoom bug"
- "follow user location"
- "restore previous map position"
- "mobile touch map issue"
- "dark mode map"
- "Leaflet CSS filter"
- "Leaflet zoom controls dark mode"
- "Leaflet attribution dark mode"

## What This Skill Covers
- Map bootstrapping and initial view selection
- Tile layer setup and theme-aware tile styling
- Marker, circle, polyline, and popup rendering
- Follow-player and GPS-centered interactions
- Restoring prior center and zoom without jarring first paint
- One-shot shared-link map panning
- Heading-mode map rotation without corrupting Leaflet pan transforms
- Built-in Leaflet zoom control and attribution theming
- Mobile behavior: touch, orientation, narrow layouts, button density
- Performance issues from repeated pan/zoom handlers or heavy tile filters

## Procedure
1. Identify the Leaflet integration surface.
   Determine whether the app uses vanilla Leaflet, React-Leaflet, or another wrapper.

2. Find the owning map lifecycle.
   Start at the nearest concrete anchor: `L.map(...)`, `L.tileLayer(...)`, `MapContainer`, map event handlers, or the function that decides initial center/zoom.

3. Separate startup state from live state.
   Treat these independently:
   - initial map center and zoom
   - persisted user position or GPS restore
   - follow-mode behavior
   - one-shot shared-link or deep-link panning
   - later map movement from user input or async data

4. Keep map control state explicit.
   Prefer named state for:
   - whether the user is following location
   - whether a movement is programmatic
   - whether a deep-link/shared-link override is transient
   Avoid overloading one persisted boolean with multiple meanings.

5. Make tile styling theme-aware, not hardcoded.
   If dark mode needs filtered OSM tiles, give the tile layer a class and drive the CSS filter from theme variables. Keep light mode untouched unless the request explicitly says otherwise.

6. Handle overlays from theme tokens.
   Marker, circle, and polyline colors should come from CSS custom properties or one theme lookup function so theme changes update map overlays consistently.

7. Theme built-in Leaflet controls too.
   If the app uses Leaflet defaults (zoom +/- and attribution), style those selectors with the same dark/light token system so controls do not clash with the map or app chrome.

8. Protect mobile layout.
   For modal or panel actions around map workflows:
   - check narrow portrait layouts
   - verify icon buttons do not collapse or wrap unexpectedly
   - ensure touch states do not fall back to browser default fills

9. Validate with behavior-scoped checks.
   Prefer the narrowest meaningful validation:
   - initial load behavior
   - reload behavior
   - shared-link/deep-link behavior
   - follow button behavior
   - narrow-screen modal layout
   - zoom control and attribution readability in dark mode
   - theme toggle behavior

## Common Leaflet Pitfalls
- Starting the map at `[0, 0]` before persisted position is applied, causing a world-view flash
- Persisting a temporary deep-link override into normal follow state
- Treating missing URL params as numeric zeroes with `Number(null)`
- Allowing programmatic `setView()` calls to disable follow mode
- Triggering duplicate viewport loads from overlapping `moveend` flows
- Composing custom `rotate()/scale()` into Leaflet's live `mapPane.style.transform`, causing pan offsets in heading mode
- Using translucent dark controls over bright map tiles, making controls look pale
- Leaving Leaflet's built-in zoom or attribution controls unthemed in dark mode
- Applying heavy dark-mode tile filters without checking performance on mobile
- Letting mobile media queries collapse action rows that should remain side-by-side

## Preferred Patterns
- Start the map at the restored virtual/user position when available
- Use a dedicated transient flag for shared-link focus instead of mutating persisted follow state
- Add `className` to tile layers so CSS can theme them without replacing tile providers
- Keep Leaflet translate in `mapPane.style.transform`; apply heading rotation/zoom via separate `style.rotate` and `style.scale`
- Theme Leaflet's built-in controls and attribution with explicit selectors and tokens
- Centralize color lookup for markers and rings
- Use one-shot URL consumers that clear params after handling

## References
- [Leaflet patterns](./references/leaflet-patterns.md)
