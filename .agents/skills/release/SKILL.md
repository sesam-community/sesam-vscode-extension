---
name: release
description: Cut a new versioned release of the DTL Language Support extension — verify readiness, update the changelog, bump the version, build the VSIX, and create a GitHub Release. Use when the user wants to release a new version, cut a release, or asks "is X.Y.Z ready to ship?".
---

# Release Workflow

A structured checklist for shipping a new version of the **DTL Language Support** extension.
The source of truth for what belongs in each release is `packages/vscode-extension/agent/plans/release-plan.prompt.md`.

---

## Step 1 — Identify the target version

1. Read `packages/vscode-extension/agent/plans/release-plan.prompt.md` in full.
2. Note the `[Unreleased]` section — these are the changes that will form the new release.
3. Determine the next version number from the **Release Roadmap Summary** table.  
   - If the user has not specified a version, propose the next planned version and confirm.
4. Check `packages/vscode-extension/package.json` `"version"` field to confirm the current published version.

---

## Step 2 — Verify feature readiness

Read `packages/vscode-extension/agent/impl/README.md` and cross-check every feature listed in
the `[Unreleased]` section of the changelog against the tracking table:

- Every F-number in `[Unreleased]` **must** have status `implemented` (or `fully implemented`).
- Any feature with status `in progress`, `phase N implemented`, or `planned` is **not ready**.

If any feature is not ready, report it to the user and stop. Do not proceed with a partial release
unless the user explicitly asks to defer the unready features to the next version.

---

## Step 3 — Update the changelog

Edit `packages/vscode-extension/agent/plans/release-plan.prompt.md`:

1. **Rename `[Unreleased]`** to `[X.Y.Z] — YYYY-MM-DD` (today's date, ISO 8601).
2. **Add a fresh empty `[Unreleased]` section** at the top (above the new versioned entry):
   ```md
   ## [Unreleased]

   _(nothing yet)_
   ```
3. **Update the comparison links** at the bottom of the file:
   - Change `[unreleased]: .../compare/vX.Y.Z-prev...HEAD` to point from the new tag to `HEAD`.
   - Add a new versioned link: `[X.Y.Z]: .../compare/vX.Y.Z-prev...vX.Y.Z`.

---

## Step 4 — Bump the version

Edit `packages/vscode-extension/package.json`:

- Set `"version"` to the new version string (e.g. `"0.2.0"`).

No other files need manual version bumps — `package.json` is the single source of truth for
the VSIX version.

---

## Step 5 — Build the VSIX

From `packages/vscode-extension/`:

```bash
pnpm build
pnpm exec vsce package --no-dependencies --out sesam-X.Y.Z.vsix
```

Verify the output file exists and note its size. A healthy build is typically 1–5 MB.

---

## Step 6 — Smoke test

Before tagging, do a quick manual smoke test in the Extension Development Host:

1. Install the built VSIX locally:
   ```bash
   code --install-extension sesam-X.Y.Z.vsix
   ```
2. Reload VS Code and open a `.conf.pipe` file.
3. Confirm the extension activates and the status bar item appears.
4. Spot-check the headline features from `[Unreleased]` — one positive case each is enough.

If the smoke test fails, fix the issue, rebuild (Step 5), and re-test before continuing.

---

## Step 7 — Commit and tag

```bash
git add packages/vscode-extension/package.json \
        packages/vscode-extension/agent/plans/release-plan.prompt.md
git commit -m "chore(release): v X.Y.Z"
git tag vX.Y.Z
git push origin HEAD --tags
```

> **Confirm with the user before running `git push`.** Pushing tags triggers the GitHub release
> CI and cannot be undone easily.

---

## Step 8 — Create the GitHub Release

Using the GitHub CLI or the GitHub web UI:

```bash
gh release create vX.Y.Z sesam-X.Y.Z.vsix \
  --title "v X.Y.Z — <release theme from roadmap>" \
  --notes-file <(echo "See [CHANGELOG](packages/vscode-extension/agent/plans/release-plan.prompt.md) for full details.")
```

The VSIX is the primary distributable — users install via:
```bash
code --install-extension sesam-X.Y.Z.vsix
```

---

## Step 9 — Post-release housekeeping

- Update `agent/impl/README.md` if any feature status notes refer to "unreleased" work — they are now shipped.
- Announce the release in the team channel / PR if applicable.
- Confirm the next planned version is noted in the **Release Roadmap Summary** table.

---

## Quick Reference — Version → Theme mapping

| Version | Theme | Gate features |
|---|---|---|
| 0.1.0 | Foundation | F00, F01, F03, F04, F09, F12–F26 |
| 0.2.0 | Testing & Diff | F05, F06 |
| 0.3.0 | Node Diagnostics | F10 |
| 0.4.0 | Visual & AI Polish | F07/F15, F08 |
| 1.0.0 | Management Studio | F02, F11 |
