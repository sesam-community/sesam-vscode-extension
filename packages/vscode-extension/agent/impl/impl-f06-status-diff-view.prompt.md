# F06: Status / Diff View

> **Status**: `in progress` — Phases A and B implemented
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
   - Groups: **Modified**, **Node Only**, **Local Only**
   - Each group shows the count and is expanded by default.
5. Refresh button (↻) in the view title reruns `sesam.showStatus`.

### Phase B: Diff Panel ✅

1. Each Modified / Node Only item has an inline $(diff) button → `sesam.viewDiff`.
2. `sesam.viewDiff` also works from the command palette: shows a quickpick of all diffable items
   from the last loaded status (prompts to run `sesam.showStatus` first if none are loaded).
3. On invocation:
   - Fetches the node-side config via `getNodeConfig(creds, id, kind)` from `@sesam/core`.
   - Formats it with `formatSesamJson` and stores it in an in-memory `SesamNodeConfigProvider`
     under the `sesam-node://` URI scheme.
   - **Modified**: opens VS Code's native diff editor — node version on the left, local file on the right.
   - **Node Only**: opens the node version as a read-only virtual document.

### Phase C: Push / Pull CodeLens

1. Add CodeLens to pipe/system config files:
   - "↑ Upload to node" (if the file's `_id` appears as `modified` or `local-only` in the last status)
   - "↓ Download from node" (if `modified` or `node-only`)
2. Implement via a `vscode.CodeLensProvider` in `client/src/status/SyncStatusCodeLens.ts`.
3. Driven by the cached `SyncStatusProvider` state — no extra network call on file open.
4. Refresh CodeLens after any `sesam.upload` / `sesam.download` / `sesam.showStatus` completes.

### Phase D: Gutter Decorations

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
| `packages/core/src/sync-status.ts` (new) | `getSyncStatus()` + `getNodeConfig()` |
| `packages/core/src/types.ts` | Added `SyncState`, `SyncStatusItem` |
| `packages/core/src/index.ts` | Exported new functions and types |
| `client/src/status/SyncStatusProvider.ts` (new) | `SyncStatusProvider`, `SesamNodeConfigProvider`, `ConfigStatusItem` |
| `client/src/sesam-runner.ts` | Added `syncStatus()` method |
| `package.json` | `sesamSyncStatus` view, `sesam.showStatus` + `sesam.viewDiff` commands, menus |
| `client/src/extension.ts` | Wired provider, tree view, and both commands |

---

## Dependencies

- **F00** — `@sesam/core` REST client (`NodeClient.getPipes`, `getSystems`, `getPipe`, `getSystem`)
- **F05** — diff view pattern reused from test result webview
