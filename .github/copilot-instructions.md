# GitHub Copilot Instructions

## Table of Contents

- [Project Overview](#project-overview)
- [Repository Structure](#repository-structure)
- [Language & File Conventions](#language--file-conventions)
- [Key Architectural Facts](#key-architectural-facts)
- [Development Commands](#development-commands)
- [File Naming Conventions](#file-naming-conventions)
- [Coding Conventions](#coding-conventions)
  - [Import Order](#import-order)
- [Feature Planning](#feature-planning)

## Project Overview

This is a **pnpm monorepo** (`sesam-ts`) containing a VS Code extension that provides language support for
[Sesam](https://docs.sesam.io) pipe/system configurations and DTL (Data Transformation Language).

## Repository Structure

```
packages/
  core/                  # @sesam/core — planned TS rewrite of sesam-py (not yet implemented)
  cli/                   # @sesam/cli  — planned CLI wrapper for @sesam/core (not yet implemented)
  vscode-extension/      # The VS Code extension (active development)
    client/src/          # Extension entry point (extension.ts) — VS Code API, commands, UI
    server/src/          # LSP server (server.ts) — completions, hover, diagnostics, formatting, outline
    src/shared/          # Shared code between client and server
      dtl-registry.ts    # All DTL functions and built-in variables
      dtl-evaluator.ts   # Offline DTL evaluator
      config-formatter.ts # Sesam JSON formatter (preserves key order, compact arrays)
    tests/               # Vitest unit tests
    agent/               # Feature planning docs and implementation prompts
      sesam-extension-plan.prompt.md  # Top-level product plan
      impl/README.md                  # Feature tracking table
      impl/impl-f*.prompt.md          # Per-feature implementation specs
```

## Language & File Conventions

- **Language ID**: `sesam-config` — assigned to `*.conf.pipe`, `*.conf.system`, `*.conf.json`
- Pipe configs live in `pipes/`, system configs in `systems/`
- New files created by the extension use `.conf.pipe` / `.conf.system` extensions
- All sesam-config files are auto-formatted on save (preserves key order, compact DTL arrays, multi-line objects)

## Key Architectural Facts

- The LSP server runs as a separate Node.js process; client communicates via IPC
- `server/src/server.ts` handles: completions, hover, diagnostics, formatting, document symbols (outline)
- Completions: source types (inside `"source": {}`), system types (root-level depth=1), DTL variables, DTL functions
- Trigger characters: `"`, `[`, `_`, `.`, `:`
- `config-formatter.ts` is imported by **both** client and server — do not add VS Code API dependencies to it
- `dtl-registry.ts` is the single source of truth for all DTL functions — add new functions there
- In `dtl-registry.ts`, each category has its own `PascalCase` array named `<Category>Fns` (e.g. `TransformFns`, `BooleanLogicFns`) declared `as const satisfies readonly DtlFunction[]`. The module-level `FUNCTIONS` array combines them all via spread.

## Development Commands

```bash
# From packages/vscode-extension/
pnpm build       # Build client + server with Vite
pnpm test        # Run Vitest unit tests
```

Press **F5** in VS Code to launch the extension in a new Extension Development Host window.

## File Naming Conventions

| File type | Naming | Example |
|---|---|---|
| Source module | kebab-case | `dtl-validator.ts`, `config-formatter.ts` |
| VS Code provider / class | kebab-case | `pipe-graph-provider.ts`, `pipe-outline-provider.ts` |
| Types / interfaces only | `*.types.ts` | `dtl-registry.types.ts`, `server.types.ts` |
| Utility / helper functions only | `*.utils.ts` | `string.utils.ts`, `range.utils.ts` |
| Constants only | `*.constants.ts` or `constants.ts` | `constants.ts` |
| Test file | mirrors source, `*.test.ts` | `dtl-validator.ts` → `validator.test.ts` |
| Docs / guides | kebab-case `.md` (except root `README.md`) | `copilot-agent.md`, `development.md` |

## Coding Conventions

- TypeScript strict mode; no `any` unless unavoidable
- Functions return typed objects; no `process.exit` in shared/server code
- LSP server: register capabilities in `onInitialize`, wire handlers immediately after
- Tests live in `tests/` and use Vitest (`describe`/`it`/`expect`)
- Do not sort JSON keys in the formatter — preserve insertion order
- `selectionRange` in `DocumentSymbol` must always be contained within `range`
- **Array functions over loops** — prefer `map`, `filter`, `reduce`, `flatMap`, `find`, `every`, `some` over `for`/`while` loops
- **Parentheses in conditions** — always wrap `if` / `else if` conditions in parentheses; also wrap ternary conditions when they contain operators
- **Functional Programming** — favour pure functions (no side-effects, same input → same output), immutability (`const`, spread instead of mutation), and function composition over classes with mutable state where practical
- **Breathing space** — always leave a blank line before and after `if`, `for`, and `return` statements, unless the block contains only a single statement or the `if`/`return` is the very first or last line of a block

### Import Order

Imports must be grouped with a blank line between each group, in this order:

1. **Node built-ins** (`node:path`, `node:fs`, …)
2. **Third-party packages** (`vscode`, `vscode-languageserver/node`, `vscode-languageserver-textdocument`, …)
3. **Internal / workspace modules** (relative paths: `../../src/shared/…`, `./utils`, `./constants`, …)
4. **Type-only imports** (`import type { … }`) — always last

Example:
```ts
import * as path from "node:path";

import { window, commands } from "vscode";
import { CompletionItem } from "vscode-languageserver/node";

import { formatSesamJson } from "../../src/shared/config-formatter";
import { buildDocumentSymbols } from "./utils";

import type { DtlSettings, SesamSettings } from "./types";
```

## Feature Planning

Before implementing a new feature, check `agent/impl/README.md` for its status and read the corresponding
`impl-f*.prompt.md` file for the design spec. Update the status in `README.md` when starting/finishing work.

Current phase: **Phase 1 MVP**. Priority order:
1. F00 — Bundle sesam-py (TS rewrite)
2. F01 — sesam-py Command Integration
3. F02 — Config File Intelligence
4. F03 — Secure Credential Management
