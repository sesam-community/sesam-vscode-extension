---
name: lsp-handler
description: Add a new LSP capability (completion, hover, definition, rename, code action, diagnostic, document symbol, etc.) to the Sesam VS Code extension. Use when adding any new language intelligence feature to server.ts or its utils.
---

# Add an LSP Handler

Checklist for wiring a new LSP capability end-to-end in this extension.

## Architecture recap

```
client/src/extension.ts          — starts the LSP client, registers VS Code commands
server/src/server.ts             — LSP server: onInitialize + all request handlers
server/src/utils/server.utils.ts — pure helper functions (context predicates, builders)
server/src/utils/*.utils.ts      — feature-specific utils (alias-rename, cross-ref, etc.)
src/shared/                      — code shared by client AND server (no vscode imports)
```

## Step 1 — Declare the capability

In `server.ts` → `onInitialize`, add the capability to the returned object:

```ts
// Example: adding a new code action provider
return {
  capabilities: {
    ...existingCapabilities,
    codeActionProvider: true,
  },
};
```

Capability keys: `completionProvider`, `hoverProvider`, `definitionProvider`,
`referencesProvider`, `renameProvider`, `codeActionProvider`, `documentSymbolProvider`,
`documentLinkProvider`, `documentFormattingProvider`.

## Step 2 — Register the handler

Immediately after `onInitialize` wiring (not inside it), add the handler:

```ts
connection.onCodeAction((params) => {
  // ...
});
```

Keep the handler itself thin — delegate all logic to a util function.

## Step 3 — Write the util function

Create or extend a file in `server/src/utils/`:

- If the feature is closely related to an existing util file, extend it.
- Otherwise create `server/src/utils/<feature>.utils.ts`.
- The function must be **pure**: takes text/document/params, returns LSP objects.
- No side effects, no imports from `vscode`.

Import convention:
```ts
import { CompletionItem, ... } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";
// internal last
import { escapeRegex } from "./server.utils";
```

## Step 4 — Context predicates (completions / hover only)

If the handler fires only in specific JSON contexts, add a predicate to `server.utils.ts`:

```ts
export const isMyNewContext = (prefix: string): boolean => {
  return /my-pattern/.test(prefix);
};
```

Trigger characters are declared in `completionProvider.triggerCharacters` in `onInitialize`.
Current set: `['"', '[', '_', '.', ':']`.

## Step 5 — Tests

Add tests in `packages/vscode-extension/tests/`:

```ts
// For a util function
import { myNewUtil } from "../server/src/utils/my-feature.utils";

describe("myNewUtil", () => {
  it("returns X when ...", () => { ... });
});
```

For context predicates, test both `true` and `false` cases with realistic prefix strings.

## Step 6 — Verify end-to-end

Press **F5** to launch the Extension Development Host and manually verify:
- The capability fires in the right context.
- It does not fire where it shouldn't.
- `selectionRange` is always contained within `range` (for `DocumentSymbol`).
