# sesam-ts

Monorepo for the Sesam TypeScript ecosystem. Contains three packages:

| Package | Path | Description |
|---|---|---|
| `@sesam/core` | [`packages/core`](packages/core) | Pure TypeScript library — typed API for all Sesam node operations |
| `@sesam/cli` | [`packages/cli`](packages/cli) | Drop-in sesam-py replacement for the terminal (wraps `@sesam/core`) |
| VS Code extension | [`packages/vscode-extension`](packages/vscode-extension) | Full-featured VS Code extension for Sesam DTL development |

## Getting Started

```bash
# Install all dependencies across packages
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test
```

See each package's `README.md` for package-specific documentation.

## Architecture

```
@sesam/cli  ──depends on──►  @sesam/core
vscode-extension  ──depends on──►  @sesam/core
```

See [`packages/vscode-extension/agent/impl/impl-f00-monorepo-structure.prompt.md`](packages/vscode-extension/agent/impl/impl-f00-monorepo-structure.prompt.md) for the full architectural decision record.
