# GitHub Copilot Instructions

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

## Development Commands

```bash
# From packages/vscode-extension/
pnpm build       # Build client + server with Vite
pnpm test        # Run Vitest unit tests
```

Press **F5** in VS Code to launch the extension in a new Extension Development Host window.

## Coding Conventions

- TypeScript strict mode; no `any` unless unavoidable
- Functions return typed objects; no `process.exit` in shared/server code
- LSP server: register capabilities in `onInitialize`, wire handlers immediately after
- Tests live in `tests/` and use Vitest (`describe`/`it`/`expect`)
- Do not sort JSON keys in the formatter — preserve insertion order
- `selectionRange` in `DocumentSymbol` must always be contained within `range`

## Feature Planning

Before implementing a new feature, check `agent/impl/README.md` for its status and read the corresponding
`impl-f*.prompt.md` file for the design spec. Update the status in `README.md` when starting/finishing work.

Current phase: **Phase 1 MVP**. Priority order:
1. F00 — Bundle sesam-py (TS rewrite)
2. F01 — sesam-py Command Integration
3. F02 — Config File Intelligence
4. F03 — Secure Credential Management
