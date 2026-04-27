# E2E Tests via Playwright

> **Status**: `planned`
> **Rollout Phase**: Cross-cutting — applies to Phase 1+ features
> **Depends on**: All Phase 1 features implemented; VS Code Extension host launches cleanly
> **Tracking**: [README.md](README.md)

---

## Summary

Add end-to-end tests that launch a real VS Code Extension Development Host using
[`@vscode/test-cli`](https://github.com/microsoft/vscode-test-cli) +
[`@playwright/test`](https://playwright.dev), drive the editor programmatically, and assert on
observable behaviour — completions appear, diagnostics fire, tree views populate, commands run.

These tests fill the coverage gap that Vitest unit tests cannot reach: anything that requires a
real `vscode` API instance (TreeDataProvider rendering, CodeLens display, WebviewPanel content,
the Testing API tree, status bar items, credential flows).

---

## Why Playwright + `@vscode/test-cli`

| Tool | Role |
|---|---|
| `@vscode/test-cli` | Downloads a pinned VS Code version, launches it with `--extensionDevelopmentPath`, and exposes `vscode` to the test runner |
| `@playwright/test` | Drives the VS Code Electron window via CDP; takes screenshots; provides `expect` assertions |
| `vitest` | Unit tests (pure functions, LSP utils) — **unchanged** |

`@vscode/test-cli` wraps the older `vscode-test` / `vscode-extension-tester` pattern into a
first-party CLI with TypeScript support. Playwright's Electron driver targets the VS Code window
directly, making UI assertions possible without an Electron test framework fork.

---

## Scope

### In scope

- **LSP completions** — open a `.conf.pipe` file, trigger `"`, assert completion items appear
- **Diagnostics** — open a file with a known DTL error, assert diagnostic squiggles + messages
- **Tree views** — activate the extension, assert Pipe Lineage / System Pipes views render
- **Commands** — invoke `sesam.runUpload` (mocked node), assert status bar updates
- **Formatter** — save a `.conf.pipe` file, assert key order is preserved

### Out of scope (for now)

- Tests requiring a live Sesam node (those remain in `@sesam/core` integration tests with a real
  node URL supplied via environment variables)
- Screenshot comparison / visual regression (too fragile for CI)

---

## Folder structure

```
packages/vscode-extension/
  e2e/
    fixtures/                  ← minimal workspace fixtures opened by each test
      simple-pipe/
        pipes/
          my-pipe.conf.pipe
        systems/
    tests/
      completions.e2e.ts
      diagnostics.e2e.ts
      tree-views.e2e.ts
      formatter.e2e.ts
    utils/
      open-file.ts             ← helpers: openFile, triggerCompletion, waitForDiagnostics
    .vscode-test.mjs           ← @vscode/test-cli config
  package.json                 ← add `e2e` script + dev deps
```

---

## Implementation Phases

### Phase A — Scaffolding

**Step 1** — Install dev dependencies in `packages/vscode-extension/package.json`:

```jsonc
"@vscode/test-cli": "^0.0.10",
"@playwright/test": "^1.44.0",
"playwright": "^1.44.0"
```

**Step 2** — Create `.vscode-test.mjs`:

```js
import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
  files: "e2e/tests/**/*.e2e.ts",
  workspaceFolder: "e2e/fixtures/simple-pipe",
  mocha: { timeout: 30_000 },
});
```

**Step 3** — Add `e2e` and `e2e:headless` scripts to `package.json`:

```jsonc
"e2e":          "vscode-test",
"e2e:headless": "vscode-test --headless"
```

**Step 4** — Create `e2e/fixtures/simple-pipe/` with a minimal valid pipe and system config so
the extension activates cleanly.

**Step 5** — Create `e2e/utils/open-file.ts` with reusable helpers:

```ts
import * as vscode from "vscode";

/** Open a file relative to the workspace fixture and wait for the document to be ready. */
export const openFile = async (relPath: string): Promise<vscode.TextEditor> => { ... };

/** Position the cursor and trigger completion, returning the list of items. */
export const triggerCompletion = async (
  doc: vscode.TextDocument,
  position: vscode.Position,
): Promise<vscode.CompletionList> => { ... };

/** Wait until at least one diagnostic appears on `uri` (or timeout). */
export const waitForDiagnostics = async (
  uri: vscode.Uri,
  timeoutMs = 5_000,
): Promise<vscode.Diagnostic[]> => { ... };
```

### Phase B — Completion tests

File: `e2e/tests/completions.e2e.ts`

| Test | Scenario |
|---|---|
| Source type completions | Inside `"source": { "type": "` → completion list contains `"dataset"`, `"embedded"` |
| System type completions | Root-level `"type": "` at depth 1 → list contains `"system:rest"` |
| Transform type completions | Inside `"transform": { "type": "` → list contains `"dtl"`, `"http"` |
| DTL function completions | Inside `["` in a DTL rule → list contains `"add"`, `"copy"` |
| DTL variable completions | Inside `["_` → list contains `"_S"`, `"_T"` |
| Prop key completions | After `{` or `,` then `"` in pipe root → list contains `"_id"`, `"source"` |

### Phase C — Diagnostic tests

File: `e2e/tests/diagnostics.e2e.ts`

| Test | Scenario |
|---|---|
| Unknown DTL function | `["unknownFn"]` → error diagnostic appears |
| Missing `_id` | Config object without `_id` → error diagnostic appears |
| Missing `type` | Config without `type` → error diagnostic appears |
| Malformed path | `_S..foo` in a string arg → warning diagnostic appears |
| Argument count | `["add"]` (missing args) → error diagnostic appears |

### Phase D — Formatter test

File: `e2e/tests/formatter.e2e.ts`

| Test | Scenario |
|---|---|
| On-save formatting | Open a pipe config with out-of-order keys, save, assert `_id` comes first and DTL arrays are compact |

### Phase E — Tree view smoke tests

File: `e2e/tests/tree-views.e2e.ts`

| Test | Scenario |
|---|---|
| Pipe Lineage view activates | Extension activates → `sesam-lineage` view is registered |
| System Pipes view activates | `sesam-systems` view is registered |

---

## CI integration

Add a GitHub Actions job (or extend the existing one):

```yaml
e2e:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: pnpm/action-setup@v3
    - run: pnpm install
    - run: pnpm build
      working-directory: packages/vscode-extension
    - run: pnpm e2e:headless
      working-directory: packages/vscode-extension
```

The `--headless` flag runs VS Code in headless Electron mode (no display server required).

---

## Open questions

1. **Mock node** — commands that call the Sesam node (upload, preview) need either a stub HTTP
   server or `vi.mock` equivalent. Decide whether to use `msw` (Mock Service Worker in Node mode)
   or a lightweight `http.createServer` fixture.
2. **Test isolation** — each test should start with a clean extension state. Investigate whether
   `vscode.commands.executeCommand("workbench.action.closeAllEditors")` is sufficient, or whether
   each test needs its own VS Code instance.
3. **Flakiness budget** — LSP responses are async; `waitForDiagnostics` needs a sensible polling
   interval and timeout. Calibrate in Phase B before expanding coverage.
