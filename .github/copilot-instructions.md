# Copilot Instructions for Quipu

## Project Overview
- Stack: FastAPI backend + static Leaflet frontend.
- Key frontend file: app/static/app.js.
- Key styles: app/static/styles.css.
- Key data files: data/meta.json, data/items/*.json, data/cells/*.json.

## Development Commands
- Setup: bash scripts/setup.sh
- Serve (default start): bash scripts/serve.sh
- Serve lifecycle: bash scripts/serve.sh start|status|restart|stop|logs
- Quick tunnel lifecycle (ephemeral URL): bash scripts/tunnel.sh start|status|restart|stop|logs
- Named tunnel lifecycle (stable URL): bash scripts/named-tunnel.sh start|status|restart|stop|logs
- Tunnel scripts are separate from serve.sh; do not add tunnel start/stop/status logic to serve.sh.
- Quick tunnel hostnames change over time; account for origin-scoped browser localStorage (data can fragment across FQDNs).

## Coding Expectations
- Keep edits minimal and focused on the requested behavior.
- Preserve current app architecture and naming unless a refactor is explicitly requested.
- Avoid introducing frameworks or build tooling changes for frontend tasks unless requested.
- Prefer clear, explicit state flags over overloaded booleans.

## Leaflet and Map State Rules
- Treat Leaflet pan transform ownership carefully.
- Keep Leaflet translate state in mapPane.style.transform.
- For heading mode visuals, use mapPane.style.rotate and mapPane.style.scale.
- Do not compose custom rotate/scale directly into Leaflet's live transform string.
- Keep startup center/zoom handling separate from live follow-state updates.
- Keep shared/deep-link focus transient and avoid persisting it as follow preference.

## UI and Theme Rules
- Use theme tokens (CSS variables) for map overlays and controls.
- Theme built-in Leaflet controls and attribution in both light and dark modes.
- Validate mobile layouts for action rows and map-related modals.

## Validation Checklist
When changing map behavior, verify:
- Initial load center/zoom is correct.
- Reload center/zoom is correct.
- Follow mode behavior is correct.
- Shared-link/deep-link behavior is one-shot and does not corrupt persisted state.
- Portal travel recenter behavior is correct in both north-up and heading modes.

## Scope and Safety
- Do not rewrite unrelated files.
- Do not modify persistent user data formats without explicit request.
- If introducing temporary diagnostics, remove them before finalizing unless asked to keep them.

## Agent Integration
The repository provides a compact sub-agent `code-researcher` (stored in `.github/agents/code-researcher.agent.md`). The main Copilot agent SHOULD invoke this sub-agent when a task requires focused, iterative code exploration or repeated short searches across the repo to save token/context costs. Guidance:
- Use the `code-researcher` when the work is research-heavy, requires multiple small read/search runs, or when the caller can provide a 1-3 line objective and minimal file/symbol context.
- The sub-agent has limited tools: `run_in_terminal`, `read_file`, `fetch_webpage`, and `grep_search`. Do not expect it to perform broad or interactive tasks beyond these.
- If the task involves complex multi-file edits or long-running builds/tests, prefer the main agent instead of the sub-agent.
