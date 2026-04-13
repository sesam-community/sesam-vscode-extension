# F04: Node-Connected Live Preview

> **Status**: `implemented`
> **Rollout Phase**: Phase 3 - Node Connectivity
> **Tracking**: [README.md](README.md)

---

## Summary

The existing offline Pipe Preview panel (`client/src/preview/PreviewPanel.ts`) evaluates DTL locally using
the built-in `dtl-evaluator.ts`. The offline evaluator cannot handle `hops`, `apply-hops`,
`lookup-entity`, datetime functions, URL encoding, encryption, or `_B` (HTTP request context) — it
emits a warning and returns `null` for all of these.

This feature adds a **Live** mode that replaces the offline evaluation path with a call to the Sesam
node's pipe preview API, giving exact, node-side evaluation for all DTL functions:

```
POST https://{node-url}/api/pipes/{pipe-id}/preview
```

The offline evaluator stays intact and remains the default. Live mode is opt-in via a toggle button.

---

## Current State of `PreviewPanel`

- Two-pane layout: editable input entity (left) / read-only output (right)
- Entity navigation bar (shown when `source.type === "embedded"` has multiple entities)
- Offline evaluation via `dtl-evaluator.ts` only — no HTTP calls
- Settings `sesam.nodeUrl` and `sesam.jwt` already exist in `package.json` but are not yet read
- No `testdata/<pipe-id>.json` file loading (planned but not implemented for offline mode either)

---

## API Contract

### Preview Endpoint
```
POST https://{node-url}/api/pipes/{pipe-id}/preview
Authorization: Bearer {jwt}
Content-Type: application/json
```

**Request body** — array of input entities (`_S`):
```json
[{ "_id": "...", ... }]
```

**Response** — array of output entities (`_T`), one per input (empty if entity is discarded by a filter):
```json
[{ "_id": "...", ... }]
```

Errors: HTTP 4xx/5xx with JSON body `{ "message": "..." }`.

### Dataset Entities Endpoint
```
GET https://{node-url}/api/datasets/{dataset-id}/entities?limit=50&since={_ts}
Authorization: Bearer {jwt}
```

**Response** — array of entities; use `_ts` of the last entity as the `since` cursor for pagination.

---

## Implementation Phases

### Phase 1 — Node HTTP Client + Basic Live Evaluation (MVP)

#### Step 1: Create `client/src/node-client.ts`

Pure-function HTTP client. No extra npm dependencies — use Node.js built-in `https`/`http` modules.

**Typed error classes:**

| Class | Trigger |
|---|---|
| `NodeAuthError` | HTTP 401 or 403 |
| `NodeApiError` | HTTP 4xx/5xx (other); carries `.message` from response body |
| `NodeNetworkError` | DNS failure, timeout, connection refused |

**Exported functions:**

```ts
previewPipe(
  nodeUrl: string, jwt: string, pipeId: string, entities: Entity[]
): Promise<Entity[]>
// POST {nodeUrl}/api/pipes/{pipeId}/preview
// Authorization: Bearer {jwt}, Content-Type: application/json
// Body: JSON-serialised entity array; returns parsed response array

fetchDatasetEntities(
  nodeUrl: string, jwt: string, datasetId: string, limit?: number
): Promise<Entity[]>
// GET {nodeUrl}/api/datasets/{datasetId}/entities?limit={limit ?? 50}
// Returns parsed entity array; caller uses _ts of last entity as next `since` cursor

getDataset(
  nodeUrl: string, jwt: string, datasetId: string
): Promise<Entity[]>
// Equivalent to sesam get-dataset: dumps all entities from a dataset
// GET {nodeUrl}/api/datasets/{datasetId}/entities (paginated via _ts cursor)
// Corresponds to sesam-py `get-dataset <dataset-id>` command

putDataset(
  nodeUrl: string, jwt: string, datasetId: string, entities: Entity[]
): Promise<void>
// Equivalent to sesam put-dataset: replaces all entities in a dataset
// POST {nodeUrl}/api/receivers/{datasetId}/entities
// Content-Type: application/json; body: JSON-serialised entity array
// Corresponds to sesam-py `put-dataset <dataset-id>` command
```

URL validation: reject non-HTTPS unless host is `localhost` or `127.0.0.1`.

**Relevant files:**
- `client/src/node-client.ts` — **new file**
- `tests/node-client.test.ts` — **new test file** (mock `https.request`, verify URL, auth header, error mapping)

#### Step 2: Create `client/src/credential-resolver.ts`

Single integration point for credential resolution. Future F03 SecretStorage support is added here only.

```ts
resolveCredentials(): { nodeUrl: string; jwt: string } | null
// Reads sesam.nodeUrl and sesam.jwt from vscode.workspace.getConfiguration()
// Returns null if either setting is empty
```

**Relevant files:**
- `client/src/credential-resolver.ts` — **new file**
- `tests/credential-resolver.test.ts` — **new test file** (mock `getConfiguration`, verify null return when empty)

#### Step 3: Add Live Mode toggle to `PreviewPanel`

**Extension host changes (`PreviewPanel.ts`):**

1. Add `private _mode: 'offline' | 'live'` field. Load from and persist to
   `context.workspaceState` under key `sesam.previewMode`.
2. Accept `context: vscode.ExtensionContext` in constructor (needed for `workspaceState`).
   Update `createOrShow()` signature and `extension.ts` call-site accordingly.
3. Handle new inbound webview message `{ type: "toggleMode" }`:
   - Flip `_mode`, persist to `workspaceState`.
   - Resolve credentials via `resolveCredentials()`.
   - Post `{ type: "modeChanged", mode, hasCredentials: boolean }` back to webview.
4. When `{ type: "evaluate" }` arrives and `_mode === 'live'`:
   - Extract `pipeId` from the document's `_id` field (reuse existing JSON parse in `_sendDocumentState`).
   - Call `resolveCredentials()`. If null, post `{ type: "modeChanged", mode: "live", hasCredentials: false }`.
   - Otherwise call `previewPipe(nodeUrl, jwt, pipeId, [inputEntity])`.
   - Post `{ type: "liveResult", entities: Entity[] }` on success or `{ type: "liveError", ... }` on failure.

**Webview HTML changes:**

- Add a mode toggle button in the header bar (after the file name, before "Evaluate"):
  - Offline: `🔌 Offline` — secondary-style button
  - Live: `🌐 Live` — primary-style button (highlighted)
- Credential warning banner (hidden by default): yellow bar shown when `hasCredentials === false` in live mode.
  Text: *"Set `sesam.nodeUrl` and `sesam.jwt` in Settings to enable Live mode."*
  Includes an `<a href="#" onclick="openSettings()">Open Settings</a>` link that posts
  `{ type: "openSettings" }` to the host.
- Spinner CSS class on the output pane while `_loading === true`.

**New webview → host messages:**

| Message | Trigger |
|---|---|
| `{ type: "toggleMode" }` | User clicks the mode toggle button |
| `{ type: "openSettings" }` | User clicks the credential warning "Open Settings" link |

**New host → webview messages:**

| Message | Purpose |
|---|---|
| `{ type: "modeChanged", mode, hasCredentials }` | Sent after toggle or on panel open |
| `{ type: "liveResult", entities }` | Live evaluation succeeded |
| `{ type: "liveError", kind, message }` | Live evaluation failed; `kind`: `"auth"` \| `"api"` \| `"network"` |

**Relevant files:**
- `client/src/preview/PreviewPanel.ts` — modify class + HTML
- `client/src/extension.ts` — pass `context` to `PreviewPanel.createOrShow()`

#### Step 4: Extend Entity Sourcing

Add `testdata/<pipe-id>.json` loading to both modes (was missing from offline too), and auto-fetch
from the node dataset API in live mode when no local test data is available.

**Entity resolution priority (both modes):**

1. `source.type === "embedded"` → use inline `entities` array (existing)
2. Workspace file `testdata/{pipeId}.json` → load with `vscode.workspace.findFiles()` + `readFile()`
   → populate entity navigation slider; show label `"testdata"` in the nav bar
3. *(Live mode only)* Neither of the above found **and** `source.dataset` is set → call
   `fetchDatasetEntities(nodeUrl, jwt, source.dataset)` to seed the slider from the node
4. Fallback → user types manually in the textarea (unchanged)

**New private helper in `PreviewPanel`:**

```ts
private async _loadTestdataEntities(pipeId: string): Promise<Entity[] | null>
// vscode.workspace.findFiles(`**/testdata/${pipeId}.json`, null, 1)
// Returns parsed content or null if not found / parse error
```

**Relevant files:**
- `client/src/preview/PreviewPanel.ts` — new `_loadTestdataEntities()` + updated `_sendDocumentState()`

---

### Phase 2 — Error Handling & UX Polish

#### Step 5: Structured Error Display

Map typed errors from `node-client.ts` to styled banners in the webview:

| Error | Banner colour | Message |
|---|---|---|
| `NodeAuthError` | Red | `Authentication failed (HTTP 401). Check your JWT in Settings.` + "Open Settings" |
| `NodeApiError` | Red | `Node error: {message}` (preserves Sesam node response body `message`) |
| `NodeNetworkError` | Red | `Cannot reach node at {url}. Check sesam.nodeUrl.` |

Add CSS `status-bar.loading` state with a spinner (CSS `@keyframes spin`).

#### Step 6: Auto-Refresh on Save

- Subscribe to `vscode.workspace.onDidSaveTextDocument` in `PreviewPanel`.
- If the saved file URI matches the currently previewed document, re-trigger evaluation in the current mode.
- Debounce: 300 ms delay to avoid rapid re-fires on consecutive saves.
- Add an "Auto" checkbox in the header bar (persisted per-workspace in `workspaceState` under
  `sesam.previewAutoRefresh`). Default: `false`.

#### Step 7: Copy Entity JSON Buttons

- Add a `⧉ Copy` icon button in the output pane header.
  - Sends `{ type: "copyOutput" }` to the extension host → `vscode.env.clipboard.writeText(outputJson)`.
- Add a small `⧉` inline button in the entity navigation bar next to the entity counter.
  - Copies the current input entity JSON to clipboard using the same host-relay pattern.

---

### Phase 3 — Dataset Entity Browser (Beyond MVP)

#### Step 8: Fetch & Browse Source Entities from Node

When live mode is active and the pipe source is a `"dataset"` (non-embedded) type with no local
`testdata/` file, show a **"Fetch from node"** button in the entity navigation bar.

Behaviour:
1. On click: `fetchDatasetEntities(nodeUrl, jwt, source.dataset, 50)` → populate entity slider.
2. Show entity count label `"Entity 3 / 50 (from node)"` to distinguish from local data.
3. "Load more" button fetches the next page using `since` = `_ts` of the last fetched entity.
4. Fetched entities cached in memory per pipe-id. Cache invalidated on mode toggle or pipe switch.

#### Step 9: Send Full Config with Preview Request

Investigate whether the Sesam preview API accepts a `config` field alongside the entity array,
allowing evaluation of the **current (unsaved) editor content** without requiring an upload first.

If supported:
- Add the current document's parsed JSON as a `config` property in the request body.

If not supported:
- When the API returns 404 (pipe not found), surface a warning banner:
  *"Pipe not found on node. Upload it first, or switch to Offline mode."*

---

### Phase 4 — Advanced Features (Post-MVP)

#### Step 10: Side-by-Side Offline vs Live Comparison

Add a **"Compare"** button that runs both offline and live evaluation on the same input entity
simultaneously (`Promise.allSettled`) and renders a diff-style view:

- Two output columns: `Offline` and `Live` (instead of one output pane).
- Fields that differ are highlighted with a coloured background.
- Useful for validating that the offline evaluator produces the same result as the node, or for
  identifying which functions are unsupported offline.

#### Step 11: F03 Credential Manager Integration

Extend `credential-resolver.ts` to also check VS Code `SecretStorage` before falling back to
settings. When F03 Phase A is implemented:

```ts
resolveCredentials(context: vscode.ExtensionContext): Promise<{ nodeUrl: string; jwt: string } | null>
// 1. nodeUrl: read sesam.nodeUrl setting (not a secret)
// 2. jwt: context.secrets.get('sesam.jwt.<activeProfile>') ?? settings['sesam.jwt']
```

The `PreviewPanel` constructor already receives `context`, so the only change is in `credential-resolver.ts`.

---

## Files to Modify / Add

| File | Action |
|---|---|
| `client/src/node-client.ts` | **New** — `previewPipe()`, `fetchDatasetEntities()`, typed error classes |
| `client/src/credential-resolver.ts` | **New** — `resolveCredentials()` reading `sesam.nodeUrl` + `sesam.jwt` |
| `client/src/preview/PreviewPanel.ts` | **Modify** — live toggle, live eval path, entity sourcing, auto-refresh, copy buttons, error display |
| `client/src/extension.ts` | **Modify** — pass `context` to `PreviewPanel.createOrShow()` |
| `tests/node-client.test.ts` | **New** — unit tests for HTTP client |
| `tests/credential-resolver.test.ts` | **New** — unit tests for credential resolution |
| `package.json` | No changes — `sesam.nodeUrl` and `sesam.jwt` settings already declared |

> **Note**: `dtl-evaluator.ts` is not modified. The offline evaluator stays exactly as-is.

---

## Dependencies

- **`sesam.nodeUrl` + `sesam.jwt` settings** — already declared in `package.json`; no F03 prerequisite for Phase 1
- **F03** (SecretStorage) — adds Step 11 on top of Phase 1; Phase 1 works without it
- Existing `PreviewPanel` offline functionality must remain intact when `mode === 'offline'`

## Relationship to `@sesam/core` (F00)

`previewPipe()` and `fetchDatasetEntities()` are Sesam node API calls that logically belong in
`@sesam/core` (alongside the planned `uploadPipes`, `runPipe`, `getStatus`, etc.). However, F00 is
currently a placeholder and is a separate, large body of work.

**For this impl**, the two functions are built in `client/src/node-client.ts` inside the extension.
When F00 is eventually implemented:
- The node API functions migrate into `@sesam/core`.
- `node-client.ts` becomes either a thin re-export wrapper or is deleted, with the extension importing
  from `@sesam/core` directly.

`credential-resolver.ts` stays in the extension regardless — it reads VS Code settings/SecretStorage,
which is UI-layer infrastructure not suitable for a pure library.

**F04 does not depend on F00.** The extension can call the Sesam REST API directly without any
sesam-py bundling work.

---

## Verification

| Test | Method |
|---|---|
| `node-client.ts` HTTP calls | Unit — mock `https.request`, verify URL/headers/body/error mapping |
| `credential-resolver.ts` | Unit — mock `vscode.workspace.getConfiguration`, verify null when empty |
| Offline mode regression | Manual — embedded pipe, existing evaluation unchanged |
| Live mode (hops) | Manual — pipe with `hops`: offline shows warning, live shows real result |
| No credentials | Manual — toggle to Live with empty settings → yellow banner → "Open Settings" works |
| Auth error | Manual — invalid JWT → red 401 banner |
| Auto-refresh | Manual — enable "Auto", save pipe, output re-evaluates |
| `pnpm build` | CI — must exit 0 |
