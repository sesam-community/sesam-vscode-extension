# F10: Inline Output & Diagnostics from Node

> **Status**: `planned`
> **Rollout Phase**: Phase 3 - Node Connectivity
> **Tracking**: [impl-plan.prompt.md](impl-plan.prompt.md)

---

## Summary

After a sesam command runs (upload, run, test), surface per-pipe execution statistics and node-side
errors directly in the editor as diagnostics, gutter decorations, and CodeLens annotations - rather
than requiring the user to read the Output Channel log.

---

## Implementation Phases

### Phase A: Execution Result Parsing

1. Create `client/src/executionResultParser.ts`:
   - `parseRunOutput(stdout: string): PipeResult[]`
   - `PipeResult`: `{ pipeName, status: 'ok'|'error', entitiesIn, entitiesOut, errorMessage? }`
2. After any sesam-py command completes in F01 `sesamCommands.ts`, call the parser and publish results
   via an event emitter `sesamEvents.emit('runCompleted', results)`.

### Phase B: Diagnostics from Node Errors

1. In `client/src/inlineDiagnostics.ts`, subscribe to `sesam.runCompleted` events.
2. For each `PipeResult` with `status === 'error'`:
   - Locate the pipe's `.conf.json` file in the workspace.
   - Create a `vscode.Diagnostic` with severity `Error` pointing to line 0 (or the transform block
     if the error message includes a path).
   - Add the diagnostic to a dedicated `DiagnosticCollection` named `"Sesam"`.
3. Clear all Sesam diagnostics before each new run.
4. Clicking a Sesam diagnostic navigates to the file and, if possible, the offending transform.

### Phase C: Per-Pipe Stats CodeLens

1. Add a `CodeLensProvider` in `client/src/statCodeLens.ts`.
2. After a run, display above each pipe's `"_id"` key:
   - `Sesam: 1,234 entities in -> 1,234 entities out (last run: 2 min ago)`
   - On error: `Sesam: FAILED - <short error message>` (red, clickable -> Output Channel filtered to
     this pipe)
3. Stats persisted in `workspaceState` so they survive panel close; cleared on next run.

### Phase D: Gutter Run-Status Decorations

1. Add gutter decorations to open `.conf.json` files after a run:
   - Green checkmark: pipe ran without errors
   - Red X: pipe encountered an error
   - Use `vscode.window.createTextEditorDecorationType` with `gutterIconPath` pointing to SVG icons
     in `resources/icons/`.
2. Decorations applied to the line containing `"_id"` in each pipe file.
3. Hovering the gutter icon shows a hover message with the run timestamp and entity counts.

---

## Files to Modify / Add

| File | Change |
|---|---|
| `client/src/sesamCommands.ts` | Emit `runCompleted` event after command finishes (extends F01) |
| `client/src/executionResultParser.ts` (new) | Output parser: stdout -> `PipeResult[]` |
| `client/src/inlineDiagnostics.ts` (new) | Diagnostics collection management |
| `client/src/statCodeLens.ts` (new) | Per-pipe stats CodeLens provider |
| `resources/icons/sesam-ok.svg` (new) | Gutter icon - success |
| `resources/icons/sesam-error.svg` (new) | Gutter icon - error |
| `client/src/extension.ts` | Register diagnostics + CodeLens providers |

---

## Dependencies

- **F00/F01** - requires binary execution and the `runCompleted` event from F01
- **F06** - gutter decoration pattern can be shared with F06 Phase D
