# F11: Management Studio Functionalities

> **Status**: `planned`
> **Rollout Phase**: Phase 5 - Long-term
> **Tracking**: [impl-plan.prompt.md](impl-plan.prompt.md)

---

## Summary

Bring the three core Management Studio capabilities into VS Code as a first-class replacement workflow:

1. **Entity Navigation** - browse datasets with entity list + JSON viewer (two-pane, like Management Studio)
2. **Save pipes/systems to node** - write a single pipe without full `sesam upload`
3. **Run pipes from editor** - trigger a pump run via CodeLens, stream output inline

These are long-term features with higher complexity and dependency on a stable node connection (F03/F04).

---

## Management Studio Entity Browser Reference

From Management Studio UI:

| Column | Source field |
|---|---|
| Entity ID (`_id`) | String identifier |
| Timestamp (`_updated`) | ISO-8601 or Unix timestamp |
| Sequence (`_ts`) | Monotonic integer |

Entity detail JSON viewer shows full schema:
`_id`, `_updated`, `_previous`, `_deleted`, `_ts`, `_hash` + user-defined fields.

---

## Implementation Phases

### Phase A: Entity Navigation Webview

1. Add a new VS Code sidebar view panel `"Sesam: Datasets"`:
   - Top pane: a TreeView listing all datasets (fetched from `GET /datasets` when credentials available).
   - Bottom pane: a webview embedded in the sidebar that shows the entity list for the selected dataset.
2. Entity list pane (webview):
   - Table of `_id`, `_updated` (formatted), `_ts` (sequence).
   - Click a row -> expand JSON viewer below the table (single pane switches to entity detail).
   - Entity JSON viewer: collapsible JSON tree with all fields; copy button per field value.
   - "Load more" button (default page size 50 entities).
3. REST calls: `GET /datasets/<id>/entities?limit=50&since=<seq>` for paginated load.
4. Add a search input: filter by `_id` prefix or exact match.
5. Register view in `package.json` under `contributes.views.sesamExplorer`.

### Phase B: Save Pipe to Node

1. Register command `sesam.savePipe` (`when`: active editor is a pipe/system `.conf.json`).
2. Read the current file content; determine the pipe `_id` and type (`pipe` or `system`).
3. Call the Sesam REST API:
   - PUT `<nodeUrl>/api/pipes/<id>/config` with the pipe JSON body.
   - Or PUT `<nodeUrl>/api/systems/<id>/config` for systems.
4. On success: show status bar "Saved <pipe-name> to node" briefly.
5. On conflict/validation error: show an error notification with the node's error message.
6. Add `dtl.sesampy.confirmBeforeSave` setting (boolean, default `true`) - shows a confirmation before overwriting.
7. Add "Save to node" CodeLens at the top of each pipe/system file.

### Phase C: Run Pipe from Editor

1. Register command `sesam.runPipe` (`when`: active editor is a `.conf.json`).
2. Extract the pipe `_id` from the active file.
3. Trigger a pump run: POST `<nodeUrl>/api/pipes/<id>/pump` (Sesam pump REST endpoint).
4. Poll `GET /api/pipes/<id>` every 2 s for pump status until `runtime.success` or `runtime.failed`.
5. Stream progress to the Output Channel with entity counts as they update.
6. On completion: show a status bar flash with entity count processed.
7. On error: create a Sesam diagnostic (F10) pointing at the transform that failed.
8. Add "Run pipe" CodeLens at the top of each pipe file alongside "Save to node" (Phase B).

### Phase D: Entity-by-Entity Debug Step-Through

> High complexity / future research item.

1. Add a "Debug" button in the entity list pane (Phase A) that enters a step-through mode.
2. Each entity is passed through the local DTL evaluator (F04 Phase C) one at a time.
3. The output entity is shown alongside the input entity in a split view.
4. Transforms are highlighted in the DTL file as they execute (requires DTL AST source mapping).
5. Users can set "breakpoints" on DTL function calls (right-click -> "Break on this transform").

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | `contributes.views`, new commands, `dtl.sesampy.confirmBeforeSave` setting |
| `client/src/extension.ts` | Register dataset explorer view + save/run commands |
| `client/src/datasetExplorer.ts` (new) | TreeView of datasets + entity webview panel |
| `client/src/nodeClient.ts` | Add `saveConfig()`, `runPump()`, `getPipeStatus()` methods (extends F04) |
| `client/src/savePipe.ts` (new) | Save pipe/system to node logic |
| `client/src/runPipe.ts` (new) | Run pipe pump + status polling + diagnostics |
| `client/src/pipeCodeLens.ts` (new) | CodeLens for "Save to node" + "Run pipe" |

---

## Dependencies

- **F03** - credentials (node URL + JWT) required for all REST calls
- **F04** - `nodeClient.ts` is extended here with write + pump endpoints
- **F10** - diagnostics infrastructure reused for run-time errors in Phase C
- Phase D (step-through debug) depends on DTL AST source map work (not yet scoped)
