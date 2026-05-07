# Large Workspace Optimization (1k+ pipes)

> **Status**: `phase 2 implemented`
> **Rollout Phase**: Cross-cutting
> **Tracking**: [README.md](../impl/README.md)

---

## Problem Statement

When a workspace contains 1 000+ pipe config files, two classes of symptoms appear:

1. **VS Code becomes unresponsive** — Ctrl+P / Quick Open never opens (extension host blocks the
   VS Code render thread).
2. **Extension features stop working** — Pipe Preview, Node Status panel, DAG tree views, and
   Sync Status all fail or time out.

Both symptoms have the same root cause: every expensive workspace scan runs unconditionally,
synchronously (in the LSP server), or with no debouncing/coalescing — causing cascading work that
saturates the extension host event loop for several seconds on every file-change event.

---

## Root Cause Analysis

### B1 — Full DAG rebuild on every file event (no debouncing)

**File**: `client/src/extension.ts` — `rescanDag()` / file watchers

```ts
// Current: every single file write fires a full rescan
watcher.onDidCreate(() => { rescanDag(); });
watcher.onDidChange(() => { rescanDag(); });
watcher.onDidDelete(() => { rescanDag(); });
```

`buildDagFromWorkspace()` calls `vscode.workspace.findFiles("**/*.{json,conf.pipe,…}")` then
`Promise.all(files.map(readFile + JSON.parse))` — reading and parsing all 1k+ files concurrently
on every keystroke autosave.

**Impact**: extension host saturated; Ctrl+P blocked; tree views fire `refresh()` on stale data
that is immediately overwritten by the next rescan.

---

### B2 — Overly broad `findFiles` glob in `buildDagFromWorkspace`

**File**: `client/src/extension.ts` — `buildDagFromWorkspace()`

```ts
const files = await vscode.workspace.findFiles(
  "**/*.{json,conf.pipe,conf.system,conf.json}",
  "**/node_modules/**",
);
```

Matches **every** `.json` file in the workspace — `package.json`, `tsconfig.json`, test fixtures,
`language-configuration.json`, etc. All are read and parsed even though 99 % of them are not Sesam
configs. With 1k+ pipe files the total I/O and parse budget is dominated by this one call.

---

### B3 — Synchronous file scan in LSP server workspace index

**File**: `server/src/utils/workspace-index.ts` — `scanDirectory()`

```ts
const scanDirectory = (dirPath: string): void => {
  const entries = fs.readdirSync(dirPath, { withFileTypes: true }); // SYNC
  for (const entry of entries) {
    // …
    text = fs.readFileSync(filePath, "utf-8"); // SYNC
  }
};
```

`readdirSync` + `readFileSync` on 1k+ files blocks the LSP server Node.js event loop for hundreds
of milliseconds at activation. Because the client and server communicate over IPC, the client's
`await client.start()` resolves late — delaying the rest of `activate()`.

---

### B4 — `findFiles` on every "open local file" / diff action

**Files**: `client/src/node-status/node-status-panel.ts`, `client/src/extension.ts`

```ts
// Called every time a pipe row is clicked in the NodeStatusPanel:
const all = await vscode.workspace.findFiles("**/{pipes,systems}/**", "**/node_modules/**");
const match = all.find((uri) => …);
```

With 1k+ files, this is O(N) file discovery + O(N) linear search on every user click. The result
is never cached; each click scans the workspace from scratch.

---

### B5 — LSP document selector matches all JSON files under `pipes/` and `systems/`

**File**: `client/src/extension.ts` — `clientOptions.documentSelector`

```ts
{ scheme: "file", language: "json", pattern: "**/{pipes,systems}/**/*.json" }
```

VS Code registers every matching file with the language server. At startup the server receives
`onDidOpen` for every file VS Code has previously opened in the editor — potentially hundreds.
For each, it runs `validateCalls`, `validateStructure`, `validatePathStrings`,
`validateConfigStructure`, cross-reference checks, and `workspaceIndex.indexFile` — all serially.

---

### B6 — `PipeGraphProvider.scanWorkspace()` glob is too broad

**File**: `client/src/graph/PipeGraphProvider.ts`

```ts
const files = await vscode.workspace.findFiles(`**/*.json`, `**/node_modules/**`);
```

No restriction to `pipes/` or `systems/` — reads all `.json` files in the workspace.

> Note: `PipeGraphProvider` is the legacy sidebar tree (not the newer DAG providers).
> It still runs on first expansion, contributing to startup I/O.

---

### B7 — NodeStatusPanel renders 1k+ rows as a single DOM pass

**File**: `client/src/node-status/node-status-panel.ts` + the associated WebView HTML

The panel builds one `<tr>` per pipe in a single synchronous HTML string concatenation and injects
it via `panel.webview.html = …`. In a browser/webview context this causes a multi-second layout
and paint pass, freezing the webview panel.

---

### B8 — SyncStatus refresh fires unconditionally at startup and on every save

**File**: `client/src/extension.ts`

```ts
setTimeout(() => refreshSyncStatusSilently(), 3_000); // fires 3 s after activation
```

`refreshSyncStatusSilently` calls `runner.syncStatus(…, workspaceDir)` which compares all local
files against all node configs — proportional to the number of pipes. With 1k+ pipes this takes
several seconds and keeps the network connection busy, delaying all other node requests.

---

## Proposed Optimizations

### O1 — Debounce DAG rescans (High Impact, Low Effort)

**Target**: `client/src/extension.ts` — file watcher callbacks

Replace the immediate `rescanDag()` call with a leading-edge debounce:

```ts
let _dagDebounceTimer: ReturnType<typeof setTimeout> | undefined;

const scheduleDagRescan = (): void => {
  clearTimeout(_dagDebounceTimer);
  _dagDebounceTimer = setTimeout(() => rescanDag(), 1_500);
};

watcher.onDidCreate(scheduleDagRescan);
watcher.onDidChange(scheduleDagRescan);
watcher.onDidDelete(scheduleDagRescan);
confWatcher.onDidCreate(scheduleDagRescan);
confWatcher.onDidChange(scheduleDagRescan);
confWatcher.onDidDelete(scheduleDagRescan);
```

A 1 500 ms trailing debounce means a `sesam download` (which writes 1k+ files) fires exactly
**one** rescan instead of 1 000+. This alone eliminates 99 % of the post-download lock-up.

---

### O2 — Narrow the `buildDagFromWorkspace` glob (High Impact, Low Effort)

**Target**: `client/src/extension.ts` — `buildDagFromWorkspace()`

Restrict to Sesam file extensions only, and scope to the `pipes/` and `systems/` folders:

```ts
const files = await vscode.workspace.findFiles(
  "**/{pipes,systems}/**/*.{json,conf.pipe,conf.system,conf.json}",
  "**/node_modules/**",
);
```

This excludes `package.json`, `tsconfig.json`, fixture files, etc. For a workspace with 1k pipe
files and 200 other JSON files, this reduces the file set from ~1 200 to ~1 000 — and more
importantly prevents unnecessary I/O for non-Sesam files.

Also apply the same narrowing to `PipeGraphProvider.scanWorkspace()` (B6):

```ts
// Before
const files = await vscode.workspace.findFiles(`**/*.json`, `**/node_modules/**`);
// After
const files = await vscode.workspace.findFiles(
  "**/{pipes,systems}/**/*.json",
  "**/node_modules/**",
);
```

---

### O3 — Incremental DAG update on single-file change (Medium Impact, Medium Effort)

**Target**: `client/src/extension.ts` — `rescanDag()` + `buildDagFromWorkspace()`

Instead of always doing a full rescan, detect when only one file changed and perform a surgical
update:

```ts
// Watcher callbacks receive the changed URI
watcher.onDidChange((uri) => scheduleDagRescan(uri));
watcher.onDidCreate((uri) => scheduleDagRescan(uri));
watcher.onDidDelete((uri) => scheduleDagRescan(uri));
```

`buildDagFromWorkspace` gains an optional `changedUri` parameter. When supplied it:

1. Removes the old `FullPipeInfo` for that URI from the existing `dagRef.current`.
2. Reads and re-parses only the changed file.
3. Re-inserts the updated entry.
4. Re-runs `buildDagIndex` only over the delta.

Full rescans are still performed at startup and when the `dtl.refreshDag` command is invoked
explicitly.

**Prerequisite**: O1 (debounce) must land first so single-file rescans are not triggered 50 times
during a save burst.

---

### O4 — Async workspace-index scan in LSP server (High Impact, Low Effort)

**Target**: `server/src/utils/workspace-index.ts` — `scanDirectory()`

Replace `fs.readdirSync` / `fs.readFileSync` with async equivalents
(`fs.promises.readdir` / `fs.promises.readFile`). This yields control back to the Node.js event
loop between I/O operations, preventing the LSP process from blocking IPC message handling during
startup.

```ts
const scanDirectory = async (dirPath: string): Promise<void> => {
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) { … await scanDirectory(…); }
    else {
      const text = await fs.promises.readFile(filePath, "utf-8");
      indexFileText(uri, text);
    }
  }
};
```

Expose a public `scanWorkspaceAsync` and call it from `onInitialized` handler in `server.ts`
instead of the current synchronous inline scan.

---

### O5 — Cache the local file URI map for "open local file" lookups (Medium Impact, Low Effort)

**Target**: `client/src/node-status/node-status-panel.ts` + relevant `extension.ts` sections

Build and cache a `Map<string, vscode.Uri>` from pipe id → local file URI the first time it is
needed (or reuse the DAG index already built by `buildDagFromWorkspace`):

```ts
// In NodeStatusPanel:
private _localFileCache: Map<string, vscode.Uri> | null = null;

private async resolveLocalFile(pipeId: string): Promise<vscode.Uri | undefined> {
  if (!this._localFileCache) {
    const all = await vscode.workspace.findFiles("**/{pipes,systems}/**", "**/node_modules/**");
    this._localFileCache = new Map(
      all.map((uri) => {
        const base = path.basename(uri.fsPath);
        const id = CONFIG_EXTS.reduce((s, ext) => s.replace(new RegExp(`${ext}$`), ""), base);
        return [id, uri];
      }),
    );
  }
  return this._localFileCache.get(pipeId);
}
```

Invalidate the cache on file-system watcher events. Since the DAG index already contains
`fileUri` for each pipe, the `DagIndex.byId` map can serve as the canonical source instead of
re-scanning.

---

### O6 — Virtual scrolling / pagination in NodeStatusPanel (Medium Impact, Medium Effort)

**Target**: `client/src/node-status/node-status-panel.ts` WebView HTML generation

When pipe count > 500:

- Render only the first 200 rows initially.
- Add an "infinite scroll" sentinel at the bottom — when it enters the viewport, append the next
  200 rows.
- Alternatively, show a pagination control ("Showing 1–200 of 1 247 pipes").

The filter/search box already exists; server-side filtering should reduce the visible set before
pagination applies.

**Alternative (simpler)**: add a `sesam.nodeStatus.pageSize` setting (default `500`) and show a
"Load more" button. Simple, low-risk, unblocks the panel for most users without a full virtual DOM
implementation.

---

### O7 — Lazy / on-demand SyncStatus (Medium Impact, Low Effort)

**Target**: `client/src/extension.ts` — `refreshSyncStatusSilently()`

Remove the unconditional 3-second startup refresh:

```ts
// Remove this line:
setTimeout(() => refreshSyncStatusSilently(), 3_000);
```

Only populate `SyncStatusProvider` when:

1. The user explicitly runs `sesam.showStatus`.
2. A download or upload completes successfully.
3. The user saves a file **and** the Sync Status tree view is currently **visible** (check
   `syncStatusView.visible`).

This avoids a network round-trip for every activation, which is particularly expensive when the
node is hibernated (triggers the provisioning flow).

---

### O8 — Throttle LSP diagnostics at activation (Low Impact, Medium Effort)

**Target**: `server/src/server.ts` — `onDidOpen` / `connection.onInitialized`

At startup the LSP server receives `onDidOpen` for every file VS Code has open. Each triggers
validation. With 1k+ files open, this queues 1k+ sequential validation runs.

Add a concurrency limiter (e.g. `p-limit` with concurrency `4`) around validation tasks at
initialisation time. Documents already open in the active editor always run first; background
files run at limited concurrency.

```ts
import pLimit from "p-limit";
const limit = pLimit(4);

// In onDidOpen handler:
void limit(() => validateDocument(document));
```

> This requires adding `p-limit` as a dependency or implementing a lightweight queue manually
> (prefer manual implementation to avoid an extra bundle dep).

---

## Implementation Priority

| # | Optimization | Effort | Impact | Fixes |
|---|---|---|---|---|
| O1 | Debounce DAG rescans | XS | Critical | B1 |
| O2 | Narrow `findFiles` glob | XS | High | B2, B6 |
| O4 | Async workspace-index scan | S | High | B3 |
| O7 | Lazy SyncStatus | XS | Medium | B8 |
| O5 | Cache local file URI map | S | Medium | B4 |
| O3 | Incremental DAG update | M | High | B1 (full fix) |
| O6 | Virtual scroll in NodeStatusPanel | M | Medium | B7 |
| O8 | Throttle LSP diagnostics | M | Low | B5 |

**Recommended Phase 1** (land together, < 1 day): O1, O2, O4, O7 — these are all small,
independent changes and together eliminate the Ctrl+P freeze and the startup I/O avalanche.

**Recommended Phase 2**: O5, O3 — incremental DAG update requires careful testing against the
existing DAG test suite.

**Recommended Phase 3**: O6, O8 — UI and LSP plumbing changes, more effort, lower urgency.

---

## Files Touched

| File | Changes |
|---|---|
| `client/src/extension.ts` | O1 (debounce), O2 (glob), O3 (incremental), O5 (cache), O7 (lazy sync) |
| `client/src/graph/PipeGraphProvider.ts` | O2 (narrow glob) |
| `client/src/node-status/node-status-panel.ts` | O5 (cache), O6 (pagination) |
| `server/src/utils/workspace-index.ts` | O4 (async scan) |
| `server/src/server.ts` | O4 (call async scan), O8 (throttle) |

---

## Acceptance Criteria

- Opening a workspace with 1 000 pipe configs: Ctrl+P responds within 1 second of extension
  activation.
- Saving a single file in the workspace: DAG rescan completes within 2 seconds and does not block
  the UI.
- Clicking "Open local file" in NodeStatusPanel: file opens within 500 ms.
- `sesam download` (writes 1k files): triggers exactly one DAG rescan, not one per file.
- NodeStatusPanel with 1k pipes: the panel opens and renders the first 200 rows within 2 seconds.
- LSP server activation with 1k files in workspace: no observable freeze of the extension host
  during the first 10 seconds.
