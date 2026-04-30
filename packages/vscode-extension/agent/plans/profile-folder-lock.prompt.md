# Plan: One Profile Per Folder (Profile Lock)

> **Status**: `implemented`
> **Context**: F03 (Secure Credential Management) — additive behaviour on top of the multi-profile switcher.

---

## Problem

A developer can freely switch profiles in any folder at any time. This creates a risk: after a full
download has populated `pipes/` and `systems/`, the local configs are tied to a specific Sesam node.
Switching profiles mid-session would mix configs from two different nodes or silently point subsequent
uploads/runs at the wrong node.

---

## Goal

Lock the active profile to its workspace folder after the first successful **full download**. This
makes the relationship between a folder and its Sesam node explicit and tamper-proof for the lifetime
of that VS Code window.

Opening a new folder gives a fresh `workspaceState` with no lock — the developer can freely choose
a profile there.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Lock trigger** | After first successful `sesam.download` | The download is the moment local configs are bound to a node |
| **Unlock** | Open a new folder — no unlock command | Strict; prevents accidental node mixing |
| **Switch UI when locked** | Status bar becomes non-interactive; command hidden from palette | Removes the affordance entirely |
| **Profiles Panel (locked folder)** | Show all profiles; non-active show a lock badge instead of "Make active" | Transparency without action |
| **`sesam.downloadFile`** | Does NOT trigger the lock | File-level download doesn't bind the whole workspace |

---

## Implementation Phases

### Phase 1 — Lock state (`profile-manager.ts`)

1. Add constant `PROFILE_CONNECTED_KEY = "sesam.profileConnected"` next to the existing key constants.
2. Add exported function `isProfileConnected(): boolean` — reads
   `ctx().workspaceState.get<boolean>(PROFILE_CONNECTED_KEY) ?? false`.
3. Add exported function `setProfileConnected(): Promise<void>`:
   - Writes `true` to `workspaceState` under `PROFILE_CONNECTED_KEY`.
   - Fires `vscode.commands.executeCommand("setContext", "sesam.profileConnected", true)` so
     `when` clauses in `package.json` take effect immediately.
   - Calls `void _refreshStatusBar()` to re-render the status bar as non-interactive.
4. In `initProfileManager()`, after the status bar item is created, sync the VS Code context key
   with the persisted value so the lock survives extension restarts:
   ```ts
   void vscode.commands.executeCommand(
     "setContext", "sesam.profileConnected", isProfileConnected()
   );
   ```

### Phase 2 — Enforce on switch (`profile-manager.ts`)

5. At the very top of `runSwitchProfile()`, before the dirty-file guard, add:
   ```ts
   if (isProfileConnected()) {
     vscode.window.showInformationMessage(
       "Sesam: This folder is locked to its profile. Open a new folder to use a different profile."
     );
     return;
   }
   ```

### Phase 3 — Non-interactive status bar (`profile-manager.ts`)

6. Move the `_statusBarItem.command` assignment out of `initProfileManager()` and into
   `_refreshStatusBar()`:
   - When **not locked**: `_statusBarItem.command = "sesam.switchProfile"`
   - When **locked**:     `_statusBarItem.command = undefined`
   - Also update `_statusBarItem.tooltip` accordingly:
     - Not locked: `"Click to switch Sesam profile"`
     - Locked: `"Profile locked to this folder"`

### Phase 4 — Hide from command palette (`package.json`)

7. In the `commandPalette` contribution array, find the entry for `sesam.switchProfile` and add
   (or update) its `when` clause to `"!sesam.profileConnected"`.
   If no entry exists yet, add one:
   ```json
   { "command": "sesam.switchProfile", "when": "!sesam.profileConnected" }
   ```

### Phase 5 — Trigger lock on successful download (`extension.ts`)

8. In the `sesam.download` command handler, inside the `withProgress` callback, immediately after
   `vscode.window.showInformationMessage("Sesam: Download complete …")` on the success path:
   ```ts
   await setProfileConnected();
   ```
   Import `setProfileConnected` from `"./profile-manager"` (already imported; just add the name).

### Phase 6 — Profiles Panel UI

9. **`ProfilesPanel.ts`** — in `_loadAndSend()`, add `isLocked: isProfileConnected()` to the
   `data` message sent to the webview.
10. **`profiles-panel.html`** — in the `data` message handler, receive `isLocked` and:
    - When `isLocked && !row.isActive`: replace the "Make active" button with a
      `<span class="field-tag locked-tag">🔒 Locked to folder</span>` badge.
    - Style: same background/colour as the existing `active-badge`.

---

## Files to Modify

| File | Change |
|---|---|
| `client/src/profile-manager.ts` | Add `PROFILE_CONNECTED_KEY`, `isProfileConnected`, `setProfileConnected`; update `initProfileManager`, `_refreshStatusBar`, `runSwitchProfile` |
| `client/src/extension.ts` | Call `setProfileConnected()` after successful download; add import |
| `client/src/profile-manager/ProfilesPanel.ts` | Add `isLocked` to `_loadAndSend` data message |
| `resources/profiles-panel.html` | Render lock badge instead of "Make active" when `isLocked` |
| `package.json` | Add `when: "!sesam.profileConnected"` to `sesam.switchProfile` commandPalette entry |

---

## Verification Checklist

- [ ] Add profile → `sesam.switchProfile` works before any download (no lock yet).
- [ ] Run `sesam.download` → success → status bar click is a no-op (non-interactive).
- [ ] `sesam.switchProfile` hidden from command palette after download.
- [ ] Reload VS Code with same folder → lock persists.
- [ ] Open a new folder → lock absent, can switch freely.
- [ ] Profiles Panel (locked): non-active profiles show "Locked to folder" badge, no "Make active" button.
- [ ] Profiles Panel: Delete button still works for the active (locked) profile.
- [ ] `sesam.downloadFile` does NOT set the lock.
