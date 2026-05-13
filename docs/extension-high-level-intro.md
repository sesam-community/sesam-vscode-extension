# Sesam VS Code Extension — High-Level Intro

> A quick breakdown for new contributors covering what the extension does, how it's architected, and how the agentic coding workflow is structured.

---

## Table of Contents

- [What It Is](#what-it-is)
- [Core Capabilities](#core-capabilities)
- [Architecture in a Nutshell](#architecture-in-a-nutshell)
  - [Monorepo packages](#monorepo-packages)
  - [Inside the extension](#inside-the-extension)
- [Agentic Coding Workflow](#agentic-coding-workflow)
  - [Key files](#key-files)
  - [Available skills](#available-skills)
  - [Typical agentic flow](#typical-agentic-flow)
- [Feature Status Snapshot](#feature-status-snapshot)
- [Quick Start for Contributors](#quick-start-for-contributors)

---

## What It Is

- A **VS Code extension** providing first-class IDE support for [Sesam](https://docs.sesam.io) — a DataHub / integration platform
- Lives in a **pnpm monorepo** (`sesam-ts`) alongside `@sesam/core` (TS rewrite of the Python CLI) and `@sesam/cli` (terminal wrapper)
- Distributed as a VSIX via **GitHub Releases** (not the Marketplace — private repo)

---

## Core Capabilities

- **DTL language support** — syntax highlighting, autocompletion, hover docs, linting, formatter
- **Config file intelligence** — auto-format on save, key-order-preserving formatter
- **Node connectivity** — upload/download/run/verify commands, live updates via Socket.IO, status bar
- **Navigation** — Go to Definition, Find All References, Rename (rules, aliases, datasets, cross-file)
- **Pipe DAG** — tree views for lineage & dependents, system pipes view
- **Live Preview** — entity viewer webview panel, entity search
- **Test integration** — VS Code Testing API wired to the sesam test runner
- **Profiles** — secure credential management, workspace-scoped profiles, safe profile switching
- **Copilot `@sesam` agent** — LM Tools API + custom Copilot Chat participant

---

## Architecture in a Nutshell

### Monorepo packages

| Package | Name | Role |
|---|---|---|
| `packages/core/` | `@sesam/core` | Pure TypeScript library for all Sesam node operations (upload, download, run, test, diff, …). No CLI deps — all functions return typed objects. Bundled inside the VSIX so no `pip install` is ever needed. |
| `packages/cli/` | `@sesam/cli` | Thin shell around `@sesam/core` using `commander`. Drop-in terminal replacement for `sesam-py`. NOT bundled in the VSIX — published separately for terminal users. |
| `packages/vscode-extension/` | `dtl-language-support` | The VS Code extension itself (publisher: `bouvet`, distributed as a VSIX via GitHub Releases). |

### Inside the extension

| Layer | Path | Responsibility |
|---|---|---|
| **Client** | `client/src/` | VS Code API, commands, UI, webviews |
| **LSP Server** (`Language Server Protocol`) | `server/src/` | Completions, hover, diagnostics, formatting, outline — runs as a separate Node.js process, communicates with the client via IPC |
| **Shared** | `src/shared/` | `dtl-registry.ts`, `dtl-evaluator.ts`, `config-formatter.ts` — no VS Code deps, imported by both client and server |

> `config-formatter.ts` is imported by **both** client and server — never add VS Code API dependencies to it.

---

## Agentic Coding Workflow

The project is built with Copilot-driven development in mind. Everything is documented so an AI agent can pick up a feature and implement it end-to-end.

### Key files

| File / Folder | Purpose |
|---|---|
| [`.github/copilot-instructions.md`](../.github/copilot-instructions.md) | Project-wide conventions injected into every Copilot session (coding style, import order, architecture rules) |
| [`agent/sesam-extension-plan.prompt.md`](../packages/vscode-extension/agent/sesam-extension-plan.prompt.md) | Top-level product plan — the "source of truth" for _what_ the extension should become |
| [`agent/impl/README.md`](../packages/vscode-extension/agent/impl/README.md) | Feature tracking table (~30 features), each with a status badge |
| [`agent/impl/impl-fXX-*.prompt.md`](../packages/vscode-extension/agent/impl/) | Per-feature design specs; Copilot reads these before implementing |
| [`agent/plans/*.prompt.md`](../packages/vscode-extension/agent/plans/) | Freeform planning docs for cross-cutting concerns (release, E2E tests, large workspace optimization, etc.) |
| [`.agents/skills/`](../.agents/skills/) | Reusable Copilot skill files loaded on demand |

### Available skills

| Skill | When to invoke |
|---|---|
| `impl-feature` | Implement a planned feature end-to-end from its spec |
| `dtl-function` | Add a DTL built-in to the registry + evaluator + tests |
| `lsp-handler` | Add a new LSP capability to the server |
| `tdd` | Red-green-refactor loop with interface-design and mocking guides |
| `debug-lsp` | Diagnose why an LSP feature is firing incorrectly or not at all |
| `improve-codebase-architecture` | Review code for architectural fit (layer placement, import discipline) |
| `release` | Cut a versioned release — changelog, version bump, VSIX build, GitHub Release |
| `create-pr-description` | Generate a PR description from the current git diff + impl spec |
| `grill-me` | Interview the user relentlessly about a plan until reaching shared understanding |

### Typical agentic flow

1. Open `agent/impl/README.md` — find the feature you want to work on
2. Read the corresponding `impl-fXX-*.prompt.md` spec
3. Ask Copilot: _"Implement F19 using the impl-feature skill"_
4. Agent reads the spec, implements, writes tests, updates `README.md` status to `implemented`

---

## Feature Status Snapshot

| Phase | Goal | Status |
|---|---|---|
| **Phase 1 — MVP** | Zero-install, daily command loop, editor intelligence | Fully implemented |
| **Phase 2 — Testing & Diff** | VS Code Testing API, status/diff view | Mostly implemented |
| **Phase 3 — Node Connectivity** | Live preview, inline diagnostics | Preview done; inline diagnostics planned |
| **Phase 4 — AI & Visual** | `@sesam` Copilot agent, interactive pipe graph | Agent done; graph planned |
| **Phase 5 — Management Studio** | Full Studio parity in VS Code | Planned |

Full table: [`agent/impl/README.md`](../packages/vscode-extension/agent/impl/README.md)

---

## Quick Start for Contributors

```bash
# Install dependencies (from repo root)
pnpm install

# Build the extension
cd packages/vscode-extension
pnpm build

# Run unit tests
pnpm test

# Launch in Extension Development Host
# Press F5 in VS Code
```

See [packages/vscode-extension/docs/development.md](../packages/vscode-extension/docs/development.md) for a full development guide.
