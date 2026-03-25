# F19: DTL Syntax Linting

> **Status**: `implemented`
> **Rollout Phase**: Phase 1 - MVP
> **Depends on**: none (enhances existing `dtl-parser.ts` / `dtl-validator.ts` pipeline)
> **Tracking**: [README.md](README.md)

---

## Summary

Show editor diagnostics (red/yellow squiggles) when DTL or pipe config files contain syntax and
semantic errors. This covers two layers:

1. **JSON structure errors** — malformed JSON that `JSON.parse` currently swallows silently (e.g.
   two arrays written next to each other without a separating `,`).
2. **DTL semantic errors** — structurally valid JSON that violates DTL rules (e.g. a transform
   function used inside an expression argument, or an `apply` call referencing a rule that does not
   exist in the same `rules` dict).

Currently `parseDtlText` calls `JSON.parse` and returns early with no calls *and no errors* when
parsing fails, so the user gets no feedback at all. This feature surfaces those failures directly
in the editor.

---

## DTL JSON Format — Key Semantic Rules

### Rules list structure
Each element of a `rules.<name>` array must be an **array** (a DTL call), never a
primitive value or bare object:

```json
"rules": {
  "default": [
    ["add", "type", "customer"],   ✓  call array
    ["copy", "_id"],               ✓  call array
    "some-string"                  ✗  bare primitive — invalid
  ]
}
```

### Function call structure
Each DTL call array must have a **string** as its first element (the function name):

```json
["add", "foo", "bar"]          ✓  string first element — valid call
[["add", "x", 1], ["copy", "_"]]  ✓  array first element — inline transform block (e.g. "if" then/else branch)
```

A bare non-array, non-string item *inside* a `rules` list (e.g. `"just-a-string"`) is invalid —
only array items (calls or inline transform blocks) are permitted.

### Transform vs. expression functions
The `DtlFunctionKind` in `dtl-registry.types.ts` distinguishes:

| Kind | Examples | Where valid |
|---|---|---|
| `"transform"` | `add`, `copy`, `remove`, `filter`, `merge`, `default`, `create`, `emit`, `create-child`, `discard`, `fail` | **Top-level only** inside a rules list |
| `"expression"` | `upper`, `concat`, `eq`, `sum`, `count`, `hops`, `if`, … | As **arguments** to other calls *or* at top-level if the function evaluates/returns without emitting an entity |

Placing a transform function (`kind: "transform"`) as a *nested argument* inside another call is
an error — transform functions are *statements*, not values.

> **Note**: The inverse (expression at top-level) is **not** itself an error in Sesam — it is valid
> to evaluate an expression at the top level and discard the result. Do not lint this case.

### `apply` / `apply-hops` rule reference
When `["apply", "ruleName", expr]` or `["apply-hops", "ruleName", hopsSpec]` is used, the
`ruleName` string must match a key in the enclosing transform's `rules` dictionary:

```json
"rules": {
  "default": [
    ["apply-hops", "order", { ... }]   ✓  "order" exists below
  ],
  "order": [
    ["copy", "_id"]
  ]
}
```

If `ruleName` does not match any key in `rules`, emit a `Warning` (not `Error`) because the user
may be in the middle of adding the rule.

### DTL argument value types

Reviewing all DTL function categories, the concrete JSON value types that can appear as
**literal arguments** (non-call, non-path-expression values) in DTL source are:

| JSON type | Examples in DTL | How to identify |
|---|---|---|
| `string` | `"_S.name"`, `"customer"`, `"day"`, `"UTC"`, `"murmur3"`, `"orders o"` | `typeof v === "string"` |
| `number` | `26`, `3.14`, `1`, `-1` — e.g. `["sleep!", 10]`, `["datetime-plus", "day", 1, ...]` | `typeof v === "number"` |
| `boolean` | `true`, `false` — e.g. `["add", "is_adult", true]`, `hops.recurse: true` | `typeof v === "boolean"` |
| `null` | `null` — e.g. `["add-if", "foo", null]` | `v === null` |
| `object` (dict) | hops spec `{"datasets":[...],"where":[...]}`, `["apply-ns", {"property_namespace":...}]`, `["has-key","a",{"a":1}]` | `typeof v === "object" && !Array.isArray(v)` |
| `array` | sub-expressions `["upper","_S.name"]`, `["list",1,2]` | `Array.isArray(v)` |

**Conclusion**: the claim "only booleans, numbers and null are not strings" is **incomplete** —
**objects (dicts)** are also used as direct literal arguments in several functions:
`hops`, `apply-hops`, `apply-ns` (config dict form), `has-key`, `merge`/`merge-union` (inline
entity literals), `literal`, `dict`, and others.

**Implication for Phase D**: when scanning for path-expression candidates, skip every argument
that is not a plain JSON string (`typeof arg !== "string"`). Numbers, booleans, null, objects,
and sub-expression arrays are all non-candidates and require no path validation.

### Path expression format
Path strings such as `"_S.firstname"` or `"o.cust_id"` must:

- Start with a known variable prefix or a declared dataset alias (e.g. `_S`, `_T`, `_P`, `_R`,
  `_B`, `_`) — unless the string contains no dot (it is then treated as a literal, not a path).
- Not contain empty segments (e.g. `"_S..foo"` has an empty segment between the two dots).
- Use the trailing-dot self-reference form `"_S."` only as a standalone path (referencing the
  entity itself), not in the middle of a path (e.g. `"_S..name"` is malformed).

> **Scope note**: Full alias-awareness inside `hops` `datasets` declarations (checking `o.field`
> against a declared alias `o`) is complex and is **deferred** to a future sub-phase. For Phase A–C
> below, only the basic prefix validation described above is implemented.

---

## Implementation Phases

### Phase A — Surface JSON parse errors

**Goal**: show an error squiggle when the document contains invalid JSON, instead of silently
skipping all validation.

1. Modify `ParseResult` in `dtl-parser.ts` to add a `parseError` field:

   ```ts
   export interface ParseError {
     message: string;
     /** Approximate 0-based offset of the error in the document, or -1 if unavailable */
     offset: number;
   }

   export interface ParseResult {
     calls: DtlCall[];
     errors: string[];          // keep for backwards compat
     parseError: ParseError | null;
   }
   ```

2. In `parseDtlText`, catch the `SyntaxError` thrown by `JSON.parse` and populate `parseError`:
   - Node ≥ 20 attaches a `position` property directly on the error object — use it when present.
   - Fall back to grepping the message for `"at position N"` patterns.
   - If neither is available, set `offset: -1` (diagnostic lands on line 0).

3. In `server.ts` → `validateDocument`, convert `parseResult.parseError` into an LSP `Diagnostic`:

   ```ts
   if (parseResult.parseError) {
     const pos = parseResult.parseError.offset >= 0
       ? offsetToPosition(text, parseResult.parseError.offset)
       : { line: 0, character: 0 };
     diagnostics.push({
       range: Range.create(pos.line, pos.character, pos.line, pos.character + 1),
       severity: DiagnosticSeverity.Error,
       message: `Invalid JSON: ${parseResult.parseError.message}`,
       source: "dtl",
       code: "invalid-json",
     });
   }
   ```

4. When `parseError` is set, skip DTL semantic validation (no valid AST to validate).

**Example error caught**:
- `[["add" "foo"]["copy" "_id"]]` → *"Invalid JSON: Expected ',' or ']' after array element"*

---

### Phase B — DTL structural validation

**Goal**: validate structural DTL rules on top of valid JSON.

Add a new `validateStructure` function in `dtl-validator.ts` (or a new file
`server/src/dtl-structure-validator.ts`) that takes the raw parsed JSON value (not just `DtlCall[]`)
and emits `Diagnostic[]`.

Checks to implement:

| Check | Severity | Code |
|---|---|---|
| Item in rules list is not an array | `Error` | `rule-not-array` |
| First element of a DTL call is not a string | `Error` | `missing-function-name` |
| `apply` / `apply-hops` references an undefined rule name | `Warning` | `undefined-rule` |

Because the walker already tracks all calls and the `DtlCall` type already carries positional info,
the rule-not-array and missing-function check can be done using the existing `DtlCall` output —
specifically by inspecting `functionName === null` at top-level calls.

For the `apply` / `apply-hops` rule reference check: `parseDtlText` already has access to the full
`rules` dict structure. Extend `ParseResult` with:

```ts
/** All rule names declared in this document's transforms, keyed by transform index */
ruleNames: Set<string>;
```

Then in `validateCalls`, when `functionName === "apply" || functionName === "apply-hops"`:
* Expect `argCount >= 1`.
* Read the second element of the call (the rule name) — this requires exposing the raw args from
  the walker. Add an optional `firstStringArg: string | null` field to `DtlCall` to hold the first
  string argument (i.e. `arr[1]` when it is a string).
* Look it up in `parseResult.ruleNames`.

---

### Phase C — Kind-aware context validation

**Goal**: warn when a `transform` function is used as a nested expression argument.

`DtlCall` already has `isTopLevel: boolean`. When `isTopLevel === false` and `getDtlFunction(name)?.kind === "transform"`, emit:

```
Error: Transform function "add" cannot be used as an expression argument.
       Only expression functions are valid here.
```

Code: `transform-in-expression`, Severity: `Error`

This check belongs in `validateCalls` in `dtl-validator.ts` — it is a single extra `if` branch.

---

### Phase D — Path expression validation

**Goal**: catch obviously malformed path strings.

1. Add `validatePathStrings(calls: DtlCall[], text: string): Diagnostic[]` in
   `server/src/dtl-path-validator.ts`.
2. For each string argument in every `DtlCall`, run `looksLikePath(value)`:
   - Returns true if the string contains a `.` and starts with `_` or a lowercase Latin letter
     (potential alias prefix).
3. If `looksLikePath`, check:
   - No empty segments: reject `"_S..foo"`.
   - Valid variable prefix — must start with one of: `_S`, `_T`, `_P`, `_R`, `_B`, `_.<`sth`>`.
     If the prefix is a single lowercase word followed by `.` it may be an alias — skip prefix
     validation for those (future Phase).
4. Emit `Warning` with code `"malformed-path"`.

> This phase is relatively minor and can be shipped independently of Phases A–C.

---

## Settings Integration

Extend `DtlSettings` / `defaultSettings` with individual toggles for each Phase:

```ts
validate: {
  enabled: true,
  unknownFunctions: true,
  argCount: true,
  jsonSyntax: true,        // Phase A
  dtlStructure: true,       // Phase B
  transformInExpression: true,  // Phase C
  pathExpressions: false,   // Phase D — off by default (noisy)
}
```

Wire these through `ValidatorOptions` in `dtl-validator.types.ts`.

---

## Files to Create / Modify

| File | Change |
|---|---|
| `server/src/dtl-parser.ts` | Add `ParseError` type; populate `parseResult.parseError` on JSON failure; add `ruleNames: Set<string>` and `firstStringArg` to relevant types |
| `server/src/dtl-validator.ts` | Add Phase C check (`transform-in-expression`); add `undefined-rule` check |
| `server/src/dtl-structure-validator.ts` *(new)* | Phase B structural checks: `rule-not-array`, `missing-function-name` |
| `server/src/dtl-path-validator.ts` *(new)* | Phase D path expression checks |
| `server/src/server.ts` | Convert `parseError` → Diagnostic; call new validators; merge into `sendDiagnostics` |
| `server/src/server.types.ts` | Add `jsonSyntax`, `dtlStructure`, `transformInExpression`, `pathExpressions` to `DtlSettings.validate` |
| `server/src/constants.ts` | Update `defaultSettings` with new validation flags |
| `types/dtl-validator.types.ts` | Add new flags to `ValidatorOptions` |
| `tests/validator.test.ts` | Add tests for Phases C–D |
| `tests/parser.test.ts` | Add tests for Phase A (`parseError` populated correctly) |
| `tests/structure-validator.test.ts` *(new)* | Tests for Phase B structural checks |

---

## Test Cases

### Phase A

| Input (inside `"rules": { "default": [...] }`) | Expected |
|---|---|
| `[["add" "foo"]["copy" "_id"]]` — missing comma | `invalid-json` error at position of `[` |
| `{"_id": "x" "type": "pipe"}` — missing comma between keys | `invalid-json` error |
| `[["add", "foo"], ["copy", "_id"]]` — valid | no diagnostics |

### Phase B

| Input | Expected |
|---|---|
| `"rules": { "default": ["just-a-string"] }` | `rule-not-array` error |
| `["if", cond, [["add", "x", 1], ["merge", "_T"]]]` — then-block (array of arrays) | no diagnostic — treated as inline transform block |
| `["apply", "nonexistent"]` at top level | `undefined-rule` warning |
| `["apply", "order"]` where `"order"` exists in `rules` | no diagnostic |

### Phase C

| Input | Expected |
|---|---|
| `["concat", ["add", "foo", "bar"], "baz"]` — `add` nested as arg | `transform-in-expression` error |
| `["add", "name", ["upper", "_S.name"]]` — `upper` nested | no diagnostic |

### Phase D

| Input | Expected |
|---|---|
| `"_S..foo"` as an argument string | `malformed-path` warning |
| `"_S.name"` | no diagnostic |
| `"_S."` (self-reference) | no diagnostic |

---

## Priority

Implement in order: **Phase A → B → C → D**.

Phase A gives the highest user-visible value (catches the user's exact reported bug) with minimal
code change. Phases B and C are high-value and build directly on the existing `DtlCall` structure.
Phase D is lower-priority and can ship as a follow-up PR.
