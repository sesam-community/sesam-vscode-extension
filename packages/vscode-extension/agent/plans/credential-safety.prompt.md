# Credential Safety — Design Options

> **Context:** F03 (Secure Credential Management) introduced named profiles stored in SecretStorage.
> The risk: a developer may forget to switch profiles and accidentally run a destructive command
> (upload, wipe, sync) against the wrong Sesam node — most critically, production.

---

## The Core Problem

- Profile/JWT is global (SecretStorage, `globalState`).
- The active profile is workspace-scoped (`sesam.activeProfile` in `.vscode/settings.json`),
  but `.vscode/settings.json` may not be committed, and changes silently between repo checkouts.
- There is currently no connection between a repo and its intended Sesam node.
- Result: a developer can open any repo, be on the `prod` profile, and upload without any warning.

---

## Option A — Show node hostname in the status bar

**Cost:** Very low — one-line change to `_refreshStatusBar()`.

**How it works:**
Change the status bar item from:
```
$(key) Sesam: [prod]
```
to:
```
$(key) prod · datahub-abc123.sesam.cloud
```

**Pros:**
- Zero extra concepts or files.
- The URL is an immediate visual cue — a developer glancing at the status bar knows instantly
  which node they're targeting.

**Cons:**
- Passive only — does not prevent mistakes, just makes them more visible.
- Still requires the developer to notice.

**Verdict:** Should be done regardless of which other option is chosen. It's a free safety net.

---

## Option B — Danger-zone labels + confirmation for destructive commands

**Cost:** Medium — requires F01 (command integration) to be in place first.

**How it works:**
1. Add a `"production": true` flag to profile metadata.
2. When a destructive command (upload, wipe, sync) targets a production-flagged profile,
   show a modal requiring the user to type the profile name to confirm — similar to GitHub's
   repo-deletion dialog.

**Pros:**
- Catches accidental use of the wrong profile even without a lockfile.
- The confirmation friction is proportional to the risk.

**Cons:**
- Relies on the developer having correctly flagged the profile as production.
- Does not help if the profile is simply misconfigured or mislabelled.
- Adds friction to legitimate production workflows.

**Verdict:** Useful as a belt-and-suspenders addition on top of Option C. Not sufficient alone.

---

## Option C — `.sesamprofile` lock file committed to the repo

**Cost:** Medium — new file format, workspace-open listener, validation logic.

**How it works:**
A small JSON file at the repo root, committed to source control:

```json
{
  "nodeUrl": "https://datahub-dev-abc123.sesam.cloud"
}
```

On workspace open (and on file change), the extension reads `.sesamprofile` and compares
`nodeUrl` against the active profile's resolved node URL. Three possible states:

| State | Status bar | Behaviour |
|---|---|---|
| `.sesamprofile` absent | Normal | No validation — works as today |
| Match | Green / normal | No warnings |
| Mismatch | Yellow warning badge | Notification on activation; destructive F01 commands show a confirmation modal |

The mismatch modal for destructive commands:
> ⚠ The active profile targets `datahub-prod-xyz.sesam.cloud` but this repo expects
> `datahub-dev-abc123.sesam.cloud`. Continue anyway?
> [Cancel] [Override — I know what I'm doing]

**Pros:**
- The repo encodes its intended node. A new team member cloning the repo is immediately
  validated against the right endpoint.
- Works with both single-profile and multi-profile setups.
- Same pattern as `.nvmrc`, `.python-version`, `.tool-versions` — idiomatic and familiar.

**Cons:**
- Requires `.sesamprofile` to exist and be committed (teams must adopt the convention).
- Teams using gitignored `.vscode/settings.json` for `sesam.activeProfile` must also commit
  `.sesamprofile` — two files to maintain.

**Verdict:** The most robust solution. Recommended as the primary safety mechanism.

---

## Option D — Single profile (keyed by node URL, no profile names)

**Cost:** Low-to-medium — simplifies the existing F03 model, removes the profile-name concept.

**How it works:**
- Drop named profiles entirely.
- Store JWTs keyed by node URL: `sesam.jwt.https://datahub-abc123.sesam.cloud`.
- `.sesamprofile` (or `sesam.nodeUrl` setting) declares the active node URL for the workspace.
- The extension automatically resolves the JWT for that URL — no "switch profile" needed.
- Status bar shows the node hostname; nothing more.

```
sesam.setToken → prompts for nodeUrl + JWT, stores under URL key
sesam.deleteToken → lists known URLs, deletes selected
```

**Pros:**
- Eliminates the "wrong profile" risk entirely — the repo defines the node, not the developer.
- Fewer concepts (no active profile, no switching).
- A team member cloning the repo targets the correct node automatically.

**Cons:**
- Less flexible for power users who need to point the same repo at different nodes
  (e.g. dry-run on staging, then deploy to prod).
- Requires refactoring the existing F03 credential-manager / profile-manager code.

**Verdict:** Ideal for teams with a simple single-node-per-repo setup. Could be the default
with multi-profile as an explicit opt-in power-user feature.

---

## Recommended Combination

**Immediate (no F01 dependency):**
1. **Option A** — Show node hostname in status bar. Ship now, zero risk.
2. **Option C** — `.sesamprofile` lockfile support: read file, compare, warn on mismatch.

**When F01 (command integration) ships:**
3. **Option B** — Block / confirm before destructive commands on mismatched node.

**Longer term:**
4. Evaluate **Option D** (single-profile) as a simplification once real usage patterns
   are understood. If most teams use one node per repo, make D the default and treat
   named profiles as an advanced mode.

---

## Files to Create / Modify

| File | Change |
|---|---|
| `client/src/profile-manager.ts` | Option A: update `_refreshStatusBar()` to include node hostname |
| `client/src/sesamprofile-watcher.ts` (new) | Option C: read `.sesamprofile`, compare to active profile, emit mismatch events |
| `client/src/extension.ts` | Option C: init watcher on activate, show warning notification on mismatch |
| `.sesamprofile` (repo root, user creates) | Option C: lockfile committed by the team |
| `package.json` | Option C: add `sesam.ignoreProfileMismatch` boolean setting (default `false`) |

---

## `.sesamprofile` Schema

```jsonc
{
  // Required: the expected Sesam node URL for this repo.
  "nodeUrl": "https://datahub-dev-abc123.sesam.cloud"
}
```

Future extensions (not in scope for initial implementation):
- `"allowedProfiles": ["dev", "staging"]` — whitelist of profiles permitted for this repo
- `"warnOnlyProfiles": ["staging"]` — warn but don't block for these profiles
- `"blockProfiles": ["prod"]` — always block, no override
