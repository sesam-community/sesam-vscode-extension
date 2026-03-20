# F12: conf.json Pipe Config Support & Full-File Sesam Formatter

> **Status**: `planned`
> **Rollout Phase**: Phase 1 - MVP (core DTL editing improvement)
> **Depends on**: none (standalone enhancement to existing DTL LSP)
> **Tracking**: [README.md](README.md)

---

## Summary

Extend DTL LSP features (completions, hover, diagnostics, formatting) to `*.conf.json` files anywhere in
the workspace — these are the pipe/system config files sesam-py produces when downloading from a node.
Replace the current `rules`-only text-replacement formatter with a full-file Sesam formatter (alphabetically
sorted keys, objects multi-line, DTL arrays compact/inline), applied uniformly to all Sesam JSON config
files.

---

## Background

When sesam-py downloads configs from a node it writes them as `<pipe-id>.conf.json` files. These are
standard Sesam pipe config objects (not pure DTL arrays) with this shape:

```json
{
  "_id": "difi-enhetsregisteret-enrich",
  "type": "pipe",
  "source": {
    "type": "dataset",
    "dataset": "difi-enhetsregisteret-collect"
  },
  "transform": {
    "type": "dtl",
    "rules": {
      "default": [
        ["copy", "*"],
        ["add", "rdf:type", ["ni", "difi", "difi-enhetsregisteret"]]
      ]
    }
  },
  "add_namespaces": true
}
```

Key characteristics vs. pure `.dtl` files:
- Always starts with a **JSON object** (not an array).
- DTL lives under `transform.rules.<ruleName>` as a nested array.
- May have multiple rule sets (e.g. `"default"`, `"foo"`, etc.).

The current extension only activates LSP features for `**/{pipes,systems}/**/*.json`. conf.json files can
live anywhere in the workspace and need the same support. The current formatter only rewrites
`transform.rules` via a fragile regex; this should be replaced with a proper whole-file formatter.

**Reference implementation**: [BaardBouvet/dtl-vscode-extension – client/src/extension.ts](https://github.com/BaardBouvet/dtl-vscode-extension/blob/main/client/src/extension.ts)

---

## Decisions

| Decision | Value |
|---|---|
| Format scope | **Whole file** |
| Key ordering | **Alphabetical sort** (matches BaardBouvet reference) |
| DTL arrays | **Compact** — items space-separated on one line; nested arrays inline |
| JSON objects | **Multi-line** — each key on its own line with indentation |
| Selector location | `**/*.conf.json` anywhere in the workspace |
| Existing pipes/systems JSON | **Same formatter** applied (no special-casing) |

---

## Implementation Phases

### Phase A — LSP Activation for conf.json

**File**: `client/src/extension.ts`

1. Add `{ scheme: "file", language: "json", pattern: "**/*.conf.json" }` to the `documentSelector` array
   in `clientOptions` (alongside the existing `**/{pipes,systems}/**/*.json` entry).
2. Add a second `vscode.workspace.createFileSystemWatcher("**/*.conf.json")` entry in
   `synchronize.fileEvents`.
3. Add a second watcher for the `PipeGraphProvider` refresh:
   ```ts
   const confWatcher = vscode.workspace.createFileSystemWatcher("**/*.conf.json");
   confWatcher.onDidCreate(() => graphProvider.refresh());
   confWatcher.onDidChange(() => graphProvider.refresh());
   confWatcher.onDidDelete(() => graphProvider.refresh());
   context.subscriptions.push(confWatcher);
   ```

> **No `package.json` changes needed**: `activationEvents: ["onLanguage:json"]` already fires for conf.json;
> the grammar injection (`source.dtl.injection`) injects into all `source.json` files; snippets are already
> scoped to `"language": "json"`.

**File**: `server/src/dtl-parser.ts` — **no changes needed**.
`parseDtlText(text, "json")` already handles a single JSON object with `transform.rules` (the conf.json
shape) and also handles arrays of pipe config objects (bulk download shape).

---

### Phase B — Full-File Sesam Formatter

**File**: `server/src/server.ts`

#### Step 1 — Add `sortObjectKeysRecursively`

```ts
function sortObjectKeysRecursively(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeysRecursively);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as object).sort()) {
    sorted[key] = sortObjectKeysRecursively((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}
```

#### Step 2 — Add `formatSesamJson`

Port the BaardBouvet character-by-character formatter:

```ts
function formatSesamJson(value: unknown, tabSize: number): string
```

Algorithm:
1. `const compact = JSON.stringify(sortObjectKeysRecursively(value), null, 0)` — baseline, no whitespace.
2. Maintain a **context stack** and an `indent` counter. Initial stack: `[Context.Object]`.
3. Context enum: `Root | String | Array | Object | Escape`.
4. Walk each char; outside `String`/`Escape` context apply:

| Trigger | Rule |
|---|---|
| `{` and next char `!== '}'` | append `{`, then `\n` + `indent×spaces` |
| `}` | append `\n` + `(indent-1)×spaces`, then `}` |
| `,` in `Object` | append `,`, then `\n` + `indent×spaces` |
| `,` in `Array` | append `, ` |
| `]` and `prev === ']'` | append `\n` + `indent×spaces` before `]` |
| `]` and `prev !== '[' && prev !== ']'` | append `\n` + `(indent-1)×spaces` before `]` |
| `:` | append `: ` |

5. Increment `indent` on `{`/`[`; decrement before emitting `}`/`]`.
6. Return `output`.

> **Note on `prev === ']'` rule**: this produces a newline before the closing `]` of the outer rules array
> when the last element itself is an array. Verify during testing that this doesn't produce a double blank
> line — adjust to a single newline if needed.

#### Step 3 — Replace `formatJsonPipeConfig` with `formatSesamConfig`

```ts
function formatSesamConfig(parsed: unknown, tabSize: number): TextEdit[] | null
```

- Returns `null` (no edits) if `parsed` is not a Sesam config.
  - Valid: a plain object with `_id` and/or `type` keys, OR an array of such objects.
  - Invalid: a bare DTL array (no reformatting needed), or non-Sesam JSON.
- Calls `formatSesamJson(parsed, tabSize)`.
- Computes `fullDocRange` from line 0 char 0 to `document.lineCount - 1` / last char.
- Returns `[TextEdit.replace(fullDocRange, formatted)]`.

Update `connection.onDocumentFormatting`:
```ts
connection.onDocumentFormatting((params): TextEdit[] => {
  const document = documents.get(params.textDocument.uri);
  if (!document) return [];
  try {
    const parsed = JSON.parse(document.getText());
    return formatSesamConfig(parsed, document, params.options.tabSize ?? 2) ?? [];
  } catch {
    return [];
  }
});
```

Remove the now-obsolete `formatJsonPipeConfig` function and the `rulesRawMatch` regex approach.

---

## Verification Checklist

- [ ] Open a `*.conf.json` file **outside** `pipes/`/`systems/` directories — completions, hover, and
      diagnostics activate (function name completions, `_S.` variable hints, unknown-function errors).
- [ ] **Format Document** (`Shift+Alt+F`) on a conf.json → whole file reformatted:
  - Keys sorted alphabetically at every level.
  - Each object key on its own line with proper indentation.
  - DTL rule arrays compact: `["add", "foo", ["ni", "ns", "bar"]]` on one line.
  - Top-level rule list entries each on their own line.
- [ ] **Format Document** on an existing `pipes/**/*.json` → same Sesam style applied.
- [ ] `pnpm test` (in `packages/vscode-extension`) → all parser and validator tests pass.
- [ ] Format the user's example conf.json and verify `transform.rules.default` is readable — each top-level
      DTL call on its own line, nested expressions inline.
- [ ] Idempotent: formatting an already-formatted file produces no changes (second format is a no-op).
