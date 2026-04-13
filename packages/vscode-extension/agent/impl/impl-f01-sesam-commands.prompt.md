# F01: sesam-py Command Integration

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP
> **Depends on**: F00 (SesamRunner available)
> **Tracking**: [README.md](README.md)

---

## Summary

Expose the most common sesam-py operations (upload, download, run, test, validate, format, status, log, restart) directly
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
   | `sesam.validate` | Sesam: Validate | ⚠️ Implemented internally via `validateWorkspace()` in `@sesam/core` — does **not** call the backend API. The node has no validate endpoint; validation runs fully offline against local config files. |
   | `sesam.format` | Sesam: Format DTL files |
   | `sesam.status` | Sesam: Show status |
   | `sesam.log` | Sesam: Show pipe log... |
   | `sesam.restart` | Sesam: Restart node |

2. Create `client/src/sesamCommands.ts`:
   - `runSesamCommand(args: string[]): Promise<void>` - invokes the command via F00 `SesamRunner`,
     streams stdout/stderr to a named Output Channel `"Sesam"`.
   - Each command listed above maps to a function that calls `runSesamCommand` with the right args.
3. Register activation event `onCommand:sesam.*` (or `onStartupFinished`) in `package.json`.
4. Add `when` clause `sesam.runnerReady` so commands are greyed out if the runner check fails (F00).

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
   - `Sesam: log <pipe>` (parameterized - prompts for pipe name; streams execution log to Output Channel)
   - `Sesam: restart` (restarts the target node; shows a confirmation dialog first)
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
| `client/src/sesamCommands.ts` (new) | Command implementations (includes `log` and `restart`) |
| `client/src/sesamTaskProvider.ts` (new) | VS Code Task Provider |
| `client/src/statusBar.ts` (new) | Status bar widget logic |

---

## Dependencies

- **F00** - `SesamRunner` must be initialised before any command can execute
- **F03** - credential management should be wired in before `upload`/`download` are widely used

---

## Portal Node Status Hints

When a node API call fails, `client/src/portal-client.ts` queries
`GET https://portal.sesam.io/api/subscriptions/{sub-id}` (sub-id decoded from JWT `principals`)
and appends a human-readable hint to the error message. Not shown for auth errors (401/403).

The logic mirrors the Management Studio webapp (`useConnectSubscriptionFlow` +
`calculateSubscriptionProvisioningStatus` in webconsole). Status evaluation order:

| Priority | Condition | Hint shown to user |
|---|---|---|
| 1 | `was_hibernated_due_to_idleness === true` | "Node is waking from hibernation — this may take a few minutes. Try again shortly." |
| 2 | `provisioning_status === "hibernated"` | "Node is hibernated. Wake it up in the Sesam portal before retrying." |
| 3 | `provisioning_status === "pending"` or `"provisioning"` | "Node is being provisioned — this may take a few minutes. Try again shortly." |
| 4 | `provisioning_status === "failed"` | "Node provisioning has failed. Check network settings in the Sesam portal." |
| 5 | `provisioning_status === "destroyed"` | "Node has been destroyed. Check the Sesam portal." |
| 6 | `provisioning_status === "completed"` and `connections === []` | "No default connection defined for this subscription. Configure one in the Sesam portal." |
| — | `provisioning_status === "completed"` with connections | No hint (null) — node is healthy |
| — | Portal fetch fails / sub-id not in JWT | No hint (null) — silent best-effort |

**Key design notes:**
- `was_hibernated_due_to_idleness` is checked **before** `provisioning_status` — same as Management Studio.
  When hibernated due to idleness, the node auto-wakes (spinner in portal), so the message is
  informational, not an instruction to act manually.
- Auth errors skip the portal check entirely (hint would be misleading).
- The portal response is always logged to the Sesam output channel for debugging.
- For on-premise / non-provisioner-v2 nodes (no `principals` in JWT), hint is silently skipped.
