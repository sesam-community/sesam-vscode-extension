# F01: sesam-py Command Integration

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP
> **Depends on**: F00 (binary resolved)
> **Tracking**: [README.md](README.md)

---

## Summary

Expose the most common sesam-py operations (upload, download, run, test, validate, format, status) directly
from VS Code without the user switching to a terminal. Covers Command Palette commands, a status bar widget,
a dedicated Output Channel, and VS Code Task definitions.

---

## Implementation Phases

### Phase A: Command Palette + Output Channel

1. Register the following commands in `package.json` under `contributes.commands`:

   | Command ID | Title |
   |---|---|
   | `sesam.upload` | Sesam: Upload pipes |
   | `sesam.download` | Sesam: Download pipes |
   | `sesam.run` | Sesam: Run pipe... |
   | `sesam.validate` | Sesam: Validate |
   | `sesam.format` | Sesam: Format DTL files |
   | `sesam.status` | Sesam: Show status |

2. Create `client/src/sesamCommands.ts`:
   - `runSesamCommand(args: string[]): Promise<void>` - spawns binary (from F00 `resolveBinary()`),
     streams stdout/stderr to a named Output Channel `"Sesam"`.
   - Each command listed above maps to a function that calls `runSesamCommand` with the right args.
3. Register activation event `onCommand:sesam.*` (or `onStartupFinished`) in `package.json`.
4. Add `when` clause `sesam.binaryReady` so commands are greyed out if binary check fails (F00).

### Phase B: Status Bar Widget

1. Create a persistent status bar item (priority 100, left-aligned) showing:
   - Idle: `$(sesam-logo) Sesam` - clickable -> opens Output Channel.
   - Running: `$(sync~spin) Sesam: uploading...`
   - Success: `$(check) Sesam: done` (clears after 5 s).
   - Error: `$(error) Sesam: failed` (persists until next run, clickable -> Output Channel).
2. Track running commands with a ref-counter so concurrent runs are reflected correctly.
3. Expose `sesam.showOutput` command (status bar click handler).

### Phase C: VS Code Task Provider

1. Implement `vscode.TaskProvider` in `client/src/sesamTaskProvider.ts`.
2. Auto-detect workspace root for `.syncconfig`; expose tasks:
   - `Sesam: upload`
   - `Sesam: download`
   - `Sesam: run <pipe>` (parameterized - prompts for pipe name)
   - `Sesam: test`
3. Make tasks available from `Terminal > Run Task...` and bindable to keyboard shortcuts.
4. Register via `vscode.workspace.registerTaskProvider('sesam', provider)` in `extension.ts`.

---

## Configuration Points (package.json contributions)

```jsonc
"dtl.sesampy.defaultNode": "",           // fallback if .syncconfig absent
"dtl.sesampy.confirmBeforeUpload": true, // safety gate
"dtl.sesampy.singleMode": false          // pass --single-mode to upload/download
```

---

## Files to Modify / Add

| File | Change |
|---|---|
| `package.json` | Command registrations, settings, activation events |
| `client/src/extension.ts` | Register commands + task provider on activation |
| `client/src/sesamCommands.ts` (new) | Command implementations |
| `client/src/sesamTaskProvider.ts` (new) | VS Code Task Provider |
| `client/src/statusBar.ts` (new) | Status bar widget logic |

---

## Dependencies

- **F00** - binary must be resolvable before any command can execute
- **F03** - credential management should be wired in before `upload`/`download` are widely used
