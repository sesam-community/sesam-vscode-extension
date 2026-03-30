# F04: Node-Connected Live Preview

> **Status**: `planned`
> **Rollout Phase**: Phase 3 - Node Connectivity
> **Tracking**: [README.md](README.md)

---

## Summary

The existing offline Pipe Preview panel (`client/src/preview/PreviewPanel.ts`) evaluates DTL locally using
the built-in `dtl-evaluator.ts` and loads input entities from `source.entities` (embedded source) or
`testdata/<pipe-id>.json`. The offline evaluator cannot handle `hops`, `apply-hops`, or `lookup-entity`.

This feature adds a **Live** mode that replaces the offline evaluation path with a call to the Sesam node's
pipe preview API:

```
POST https://{node-url}/api/pipes/{pipe-id}/preview
```

This gives exact, node-side evaluation for all DTL functions using the current pipe config and real data.

---

## API Contract

### Endpoint
```
POST https://{node-url}/api/pipes/{pipe-id}/preview
Authorization: Bearer {jwt}
Content-Type: application/json
```

### Request body
```json
[                      // array of input entities (_S)
  { "_id": "...", ... }
]
```

### Response
```json
[                      // array of output entities (_T), one per input (may be empty if discarded)
  { "_id": "...", ... }
]
```

Errors are returned as HTTP 4xx/5xx with a JSON body `{ "message": "..." }`.

---

## Implementation Phases

### Phase A: Toggle + Authentication Wiring

1. Add a "Live" toggle button to the `PreviewPanel` webview toolbar (HTML/CSS in PreviewPanel.ts).
2. Add state field `PreviewPanel.mode: 'offline' | 'live'`; persist per-workspace in `workspaceState`.
3. When `mode === 'live'`:
   - Resolve the node URL + JWT via F03 `credentialManager.getToken` + `profileManager.getActiveNode`.
   - Show a lock icon when authenticated, a warning when credentials are missing (with a "Set credentials"
     link that triggers `sesam.setToken`).

### Phase B: Live Evaluation via Pipe Preview API

1. Create `client/src/nodeClient.ts`:
   - `previewPipe(nodeUrl: string, jwt: string, pipeId: string, entities: Entity[]): Promise<Entity[]>`
   - Uses the Node `https` module (no extra deps) to `POST /api/pipes/{pipeId}/preview`.
   - `fetchEntities(nodeUrl: string, jwt: string, datasetId: string, limit?: number): Promise<Entity[]>`
   - Uses `GET /api/datasets/{id}/entities?limit=N` with `since` cursor for pagination.
2. In `PreviewPanel`, when `mode === 'live'`:
   - Replace the `evaluate(rules, inputEntity)` call with `nodeClient.previewPipe(...)`.
   - Extract `pipe-id` from `_id` in the active document to build the API URL.
   - Evaluation now sends the full entity array (all embedded/testdata entities, or just the selected one).
   - Add a "Refresh" button and auto-refresh on pipe save.
3. Cache the last response per pipe-id in memory; invalidate on refresh or pipe change.

### Phase C: Input Entity Sourcing for Live Mode

When `mode === 'live'`, the input entities are sourced as follows (same priority as offline mode):
1. `source.type === "embedded"` → use inline `entities` array
2. `testdata/<pipe-id>.json` → load from workspace filesystem (already implemented for offline mode)
3. Manual input → use what the user has typed in the textarea

All entities are sent as the request body array; the API returns one output per input.

### Phase D: Error Handling & UX Polish

1. Show a spinner in the preview panel while the API call is in flight.
2. Display node-side errors (HTTP 401, 403, network timeout, 400 DTL error) as styled banners inside
   the webview, preserving the error `message` from the response body.
3. Truncate entity lists with a "Load more" button (default limit 50 entities).
4. Add "Copy entity JSON" button per row in the entity list view.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `client/src/preview/PreviewPanel.ts` | Mode toggle, toolbar, live-mode evaluation path |
| `client/src/nodeClient.ts` (new) | `previewPipe()` → `POST /api/pipes/{id}/preview`; `fetchEntities()` → `GET /api/datasets/{id}/entities` |

> **Note**: The `DatasetResolver` abstraction and changes to `dtl-evaluator.ts` are **no longer needed**
> for live mode — the node evaluates the full pipe server-side. The offline evaluator stays as-is for
> `mode === 'offline'`.

---

## Dependencies

- **F03** - node URL + JWT must be available via credential manager
- **F01** Phase A (node connectivity established in-process)
- Existing `PreviewPanel` offline functionality must remain intact when `mode === 'offline'`
