# F00 Decision: Monorepo Structure for sesam-ts

> **Decision**: Option A - Single monorepo (vscode-extension as a third package)
> **Status**: `decided`
> **Relates to**: [impl-f00-bundle-sesam-py.prompt.md](impl-f00-bundle-sesam-py.prompt.md)

---

## Decision Summary

`@sesam/core`, `@sesam/cli`, and the VS Code extension all live in a **single pnpm monorepo** (`sesam-ts`).
The vscode-extension repository is absorbed into `sesam-ts` as the third package.

No packages are published to any registry (npm, GitHub Packages, etc.). All cross-package references use
pnpm's `workspace:*` protocol, which resolves locally without a publish step.

---

## Options Considered

| | Option A: Monorepo | Option B: Git submodule | Option C: GitHub Packages |
|---|---|---|---|
| Repos stay separate | No | Yes | Yes |
| No publish step needed | Yes | Yes | No |
| CI complexity | Low | Medium | Low |
| Git workflow friction | Low | High | Low |
| Works across machines | Yes | Yes (after submodule init) | Yes |

**Option A chosen** because:
- Zero publish overhead during development
- `workspace:*` links mean `@sesam/core` changes are immediately reflected in both `@sesam/cli` and the extension with no extra steps
- Lowest ongoing friction for a small team / solo developer
- CI is a single pipeline

---

## Repository Layout

```
sesam-ts/                             ← monorepo root
  package.json                        ← pnpm workspaces: ["packages/*"]
  pnpm-workspace.yaml
  packages/
    core/                             ← @sesam/core  (library, bundled in extension)
      package.json
      src/
        upload.ts
        download.ts
        run.ts
        status.ts
        validate.ts
        ...
    cli/                              ← @sesam/cli   (terminal tool, drop-in sesam-py replacement)
      package.json                    ← "@sesam/core": "workspace:*"
      src/
        index.ts                      ← commander entrypoint
    vscode-extension/                 ← the VS Code extension (current repo, migrated here)
      package.json                    ← "@sesam/core": "workspace:*"
      client/
      server/
      src/
      ...
```

---

## Migration Steps (current vscode-extension repo → monorepo)

1. Create new repo `sesam-ts` with `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - 'packages/*'
   ```
2. Move the current vscode-extension contents into `packages/vscode-extension/`.
3. Create `packages/core/` and `packages/cli/` scaffolds.
4. Update the extension's `package.json` to add `"@sesam/core": "workspace:*"`.
5. Update CI workflows to run from the monorepo root (`pnpm -r build`, `pnpm -r test`).
6. Archive or redirect the old vscode-extension repo.

---

## Cross-package Dependency Graph

```
@sesam/cli  ──depends on──►  @sesam/core
vscode-extension  ──depends on──►  @sesam/core
```

`@sesam/cli` and `vscode-extension` are independent of each other.
