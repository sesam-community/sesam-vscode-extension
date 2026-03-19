# F04: Node-Connected Live Preview

> **Status**: `planned`
> **Rollout Phase**: Phase 3 - Node Connectivity
> **Tracking**: [impl-plan.prompt.md](impl-plan.prompt.md)

---

## Summary

The existing offline Pipe Preview panel (`client/src/preview/PreviewPanel.ts`) evaluates DTL locally using
static entity data from `.test.json` files. Many DTL functions (`hops`, `apply-hops`, `lookup-entity`) require
a live Sesam node to resolve cross-dataset lookups. This feature adds a toggle that switches Preview from
offline mode to node-connected mode, fetching real entities from the configured Sesam node.

---

## Implementation Phases

### Phase A: Toggle + Authentication Wiring

1. Add a "Live" toggle button to the `PreviewPanel` webview toolbar (HTML/CSS in PreviewPanel.ts).
2. Add state field `PreviewPanel.mode: 'offline' | 'live'`; persist per-workspace in `workspaceState`.
3. When `mode === 'live'`:
   - Resolve the node URL + JWT via F03 `credentialManager.getToken` + `profileManager.getActiveNode`.
   - Show a lock icon when authenticated, a warning when credentials are missing (with a "Set credentials"
     link that triggers `sesam.setToken`).

### Phase B: Entity Fetching from Node

1. Create `client/src/nodeClient.ts`:
   - `fetchEntities(nodeUrl: string, jwt: string, datasetId: string, limit?: number): Promise<Entity[]>`
   - Uses `node-fetch` (or `https` module) to call `GET /datasets/<id>/entities?limit=N`.
   - Handles pagination via `since` parameter to support loading more entities.
2. In `PreviewPanel`, when `mode === 'live'`:
   - Replace the static entity array loaded from `.test.json` with a call to `fetchEntities`.
   - Add a "Dataset ID" input in the panel toolbar to specify which dataset to fetch from.
   - Add a "Refresh" button and auto-refresh on pipe save.
3. Cache fetched entities in memory for the session; invalidate on refresh or pipe change.

### Phase C: Full DTL Evaluation with Node Data

1. Update the shared evaluator (`src/shared/dtl-evaluator.ts`) so `hops`, `apply-hops`, and
   `lookup-entity` resolve via a pluggable `DatasetResolver` interface instead of returning `null`.
2. Implement `NodeDatasetResolver` in `client/src/nodeDatasetResolver.ts` using `nodeClient.fetchEntities`.
3. Implement `LocalDatasetResolver` (existing behavior, reads from `.test.json` files).
4. Pass the appropriate resolver to the evaluator based on `PreviewPanel.mode`.

### Phase D: Error Handling & UX Polish

1. Show a spinner in the preview panel while fetching.
2. Display node-side errors (HTTP 401, 403, network timeout) as styled banners inside the webview.
3. Truncate entity lists with a "Load more" button (default limit 50 entities).
4. Add "Copy entity JSON" button per row in the entity list view.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `client/src/preview/PreviewPanel.ts` | Mode toggle, toolbar, live-mode conditional logic |
| `client/src/nodeClient.ts` (new) | REST client for `GET /datasets/<id>/entities` |
| `client/src/nodeDatasetResolver.ts` (new) | `DatasetResolver` impl using nodeClient |
| `src/shared/dtl-evaluator.ts` | Accept pluggable `DatasetResolver`; refactor `hops`/`lookup-entity` |

---

## Dependencies

- **F03** - node URL + JWT must be available via credential manager
- **F01** Phase A (node connectivity established in-process)
- Existing `PreviewPanel` offline functionality must remain intact when `mode === 'offline'`
