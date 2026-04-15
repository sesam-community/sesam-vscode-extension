# sesam-ts

Monorepo for the Sesam TypeScript ecosystem. Contains three packages:

| Package | Path | Description | Status |
|---|---|---|---|
| `@sesam/core` | [`packages/core`](packages/core) | Pure TypeScript library — typed API for all Sesam node operations | ✅ implemented |
| `@sesam/cli` | [`packages/cli`](packages/cli) | Drop-in sesam-py replacement for the terminal (wraps `@sesam/core`) | ✅ implemented |
| VS Code extension | [`packages/vscode-extension`](packages/vscode-extension) | Full-featured VS Code extension for Sesam DTL development | 🔄 in progress |

## Getting started

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test
```

## Using the CLI

See [packages/cli/README.md](packages/cli/README.md) for full usage.

Quick start with a `.syncconfig` file in your project directory:

```
NODE=https://datahub-xxxx.sesam.cloud
JWT=eyJ...
```

```bash
# Install globally
cd packages/cli && pnpm link --global

# Then from any sesam project directory:
sesam status
sesam download
sesam upload
sesam run
sesam validate
```

## Architecture

```
@sesam/cli  ──depends on──►  @sesam/core
vscode-extension  ──depends on──►  @sesam/core
```

See [`packages/vscode-extension/agent/impl/impl-f00-monorepo-structure.prompt.md`](packages/vscode-extension/agent/impl/impl-f00-monorepo-structure.prompt.md) for the full architectural decision record.
