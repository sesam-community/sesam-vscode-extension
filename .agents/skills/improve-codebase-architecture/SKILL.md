---
name: improve-codebase-architecture
description: Review new or existing code for architectural fit in this monorepo — correct layer placement, import discipline, deep-module design, and coding conventions. Use when reviewing a PR, refactoring a module, or asking "where should this code live?".
---

# Improve Codebase Architecture

A structured review against the layering rules, coding conventions, and design principles of this
monorepo (`sesam-ts`).

## Layer map

```
packages/core/src/            @sesam/core — pure Node.js, no VS Code, no LSP
packages/cli/src/             @sesam/cli  — thin CLI wrapper around @sesam/core
packages/vscode-extension/
  src/shared/                 shared between client AND server — no vscode, no vscode-languageserver
  server/src/                 LSP server — vscode-languageserver/node only, no vscode
  client/src/                 VS Code extension host — vscode only, no vscode-languageserver/node
```

**Golden rule**: dependencies only flow downward. `client/` may import `shared/`; `server/` may
import `shared/`; neither may import from the other. `shared/` imports nothing from either.

---

## Checklist

### 1. Is the code in the right layer?

| Code type | Correct location |
|---|---|
| Pure data transformation (no I/O) | `src/shared/` or `packages/core/src/` |
| LSP types, completion builders, diagnostic builders | `server/src/utils/` |
| VS Code commands, tree providers, webviews, status bar | `client/src/` |
| Node HTTP calls, file I/O, zip | `packages/core/src/` |
| CLI argument parsing | `packages/cli/src/` |

Flag any `vscode` import in `server/` or `shared/`, and any `vscode-languageserver` import in
`client/` or `shared/`.

### 2. Import order

Groups must be separated by a blank line, in this order:

1. Node built-ins (`node:path`, `node:fs`)
2. Third-party packages (`vscode`, `vscode-languageserver/node`, external npm)
3. Internal / workspace modules (relative paths)
4. Type-only imports (`import type { … }`) — always last

### 3. Deep modules

Prefer **small interface, deep implementation**. Ask:

- Can the caller do their job without knowing how this works internally?
- Is there a simpler function signature that hides the complexity?
- Are there helper functions leaking into exports that callers don't need?

Unexported helpers stay unexported. Exported symbols should form a minimal, stable API.

### 4. Functional style

- Prefer `map` / `filter` / `flatMap` / `find` over `for` / `while` loops.
- Prefer `const` and spread (`{ ...obj, key: val }`) over mutation.
- No `any` unless truly unavoidable — use `unknown` + narrowing instead.
- Pure functions: same input → same output, no hidden state.

### 5. Coding conventions

- `as const satisfies readonly DtlFunction[]` for registry arrays in `dtl-registry.ts`.
- Blank line before and after `if`, `for`, `return` — except when it's the only statement in a block or the first/last line.
- `selectionRange` in `DocumentSymbol` must always be contained within `range`.
- Do not sort JSON keys in the formatter — preserve insertion order.
- New source files: `kebab-case.ts`; type-only files: `*.types.ts`; util-only files: `*.utils.ts`.

### 6. Test coverage

For any new exported function:

- Is there a corresponding test in `tests/`?
- Does the test exercise behavior through the public API (not internals)?
- Does it cover the error / null / empty-input paths?

---

## Output format

Produce a short review with sections:

```
## Layer violations
## Import order issues
## Deep-module opportunities
## Convention violations
## Missing tests
## Suggestions
```

Omit any section that has nothing to report.
