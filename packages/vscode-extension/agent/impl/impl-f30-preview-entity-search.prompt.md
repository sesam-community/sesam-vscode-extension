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

### Phase E — JSON Folding (Collapse / Expand) for Input and Output panes

Add VS Code–style JSON folding to both panes so deeply nested entities can be collapsed to a
single line, matching the folding behaviour of the built-in code editor.

---

#### Output pane

The output pane (`<div id="output-box">`) is read-only and currently rendered by `colorizeJson()`
(string → HTML string). Replace it with a new function `renderFoldableJson(value: unknown): Node`
that builds a live DOM tree:

**Rendering rules**

| JSON type | Rendered as |
|---|---|
| Object `{}` | fold-toggle `▼`/`▶` + `{` … `}`, one key-value pair per line, indented |
| Array `[]` | fold-toggle `▼`/`▶` + `[` … `]`, one element per line, indented |
| String | `<span class="json-str">` — same colour as current `colorizeJson` |
| Number / boolean / null | `<span class="json-punct">` |
| Object key | `<span class="json-key">` |

Each foldable node is a `<details>` element (or a custom `<span data-fold>` toggle):

```html
<!-- Expanded -->
<span class="fold-toggle open" title="Collapse">▼</span>{
  "key": "value",
  ...
}

<!-- Collapsed -->
<span class="fold-toggle" title="Expand">▶</span>{ … }
```

Clicking the toggle adds/removes a CSS class `collapsed` on the block; the children `<div>` and
the closing brace are hidden via `display: none`; the inline summary `{ … }` is shown via
`display: inline`.

**Fold All / Expand All** button added to the Output pane header (next to `⧉ Copy`):

```html
<button class="copy-btn" id="fold-output-btn" onclick="toggleFoldAll('output')">⊟ Fold all</button>
```

`toggleFoldAll('output')` collapses every foldable node in the output pane; a second click
expands them all. Button label toggles between `⊟ Fold all` and `⊞ Expand all`.

---

#### Input pane

The input pane is an editable `<textarea>`. Full inline folding of a live textarea requires a
gutter overlay, which is complex. Instead, implement a **dual-mode** approach:

| Mode | UI | When |
|---|---|---|
| **Edit mode** | Current `textarea` + `input-highlight` overlay (unchanged) | Default; user can type |
| **View mode** | Foldable tree (read-only), same renderer as output | User clicks "View" toggle |

A toggle button is added to the Input pane header:

```html
<button class="copy-btn" id="view-mode-btn" onclick="toggleInputViewMode()">⊟ Fold view</button>
```

**Switching to View mode**:
1. Snapshot the textarea value.
2. Parse it as JSON. If invalid, stay in edit mode and show a brief warning.
3. Hide the `input-wrapper` (`textarea` + `input-highlight`).
4. Show a `<div id="input-fold-view">` rendered by `renderFoldableJson(parsedValue)`.
5. Change the button label to `✎ Edit`.

**Switching back to Edit mode**:
1. Hide `#input-fold-view`.
2. Show `input-wrapper` again.
3. Change the button label to `⊟ Fold view`.
4. Call `syncHighlight()` to re-render the highlight overlay.

The textarea value is **never modified** by the View-mode renderer — the fold view is purely
presentational.

**Fold All / Expand All** for the input fold view works identically to the output pane, driven by
the same `toggleFoldAll('input')` helper.

---

#### Shared implementation

**`renderFoldableJson(value, indent = 0): DocumentFragment`**

Recursive function. Produces DOM nodes (not an HTML string) to avoid `innerHTML` injection.
Used by both panes.

```
renderFoldableJson(value, indent):
  if typeof value === 'object' && value !== null:
    open = value is Array ? '[' : '{'
    close = value is Array ? ']' : '}'
    entries = Object.entries(value)  |  array elements
    if entries.length === 0: return text(open + close)
    wrap = <div class="fold-block">
    header = <span>
    toggle = <span class="fold-toggle open">▼</span>
    summary = <span class="fold-summary hidden">…</span>   // shown when collapsed
    header.append(toggle, open, summary)
    body = <div class="fold-body">
    for each entry: body.append(renderFoldableJson(entry.value, indent+1))
    footer = <span class="fold-close">close</span>
    toggle.onclick = () => toggleFold(wrap)
    wrap.append(header, body, footer)
    return wrap
  else:
    return colorSpan(value)
```

**`toggleFold(wrapEl)`**: toggles class `collapsed` on `wrapEl`; hides `.fold-body` and
`.fold-close`; shows `.fold-summary`; updates toggle to `▶` / `▼`.

**CSS additions** (inside `<style>` in `preview.html`):

```css
.fold-toggle {
  cursor: pointer;
  user-select: none;
  font-size: 10px;
  color: var(--vscode-descriptionForeground);
  margin-right: 3px;
  display: inline-block;
  width: 10px;
}
.fold-summary {
  color: var(--vscode-descriptionForeground);
  font-style: italic;
}
.fold-block.collapsed > .fold-body,
.fold-block.collapsed > .fold-close { display: none; }
.fold-block.collapsed > span > .fold-summary { display: inline; }
.fold-summary { display: none; }
#input-fold-view {
  flex: 1;
  padding: 10px;
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: var(--vscode-editor-font-size, 13px);
  background: var(--vscode-editor-background);
  color: var(--vscode-editor-foreground);
  overflow: auto;
  white-space: pre;
  display: none;
}
```

---

#### Files Touched (Phase E)

| File | Change |
|---|---|
| `resources/preview.html` | Add `renderFoldableJson`, `toggleFold`, `toggleFoldAll`, `toggleInputViewMode`; add fold buttons to both pane headers; add `#input-fold-view` div; add CSS for fold controls |

No changes to `preview-panel.ts` or `node-client.ts` are required for Phase E.

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
| `resources/preview.html` | Add search bar UI (Phase D); add foldable JSON renderer + fold controls for both panes (Phase E) |
| `tests/node-client.test.ts` | New tests for search functions |
