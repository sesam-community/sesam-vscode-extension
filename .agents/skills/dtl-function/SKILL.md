---
name: dtl-function
description: Add a new DTL function to the extension's registry, evaluator, and tests. Use when adding or correcting a DTL built-in function, expression function, or transform function.
---

# Add a DTL Function

Every DTL function must be registered, optionally evaluable, and tested.

## Files to touch

| File | What to do |
|---|---|
| `src/shared/dtl-registry.ts` | Add the function to the correct category array |
| `src/shared/dtl-evaluator.ts` | Add evaluation logic (if it can be computed offline) |
| `tests/registry.test.ts` | Verify the function is discoverable |
| `tests/evaluator.test.ts` | Add offline evaluation test cases |

## Step 1 — Identify the category

Open `src/shared/dtl-registry.ts` and find the right `PascalCase` array:

| Array | Kind | Examples |
|---|---|---|
| `TransformFns` | `"transform"` | `add`, `copy`, `remove`, `merge`, `filter` |
| `BooleanLogicFns` | `"expression"` | `and`, `or`, `not`, `if` |
| `StringFns` | `"expression"` | `concat`, `upper`, `lower`, `string` |
| `MathFns` | `"expression"` | `plus`, `minus`, `multiply`, `divide` |
| `DatetimeFns` | `"expression"` | `datetime`, `datetime-parse`, `now` |
| `PathFns` | `"expression"` | `path`, `tuples`, `items`, `first`, `last` |
| `TypeFns` | `"expression"` | `is-null`, `is-empty`, `boolean`, `integer`, `float` |
| `UtilityFns` | `"expression"` | `coalesce`, `decode`, `hash128`, `uri-expand` |

## Step 2 — Add the DtlFunction entry

```ts
// In the correct array, e.g. StringFns:
{
  name: "my-function",
  kind: "expression",            // or "transform"
  description: "One-sentence description.",
  docUrl: "https://docs.sesam.io/DTLReferenceGuide.html#my-function",
  params: [
    { name: "value", description: "The input value.", optional: false },
    { name: "default", description: "Fallback when value is null.", optional: true },
  ],
  minArgs: 1,
  maxArgs: 2,
} satisfies DtlFunction,
```

The `FUNCTIONS` array at the bottom of the file is assembled via spread — no manual edit needed.

## Step 3 — Add evaluation logic (optional)

In `src/shared/dtl-evaluator.ts`, inside the `evaluate` switch:

```ts
case "my-function": {
  const [val, fallback] = args;
  return val ?? fallback ?? null;
}
```

Only implement if the function can be computed offline (no node connection required).
Skip for functions that require network I/O or have non-deterministic output.

## Step 4 — Tests

### registry.test.ts
```ts
it("my-function is known", () => {
  expect(isKnownFunction("my-function")).toBe(true);
});

it("my-function has the correct kind", () => {
  expect(getDtlFunction("my-function")?.kind).toBe("expression");
});
```

### evaluator.test.ts (if evaluated)
```ts
it("my-function returns the value when non-null", () => {
  expect(evaluate(["my-function", "hello"], ctx)).toBe("hello");
});

it("my-function returns fallback when null", () => {
  expect(evaluate(["my-function", null, "default"], ctx)).toBe("default");
});
```

## Step 5 — Run tests

```bash
cd packages/vscode-extension
pnpm test
```

All existing tests must still pass.
