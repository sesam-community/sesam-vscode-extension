# F07: Pipe Graph Enhancements

> **Status**: `planned`
> **Rollout Phase**: Phase 4 - AI & Visual Polish
> **Tracking**: [impl-plan.prompt.md](impl-plan.prompt.md)

---

## Summary

Upgrade the existing read-only pipe graph sidebar (`client/src/graph/PipeGraphProvider.ts`) with interactive
features: a richer rendering library, live node-status overlays, search/filter, and click-to-navigate.

---

## Current State

The existing `PipeGraphProvider` renders a static SVG or simple HTML graph in a webview sidebar panel.
It reflects the local workspace pipe configuration but has no live connectivity or interactivity.

---

## Implementation Phases

### Phase A: Rendering Library Swap

1. Replace the current SVG/plain-HTML rendering with a `vis-network` or `d3-force` graph layout bundled
   into the webview.
2. Use `vite.config.client.ts` to bundle the graph library into the webview assets.
3. Each node represents a pipe or system; edges represent `hops` / input connectors.
4. Node shape key:
   - Circle: pipe
   - Diamond: system (source/sink)
   - Square: dataset (intermediate)
5. Click a node -> `postMessage` to the extension host -> opens the corresponding `.conf.json` file.

### Phase B: Search & Filter

1. Add a search input at the top of the graph panel.
2. Filter the displayed nodes to those matching the search string (pipe name, system name, dataset ID).
3. Non-matching nodes are dimmed but visible; matching nodes are highlighted.
4. Add filter buttons: "Show only modified" (requires F06 status), "Show only running", "Show errors".

### Phase C: Live Node-Status Overlay

1. When F03 credentials are configured, poll `GET /pipes` every 30 s (configurable interval).
2. Overlay status badge on each pipe node:
   - Green dot: `running`
   - Red dot: `failed`
   - Grey dot: `stopped` / `disabled`
   - Spinning ring: currently pumping
3. Clicking the status badge opens a popover with last-run timestamp, entity count, error message.
4. Add a global toggle "Live mode" in the panel toolbar; when off, disable polling.

### Phase D: Minimap & Layout Controls

1. Add a minimap in the bottom-right corner of the webview for large graphs.
2. Expose layout algorithm selector: `force-directed` | `hierarchical` | `circular`.
3. Save last-used layout to `workspaceState`.
4. Add "Export as PNG" button (uses `canvas.toDataURL` in the webview and sends to extension host
   for `fs.writeFile`).

---

## Files to Modify / Add

| File | Change |
|---|---|
| `client/src/graph/PipeGraphProvider.ts` | Webview message protocol, panel registration |
| `client/src/graph/graph-webview/` (new dir) | Webview HTML + TS using vis-network/d3 |
| `vite.config.client.ts` | Bundle graph webview assets |
| `package.json` | `dtl.graph.pollingIntervalSeconds` setting |

---

## Dependencies

- **F03** - credentials needed for Phase C live polling
- **F06** - status data reused for Phase B "show modified" filter
