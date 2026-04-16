# F26: Safe Profile Switching

> **Status**: `implemented`
> **Rollout Phase**: Phase 1
> **Tracking**: [README.md](README.md)

---

## Summary

Switching Sesam profiles means switching the target node. Doing so while local files contain
unsaved edits or uncommitted git changes risks silently applying work from one environment to
another. This feature adds two safety guards that block the switch if the workspace is dirty,
and cleans up node-specific UI state (Node Status panel) after a successful switch.

---

## Guards (evaluated in order before showing the profile picker)

### 1 — Unsaved files

```ts
const dirtyFiles = vscode.workspace.textDocuments.filter((d) => d.isDirty && !d.isUntitled);
```

If any open document has unsaved changes, the switch is aborted with a warning notification
listing the relative paths of the dirty files:

> **Sesam: Save all files before switching profiles. Unsaved: pipes/my-pipe.conf.json**

Untitled (never-saved) documents are excluded — they are not part of any profile's workspace.

### 2 — Uncommitted git changes

Uses the built-in VS Code git extension (`vscode.git`) via its public API (version 1):

```ts
const gitExt = vscode.extensions.getExtension("vscode.git");
const git   = gitExt.isActive ? gitExt.exports : await gitExt.activate();
const api   = git.getAPI(1);
const repo  = api.repositories[0];  // first workspace repository
```

Blocking condition — any of the following is non-zero:

| Source | Property |
|---|---|
| Unstaged working tree changes | `repo.state.workingTreeChanges.length` |
| Staged index changes | `repo.state.indexChanges.length` |

If the total is > 0, the switch is aborted:

> **Sesam: Commit or stash all changes before switching profiles.**

**Graceful degradation**: if the `vscode.git` extension is not available (e.g. non-git workspace,
extension disabled), this guard is skipped entirely and the switch proceeds normally.

---

## Profile picker

After both guards pass, `showQuickPick` presents the profile list as before. Picking
`$(add) Add profile…` delegates to `runAddProfile()` without any further steps.

---

## Confirmation dialog

Before switching, the extension compares the current profile's `nodeUrl` with the target profile's
`nodeUrl` (via `resolveNodeUrl()`).

### Same node URL (or either URL is unknown)

A simple modal confirmation is shown:

> **Sesam: Switch profile to 'staging'?**
> Switch to profile 'staging'?
> [ Switch ] [ Cancel ]

### Different node URL

A richer modal is shown that makes the destructive consequence explicit:

> **Sesam: Switch profile to 'prod'?**
> Switching from https://datahub-dev-xxx.sesam.cloud to https://datahub-prod-yyy.sesam.cloud.
>
> Local configs (pipes/ and systems/) will be deleted and replaced with a fresh download from the new node.
> [ Switch & Download ] [ Cancel ]

---

## Teardown after switch

After `setActiveProfileName(picked.label)` and `_refreshStatusBar()`:

1. **Node Status panel** — dynamically imported `NodeStatusPanel.currentPanel?.dispose()`.
2. **Status bar** — updated to new profile.

### When node URL changed

3. **Delete local configs** — `vscode.workspace.fs.delete(folderUri, { recursive: true })` for
   both `pipes/` and `systems/` under the first workspace folder. Missing folders are silently
   ignored. Runs under a progress notification "Sesam: Switching node…".

4. **Download from new node** — `vscode.commands.executeCommand("sesam.download")`. This reuses
   the full existing download flow (credential resolution, `ensureNodeReady`, progress
   notification, formatting, key-reordering). The download command shows its own "Download will
   overwrite…" confirmation — this is intentional as a final safety check before writing to disk.

### When node URL unchanged

3. `showInformationMessage("Sesam: active profile set to '<name>'.")` — no file operations.

---

| State | Reason |
|---|---|
| Local pipe/system config files on disk | Not owned by the extension |
| Sesam output channel history | Useful for debugging; user can clear manually |
| PreviewPanel | Stays open; reloads against the new node on next evaluation |
| Provisioning poller | Already guards against cross-node interference via `subId` |
| DAG index / lineage tree | Rebuilt from local files — not node-specific |

---

## Implementation location

All logic lives in `runSwitchProfile()` in `client/src/profile-manager.ts`.
No new files were added.

---

## File Checklist

| File | Change |
|---|---|
| `client/src/profile-manager.ts` | Added dirty-file guard, git guard, and NodeStatusPanel teardown to `runSwitchProfile()` |

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| User switches to the already-active profile | Guards run, teardown runs — profile is "re-set" to itself (harmless) |
| Git repo has untracked files | `workingTreeChanges` includes untracked items → blocked |
| Multiple git repositories in workspace | Only the first (`repositories[0]`) is checked |
| Git extension busy / not yet activated | `await gitExt.activate()` is called; if it throws, the error propagates and the switch is aborted |
| No git repo in workspace | `api.repositories` is empty → guard skipped, switch proceeds |
