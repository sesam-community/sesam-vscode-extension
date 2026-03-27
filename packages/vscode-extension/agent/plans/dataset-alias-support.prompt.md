# F18: Dataset Alias Support

> **Status**: `implemented`
> **Tracking**: [README.md](../impl/README.md)

## Summary

In Sesam pipe configs, `"datasets"` array entries use an **`"id alias"`** syntax:

```json
"datasets": ["wikidata-classification-transform wct", "global-classification-vocabulary gcv"]
```

Here `wct` and `gcv` are **local aliases** for the dataset IDs. The alias is used as a variable
prefix within the same pipe:

```json
"equality_sets": [["wct.$ids", "gcv.$ids"]]
```

Aliases have no meaning outside the file that declares them.

---

## Goals

1. **Different colour** — alias tokens visually distinct from the dataset ID part
2. **Hover** — explain what the alias stands for
3. **Rename** — rename an alias throughout the file (declaration + all usages)
4. **Find All References** — show all usages of an alias in the current file

---

## Architecture

### Where it runs

All alias logic runs in the **LSP server** (`server/src/server.ts`) and a new utility module
`server/src/utils/alias-rename.utils.ts`. No client-side changes needed.

### Alias definition
An alias appears as the **second whitespace-separated token** inside a quoted string in a
`"datasets": [...]` context. The first token is the pipe/dataset ID.

Valid alias characters: `[a-zA-Z][a-zA-Z0-9_-]*`

### Alias usage
Within the same file, any JSON string value of the form `"alias"`, `"alias.path"`, or
`"alias.$field"` is a usage of the alias. In equality sets and hops `datasets` arrays the alias
itself may appear as a bare prefix.

---

## Implementation Steps

### Phase A — Syntax Highlighting

**File**: `syntaxes/dtl-injection.tmLanguage.json`

Add a TextMate rule that matches the alias token (second word) inside datasets array strings:

```json
{
  "comment": "Dataset alias — second token in 'id alias' string inside datasets arrays",
  "match": "\"[^\"\\s]+ ([a-zA-Z][a-zA-Z0-9_-]*)\"",
  "captures": {
    "1": { "name": "entity.name.tag.alias.sesam" }
  }
}
```

`entity.name.tag` renders in a warm colour (orange/yellow) in most VS Code themes, clearly
distinguishing aliases from dataset IDs (plain strings) and from DTL variables.

---

### Phase B — Hover on alias token

**Files**: `server/src/utils/alias-rename.utils.ts` (new), `server/src/server.ts`

**New util** — `findAliasAtOffset(text: string, offset: number): { alias: string; datasetId: string } | null`

Logic:
1. Find the enclosing quoted string.
2. Check that the offset falls on or after the first space in the string value.
3. Check that the prefix text (before the opening quote) matches `"datasets"\s*:\s*\[([^\]]*)`
   (i.e. we are inside a datasets array).
4. Return `{ alias, datasetId }` where `alias` is the second token and `datasetId` is the first.

**`onHover`** in `server.ts` — add a check before the existing word-hover logic:

```ts
const aliasRef = findAliasAtOffset(text, offset);
if (aliasRef) {
  return { contents: { kind: "markdown",
    value: `**${aliasRef.alias}** — alias for \`${aliasRef.datasetId}\`` } };
}
```

---

### Phase C — Rename (intra-file)

**Capability**: register `renameProvider: { prepareProvider: true }` in `onInitialize`.

**`onPrepareRename`**:
- Call `findAliasAtOffset`. If found, return the alias token's range. Otherwise return `null`.

**`onRenameRequest`**:
- Call `collectAliasRanges(text, alias)` → `Range[]` for all occurrences in the document.
- Return `WorkspaceEdit` with `TextEdit.replace(range, newAlias)` for each occurrence, all in
  the same document URI.

**New util** — `collectAliasRanges(text: string, alias: string): Range[]`

Finds all occurrences of the alias in the document:
1. **Declaration**: in `"id alias"` strings in `datasets` arrays — only the alias token portion.
2. **Usage as prefix**: any string `"alias.something"` anywhere in the document.
3. **Bare usage**: any string `"alias"` that is not followed by a space (to avoid matching the ID
   part of another `"foo alias"` entry).

Pure function — fully testable with no server dependencies.

---

### Phase D — Find All References (optional, phase 2)

Reuse `collectAliasRanges` from `onReferences` when `findAliasAtOffset` returns a result.
Return `Location[]` for all usage ranges in the current document.

---

### Phase E — Tests

**File**: `tests/alias-rename.test.ts`

`findAliasAtOffset`:
- Cursor on the id part → `null`
- Cursor on the alias part → `{ alias: "wct", datasetId: "wikidata-classification-transform" }`
- Cursor outside a datasets array → `null`
- String with no alias (single token) → `null`

`collectAliasRanges`:
- From `wikidata-classification-collect` mock: renaming `wct` covers the declaration and both
  `wct.$ids` usages.
- Does not match strings that only share a prefix (e.g. `"wcte"` is not a match for `"wct"`).
- Finds bare alias usage `"wct"` as well as prefixed `"wct.foo"`.

---

### Phase F — Docs

Update `README.md` Cross-file Navigation section:

| Action | How to invoke |
|---|---|
| **Alias highlight** | Alias tokens in `"datasets"` arrays shown in a distinct colour |
| **Alias hover** | Hover over an alias token → shows which dataset it stands for |
| **Alias rename** | `F2` on an alias token → renames it throughout the file |
| **Alias references** | Right-click alias → **Find All References** — shows all usages |

---

## Verification

1. Open a pipe with `"datasets": ["foo-pipe fp", "bar-pipe bp"]` — `fp` and `bp` appear in a
   different colour from `foo-pipe` and `bar-pipe`.
2. Hover over `fp` — tooltip shows "**fp** — alias for `foo-pipe`".
3. Press `F2` on `fp` → rename to `x` → declaration becomes `"foo-pipe x"` and all `"fp.something"`
   / `"fp"` strings in the file become `"x.something"` / `"x"`.
4. Renaming the dataset ID part (first token) does NOT trigger alias rename.
5. `collectAliasRanges` is pure and covered by unit tests.
