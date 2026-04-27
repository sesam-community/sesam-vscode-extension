---
name: debug-lsp
description: Diagnose why an LSP feature (completion, hover, definition, diagnostics, rename, code action) is not working in the Sesam extension. Use when a language intelligence feature fires incorrectly, not at all, or in the wrong place.
---

# Debug an LSP Feature

Systematic checklist for diagnosing LSP issues in this extension.

## Architecture reminder

```
Trigger (user types) → client sends request → server.ts handler → util function → response
```

The server runs as a separate Node.js process. Errors inside handlers are silently swallowed by the
LSP protocol unless you add logging.

---

## Checklist

### 1. Is the capability declared?

In `server.ts` → `onInitialize`, confirm the capability is present:

```ts
completionProvider: { triggerCharacters: ['"', '[', '_', '.', ':'] },
hoverProvider: true,
// etc.
```

If missing → add it. The client won't send requests for undeclared capabilities.

### 2. Is the handler registered?

Search `server.ts` for `connection.on<CapabilityName>`. If missing → add the handler.

Common names:
- `connection.onCompletion`
- `connection.onHover`
- `connection.onDefinition`
- `connection.onReferences`
- `connection.onRenameRequest`
- `connection.onCodeAction`
- `connection.onDocumentSymbol`

### 3. Is the trigger character right?

For completions: check that the character typed is in `triggerCharacters`. The extension currently
uses `['"', '[', '_', '.', ':']`. If your context needs a different character, add it.

### 4. Is the context predicate correct?

Most handlers use a `prefix` string (text from line start to cursor) to decide whether to respond.
The predicates live in `server/src/utils/server.utils.ts`:

- `isSourceTypeContext(prefix)` — inside `"source": { "type": "`
- `isTransformTypeContext(prefix)` — inside `"transform": { "type": "` or array variant
- `isSystemTypeContext(prefix)` — root-level `"type": "` at depth 1
- `isVariableContext(prefix)` — inside `["` (DTL variable position)
- `isFunctionNameContext(prefix)` — inside `["` at function name position
- `isPropKeyContext(prefix)` — at a JSON key position (`{` or `,` then `"`)

**To debug:** log the prefix and test the predicate in isolation:

```ts
console.log("prefix:", JSON.stringify(prefix));
console.log("isSourceTypeContext:", isSourceTypeContext(prefix));
```

Write a failing unit test in `tests/server.utils.test.ts` with the exact prefix string.

### 5. Is the range correct?

For `DocumentSymbol`: `selectionRange` **must** be contained within `range`. If not, VS Code
silently drops the symbol.

For hover / definition: the range returned must match the token the user is hovering/clicking.
Off-by-one errors in `document.offsetAt` / `document.positionAt` are common — write a unit test.

### 6. Is the util function returning the right shape?

Check the return type against the LSP spec:

| Handler | Return type |
|---|---|
| `onCompletion` | `CompletionItem[]` |
| `onHover` | `Hover \| null` — `{ contents: MarkupContent, range? }` |
| `onDefinition` | `Location \| Location[] \| null` |
| `onReferences` | `Location[]` |
| `onRenameRequest` | `WorkspaceEdit` |
| `onCodeAction` | `CodeAction[]` |
| `onDocumentSymbol` | `DocumentSymbol[]` |

### 7. Add a temporary log

In `server.ts`, add a `console.error` (goes to the extension's output channel):

```ts
connection.onHover((params) => {
  console.error("[hover] uri:", params.textDocument.uri, "pos:", JSON.stringify(params.position));
  // ...
});
```

Open the "Sesam LSP Server" output channel in the Extension Development Host to read it.

### 8. Check for silent exceptions

Wrap the handler body in try/catch and log:

```ts
connection.onCompletion((params) => {
  try {
    return buildCompletions(params);
  } catch (e) {
    console.error("[completion] error:", e);
    return [];
  }
});
```

---

## Common root causes

| Symptom | Likely cause |
|---|---|
| Feature never fires | Capability not declared in `onInitialize` |
| Feature fires everywhere | Context predicate is too broad / missing |
| Feature fires nowhere | Context predicate is too narrow / wrong regex |
| Hover shows nothing | `contents` is empty string or wrong `MarkupKind` |
| Completions don't insert correctly | `insertText` / `insertTextFormat` mismatch |
| Rename breaks the file | `WorkspaceEdit` ranges are off by one |
| Symbols missing from outline | `selectionRange` not inside `range` |
