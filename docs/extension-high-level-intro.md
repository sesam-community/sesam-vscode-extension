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
- [Development Statistics](#development-statistics)
  - [Output](#output)
  - [Process](#process)
  - [Timeline](#timeline)
- [Agentic Coding Insights](#agentic-coding-insights)
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

> For a guided walkthrough of all features with demo steps, see [docs/team-intro-session.md](team-intro-session.md).

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

1. Ask Copilot: **"What's next?"**
2. Agent reads [`agent/impl/README.md`](../packages/vscode-extension/agent/impl/README.md), finds the highest-priority feature still marked `planned`, and reads its spec
3. Agent proposes (or immediately starts) the implementation
4. Agent writes tests and updates `README.md` status to `implemented`

You can also target a specific feature: _"Implement F19 using the impl-feature skill"_ — the agent goes straight to that spec.

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

## Development Statistics

> Numbers as of v0.2.0 (13 May 2026) — 61 days after project start.

### Output

| Metric | Value |
|---|---|
| Project started | **Friday, March 13, 2026** |
| Time to first public release (v0.1.0) | **46 days** (28 Apr 2026) |
| Current version (v0.2.0) | 13 May 2026 |
| Total calendar days | 61 |
| Total commits | **549** (~9 commits/day average) |
| Merged pull requests | 50+ |
| Contributors | 1 (solo) |
| TypeScript source files | 77 (extension) + 26 (`@sesam/core`) = **103** |
| Test files | 21 |
| DTL functions in registry | ~429 entries, 2,513 lines (`dtl-registry.ts`) |
| Features tracked | ~30 |
| Features implemented | ~25 (~3 features/week) |
| Planning / spec prompt files | 37 (`agent/impl/` + `agent/plans/`) |

### Process

| Practice | How it was applied |
|---|---|
| **Branch-per-feature** | Every feature developed on a named branch; merged via PR — even as a solo developer |
| **Conventional commits** | `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `build:` prefixes throughout |
| **Spec-before-code** | Each feature has a `impl-fXX-*.prompt.md` written before the first line of code |
| **Agentic implementation** | Copilot agent reads the spec, implements, writes tests, and updates the status table |
| **Test coverage** | 21 Vitest test files covering LSP, formatter, evaluator, parser, DAG, and cross-references |
| **Continuous release** | GitHub Actions builds VSIX + installer on every release tag; no manual packaging |
| **Skills as process templates** | `.agents/skills/` codify how to add a feature, DTL function, or LSP handler — enforcing consistency across sessions |

### Timeline

| Date | Milestone |
|---|---|
| **13 Mar 2026** (Friday) | Initial commit — DTL syntax highlighting, completions, formatter |
| 18–19 Mar 2026 | Feature planning docs added (`agent/impl/`, `agent/plans/`) |
| 20 Mar 2026 | Formatter, source-type autocomplete, New Config File command |
| 24–25 Mar 2026 | Go to Rule Definition, Pipe Lineage/Dependents DAG, alias rename |
| 26 Mar 2026 | DTL linting (inline diagnostics) shipped |
| 27–30 Mar 2026 | Pipe Preview (offline entity viewer) |
| 1 Apr 2026 | Live node-backed preview, initial credential prompt |
| 13 Apr 2026 | Secure Credential Management, `@sesam/core` initial impl |
| 14 Apr 2026 | Upload/Download commands, Network Status Bar |
| 15 Apr 2026 | Node Status table, single-file upload/download |
| 16 Apr 2026 | Profile switching, first internal release tag |
| 20 Apr 2026 | Sync Status & Diff view, live updates via Socket.IO |
| 28 Apr 2026 | **v0.1.0** — first public GitHub Release (VSIX + installer) |
| 30 Apr 2026 | Permissions autocomplete / hover |
| 5–8 May 2026 | Large workspace support, entity search in preview panel |
| 13 May 2026 | **v0.2.0** released |

---

## Agentic Coding Insights

This project was built almost entirely through **Copilot agent sessions** — not just code generation, but structured AI-driven development. Key observations:

- **Spec-first discipline pays off** — writing `impl-fXX-*.prompt.md` before coding forces clarity on scope. The agent rarely went off-track when given a tight spec.
- **Skills as reusable prompts** — packaging common workflows (TDD, LSP handler, DTL function) into `.agents/skills/` meant each new feature started from a consistent baseline, not from scratch.
- **`README.md` as a live contract** — the feature tracking table in `agent/impl/README.md` doubled as the agent's task queue. "What's next?" became a reliable entrypoint that needed no human translation.
- **One developer, ~550 commits in 2 months** — the velocity only made sense with agentic coding. The agent handled boilerplate, test scaffolding, and LSP wiring while the developer stayed at the design level.
- **Trust boundaries matter** — the agent was trusted for implementation but the developer reviewed every diff. Architectural decisions (layer placement, shared code rules) were encoded in `copilot-instructions.md` so the agent wouldn't drift.
- **Context files are load-bearing** — `copilot-instructions.md`, the skill files, and the spec files are not documentation after the fact. They are the mechanism that makes the agent work correctly.

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
