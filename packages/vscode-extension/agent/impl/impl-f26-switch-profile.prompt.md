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
`$(add) Add profile…` delegates to `runAddProfile()` without any teardown.

---

## Teardown after switch

After `setActiveProfileName(picked.label)`:

1. **Node Status panel** — `NodeStatusPanel.currentPanel?.dispose()` closes the panel and clears
   its in-memory pipe cache. A dynamic `import()` is used to avoid a circular dependency
   (`NodeStatusPanel` imports helpers from `profile-manager`):

   ```ts
   const { NodeStatusPanel } = await import("./node-status/NodeStatusPanel");
   NodeStatusPanel.currentPanel?.dispose();
   ```

2. **Status bar** — `_refreshStatusBar()` updates the status bar item label to the new profile name.

3. **Notification** — `showInformationMessage("Sesam: active profile set to '<name>'.")`.

---

## What is NOT reset on switch

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
