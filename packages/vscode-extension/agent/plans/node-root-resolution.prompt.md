# Plan: Flexible Node Root Resolution

> **Status**: `draft`
> **Context**: Multiple users have their sesam-py project rooted under a `node/` subdirectory rather than directly at the workspace root.

---

## Problem

The extension assumes `pipes/`, `systems/`, `expected/`, `testdata/`, and `variables/` live at the
workspace root. Hardcoded paths are scattered across at least 6 files:

| Hardcoded string | Consumer |
|---|---|
| `"pipes"`, `"systems"` | `extension.ts` — `newConfFile`, `duplicatePipe`, `syncDiff` |
| `"pipes"`, `"systems"` | `profile-manager.ts` — delete-on-profile-switch |
| `"expected"` | `sesam-test-controller.ts` — watcher glob, snapshot update |
| `"expected"` | `sesam-chat-participant.ts` — fix context builder |
| `"testdata"` | `PreviewPanel.ts` — entity loader glob |
| `"testdata"` | `sesam-chat-participant.ts` — LLM hints |

The test controller also derives its node root by walking `../../` up from a spec file
(`expected/<spec>.test.json` → `../../`), which breaks when the tree depth differs.

The two layouts users actually encounter:

```
# Layout A — flat (current assumption)
<workspace>/
  pipes/
  systems/
  expected/
  testdata/
  tests/
  variables/

# Layout B — node/ subdirectory
<workspace>/
  node/
    pipes/
    systems/
    expected/
    testdata/
    tests/
    variables/
  scripts/
  .github/
```

---

## Goal

All extension features (file creation, sync diff, test discovery, preview, chat participant) work
correctly regardless of whether node configs live at the workspace root or inside a subdirectory.

---

## Options

### Option 1 — `sesam.rootFolder` Configuration Setting

Add a workspace-scoped string setting `"sesam.rootFolder"` (default `"."`) that lets users declare
where the node directory is relative to the workspace root.

```jsonc
// .vscode/settings.json
{
  "sesam.rootFolder": "node"   // or "." for flat layout
}
```

All path resolution is updated to `path.join(workspaceRoot, rootFolder, "pipes")` etc.  
A helper `resolveNodePath(...segments: string[]): string` is introduced once and reused everywhere.

**Pros**
- Explicit and predictable — no magic
- Trivially version-controllable via `.vscode/settings.json`
- Single setting change fixes every affected code path

**Cons**
- Requires manual configuration; newcomers may miss it
- Default `"."` is a behaviour change for nobody (backwards compatible)

---

### Option 2 — Auto-Detection

On extension activation, probe the workspace for the presence of `pipes/` and `systems/`:

1. If `<workspaceRoot>/pipes/` and `<workspaceRoot>/systems/` both exist → root is `"."`
2. Else scan one level deep for a folder that contains both → use that folder (e.g. `"node"`)
3. Fall back to `"."` if nothing is found

Cache the detected root in `workspaceState`; re-detect after a full download.

**Pros**
- Zero configuration for users
- Handles both layouts automatically

**Cons**
- Ambiguous if both `pipes/` and `node/pipes/` exist (which wins?)
- Requires filesystem I/O on every activation
- Silent failure: if detection is wrong, features break with no obvious cause
- Does not handle custom subdirectory names other than `node/`

---

### Option 3 — `.sesamrc` Project File

Introduce a project-level JSON config file at the workspace root:

```jsonc
// .sesamrc
{
  "rootFolder": "node"
}
```

The extension reads this file at activation and uses `rootFolder` for all path resolution.  
The file is committed to source control, so all team members share the same layout.

**Pros**
- Version-controllable, shared across the team automatically
- Decoupled from VS Code settings (works with any editor tooling in theory)
- Extensible — future settings (e.g. variable environment overrides) can live here

**Cons**
- Yet another config file format users must learn
- Parsing/validation adds complexity; must handle missing file gracefully
- Conflicts with any existing `.sesamrc` convention if sesam-py already uses that name

---

### Option 4 — Advise Users to Use `.code-workspace`

Document that users with a `node/` layout should open `node/` as the workspace folder, or create a
`.code-workspace` multi-root file pointing directly at `node/`:

```jsonc
// sesam.code-workspace
{
  "folders": [{ "path": "node" }]
}
```

No code changes required.

**Pros**
- Zero implementation cost
- Already works today

**Cons**
- `.github/`, `scripts/`, and other repo files fall outside the workspace — no editor access
- Multi-root `.code-workspace` files are unfamiliar to many users
- Does not scale: chat participant, sync status, and other features use `workspaceFolders[0]`
  without awareness of a `node/` level anyway, so some features may still break
- Poor UX — users should not need to restructure their VS Code setup for the extension

---

### Option 5 — Setting + Auto-Detection Fallback (Hybrid)

Combine Options 1 and 2:

1. If `sesam.rootFolder` is explicitly set → use it unconditionally
2. Else run auto-detection (probe for `pipes/` + `systems/`) → use detected path
3. If detection finds a non-root path, show a one-time information notification:
   > "Sesam: node configs detected at `node/`. Add `"sesam.rootFolder": "node"` to `.vscode/settings.json` to make this explicit."

**Pros**
- Zero config for standard layouts, explicit override for unusual ones
- Notification teaches users the setting without forcing them to discover it
- Detection ambiguity is resolved by the explicit setting

**Cons**
- More logic than Option 1 alone — detection still has the edge cases from Option 2
- Notification may be noisy for teams that never want to set the preference explicitly

---

## Comparison

| | Option 1 | Option 2 | Option 3 | Option 4 | Option 5 |
|---|---|---|---|---|---|
| Zero config | No | **Yes** | No | No | **Yes** |
| Explicit / predictable | **Yes** | No | **Yes** | **Yes** | **Yes** |
| Version-controllable config | `.vscode/settings.json` | — | `.sesamrc` | `.code-workspace` | `.vscode/settings.json` |
| Implementation complexity | Low | Medium | Medium | None | Medium |
| Handles custom names (not `node/`) | **Yes** | No | **Yes** | Partial | **Yes** |
| Backwards compatible | **Yes** | **Yes** | **Yes** | **Yes** | **Yes** |

---

## Recommendation

**Option 5 (Hybrid)** gives the best user experience:

- Existing flat-layout users see no change — auto-detection returns `"."` and all is silent.
- `node/` layout users get automatic detection and a one-time nudge to make it explicit.
- Teams that need a non-standard subdirectory name (e.g. `sesam-node/`) can use the explicit setting.

### Central abstraction

Introduce a single helper in `src/shared/` (or `client/src/`) that owns all node-root logic:

```ts
// node-root.ts
export function getNodeRoot(workspaceRoot: string): string
export function resolveNodePath(workspaceRoot: string, ...segments: string[]): string
```

All 6+ hardcoded-path call sites are updated to call `resolveNodePath` instead of
`path.join(workspaceRoot, "pipes")` etc. The detection + setting read lives entirely inside
`getNodeRoot`, keeping every caller simple.

---

## Affected Files

| File | Change |
|---|---|
| `package.json` | Add `sesam.rootFolder` setting (type: string, default: `""`, scope: `resource`) |
| `src/shared/node-root.ts` *(new)* | `getNodeRoot()`, `resolveNodePath()`, auto-detection logic |
| `client/src/extension.ts` | Replace all `path.join(workspaceRoot, "pipes"|"systems")` with `resolveNodePath(...)` |
| `client/src/profile-manager.ts` | Replace hardcoded `"pipes"`, `"systems"` folder references |
| `client/src/testing/sesam-test-controller.ts` | Replace `../../` walk and `"expected"` glob with `resolveNodePath(...)` |
| `client/src/sesam-chat-participant.ts` | Replace `"expected"`, `"testdata"`, `"pipes"` globs/hints |
| `client/src/preview/PreviewPanel.ts` | Replace `**/testdata/` glob |
| `server/src/utils/workspace-index.ts` | Optionally scope scan start to node root rather than full workspace |
