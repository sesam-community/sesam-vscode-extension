# F30: Preview Panel — Entity Search (ID / Text)

> **Status**: `planned`
> **Rollout Phase**: Phase 3 – Node Connectivity
> **Depends on**: F04 (Node-Connected Live Preview), F03 (Secure Credential Management)
> **Tracking**: [README.md](README.md)

---

## Summary

Add a search bar to the **Preview panel** top bar that lets users locate a specific source entity
by **ID** (exact match) or **Text** (substring match).

The search bar is only rendered when the pipe's source resolves to a concrete dataset — i.e. when
`source.type === "dataset"` or `source.type === "binary"` (same condition that controls the
`DatasetNavigator` component in the web console). For all other source types the top bar remains
unchanged.

When a match is found the entity is loaded into the left (input) pane and the right (output) pane
is re-evaluated live.

---

## Reference — Web Console Behaviour

`pipe-preview-panel/index.jsx` renders `<DatasetNavigator>` in the top bar when `sourceDataset`
is truthy:

```jsx
const sourceDataset = useMemo(() => {
  if (sourceType === 'dataset') {
    // single-dataset source only
    return sourceDatasetIds.length === 1 ? sourceDatasetIds[0] : null;
  } else if (sourceType === 'binary') {
    const splitUrl = url.split('/');
    if (splitUrl.includes('datasets')) {
      return splitUrl[splitUrl.indexOf('datasets') + 1];
    }
    return splitUrl[0];
  }
}, [sourceDatasetIds, url, sourceType]);
```

`DatasetNavigatorFilter.jsx` exposes two radio-button search modes:

| Mode | Label | Behaviour |
|---|---|---|
| `id` | **Id** | Exact match on `_id` (and `$ids` if indexed) via Sesam search API |
| `freetext` | **Text** | Substring scan of entity JSON — done client-side by a Web Worker in the console |

Only these two modes are required in the VS Code extension. Jump / Browse / Filter controls are
**out of scope**.

---

## API Contracts

### ID search
```
GET {nodeUrl}/api/datasets/{datasetId}/search?id={encodedEntityId}
Authorization: Bearer {jwt}
```
Returns an array of matching entity objects. An empty array means no match.

### Text search (client-side)
Stream pages of entities via the existing `fetchDatasetEntities` function
(`client/src/node-client.ts`) and filter each page in the extension host before forwarding the
first match to the webview.

```
GET {nodeUrl}/api/datasets/{datasetId}/entities?limit=200&since={cursor}
Authorization: Bearer {jwt}
```

Scan continues until a match is found or all entities are exhausted (safety cap: 10 000 entities).

---

## Implementation Phases

### Phase A — Node client: `searchDatasetById`

**File**: `client/src/node-client.ts`

Add a new exported function:

```ts
searchDatasetById(
  nodeUrl: string,
  jwt: string,
  datasetId: string,
  entityId: string,
  logger?: NodeRequestLogger,
): Promise<Entity[]>
// GET {nodeUrl}/api/datasets/{datasetId}/search?id={encodedEntityId}
// Returns parsed entity array (empty = no match).
```

**Relevant files**:
- `client/src/node-client.ts` — add `searchDatasetById`
- `tests/node-client.test.ts` — add unit test: mock `https.request`, verify URL construction and
  empty-array on 404 response

---

### Phase B — Node client: `searchDatasetByText`

**File**: `client/src/node-client.ts`

Add a new exported function:

```ts
searchDatasetByText(
  nodeUrl: string,
  jwt: string,
  datasetId: string,
  query: string,
  maxEntities?: number,    // default 10 000
  logger?: NodeRequestLogger,
): Promise<Entity | null>
// Pages through GET /api/datasets/{datasetId}/entities (limit=200 per page)
// and returns the first entity whose JSON representation contains `query` as a
// case-insensitive substring.  Returns null when no match is found within
// maxEntities.
```

The implementation calls `fetchDatasetEntities` in a loop, advancing the `since` cursor
(`_ts` of the last entity on each page) until a match is found or entities are exhausted.

**Relevant files**:
- `client/src/node-client.ts` — add `searchDatasetByText`
- `tests/node-client.test.ts` — unit tests: single-page match, multi-page match, no match within cap

---

### Phase C — Preview panel: webview ↔ host messages

**File**: `client/src/preview/preview-panel.ts`

#### New inbound message types

Extend `MessageFromWebview`:

```ts
| { type: "searchEntity"; searchType: "id" | "text"; query: string }
```

#### New outbound message types

These are already handled in the webview HTML — add them to the host:

```ts
| { type: "searchResult"; entity: Entity }
| { type: "searchError"; message: string }
| { type: "searchNoMatch" }
| { type: "searchLoading" }
```

#### Handler (`_handleMessage`)

When `{ type: "searchEntity" }` arrives:

1. Resolve credentials via `resolveCredentials()`. If null, post `searchError`.
2. Extract `sourceDataset` from the document using `extractSourceDataset(text)`.
   - If null (source is not `dataset`/`binary` type), post `searchError`.
3. Post `{ type: "searchLoading" }` to the webview.
4. Dispatch based on `searchType`:
   - `"id"`: call `searchDatasetById(...)`. If the result array is non-empty, post
     `searchResult` with the first entity. Otherwise post `searchNoMatch`.
   - `"text"`: call `searchDatasetByText(...)`. If a match is returned, post `searchResult`.
     Otherwise post `searchNoMatch`.
5. On any node error, post `searchError` with the error message.

When `searchResult` arrives in the **webview**, load the entity into the input pane and trigger
live evaluation (same as manually editing the input).

**Relevant files**:
- `client/src/preview/preview-panel.ts` — extend `MessageFromWebview`, add handler

---

### Phase D — Webview HTML: search bar UI

**File**: `resources/preview.html`

#### Condition for rendering

The search bar is only shown when the webview receives a `documentState` message that includes
a truthy `sourceDataset` field. Add `sourceDataset` to the `documentState` message payload sent
by `_sendDocumentState()`.

`_sendDocumentState` already calls `extractSourceDataset(text)` internally — expose it:

```ts
this._panel.webview.postMessage({
  type: "documentState",
  // ... existing fields ...
  sourceDataset: extractSourceDataset(text) ?? null,
});
```

#### UI layout

Insert a search row inside the top bar, conditionally shown:

```
[ Id ● ] [ Text ○]  [___________search query___________] [Search] [✕ clear]
```

- Two radio inputs: `id` (default) / `text`
- Text input (`<input type="text">`) for the query; pressing `Enter` submits
- **Search** button — sends `{ type: "searchEntity", searchType, query }` to the host
- **✕** button — clears the input and resets state
- While `searchLoading` is active: disable the Search button and show a spinner/ellipsis label
- On `searchNoMatch`: show a small inline message `"No match found"`
- On `searchError`: show the error message in the error style already used by `liveError`
- On `searchResult`: the entity is placed into the input editor automatically (no extra UI needed)

**Styling**: match the existing monospace / dark-background webview aesthetic; no external
CSS frameworks are used in `preview.html`.

**Relevant files**:
- `resources/preview.html` — add search bar HTML + JS event wiring
- `client/src/preview/preview-panel.ts` — include `sourceDataset` in `documentState` message

---

## Out of Scope

- Jump-to-sequence / Jump-to-timestamp controls
- Browse filter (Latest / Latest w/ deleted / All)
- ElasticSearch index-based full-text search (requires the `elasticsearch-freetext` system)
- Subset filtering

---

## Tests

| File | What to test |
|---|---|
| `tests/node-client.test.ts` | `searchDatasetById` — URL, empty on no match; `searchDatasetByText` — single-page, multi-page, cap exceeded |

No new tests are required for the webview HTML or preview panel wiring (VS Code API interaction
is not unit-testable without a full integration harness).

---

## Files Touched

| File | Change |
|---|---|
| `client/src/node-client.ts` | Add `searchDatasetById`, `searchDatasetByText` |
| `client/src/preview/preview-panel.ts` | Extend message types, add search handler, expose `sourceDataset` in `documentState` |
| `resources/preview.html` | Add search bar UI |
| `tests/node-client.test.ts` | New tests for search functions |
