# F06: Status / Diff View

> **Status**: `planned`
> **Rollout Phase**: Phase 2 - Testing & Diff
> **Tracking**: [README.md](README.md)

---

## Summary

Show what has changed between the local workspace and the remote Sesam node, similar to a git status panel.
Users can see which pipes/systems are locally modified vs the node, and push or pull individual items.

---

## Implementation Phases

### Phase A: Sesam Status Command

1. Register `sesam.showStatus` command (extending F01).
2. On invocation, run `sesam status` via the binary and capture JSON output.
3. Parse the output into a list of changed items, each with:
   - `name`: pipe or system name
   - `state`: `added` | `modified` | `deleted` | `untracked`
4. Display results in a `TreeView` (new `SesStatusProvider`):
   - Tree root: "Sesam Status"
   - Children: one item per changed pipe/system, with a git-style icon (+ / M / D / ?)
5. Register `sesam.refreshStatus` command mapped to the TreeView refresh button.

### Phase B: Git-Style Diff Panel

1. For each item in the status tree, add an inline action button "View Diff".
2. On click:
   - Download the node version to a temp file via `sesam download --pipes <name>` or REST API.
   - Open VS Code native diff editor: `vscode.commands.executeCommand('vscode.diff', nodeUri, localUri)`.
3. Add "Accept Node Version" and "Keep Local Version" buttons in the diff editor toolbar via a
   contributed editor command.

### Phase C: Push / Pull CodeLens

1. Add CodeLens to pipe JSON files (`.conf.json`):
   - "Upload to node" (if status is `modified` or `added`)
   - "Download from node" (if local is behind node)
2. Implement via a `vscode.CodeLensProvider` in `client/src/statusCodeLens.ts`.
3. Rely on cached status state from Phase A to determine which CodeLens to show without re-running
   `sesam status` on every file open.
4. Refresh CodeLens after any `sesam upload` or `sesam download` command completes (listen to F01
   command events).

### Phase D: Gutter Decorations

1. After `sesam status`, mark modified/added/deleted lines in open pipe files with gutter indicators
   (reuse VS Code's built-in `vscode.window.createTextEditorDecorationType`).
2. Use a subtle colored line in the gutter (similar to git gutter blame):
   - Modified: blue
   - Added: green
   - Deleted: red
3. Decorations computed by comparing local file content with the last-downloaded node version cached in
   `workspaceState`.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | `contributes.views` (status tree), `contributes.commands` (refresh, view diff) |
| `client/src/extension.ts` | Register status provider + CodeLens provider |
| `client/src/statusProvider.ts` (new) | `TreeDataProvider<StatusItem>` |
| `client/src/statusCodeLens.ts` (new) | `CodeLensProvider` for push/pull actions |
| `client/src/statusParser.ts` (new) | Parse `sesam status` output |

---

## Dependencies

- **F00/F01** - binary for `sesam status`, `sesam upload`, `sesam download`
- **F05** - diff view pattern can be shared with F05 Phase C
