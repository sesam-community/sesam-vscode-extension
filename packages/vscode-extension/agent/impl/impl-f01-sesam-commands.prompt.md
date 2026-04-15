# F01: sesam-py Command Integration

> **Status**: `implemented`
> **Rollout Phase**: Phase 1 - MVP
> **Depends on**: F00 (SesamRunner available)
> **Tracking**: [README.md](README.md)

---

## Summary

Expose the most common sesam-py operations directly from VS Code without the user switching to a
terminal. Covers Command Palette commands, editor title-bar buttons, a dedicated Output Channel,
and VS Code Task definitions.

---

## Implemented Commands

| Command ID | Title | Scope |
|---|---|---|
| `sesam.upload` | Sesam: Upload to Node | Whole workspace |
| `sesam.download` | Sesam: Download from Node | Whole workspace |
| `sesam.runPipe` | Sesam: Run Pipe | Current file |
| `sesam.uploadFile` | Sesam: Upload This Config to Node | Current file |
| `sesam.downloadFile` | Sesam: Download This Config from Node | Current file |
| `sesam.pipeStatus` | Sesam: Show Pipe Status | Current file |
| `sesam.nodeStatus` | Sesam: Show Node Status | Whole node |

### Editor title-bar button order (left → right)

1. `sesam.runPipe` / `sesam.pipeRunningIndicator` — start the pump (or spinner when running)
2. `sesam.pipeStatus` — fetch and display runtime status for the current pipe
3. `dtl.previewPipe` — open the offline preview panel
4. `sesam.uploadFile` — upload **only** the current config file to the node
5. `sesam.downloadFile` — download **only** the current config file from the node
6. `sesam.upload` — upload full workspace to the node
7. `sesam.download` — download full workspace from the node
8. `sesam.nodeStatus` — show a Quick Pick with runtime status of all node pipes
9. `sesam.fixWithCopilot` — open Copilot chat with file errors

### `sesam.nodeStatus` — Node Status Quick Pick

- Fetches all pipe statuses via `SesamRunner.status()`.
- Shows a filterable Quick Pick list with:
  - Icon: `$(sync~spin)` running · `$(error)` failures · `$(check)` OK · `$(circle-outline)` other
  - Description: state string
  - Detail: success/failure counts and last-run timestamp
- Summary header: `N pipes — X running, Y with failures`.
- Available in: editor title bar (`navigation@8`), Explorer panel `view/title`, Command Palette.

### `sesam.pipeStatus` — Per-Pipe Status Notification

- Reads `_id` from the active document.
- Fetches all statuses and finds the matching entry.
- Shows an information message: `$(icon) Sesam pipe '<id>': <state>`.

### `sesam.uploadFile` / `sesam.downloadFile` — Single-config transfer

The single-file operations use per-entity REST endpoints (`PUT /api/pipes/{id}/config`,
`GET /api/pipes/{id}`) from `@sesam/core`, so they do **not** overwrite other configs on the node.

#### Upload flow
1. Read and parse the active config file.
2. Run offline validation on the workspace (filter to this file's errors).
3. `PUT /api/pipes/{id}/config` or `PUT /api/systems/{id}/config`.
4. Show success / validation error notification.

#### Download flow
1. Read `_id` from the active document.
2. Show confirmation dialog (will overwrite local file).
3. `GET /api/pipes/{id}` or `GET /api/systems/{id}`.
4. Write the `original` config to `pipes/<id>.conf.json` or `systems/<id>.conf.json`.
5. Show success notification with the relative file path.

---

## Core additions (`@sesam/core`)

| Addition | Purpose |
|---|---|
| `NodeClient.getPipe(id)` | `GET /api/pipes/{id}` |
| `NodeClient.getSystem(id)` | `GET /api/systems/{id}` |
| `NodeClient.putPipeConfig(id, config)` | `PUT /api/pipes/{id}/config` |
| `NodeClient.putSystemConfig(id, config)` | `PUT /api/systems/{id}/config` |
| `uploadSingleConfig(creds, filePath, opts?)` | Single-file upload (exported from index) |
| `downloadSingleConfig(creds, id, type, opts)` | Single-config download (exported from index) |
| `SingleUploadResult`, `SingleDownloadResult`, `DownloadSingleOptions` | New types |

---

## Files Modified

| File | Change |
|---|---|
| `package.json` | Added 4 new commands + menu entries |
| `client/src/extension.ts` | Registered `sesam.uploadFile`, `sesam.downloadFile`, `sesam.pipeStatus`, `sesam.nodeStatus` |
| `client/src/sesam-runner.ts` | Added `uploadFile()`, `downloadFile()` methods |
| `packages/core/src/node-client.ts` | Added `getPipe`, `getSystem`, `putPipeConfig`, `putSystemConfig` |
| `packages/core/src/upload.ts` | Added `uploadSingleConfig()` |
| `packages/core/src/download.ts` | Added `downloadSingleConfig()` |
| `packages/core/src/types.ts` | Added single-config types |
| `packages/core/src/index.ts` | Exported new functions |

---

## Dependencies

- **F00** - `SesamRunner` must be initialised before any command can execute
- **F03** - credential management must be wired in before upload/download commands are used

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
