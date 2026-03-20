# Distribution: Internal VS Code Extension Distribution

> **Decision**: VSIX published to GitHub Releases (private monorepo)
> **Status**: `decided`
> **Relates to**: [impl-f00-bundle-sesam-py.prompt.md](impl-f00-bundle-sesam-py.prompt.md), [impl-f00-monorepo-structure.prompt.md](impl-f00-monorepo-structure.prompt.md)

---

## Decision Summary

The VS Code extension is **not published to the Microsoft Marketplace or Open VSX**. Instead, the CI
pipeline builds a `.vsix` file on each release tag and attaches it to a **GitHub Release** in the private
`sesam-ts` monorepo. Team members install it directly via the VS Code CLI.

---

## Options Considered

| | Option A: VSIX + GitHub Releases | Option B: Shared file location | Option C: Open VSX (self-hosted) | Option D: Azure Artifacts |
|---|---|---|---|---|
| Infrastructure to maintain | None | None | Yes (server) | Yes (Azure DevOps org) |
| CI integration | Easy | Easy | Medium | Medium |
| Auto-updates | No (manual install) | No | Yes | Yes |
| Access control | GitHub repo permissions | Network/intranet ACL | Custom | Azure permissions |
| Effort | Low | Trivial | High | Medium |

**Option A chosen** because:
- Zero infrastructure — GitHub Release is already available in the monorepo
- CI automation is a single `vsce package` + `gh release upload` step
- Access controlled by GitHub repo permissions (same as the code)
- Auto-updates are not critical for a small internal team

---

## Install Flow

### First install

```bash
# Download the latest release asset
gh release download --repo <org>/sesam-ts --pattern "*.vsix" --dir /tmp/sesam

# Install into VS Code
code --install-extension /tmp/sesam/sesam-*.vsix
```

Or: download the `.vsix` manually from the GitHub Releases page and run:
```bash
code --install-extension sesam-x.y.z.vsix
```

### Updating

Same flow — install the new `.vsix` over the existing version. VS Code handles the upgrade gracefully.

A convenience script (`scripts/install-extension.sh`) can be committed to the monorepo to wrap the above:
```bash
#!/usr/bin/env bash
set -euo pipefail
LATEST=$(gh release view --repo <org>/sesam-ts --json tagName -q .tagName)
gh release download "$LATEST" --repo <org>/sesam-ts --pattern "*.vsix" --dir /tmp/sesam-install
code --install-extension /tmp/sesam-install/*.vsix
echo "Installed sesam extension $LATEST"
```

---

## CI Pipeline (GitHub Actions)

Add a release job to `.github/workflows/release.yml` in the monorepo:

```yaml
jobs:
  release-extension:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install
      - run: pnpm --filter vscode-extension build
      - run: pnpm --filter vscode-extension exec vsce package --out sesam-${{ github.ref_name }}.vsix
      - uses: softprops/action-gh-release@v2
        with:
          files: sesam-${{ github.ref_name }}.vsix
```

Triggered on a version tag push (e.g. `v1.2.3`).

---

## Note on Marketplace

The extension will **never** be submitted to:
- [Visual Studio Marketplace](https://marketplace.visualstudio.com)
- [Open VSX Registry](https://open-vsx.org)

The `package.json` should omit `publisher` or set it to a placeholder to prevent accidental publishing.
Add a pre-publish guard in `package.json`:

```json
"scripts": {
  "vscode:prepublish": "echo 'This extension is for internal use only. Do not publish to the marketplace.' && exit 1"
}
```
