# F23: Centralized Network Status Bar

> **Status**: `planned`
> **Rollout Phase**: Phase 1
> **Tracking**: [README.md](README.md)

---

## Summary

A single persistent VS Code status bar item on the **right side** that shows live network activity for
all extension HTTP requests — portal API calls, Sesam node API calls, and pipe operations.

Today, each command reports its own result via `showInformationMessage` / `showErrorMessage`. There is
no persistent, ambient indication of what is happening on the wire. This feature adds a lightweight,
always-visible status indicator without changing any user-facing notification flows.

---

## Status Bar States

| State | Icon | Text example | Colour |
|---|---|---|---|
| Idle | `$(circle-outline)` | `Sesam` | default (no colour override) |
| GET in flight | `$(sync~spin)` | `GET portal/subscriptions` | `#569cd6` (blue) |
| POST/PUT in flight | `$(sync~spin)` | `POST run-pipe/my-pipe` | `#dcdcaa` (yellow) |
| DELETE in flight | `$(sync~spin)` | `DELETE config` | `#ce9178` (orange) |
| Success | `$(check)` | `200 OK` | `#4ec9b0` (green) |
| Failed | `$(error)` | `503 Failed` | `#f44747` (red) |

- **Success** state auto-reverts to idle after **2 000 ms**.
- **Failed** state auto-reverts to idle after **3 000 ms**.
- **Multiple concurrent requests**: display the most-recently-started method + label; show the total
  count in the tooltip, e.g. `3 requests in flight`.
- The provisioning poller background ticks (every 30 s) are **excluded** — only user-triggered or
  preview-triggered requests light up the bar.

---

## Architecture

### New file: `client/src/network-status.ts`

Owns the status bar item and exposes a single public function:

```ts
// Call once during activate(); registers the status bar item.
export function createNetworkStatusBar(context: vscode.ExtensionContext): void

// Call before firing a request. Returns a done() callback.
// method:  "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
// label:   short human-readable description, e.g. "run-pipe/my-pipe"
export function trackRequest(method: string, label: string): (success: boolean, statusCode?: number) => void
```

Module-level state (no class, consistent with the `_wakeUpSent` pattern):

```ts
let _statusBar: vscode.StatusBarItem | undefined;
let _inflightCount = 0;
let _lastMethod = "";
let _lastLabel = "";
let _revertTimer: ReturnType<typeof setTimeout> | undefined;
```

`trackRequest` returns a `done(success, statusCode?)` callback.  Calling it:
1. Decrements `_inflightCount`.
2. If `_inflightCount > 0` → keeps showing the next in-flight request.
3. If `_inflightCount === 0` → transitions to success/failed state, schedules revert timer.

### Integration points

#### `portal-client.ts`

Wrap the three `https.request` blocks (`fetchSubscriptionStatus`, `triggerNodeWakeUp`, `pingNode`).

```ts
import { trackRequest } from "./network-status";

// fetchSubscriptionStatus
const done = trackRequest("GET", "portal/subscriptions");
// in res.on("end"):
done(res.statusCode !== undefined && res.statusCode < 400, res.statusCode);
// in req.on("error"):
done(false);

// triggerNodeWakeUp
const done = trackRequest("POST", "portal/analytics");

// pingNode (silent — excluded; it is a background connectivity probe)
// → no trackRequest call
```

> `pingNode` is a background probe in the node-polling phase; it should not light up the bar.

#### `extension.ts`

Wrap `SesamRunner` call sites with `trackRequest`:

```ts
// sesam.runPipe command
const done = trackRequest("POST", `run-pipe/${pipeId}`);
try {
  const result = await runner.runPipe(creds, pipeId);
  done(result.success);
} catch {
  done(false);
}
```

Apply the same pattern to future `upload`, `download`, `getStatus` calls as they are added.

Also call `createNetworkStatusBar(context)` early in `activate()`.

#### `PreviewPanel.ts`

Wrap the live evaluation `fetch` in `_runLiveEvaluation`:

```ts
const done = trackRequest("POST", `preview/${this._pipeId}`);
try {
  const response = await fetch(url, ...);
  done(response.ok, response.status);
} catch {
  done(false);
}
```

---

## File Changes Summary

| File | Change |
|---|---|
| `client/src/network-status.ts` | **NEW** — status bar + `trackRequest` |
| `client/src/extension.ts` | Call `createNetworkStatusBar`; wrap `SesamRunner` call sites |
| `client/src/portal-client.ts` | Add `trackRequest` to `fetchSubscriptionStatus` and `triggerNodeWakeUp` |
| `client/src/preview/PreviewPanel.ts` | Add `trackRequest` around live eval fetch |

No changes to `@sesam/core` or the LSP server.

---

## Implementation Phases

### Phase A — Status bar + portal instrumentation
1. Create `network-status.ts` with full state machine and `createNetworkStatusBar` / `trackRequest`.
2. Wire `createNetworkStatusBar` into `activate()`.
3. Add `trackRequest` calls in `portal-client.ts` (`fetchSubscriptionStatus`, `triggerNodeWakeUp`).

### Phase B — Command and preview instrumentation
4. Wrap `SesamRunner.runPipe` call site in `extension.ts`.
5. Wrap live eval fetch in `PreviewPanel.ts`.
6. Add wrapping to future command call sites as they are implemented (upload, download, etc.).
