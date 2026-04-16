# F24: Live Updates via Socket.IO

> **Status**: `planned`
> **Rollout Phase**: Phase 1 (Node Status Panel enhancement)
> **Tracking**: [README.md](README.md)

---

## Summary

Replace the 30-second polling interval in `NodeStatusPanel` with a persistent **Socket.IO** connection
to the Sesam node. When connected, the panel receives real-time `pipes_updated`, `pipes_added`, and
`pipes_deleted` push events from the node — exactly as Management Studio does.

A **Live updates toggle** in the panel toolbar lets the user opt out at any time. When the WebSocket
connection cannot be established the toggle is automatically hidden and the panel shows a "Not supported"
badge — there is **no polling fallback**. The only way to refresh data when live updates are unavailable
is the manual **Refresh** button.

Filter pills no longer trigger a REST fetch. Because the full pipe list is always in memory (delivered
by the socket snapshot), filtering is purely client-side.

---

## Reference Implementation (Management Studio)

The MS codebase at `/home/shimshon.zacken/Documents/bouvet/webconsole/app/src/` is the canonical
reference. The key files are:

| File | Role |
|---|---|
| `hooks/useSocketIO.ts` | Connection lifecycle, `connect` / `closeConnection`, event wiring |
| `hooks/useLiveUpdates.ts` | Registers `on(eventType, handler)` for pipes/systems/datasets |
| `network/websocketFactory.ts` | `io()` call with exact options |
| `network/messageRouter.ts` | Dispatches incoming events to state |
| `types/network.types.ts` | All event name constants and payload types |
| `utils/common.utils.ts` | `getWebSocketUrlFromApiUrl` URL conversion |

### Socket.IO connection options (must match MS exactly)

```ts
import { io } from "socket.io-client";

io(wsUrl, {
  path: "/ws/",
  reconnection: true,
  reconnectionAttempts: 1,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  transports: ["websocket"],
  upgrade: false,
  auth: { token: `bearer ${jwt}` },
});
```

### URL conversion

The node URL stored in a profile is the REST API base (e.g. `https://datahub-xxx.sesam.cloud/api`).
The WebSocket URL drops the protocol scheme and removes `/api`:

```ts
// mirrors getWebSocketUrlFromApiUrl from common.utils.ts
const toWebSocketUrl = (nodeUrl: string): string =>
  nodeUrl
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:")
    .replace(/\/api\/?$/, "");

// Examples:
// "https://datahub-xxx.sesam.cloud/api" → "wss://datahub-xxx.sesam.cloud"
// "http://localhost:9042/api"            → "ws://localhost:9042"
```

### Server → Client event names

| Event | Payload type | Meaning |
|---|---|---|
| `pipes` | `{ data: Record<string, PipeResponse> }` | Full snapshot (on connect) |
| `pipes_added` | `{ data: Record<string, PipeResponse> }` | New pipes appeared |
| `pipes_updated` | `{ data: Record<string, PipeResponse> }` | One or more pipe states changed |
| `pipes_deleted` | `{ data: Record<string, PipeResponse> }` | Pipes removed from node |

`PipeResponse` matches the shape `NodeClient.getPipes()` returns — same `_id` and `runtime` fields
already consumed by `getStatus` / `getPipeStatus` in `@sesam/core`.

### Client → Server events

| Event | When |
|---|---|
| `get_pipes(callback)` | On `connect` — fetches initial snapshot |
| `subscribe_pipes()` | On `connect` — subscribes to live push events |

We only subscribe to pipes events. Systems and datasets are not needed by `NodeStatusPanel`.

---

## Architecture

### New dependency

Add `socket.io-client` to `packages/vscode-extension/package.json` (devDependencies are not enough
since Vite bundles it into `dist/client/extension.js`):

```json
"dependencies": {
  "socket.io-client": "^4.8.1"
}
```

### New file: `client/src/node-status/live-updates.ts`

Single responsibility: own the Socket.IO connection and translate raw events into `PipeStatus[]`
callbacks. No VS Code API imports — pure TypeScript, testable in isolation.

```ts
import { io } from "socket.io-client";
import type { Socket } from "socket.io-client";

export type LiveUpdateCallback = (statuses: PipeStatus[], eventType: LiveEventType) => void;
export type LiveEventType = "snapshot" | "updated" | "added" | "deleted" | "error" | "disconnect";

export class SesamLiveUpdates {
  private _socket: Socket | null = null;
  private _onUpdate: LiveUpdateCallback;

  constructor(onUpdate: LiveUpdateCallback) {
    this._onUpdate = onUpdate;
  }

  connect(nodeUrl: string, jwt: string): void {
    const wsUrl = toWebSocketUrl(nodeUrl);

    this._socket = io(wsUrl, {
      path: "/ws/",
      reconnection: true,
      reconnectionAttempts: 1,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      transports: ["websocket"],
      upgrade: false,
      auth: { token: `bearer ${jwt}` },
    });

    this._socket.on("connect", () => {
      // 1. Request initial snapshot
      this._socket?.emit("get_pipes", (data) => {
        const statuses = pipesDataToStatuses(data.data ?? {});
        this._onUpdate(statuses, "snapshot");
      });
      // 2. Subscribe to live push events
      this._socket?.emit("subscribe_pipes");
    });

    (["pipes_added", "pipes_updated", "pipes_deleted"] as const).forEach((event) => {
      this._socket?.on(event, (data) => {
        const statuses = pipesDataToStatuses(data.data ?? {});
        const type: LiveEventType =
          event === "pipes_added" ? "added" : event === "pipes_deleted" ? "deleted" : "updated";
        this._onUpdate(statuses, type);
      });
    });

    this._socket.on("connect_error", (err) => {
      this._onUpdate([], "error");
    });

    this._socket.on("disconnect", () => {
      this._onUpdate([], "disconnect");
    });
  }

  get isConnected(): boolean {
    return this._socket?.connected ?? false;
  }

  disconnect(): void {
    this._socket?.close();
    this._socket = null;
  }
}

// Converts the server's Record<id, PipeResponse> payload to the PipeStatus array
// format already used throughout the extension.
const pipesDataToStatuses = (data: Record<string, PipeResponse>): PipeStatus[] =>
  Object.values(data).map((p) => ({
    id: p._id,
    state: p.runtime?.state ?? "unknown",
    successCount: p.runtime?.success_count ?? 0,
    failureCount: p.runtime?.failure_count ?? 0,
    queued: p.runtime?.queued ?? 0,
    lastRun: p.runtime?.last_run,
    nextRun: p.runtime?.next_run,
  }));

const toWebSocketUrl = (nodeUrl: string): string =>
  nodeUrl
    .replace(/^https:/, "wss:")
    .replace(/^http:/, "ws:")
    .replace(/\/api\/?$/, "");
```

### Changes to `NodeStatusPanel.ts`

#### Live-updates toggle

Add a toggle button (checkbox-style or icon-button) to the panel toolbar, rendered in `_buildHtml()`:

```html
<!-- shown only when live updates are supported -->
<label id="liveToggleLabel" class="live-toggle">
  <input type="checkbox" id="liveToggle" checked />
  Live updates
</label>
```

Behaviour:

| State | Toggle visible | Action on change |
|---|---|---|
| Socket supported, enabled (default) | Yes, checked | Uncheck → `SesamLiveUpdates.disconnect()`, post `connection-state: "disabled"` |
| Socket supported, disabled by user | Yes, unchecked | Check → `SesamLiveUpdates.connect(...)`, post `connection-state: "live"` on success |
| Socket not supported (`connect_error`) | **Hidden** | N/A |

The extension receives the toggle change via a new webview message:

```ts
// Webview → Extension
{ type: "set-live-updates", enabled: boolean }
```

The extension stores the user's preference in `_liveEnabled: boolean` (defaults `true`) and acts
accordingly. The preference is **not persisted** across panel sessions — the panel always starts with
live updates enabled.

#### Connection lifecycle

```
Panel created
  → _liveEnabled = true
  → SesamLiveUpdates.connect(nodeUrl, jwt)
  → on "snapshot" callback → _cachedStatuses = incoming, post { type: "data" }, post connection-state: "live"

Panel receives connect_error
  → _liveSupported = false
  → post connection-state: "not-supported"
  → hide toggle in webview
  → do NOT start any poll; wait for manual Refresh

User unchecks toggle ("set-live-updates": false)
  → SesamLiveUpdates.disconnect()
  → post connection-state: "disabled"

User checks toggle again ("set-live-updates": true)
  → SesamLiveUpdates.connect(nodeUrl, jwt)
  → on connect: post connection-state: "live"
  → on connect_error: hide toggle, post connection-state: "not-supported"

Panel receives "disconnect" mid-session
  → post connection-state: "not-supported", hide toggle
  → do NOT reconnect automatically; user must use Refresh

Panel disposed
  → SesamLiveUpdates.disconnect()
```

#### No more setInterval

The `_refreshTimer` `setInterval` in `NodeStatusPanel` is **removed entirely**. The only ways the
pipe status table refreshes are:
1. Socket.IO push event (when live updates are on and supported).
2. Manual Refresh button click in the webview (`{ type: "refresh" }` → `_loadAndSend()`) — only visible when live updates are off.

#### Hibernation/provisioning poll — also triggered by NodeStatusPanel

The **provisioning poller** (`startProvisioningPoller` / `_provisioningPoller` in `extension.ts` and
`portal-client.ts`) must fire whenever **any** node API request fails because the node is sleeping —
including requests made by `NodeStatusPanel`.

The existing pattern (used by `PreviewPanel` and the `runPipe` command) is a static callback:

```ts
// NodeStatusPanel.ts
static onProvisioningNeeded: ((nodeUrl: string, jwt: string) => void) | undefined;

// In _loadAndSend() catch block:
if (hint) {
  NodeStatusPanel.onProvisioningNeeded?.(creds.nodeUrl, creds.jwt);
}

// extension.ts — in activate():
NodeStatusPanel.onProvisioningNeeded = startPollerIfNeeded;
```

Once wired, opening the Node Status panel on a hibernated node:
1. `_loadAndSend()` fails → `fetchNodeStatusHint` returns a hint string.
2. Error overlay shown in the webview.
3. `startPollerIfNeeded` fires → provisioning status bar spinner starts, 30 s poll begins.
4. When the node is ready the user is notified and can manually Refresh to load pipe statuses.

For the Socket.IO connection (when F24 live updates are implemented), `connect_error` from a
hibernated node also fires `onProvisioningNeeded` before hiding the toggle and showing
`"not-supported"`.

#### Refresh button visibility

The Refresh button is **hidden while live updates are active** and only shown when the connection
state is `"disabled"` or `"not-supported"`. Controlled by the `connection-state` message:

```js
window.addEventListener('message', (event) => {
  const msg = event.data;
  if (msg.type === 'connection-state') {
    const showRefresh = msg.state === 'disabled' || msg.state === 'not-supported';
    document.getElementById('refreshBtn').style.display = showRefresh ? '' : 'none';
  }
});
```

On initial load (before any `connection-state` message arrives) the button is **hidden by default**
via inline style `style="display:none"` — it appears only once the state is confirmed.

| `connection-state` | Refresh button |
|---|---|
| `"live"` | Hidden |
| `"disabled"` | Visible |
| `"not-supported"` | Visible |

#### Filter pills — client-side only

Filter pills currently call `sendRefresh()` which fires a new REST request. With live updates:
- **Remove** the `sendRefresh()` call from `setStatePill()`.
- Pills update `stateFilter` and call `renderTable()` directly — no network request.
- The Refresh button is only shown when live updates are disabled/not-supported (see above).

#### Merging incremental updates

Maintain `_cachedStatuses: PipeStatus[]` on the panel instance (the same array already sent to
the webview). On each live event:

| Event type | Merge strategy |
|---|---|
| `snapshot` | Replace — `_cachedStatuses = incoming` |
| `updated` | Upsert — for each incoming item, find by `id` and replace in place; unknown IDs are appended |
| `added` | Append all incoming items (guard for duplicates by `id`) |
| `deleted` | Filter out items whose `id` appears in incoming |

Then post `{ type: "data", statuses: _cachedStatuses, ... }` to the webview as usual — the webview
JS does not need to know about the event type.

#### Remove the setInterval poll

The `_refreshTimer` interval is **removed entirely** — no polling, no fallback.

### Changes to the webview HTML/JS (in `_buildHtml()`)

#### Live indicator and toggle

The toolbar gets two new elements:

1. **Connection badge** — updates via `connection-state` messages:

| `state` value | Badge rendered | Toggle visible |
|---|---|---|
| `"live"` | `<span class="live-badge live">● Live</span>` (green) | Yes, checked |
| `"disabled"` | `<span class="live-badge disabled">○ Paused</span>` (grey) | Yes, unchecked |
| `"not-supported"` | `<span class="live-badge offline">○ Not supported</span>` (red) | **Hidden** |

2. **Live updates toggle** — a `<label>` wrapping a checkbox, hidden/shown by JS:

```js
document.getElementById('liveToggle').addEventListener('change', (e) => {
  vscode.postMessage({ type: 'set-live-updates', enabled: e.target.checked });
});
```

When `connection-state: "not-supported"` arrives:
```js
document.getElementById('liveToggleLabel').style.display = 'none';
```

#### Filter pills — client-side only

Remove the `sendRefresh()` call from `setStatePill()`. Pills now only update `stateFilter` and call
`renderTable()`. No network request is fired when a filter pill is clicked.

---

## Message Protocol (Extension ↔ Webview)

### Extension → Webview (additions)

| Message | When |
|---|---|
| `{ type: "connection-state", state: "live" \| "disabled" \| "not-supported" }` | Connection state changes |

### Webview → Extension (additions)

| Message | When |
|---|---|
| `{ type: "set-live-updates", enabled: boolean }` | User toggles the live updates checkbox |

### Unchanged

All existing message types (`data`, `loading`, `error`, `ready`, `refresh`, `openLocalFile`,
`openInManagementStudio`) remain exactly as they are.

---

## Error / Unsupported Behaviour

| Condition | Behaviour |
|---|---|
| `connect_error` (any reason) | Hide toggle, send `connection-state: "not-supported"`, do nothing else |
| `connect_error` with `"token expired"` | Same + show a VS Code warning notification: "Sesam: JWT expired — update your profile" |
| `connect_error` with `"invalid token"` / `"jwt malformed"` | Same as token expired |
| Socket disconnects mid-session | Hide toggle, send `connection-state: "not-supported"`; no auto-reconnect |
| User re-enables toggle after `"not-supported"` | Not possible — toggle is hidden when not supported |

**No polling is started under any condition.**

---

## File Checklist

| File | Change |
|---|---|
| `client/src/node-status/live-updates.ts` | **New** — `SesamLiveUpdates` class |
| `client/src/node-status/NodeStatusPanel.ts` | Add `_liveUpdates`, `_liveEnabled`, `_liveSupported`; merge strategy; remove `setInterval`; remove `sendRefresh()` from filter pills; add toggle + connection-state badge; handle `set-live-updates` message |
| `packages/vscode-extension/package.json` | Add `"socket.io-client"` dependency |
| `pnpm-lock.yaml` | Updated by `pnpm install` |

No changes to `@sesam/core`, `server/`, or any shared code — this feature is entirely a
`client/` concern.

---

## Testing Notes

- The `SesamLiveUpdates` class should be unit-tested with a mocked socket (inject via constructor
  or factory function) to cover: snapshot → state, updated → upsert, deleted → filter.
- `NodeStatusPanel` integration tests are manual (F5 launch against a real Sesam node).
- To verify fallback: block the WebSocket port or set an invalid JWT; confirm the badge switches
  to "Polling" and the 30 s timer fires.

---

## Open Questions

1. **Filter-by-pipe (single pipe mode)**: When `_filterPipeId` is set, should we still subscribe
   to all pipes and filter client-side, or is there a server-side subscription API to subscribe
   to a single pipe? The MS codebase always subscribes to all — follow the same approach.

2. **Auto-refresh on reconnect**: When the socket reconnects (e.g. after a network blip), emit
   `get_pipes` again to ensure the snapshot is fresh, since we may have missed events during
   the gap. The `reconnectionAttempts: 1` in the MS config limits retries — we handle the rest
   in the fallback logic.

3. **Multiple profiles**: `NodeStatusPanel` is a singleton. If the user switches Sesam profile
   while the panel is open, `_loadAndSend` already picks up new credentials. We should also
   call `SesamLiveUpdates.disconnect()` + `connect(newNodeUrl, newJwt)` on profile switch.
   Wire this by listening to the `sesam.profileChanged` internal event (or re-connect on the
   next `_loadAndSend` call by comparing `nodeUrl`).
