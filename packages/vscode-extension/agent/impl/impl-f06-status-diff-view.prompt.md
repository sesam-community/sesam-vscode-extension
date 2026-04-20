# F06: Status / Diff View

> **Status**: `implemented` — all planned phases complete; Phase F (gutter decorations) remains future work
> **Rollout Phase**: Phase 2 - Testing & Diff
> **Tracking**: [README.md](README.md)

---

## Summary

Show what has changed between the local workspace and the remote Sesam node, similar to a git status panel.
Users can see which pipes/systems are locally modified vs the node, and diff or pull individual items.

> **Architecture note:** All operations call `@sesam/core` directly in-process (REST API). There is no
> CLI binary or subprocess involved — the original plan pre-dated the F00 TypeScript rewrite.

---

## Implementation Phases

### Phase A: Sesam Status Command ✅

1. Register `sesam.showStatus` command.
2. On invocation, call `getSyncStatus(creds, workspaceDir)` from `@sesam/core`.
   - Fetches all pipe/system configs from the node via REST API.
   - Reads local `pipes/` and `systems/` directories.
   - Compares using key-order-independent structural JSON diff.
3. Results are a list of `SyncStatusItem` objects, each with:
   - `id`: pipe or system `_id`
   - `kind`: `"pipe"` | `"system"`
   - `state`: `"modified"` | `"node-only"` | `"local-only"`
   - `localPath`: absolute path to the local file (when it exists)
4. Displayed in a `TreeView` (`SyncStatusProvider` in `client/src/status/SyncStatusProvider.ts`):
   - Groups: **Modified**, **Remote Only**, **Local Only**
   - Each group shows the count and is expanded by default.
   - Each leaf item has a tooltip describing the state, e.g. `pipe 'my-id' exists on the node but has no local file`.
5. Refresh button (↻) in the view title reruns `sesam.showStatus`.
6. Auto-populates 3 seconds after extension activation (silent background fetch) — no user action required to see Remote Only items on first open.
7. Auto-refreshes silently after any save of a sesam config file (debounced 500 ms).
8. Auto-refreshes silently after `sesam.download` and `sesam.downloadFile` complete.

### Phase B: Diff Panel ✅

1. Each Modified / Remote Only item has an inline $(diff) button → `sesam.viewDiff`.
2. `sesam.viewDiff` also works from the command palette: shows a quickpick of all diffable items
   from the last loaded status (prompts to run `sesam.showStatus` first if none are loaded).
3. On invocation:
   - Fetches the node-side config via `getNodeConfig(creds, id, kind)` from `@sesam/core`.
   - Formats it with `formatSesamJson` and stores it in an in-memory `SesamNodeConfigProvider`
     under the `sesam-node://` URI scheme.
   - **Modified**: opens VS Code's native diff editor — node version on the left, local file on the right.
   - **Remote Only** (e.g. after `_id` rename): shows a quickpick of all local configs of the same
     kind so the user can manually pair them; escape falls back to read-only view of the node version.

### Phase C: System Status Table ✅

1. `sesam.nodeStatus` panel now has **Pipes** and **Systems** tabs.
2. Systems tab shows a table with columns: **System ID**, **Type**, **Pipes In**, **Pipes Out**, **Config Status**.
   - No run/state/last-run columns (systems are not pumped).
   - **Config Status** badge reflects **Modified** / **Remote Only** / **Local Only** from the cached sync status.
3. Per-row diff icon (same style as pipes) triggers `sesam.viewDiff` for that system.
4. New command `sesam.systemStatus` opens the Node Status panel with the Systems tab pre-selected.
5. `SyncStatusProvider` covers both pipes and systems — `getSyncStatus` already fetches both.
6. `SesamRunner.systemSummaries(creds)` computes `pipesIn` / `pipesOut` from the live node.
7. `NodeStatusPanel.onDiffSystem` static callback wired in `extension.ts` — same pattern as `onDiffPipe`.

### Phase D: Download Guard ✅

1. `sesam.download` (download all) and `sesam.downloadFile` (download single) both check for local
   changes before proceeding:
   - Calls `ensureSyncStatus()` — uses the cached result if loaded, otherwise fetches on-demand
     (shows a status-bar progress indicator "Checking local diffs…").
   - **With local changes**: modal warning listing count of modified / local-only items, with buttons
     **See Local Diffs** and **Download Anyway**.
     - "See Local Diffs" focuses the `sesamSyncStatus` tree view (already populated) and, if there
       is exactly one diffable item, opens its diff editor immediately.
   - **No local changes**: proceeds without any dialog.

### Phase E: Revert to Node ✅

1. Each **Modified** item in the Sync Status tree has an inline $(discard) button → `sesam.revertConfig`.
2. On invocation:
   - Shows a confirmation modal: *"Revert 'id' to the remote node version? This will overwrite your local changes."*
   - Fetches the node config via `getNodeConfig()`.
   - Formats with `formatSesamJson` and writes directly to `localPath`.
   - Triggers a silent sync status refresh — the item disappears from the Modified group.
3. Only available on `modified` items (not Remote Only / Local Only).
4. Hidden from the command palette (`when: false`).

### Phase F: Gutter Decorations (future)

1. After `sesam.showStatus`, mark files that are `modified` with a gutter indicator using
   `vscode.window.createTextEditorDecorationType`.
2. A subtle colored bar in the gutter (similar to the git gutter extension):
   - Modified: blue
   - Local Only (untracked): green
3. Decorations set on all currently open editors whose `_id` appears in the status results.

---

## Files Modified / Added

| File | Change |
|---|---|
| `packages/core/src/sync-status.ts` (new) | `getSyncStatus()`, `getNodeConfig()` — pipes and systems |
| `packages/core/src/types.ts` | Added `SyncState`, `SyncStatusItem`, `SystemSummary` |
| `packages/core/src/index.ts` | Exported new functions and types |
| `client/src/status/SyncStatusProvider.ts` (new) | `SyncStatusProvider`, `SesamNodeConfigProvider`, `ConfigStatusItem`, `SESAM_NODE_SCHEME`; per-item tooltips with kind + state |
| `client/src/sesam-runner.ts` | Added `syncStatus()` and `systemSummaries()` methods; imported `NodeClient` |
| `client/src/node-status/NodeStatusPanel.ts` | Pipes/Systems tab bar; Systems table; `onDiffSystem` static; `initialTab` param; `diffSystem` message |
| `package.json` | `sesamSyncStatus` view; `sesam.showStatus`, `sesam.viewDiff`, `sesam.systemStatus`, `sesam.revertConfig` commands; menus (inline diff + revert buttons) |
| `client/src/extension.ts` | Wired all providers, commands, `ensureSyncStatus()`, `refreshSyncStatusSilently()`, `onDiffPipe`, `onDiffSystem`, save-debounce listener, download guards, on-load 3 s init, `sesam.revertConfig` |

---

## Dependencies

- **F00** — `@sesam/core` REST client (`NodeClient.getPipes`, `NodeClient.getSystems`, `getNodeConfig`)
- **F05** — diff view pattern reused from test result webview
