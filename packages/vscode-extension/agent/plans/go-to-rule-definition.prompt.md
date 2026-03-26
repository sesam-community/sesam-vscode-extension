# F13: Go to Rule Definition + Find All References

> **Status**: `implemented`
> **Rollout Phase**: Phase 1 - MVP
> **Tracking**: [README.md](../impl/README.md)

---

## Summary

Add LSP **Go to Definition** and **Find All References** for rule references in `apply` and
`apply-hops` DTL calls. Ctrl+Click or F12 on `"based-on"` in `["apply", "based-on", "_S."]`
jumps to the `"based-on": [...]` rule definition. Right-click a rule definition key →
**Find All References** lists all `apply`/`apply-hops` calls referencing it in the References panel.

---

## Motivation

Sesam pipe configs frequently use `apply` to invoke named sub-rules within the same transform.
In large pipes with 10–20+ named rules, finding the target rule by scrolling is tedious.
IDE-native navigation (F12 / Ctrl+Click) and Find All References eliminate this friction.

### DTL Reference

- [`apply`](https://docs.sesam.io/hub/dtl/dtl-functions-dictionaries.html#apply-dtl-function) — `["apply", "ruleId", entity]`
- [`apply-hops`](https://docs.sesam.io/hub/dtl/dtl-functions-dictionaries.html#apply-hops-dtl-function) — `["apply-hops", "ruleId", hopsSpec]`

### Example

```json
{
  "transform": {
    "type": "dtl",
    "rules": {
      "default": [
        ["add", "$based_on",
          ["apply", "based-on", "_S."]   // ← Ctrl+Click "based-on" → jumps to ①
        ]
      ],
      "based-on": [                      // ← ① definition target
        ["copy", "*", ["list", "_*", "$*"]]
      ]
    }
  }
}
```

---

## Architecture

### Where it runs

Entirely in the **LSP server** (`server/src/`). The VS Code client (`LanguageClient`) automatically
delegates `textDocument/definition` and `textDocument/references` requests to the server — no
client-side code needed.

### Data flow — Go to Definition

```
User Ctrl+Click on "based-on"
  → VS Code sends textDocument/definition { position }
  → LSP server handler:
     1. Get document text + parse JSON
     2. Determine if position is inside a string that is the 1st arg of apply/apply-hops
     3. Find the rule key "based-on" in transform.rules
     4. Return Location { uri, range } pointing to the rule key
  → VS Code navigates to the location
```

### Data flow — Find All References

```
User right-clicks "based-on" rule key → Find All References
  → VS Code sends textDocument/references { position, context }
  → LSP server handler:
     1. Get document text
     2. Determine if position is on a rule definition key or an apply arg
     3. Scan all apply/apply-hops calls for matching rule name
     4. Return Location[] for all matches (+ definition if includeDeclaration)
  → VS Code shows results in the References panel
```

---

## Implementation Steps

### Phase A — Go to Definition: core logic

#### Step 1: Register `definitionProvider` capability

**File**: `server/src/server.ts`

In `onInitialize`, add `definitionProvider: true` to the returned capabilities object, alongside
the existing `completionProvider`, `hoverProvider`, `documentFormattingProvider`, and
`documentSymbolProvider`.

#### Step 2: Create `definition.utils.ts`

**File**: `server/src/utils/definition.utils.ts`

Pure functions for resolving rule references. No LSP types — takes raw text and position, returns
offset-based results.

**Functions to implement:**

##### `findApplyRuleReference(text, offset)`

Given document text and a cursor offset, determine whether the cursor is inside a string literal
that is the first argument of an `apply` or `apply-hops` call.

- Walk backwards from `offset` to find the enclosing `"..."` string boundaries
- Extract the string value (candidate rule name)
- Walk backwards further to check the preceding tokens: expect `"apply"` or `"apply-hops"`, then `[`, then `,`
- A lightweight scanner approach (similar to the existing context predicates in `server.utils.ts`)
  is sufficient — no need for a full parse
- Return `{ ruleName: string, nameRange: { start: number, end: number } } | null`

##### `findRuleDefinition(text, ruleName, cursorOffset)`

Given document text, a rule name, and a cursor offset (for array transform scoping), find the
offset range of that rule's key in the `transform.rules` object.

- Parse JSON to locate `transform.rules` (or `transform[N].rules` for array transforms)
- Use `findKeyOffset(text, ruleName, rulesBlockStart)` (already exists in `server.utils.ts`)
  to find the `"ruleName":` key position
- For array transforms: determine which step the cursor is inside and search only that step's rules
- Return `{ keyStart: number, keyEnd: number } | null`

#### Step 3: Wire `connection.onDefinition` handler

**File**: `server/src/server.ts`

*Depends on steps 1–2.*

```
connection.onDefinition(params => {
  1. Get document + text
  2. Compute offset from params.position
  3. Call findApplyRuleReference(text, offset)
  4. If null → return null (not a rule reference)
  5. Call findRuleDefinition(text, ref.ruleName, offset)
  6. If null → return null (rule not found)
  7. Convert offsets to LSP Position via document.positionAt()
  8. Return Location { uri: params.textDocument.uri, range }
})
```

---

### Phase B — Array transform support

*Parallel with Phase A step 3.*

#### Step 4: Handle array transforms in `findRuleDefinition`

When `transform` is an array of DTL steps, each step has its own `rules` block.
`findRuleDefinition` must search the correct step's `rules` — the one that contains the
`apply`/`apply-hops` call at the given cursor position.

Approach: determine which transform step the cursor is inside (by offset), then search
only that step's `rules` for the target key.

---

### Phase C — Find All References

#### Step 5: Register `referencesProvider` capability

**File**: `server/src/server.ts`

In `onInitialize`, add `referencesProvider: true` to the capabilities.

#### Step 6: Add reference-finding functions

**File**: `server/src/utils/definition.utils.ts`

##### `findRuleKeyAtOffset(text, offset)`

Determines if cursor is on a rule definition key (a key inside `transform.rules`).

- Parse JSON to find `transform.rules` boundaries
- Check if cursor offset falls on a key within that object
- Return `{ ruleName: string, keyRange: { start: number, end: number } } | null`

##### `findAllApplyReferences(text, ruleName)`

Scans all `apply`/`apply-hops` calls in the document, returns an array of offset ranges for
every 1st-argument string matching `ruleName`.

- Use `parseDtlText(text, "json")` to get all `DtlCall`s
- Filter calls where `functionName` is `"apply"` or `"apply-hops"`
- For each matching call, locate the 1st argument string in the raw text
- Return `Array<{ start: number, end: number }>`

#### Step 7: Wire `connection.onReferences` handler

**File**: `server/src/server.ts`

*Depends on steps 5–6.*

```
connection.onReferences(params => {
  1. Get document + text
  2. Compute offset from params.position
  3. Try findRuleKeyAtOffset(text, offset) — cursor on a rule definition
  4. If found: ruleName = result.ruleName
  5. Else try findApplyRuleReference(text, offset) — cursor on an apply arg
  6. If found: ruleName = result.ruleName
  7. If neither: return null
  8. Call findAllApplyReferences(text, ruleName)
  9. If params.context.includeDeclaration:
     also include the rule definition key range via findRuleDefinition()
  10. Convert all offset ranges to Location[] and return
})
```

---

### Phase D — Tests

#### Step 8: Create unit tests

**File**: `tests/definition.utils.test.ts`

**Test `findApplyRuleReference`:**
- Cursor inside `"based-on"` in `["apply", "based-on", "_S."]` → returns `{ ruleName: "based-on" }`
- Cursor inside `"my-rule"` in `["apply-hops", "my-rule", { ... }]` → returns `{ ruleName: "my-rule" }`
- Cursor inside `"add"` in `["add", "prop", "val"]` → returns `null` (not apply/apply-hops)
- Cursor inside `"_S.foo"` (2nd arg of apply) → returns `null`
- Cursor outside any string → returns `null`

**Test `findRuleDefinition`:**
- Load `tests/mock/pipes/multi-rule.json` → finds `"default"` and `"order-ref"` keys
- Load `tests/mock/pipes/difi-enhetsregisteret-classification-enrich.json` → finds `"1-history"`, `"add-merge"`, etc.
- Load `tests/mock/pipes/multi-transform.json` → finds rules in array transform steps
- Non-existent rule name → returns `null`

**Test `findRuleKeyAtOffset`:**
- Cursor on `"default"` key in rules → returns `{ ruleName: "default" }`
- Cursor on a non-rules key (e.g. `"_id"`) → returns `null`

**Test `findAllApplyReferences`:**
- Pipe with multiple `apply` calls to same rule → returns all positions
- No references to a given rule → returns empty array
- `apply-hops` references found alongside `apply` references

**Integration test:**
- Given full pipe config text + cursor on apply arg → verify full pipeline returns correct Location

---

## Relevant files

- `server/src/server.ts` — Add `definitionProvider`, `referencesProvider`, `connection.onDefinition`, `connection.onReferences`
- `server/src/utils/definition.utils.ts` — New file: `findApplyRuleReference`, `findRuleDefinition`, `findRuleKeyAtOffset`, `findAllApplyReferences`
- `server/src/utils/server.utils.ts` — Reuse `findKeyOffset`
- `server/src/dtl-parser.ts` — Reuse `parseDtlText` for scanning apply/apply-hops calls (not modified)
- `tests/definition.utils.test.ts` — New file: unit tests
- `tests/mock/pipes/multi-rule.json` — Fixture with multiple named rules
- `tests/mock/pipes/difi-enhetsregisteret-classification-enrich.json` — Complex fixture with 19 rules
- `tests/mock/pipes/multi-transform.json` — Array transform fixture

---

## Verification

1. `pnpm test` — all new + existing tests pass
2. `pnpm build` — no compile errors
3. **Manual (F5 Extension Host)**:
   - Ctrl+Click on rule name argument in `apply`/`apply-hops` → jumps to rule definition
   - F12 on rule name argument → same behaviour
   - Alt+F12 on rule name argument → Peek Definition inline
   - Right-click rule definition key → **Find All References** → References panel lists all `apply`/`apply-hops` calls
   - Shift+Alt+F12 on rule key → Peek References inline
   - Right-click an `apply` arg → Find All References → shows all other calls + definition (if `includeDeclaration`)
   - Rule with no references → References panel shows "No results"
   - Ctrl+Click on non-rule string (e.g. `"_S.foo"`) → no navigation (correct)
   - Ctrl+Click on missing rule → no navigation (correct)

---

## Decisions

- **Scope**: Same-document only. Cross-file `apply` (referencing rules in another pipe) is not
  supported — this matches how Sesam DTL works (rules are always local to the transform block).
- **Array transforms**: When transform is `[step1, step2, ...]`, definition and references resolve
  within the same step's `rules` block only (rules are not shared across steps).
- **LSP providers**: `definitionProvider` for F12/Ctrl+Click, `referencesProvider` for Find All
  References — standard VS Code UX. Peek variants work automatically.
- **`context.includeDeclaration`**: Respected — when true, the rule definition itself is included
  in the references list.

---

## Phase E — Rename Rule (implemented)

### Summary

Pressing **F2** on a rule key or any `apply`/`apply-hops` reference renames the rule and all
its usages in the file atomically.

### API

`renameProvider: { prepareProvider: true }` was already declared in `onInitialize`.

### Data flow

```
User presses F2 on a rule name (key or apply arg)
  → VS Code sends textDocument/prepareRename { position }
  → Handler:
     1. findRuleKeyAtOffset(text, offset)  → rule key hit?
     2. findApplyRuleReference(text, offset)  → apply arg hit?
     3. Either: return { range, placeholder: ruleName }
     4. Falls through to alias rename if neither
  → VS Code prompts user for new name
  → VS Code sends textDocument/rename { position, newName }
  → Handler:
     1. Resolve ruleName from key or apply-ref at cursor
     2. findRuleDefinition(text, ruleName, offset)  → key range
     3. findAllApplyReferences(text, ruleName)  → all apply/apply-hops ranges
     4. Build TextEdit[] replacing all occurrences
     5. Return WorkspaceEdit { changes: { [uri]: edits } }
```

### Implementation

**File**: `server/src/server.ts` — `connection.onPrepareRename` and `connection.onRenameRequest`

Priority order inside each handler:
1. Rule key (`findRuleKeyAtOffset`) — cursor on definition
2. Apply reference (`findApplyRuleReference`) — cursor on call site
3. Dataset alias (existing behaviour) — unchanged fallback

No changes to `definition.utils.ts` needed; all required helpers (`findRuleKeyAtOffset`,
`findApplyRuleReference`, `findRuleDefinition`, `findAllApplyReferences`) already existed
from Phases A–C.

### Tests

**File**: `tests/rule-rename.test.ts`

- `findRuleKeyAtOffset` — detects cursor on `"default"` and `"enrich"` keys
- `findApplyRuleReference` — detects cursor in `apply` and `apply-hops` first arg
- `findAllApplyReferences` — finds both `apply` and `apply-hops` refs; returns `[]` for rule with no calls
- `findRuleDefinition` — locates key offsets; returns `null` for unknown rule
- Full rename simulation — `"enrich"` → `"augment"` updates definition + both call sites; `"default"` → `"main"` updates key only (no apply refs)

### Verification

1. `pnpm test` — 507 tests pass
2. **Manual (F5 Extension Host)**:
   - F2 on a rule key → rename input pre-filled with rule name → all `apply`/`apply-hops` calls updated
   - F2 on an `apply` arg → same behaviour from the call site
   - F2 on a dataset alias → alias rename still works (unchanged)
   - F2 on an unrelated string → no rename offered (correct)

