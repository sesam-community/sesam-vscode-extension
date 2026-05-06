# F28: Workspace-Scoped Profiles (one profile per folder)

> **Status**: `planned`
> **Rollout Phase**: Phase 1
> **Tracking**: [README.md](README.md)

---

## Summary

Currently profiles are partially global: metadata (`sesam.profiles`, `sesam.activeProfile`) lives in
`workspaceState` (per-folder) but the JWT name registry (`sesam.profileNames`) lives in `globalState`
(shared across all folders), and JWT keys in `SecretStorage` are unnamespaced (`sesam.jwt.<name>`).
This causes bleed: a "dev" profile added in folder A appears in folder B's profiles panel.

This feature makes profiles fully workspace-scoped: each VS Code folder has its own isolated profile,
invisible to every other folder. It also enforces the one-profile-per-workspace constraint in the UI.

---

## Storage mapping (before → after)

| Key | Store | Scope before | Scope after |
|---|---|---|---|
| `sesam.profiles` | `workspaceState` | per-folder ✓ | per-folder ✓ (no change) |
| `sesam.activeProfile` | `workspaceState` | per-folder ✓ | per-folder ✓ (no change) |
| `sesam.profileConnected` | `workspaceState` | per-folder ✓ | per-folder ✓ (no change) |
| `sesam.profileNames` | `globalState` ✗ | global | `workspaceState` |
| `sesam.jwt.<name>` | `SecretStorage` | global key ✗ | `sesam.jwt.<storageId>.<name>` |

`storageId` is derived from `context.storageUri.fsPath` (stable, unique per workspace folder,
already provided by VS Code — no user-visible change).

---

## Implementation Phases

### Phase A — Move JWT name registry to `workspaceState`

**File**: `client/src/profile-manager/credential-manager.ts`

1. Change `PROFILE_NAMES_KEY` storage from `globalState` → `workspaceState`:
   - `listStoredProfileNames()`: `ctx().workspaceState.get<string[]>(PROFILE_NAMES_KEY) ?? []`
   - `registerProfileName`: write to `workspaceState`
   - `unregisterProfileName`: write to `workspaceState`

2. Migration: on `initCredentialManager`, copy any names from `globalState` into `workspaceState`
   for profiles that have matching metadata in `workspaceState`, then clear the old `globalState` entry.

After this phase, the profiles panel will no longer show profiles from other folders.

---

### Phase B — Namespace JWT keys by workspace

**File**: `client/src/profile-manager/credential-manager.ts`

1. Derive a stable `_workspaceId` in `initCredentialManager`:
   ```ts
   // Use the last two path segments of storageUri to get a short, stable ID
   const storagePath = context.storageUri?.fsPath ?? "global";
   _workspaceId = Buffer.from(storagePath).toString("base64url").slice(0, 16);
   ```

2. Change JWT key format:
   - **New**: `sesam.jwt.<workspaceId>.<profileName>`
   - **Old**: `sesam.jwt.<profileName>`

3. Migration in `getToken`: fall back to the old unnamespaced key if the namespaced key returns
   `undefined`, then silently migrate (store under new key, delete old key).

After this phase, two workspaces with a "dev" profile cannot read each other's JWT.

---

### Phase C — Enforce single profile per workspace

**File**: `client/src/profile-manager/profile-manager.ts`

1. `upsertProfile`: replace the entire stored array with `[meta]` — one profile max per workspace.
   ```ts
   await ctx().workspaceState.update(PROFILES_KEY, [meta]);
   ```

2. `runAddProfile`:
   - If a profile already exists in this workspace, enter edit-mode directly (pass `{ profileName }`)
     instead of showing the "select or create" QuickPick.
   - Remove the "New profile…" separator item — its text should become "Reconfigure this workspace's profile".

3. `runDeleteProfile`: no QuickPick needed — only one profile can exist. Confirm and delete directly.

**File**: `client/src/profile-manager/profiles-panel.ts`

- Remove the "Make active" button (only one profile; it is always considered active once set).
- Replace "Edit Profile" label with "Reconfigure" (same action, clearer label).
- When a profile exists: hide the "+ Add Profile" toolbar button; show "Reconfigure" instead.

---

### Phase D — Simplify status bar & commands

**File**: `client/src/profile-manager/profile-manager.ts`

- `sesam.switchProfile`: repurpose as "Reconfigure this workspace's profile" (opens `runAddProfile` in
  edit-mode). Remove the git-dirty guard — no longer switching nodes, just editing credentials.
- Remove the profile-name QuickPick from `runSwitchProfile` — there is nothing to switch to.

**File**: `packages/vscode-extension/package.json`

- Update command titles:
  - `sesam.addProfile` → "Sesam: Configure Profile"
  - `sesam.switchProfile` → "Sesam: Reconfigure Profile"
  - `sesam.deleteProfile` → "Sesam: Remove Profile"

---

### Phase E — Migration helper (startup)

**File**: `client/src/profile-manager/profile-manager.ts` — `initProfileManager`

On first activation after this update:

1. Read `globalState` for `sesam.profileNames`.
2. For each name that also appears in the local `workspaceState` `sesam.profiles` array,
   migrate the JWT (Phase B migration in `getToken` handles this lazily, but we can also
   trigger it eagerly here for a cleaner UX).
3. After migration, do NOT clear `globalState` immediately — other still-open workspace windows
   may not have migrated yet. Instead, write a `sesam.migratedToWorkspaceScoped` flag to
   `workspaceState`; only clear `globalState` entries whose names are no longer present in any
   accessible workspace (this is best-effort and can be skipped for safety).

---

## Files changed

| File | Change |
|---|---|
| `credential-manager.ts` | `profileNames` → `workspaceState`; JWT key namespacing; migration |
| `profile-manager.ts` | `upsertProfile` → single-profile; `runAddProfile` skip QuickPick if profile exists; `runDeleteProfile` skip QuickPick; status bar wording |
| `profiles-panel.ts` | Remove "Make active"; replace "+ Add Profile" with "Reconfigure" when profile exists |
| `profiles-panel.html` | Adjust toolbar button text/visibility; hide "Make active" button |
| `package.json` | Update command titles |

---

## Backwards compatibility

- Existing `sesam.profiles` data in `workspaceState` is valid as-is — no migration needed.
- JWT tokens are migrated lazily on first `getToken` call — users will not be asked to re-enter tokens.
- The `sesam.profileNames` `globalState` key is left in place until all workspaces have migrated (safe to clean up manually via "Developer: Clear Editor History" if desired).

---

## Out of scope

- Multi-root workspaces (each root folder would need its own profile; deferred to a later feature).
- Sharing profiles between team members via `.vscode/settings.json` — tokens must never be committed.
