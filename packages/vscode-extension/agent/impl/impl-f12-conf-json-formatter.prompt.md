# F12: Sesam Config File Extensions & Formatter

> **Status**: `implemented` (Phases A–F)
> **Rollout Phase**: Phase 1 - MVP (core DTL editing improvement)
> **Depends on**: none (standalone enhancement to existing DTL LSP)
> **Tracking**: [README.md](README.md)

---

## Summary

Sesam pipe/system config files now use dedicated file extensions (`.conf.pipe`, `.conf.system`) instead of
plain `.json`. Both are assigned the `sesam-config` language ID, which means the LSP formatter is the only
formatter — no conflict with VS Code's built-in JSON formatter or Prettier.

A shared `formatSesamJson` function in `src/shared/config-formatter.ts` is used by both the LSP server
(`onDocumentFormatting`) and the client command handler (`sesam.formatDocument`). On-save formatting is
applied automatically via `onWillSaveTextDocument`.

---

## What Changed vs. Original Plan

| Original plan | Actual implementation |
|---|---|
| Keep `*.conf.json`, fix formatter conflict | New extensions: `.conf.pipe` / `.conf.system` |
| Sort keys alphabetically | **Preserve original key order** (user feedback) |
| Formatter lives in `server/src/server.ts` | Shared: `src/shared/config-formatter.ts` |
| Format via LSP `onDocumentFormatting` only | Also: direct `editor.edit()` in command + on-save |
| `*.conf.json` registered as `json` language | All three extensions → `sesam-config` language ID |

---

## Implemented Files

| File | Change |
|---|---|
| `package.json` | `sesam-config` `filenamePatterns` includes `*.conf.pipe`, `*.conf.system`, `*.conf.json` |
| `package.json` | `sesam.formatDocument` command; `commandPalette` when-clause restricted to `sesam-config` |
| `src/shared/config-formatter.ts` | `formatSesamJson(value, tabSize)` — preserves key order, compact arrays, multi-line objects |
| `server/src/server.ts` | `onDocumentFormatting` → imports from `src/shared/config-formatter` |
| `client/src/extension.ts` | `sesam.formatDocument` applies `formatSesamJson` via `editor.edit()` directly |
| `client/src/extension.ts` | `onWillSaveTextDocument` auto-formats all `sesam-config` files on save |
| `client/src/extension.ts` | `dtl.newConfFile` creates `.conf.pipe` under `pipes/`, `.conf.system` under `systems/` |
| `client/src/extension.ts` | File watchers cover `**/*.conf.{json,pipe,system}` |

---

## Formatter Behaviour

- **Key order**: preserved (not sorted) — matches user expectation for config files
- **Objects**: each key on its own line with indentation
- **DTL arrays**: compact inline — `["add", "foo", ["ni", "ns", "bar"]]`
- **Nested arrays**: each top-level rule on its own line; inner expressions inline
- **Idempotent**: formatting an already-formatted file produces no changes

---

## Verification Checklist

- [x] Open a `*.conf.pipe` or `*.conf.system` file → `sesam-config` language mode activates
- [x] `Sesam: Format Document` on a `sesam-config` file → formatted with Sesam style, no Prettier dialog
- [x] Save a `sesam-config` file → auto-formatted on save
- [x] `Sesam: New Sesam Config File` → pipe lands in `pipes/`, system lands in `systems/`
- [x] All 118 unit tests pass
- [x] Idempotent: second format is a no-op

---

## Summary

Extend DTL LSP features (completions, hover, diagnostics, formatting) to `*.conf.json` files anywhere in
the workspace — these are the pipe/system config files sesam-py produces when downloading from a node.
Replace the current `rules`-only text-replacement formatter with a full-file Sesam formatter (alphabetically
sorted keys, objects multi-line, DTL arrays compact/inline), applied uniformly to all Sesam JSON config
files.

---

## Phase F — Canonical key ordering on save

### Motivation

The Sesam docs show a consistent key ordering in their prototype examples:

**Pipe**:
```json
{
  "_id",
  "name",
  "description",
  "comment",
  "type",
  "source",
  "transform",
  "sink",
  "pump",
  "metadata"
}
```

**System**:
```json
{
  "_id",
  "type",
  "name",
  "description",
  "comment",
  "worker_threads",
  "permissions",
  "metadata"
}
```

The docs do **not** mandate a sort order — the prototypes are illustrative. However, applying a
consistent canonical order on save makes diffs cleaner and files easier to scan.

The current formatter already preserves insertion order (by design). This phase adds an optional
reordering step that, when enabled, reorders root-level keys of pipe and system config objects to
match the doc prototype order before the rest of the formatting is applied.

---

### Canonical key orders

#### Pipe config (`"type": "pipe"`)

| Position | Key | Notes |
|---|---|---|
| 1 | `_id` | Required |
| 2 | `type` | Required |
| 3 | `source` | Required |
| 4 | `transform` | Optional |
| 5 | `sink` | Optional |
| 6 | `pump` | Optional |
| 7 | `name` | Optional, human label |
| 8 | `description` | Optional |
| 9 | `comment` | Optional |
| 10 | `metadata` | Optional |
| 11+ | all others | Alphabetical among themselves |

#### System config (`"type"` starts with `"system:"`)

| Position | Key | Notes |
|---|---|---|
| 1 | `_id` | Required |
| 2 | `type` | Required |
| 3 | `name` | Optional |
| 4 | `description` | Optional |
| 5 | `comment` | Optional |
| 6 | `metadata` | Optional |
| 7+ | all others | Alphabetical among themselves |

Keys not in the canonical list are placed after the canonical keys, sorted alphabetically among
themselves. This is forward-compatible: unknown keys are never lost or reordered destructively.

---

### Design

**Where**: `src/shared/config-formatter.ts` — add an optional `reorderKeys: boolean` parameter to
`formatSesamJson` (default `false` for backward compatibility).

```ts
export const formatSesamJson = (
  value: unknown,
  tabSize: number,
  options?: { reorderKeys?: boolean },
): string => { … };
```

When `reorderKeys` is true:
1. If `value` is an **object** with a `type` property → determine config kind (pipe / system) and
   reorder its top-level keys according to the canonical list before formatting.
2. If `value` is an **array** of config objects → apply step 1 to each element.
3. Nested objects (`source`, `transform`, `sink`, `pump`) are **not** reordered — only the root
   level.

The reordering is a pure function: `reorderConfigKeys(obj, kind) → Record<string, unknown>`.

**When applied**: only when the formatter is invoked on save (`onWillSaveTextDocument`) or via the
`Sesam: Format Document` command, not during LSP `onDocumentFormatting` (which is triggered by
editor "Format Document" / language-specific formatters — preserving order there avoids surprises).

**Setting**: controlled by a new VS Code setting `dtl.format.reorderKeys` (`boolean`, default `true`).

---

### Files touched

| File | Change |
|---|---|
| `src/shared/config-formatter.ts` | Add `reorderConfigKeys()` helper; add `options.reorderKeys` param to `formatSesamJson` |
| `server/src/server.types.ts` | Add `format: { reorderKeys: boolean }` to `DtlSettings` |
| `server/src/constants.ts` | Add `format: { reorderKeys: false }` to `defaultSettings` |
| `client/src/extension.ts` | Pass `reorderKeys: settings.format?.reorderKeys` when calling `formatSesamJson` on save |
| `package.json` | Add `dtl.format.reorderKeys` contribution point |
| `tests/formatter.test.ts` | New test cases for reorder behaviour |

---

### Test cases

| Input | Expected after reorder |
|---|---|
| Pipe with `source` before `_id` | `_id`, `type`, `source` in that order at root |
| Pipe with `pump` before `source` | `source` moved before `pump` |
| System with `metadata` before `type` | `_id`, `type`, `metadata` order |
| Unknown keys at root | Placed after canonical keys, alphabetically sorted |
| Nested `source` object | Internal key order unchanged |
| Array of pipe configs | Each element reordered independently |
| `reorderKeys: false` (default) | Key order unchanged (existing behaviour) |

---

### Acceptance criteria

- `formatSesamJson(pipe, 2, { reorderKeys: true })` → `_id` first, `type` second, `source` third
- Existing tests still pass (no `reorderKeys` → no change to current behaviour)
- On save with `dtl.format.reorderKeys: true` → file keys reordered
- On save with `dtl.format.reorderKeys: false` (default) → no reorder (current behaviour preserved)

---

## Background configs from a node it writes them as `<pipe-id>.conf.json` files. These are
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
