---
name: impl-feature
description: Implement a planned feature from the agent/impl/ spec files. Reads the spec, checks README.md status, implements, updates status. Use when starting work on a new feature, or when the user references an "F-number" (e.g. F02, F10).
---

# Implement Feature

A structured workflow for turning an `agent/impl/impl-f*.prompt.md` spec into working code.

## Step 1 — Locate the spec

1. Read `packages/vscode-extension/agent/impl/README.md` to find the feature's current status and sub-plan file.
2. Read the linked `impl-f*.prompt.md` file in full.
3. If the feature is already `implemented`, confirm with the user before proceeding.

## Step 2 — Understand dependencies

- Check the spec's **Depends on** section.
- Read any referenced files (constants, types, existing handlers) to understand the current state.
- Identify which files need to be created or modified.

## Step 3 — Plan

Before writing code, confirm with the user:

- Which phases of the spec to implement (start with Phase A unless told otherwise).
- Whether any existing code covers part of the work already.
- The public interface / exported symbols that will change.

## Step 4 — Implement (phase by phase)

For each phase in the spec:

1. Mark the feature `in progress` in `agent/impl/README.md`.
2. Implement the phase — follow all conventions in `copilot-instructions.md`:
   - Import order (built-ins → third-party → internal → type-only)
   - `as const satisfies` for registry arrays
   - Functional style, no `any`
   - Breathing space around `if` / `for` / `return`
3. Register new LSP capabilities in `onInitialize`, wire handlers immediately after (server-side).
4. Wire VS Code commands via `context.subscriptions.push(...)` (client-side).

## Step 5 — Tests

After each phase:

- Add or extend tests in `packages/vscode-extension/tests/` using Vitest.
- For server utilities: pure-function unit tests.
- For client code that requires VS Code API: skip or mock via `tests/mock/vscode.ts`.
- Run `pnpm test` from `packages/vscode-extension/` and confirm green.

## Step 6 — Update status

Update `agent/impl/README.md`:

- Set status to `phase N implemented` (if more phases remain) or `implemented` (if done).
- Note any deferred decisions or follow-up issues inline.
