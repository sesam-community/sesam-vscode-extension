import { describe, it, expect } from "vitest";
import { evaluate } from "../src/shared/dtl-evaluator";

// Shorthand: evaluate rules against a source entity and return the output
function run(rules: unknown[], source: Record<string, unknown> = {}) {
  return evaluate(rules, source as Parameters<typeof evaluate>[1]);
}

// ---------------------------------------------------------------------------
// Transforms
// ---------------------------------------------------------------------------

describe("add", () => {
  it("adds a literal value", () => {
    const { output } = run([["add", "_T.name", "Alice"]]);
    expect(output["_T.name"]).toBe("Alice");
  });

  it("adds a value from source", () => {
    const { output } = run([["add", "_T.age", "_S.age"]], { age: 30 });
    expect(output["_T.age"]).toBe(30);
  });

  it("adds an evaluated expression", () => {
    const { output } = run([["add", "_T.x", ["+", 2, 3]]]);
    expect(output["_T.x"]).toBe(5);
  });
});

describe("add-if", () => {
  it("adds value when condition is truthy", () => {
    const { output } = run([["add-if", "_T.x", "hello"]]);
    expect(output["_T.x"]).toBe("hello");
  });

  it("does not add when value is null", () => {
    const { output } = run([["add-if", "_T.x", "_S.missing"]]);
    expect("_T.x" in output).toBe(false);
  });

  it("does not add when value is false", () => {
    const { output } = run([["add-if", "_T.x", false]]);
    expect("_T.x" in output).toBe(false);
  });
});

describe("copy", () => {
  it("copies all source properties with wildcard", () => {
    const { output } = run([["copy", "*"]], { a: 1, b: 2 });
    expect(output["a"]).toBe(1);
    expect(output["b"]).toBe(2);
  });

  it("copies a single named property", () => {
    const { output } = run([["copy", "a"]], { a: 1, b: 2 });
    expect(output["a"]).toBe(1);
    expect("b" in output).toBe(false);
  });

  it("does nothing for a property that does not exist on source", () => {
    const { output } = run([["copy", "missing"]], { a: 1 });
    expect("missing" in output).toBe(false);
  });
});

describe("remove", () => {
  it("removes a named property", () => {
    const { output } = run(
      [
        ["copy", "*"],
        ["remove", "secret"],
      ],
      { name: "Bob", secret: "s3cr3t" },
    );
    expect("secret" in output).toBe(false);
    expect(output["name"]).toBe("Bob");
  });

  it("removes all properties with wildcard", () => {
    const { output } = run(
      [
        ["copy", "*"],
        ["remove", "*"],
      ],
      { a: 1, b: 2 },
    );
    expect(Object.keys(output).length).toBe(0);
  });
});

describe("rename", () => {
  it("creates new key from evaluated expression", () => {
    const { output } = run([["rename", "_T.fullName", "_S.name"]], {
      name: "Carol",
    });
    expect(output["_T.fullName"]).toBe("Carol");
  });
});

describe("default", () => {
  it("sets property when not yet present", () => {
    const { output } = run([["default", "_T.x", 42]]);
    expect(output["_T.x"]).toBe(42);
  });

  it("does not overwrite an existing property", () => {
    const { output } = run([
      ["add", "_T.x", 1],
      ["default", "_T.x", 99],
    ]);
    expect(output["_T.x"]).toBe(1);
  });
});

describe("filter / discard", () => {
  it("returns discarded status when filter condition is false", () => {
    const result = run([["filter", ["eq", "_S.type", "person"]]], {
      type: "company",
    });
    expect(result.status).toBe("discarded");
    expect(result.output).toEqual({});
  });

  it("returns ok status when filter condition is true", () => {
    const result = run([["filter", ["eq", "_S.type", "person"]]], {
      type: "person",
    });
    expect(result.status).toBe("ok");
  });

  it("discard always discards", () => {
    const result = run([["discard"]]);
    expect(result.status).toBe("discarded");
  });
});

describe("if transform", () => {
  it("applies then-branch when condition is truthy", () => {
    const { output } = run(
      [["if", ["eq", "_S.x", 1], ["add", "_T.branch", "then"]]],
      { x: 1 },
    );
    expect(output["_T.branch"]).toBe("then");
  });

  it("applies else-branch when condition is falsy", () => {
    const { output } = run(
      [
        [
          "if",
          ["eq", "_S.x", 1],
          ["add", "_T.branch", "then"],
          ["add", "_T.branch", "else"],
        ],
      ],
      { x: 0 },
    );
    expect(output["_T.branch"]).toBe("else");
  });
});

describe("case transform", () => {
  it("executes the matching branch", () => {
    const { output } = run(
      [
        [
          "case",
          ["eq", "_S.n", 1],
          ["add", "_T.label", "one"],
          ["eq", "_S.n", 2],
          ["add", "_T.label", "two"],
        ],
      ],
      { n: 2 },
    );
    expect(output["_T.label"]).toBe("two");
  });

  it("executes default branch when nothing matches", () => {
    const { output } = run(
      [
        [
          "case",
          ["eq", "_S.n", 1],
          ["add", "_T.label", "one"],
          ["add", "_T.label", "other"],
        ],
      ],
      { n: 99 },
    );
    expect(output["_T.label"]).toBe("other");
  });
});

describe("case-eq transform", () => {
  it("matches exact value", () => {
    const { output } = run(
      [
        [
          "case-eq",
          "_S.color",
          "red",
          ["add", "_T.code", "#f00"],
          "blue",
          ["add", "_T.code", "#00f"],
        ],
      ],
      { color: "blue" },
    );
    expect(output["_T.code"]).toBe("#00f");
  });
});

describe("merge", () => {
  it("merges a dict into the target", () => {
    const { output } = run([
      ["add", "_T.a", 1],
      ["merge", ["dict", "b", 2, "c", 3]],
    ]);
    expect(output["_T.a"]).toBe(1);
    expect(output["b"]).toBe(2);
    expect(output["c"]).toBe(3);
  });
});

describe("comment", () => {
  it("is a no-op", () => {
    const { output, status } = run([["comment", "this is ignored"]]);
    expect(status).toBe("ok");
    expect(output).toEqual({});
  });
});

describe("unsupported transform", () => {
  it("adds a warning and continues", () => {
    const result = run([
      ["hops", {}],
      ["add", "_T.x", 1],
    ]);
    expect(result.status).toBe("ok");
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.output["_T.x"]).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Expressions — strings
// ---------------------------------------------------------------------------

describe("string expressions", () => {
  it("concat joins multiple values", () => {
    const { output } = run([
      ["add", "_T.r", ["concat", "hello", " ", "world"]],
    ]);
    expect(output["_T.r"]).toBe("hello world");
  });

  it("upper / lower", () => {
    const { output } = run([
      ["add", "_T.u", ["upper", "hello"]],
      ["add", "_T.l", ["lower", "WORLD"]],
    ]);
    expect(output["_T.u"]).toBe("HELLO");
    expect(output["_T.l"]).toBe("world");
  });

  it("strip removes surrounding whitespace", () => {
    const { output } = run([["add", "_T.r", ["strip", "  hi  "]]]);
    expect(output["_T.r"]).toBe("hi");
  });

  it("replace all occurrences", () => {
    const { output } = run([["add", "_T.r", ["replace", "a", "o", "banana"]]]);
    expect(output["_T.r"]).toBe("bonono");
  });

  it("substring with start and end", () => {
    const { output } = run([["add", "_T.r", ["substring", "hello", 1, 3]]]);
    expect(output["_T.r"]).toBe("el");
  });

  it("split produces an array", () => {
    const { output } = run([["add", "_T.r", ["split", ",", "a,b,c"]]]);
    expect(output["_T.r"]).toEqual(["a", "b", "c"]);
  });

  it("join arrays into a string", () => {
    const { output } = run([
      ["add", "_T.r", ["join", "-", ["list", "a", "b", "c"]]],
    ]);
    expect(output["_T.r"]).toBe("a-b-c");
  });

  it("length of string", () => {
    const { output } = run([["add", "_T.r", ["length", "hello"]]]);
    expect(output["_T.r"]).toBe(5);
  });

  it("matches regex", () => {
    const { output } = run([["add", "_T.r", ["matches", "^\\d+$", "123"]]]);
    expect(output["_T.r"]).toBe(true);
  });

  it("ljust / rjust pad strings", () => {
    const { output } = run([
      ["add", "_T.l", ["ljust", "hi", 5, "-"]],
      ["add", "_T.r", ["rjust", "hi", 5, "-"]],
    ]);
    expect(output["_T.l"]).toBe("hi---");
    expect(output["_T.r"]).toBe("---hi");
  });
});

// ---------------------------------------------------------------------------
// Expressions — comparisons & booleans
// ---------------------------------------------------------------------------

describe("comparison expressions", () => {
  it("eq", () => {
    const { output } = run([["add", "_T.r", ["eq", 1, 1]]]);
    expect(output["_T.r"]).toBe(true);
  });

  it("neq", () => {
    const { output } = run([["add", "_T.r", ["neq", 1, 2]]]);
    expect(output["_T.r"]).toBe(true);
  });

  it("gt / gte / lt / lte", () => {
    const { output } = run([
      ["add", "_T.a", ["gt", 5, 3]],
      ["add", "_T.b", ["gte", 3, 3]],
      ["add", "_T.c", ["lt", 2, 4]],
      ["add", "_T.d", ["lte", 4, 4]],
    ]);
    expect(output["_T.a"]).toBe(true);
    expect(output["_T.b"]).toBe(true);
    expect(output["_T.c"]).toBe(true);
    expect(output["_T.d"]).toBe(true);
  });
});

describe("boolean expressions", () => {
  it("and", () => {
    expect(run([["add", "_T.r", ["and", true, true]]]).output["_T.r"]).toBe(
      true,
    );
    expect(run([["add", "_T.r", ["and", true, false]]]).output["_T.r"]).toBe(
      false,
    );
  });

  it("or", () => {
    expect(run([["add", "_T.r", ["or", false, true]]]).output["_T.r"]).toBe(
      true,
    );
    expect(run([["add", "_T.r", ["or", false, false]]]).output["_T.r"]).toBe(
      false,
    );
  });

  it("not", () => {
    expect(run([["add", "_T.r", ["not", false]]]).output["_T.r"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Expressions — math
// ---------------------------------------------------------------------------

describe("math expressions", () => {
  it("+ sums all args", () => {
    const { output } = run([["add", "_T.r", ["+", 1, 2, 3]]]);
    expect(output["_T.r"]).toBe(6);
  });

  it("- subtracts", () => {
    const { output } = run([["add", "_T.r", ["-", 10, 3]]]);
    expect(output["_T.r"]).toBe(7);
  });

  it("* multiplies all args", () => {
    const { output } = run([["add", "_T.r", ["*", 2, 3, 4]]]);
    expect(output["_T.r"]).toBe(24);
  });

  it("/ divides", () => {
    const { output } = run([["add", "_T.r", ["/", 10, 4]]]);
    expect(output["_T.r"]).toBe(2.5);
  });

  it("% modulo", () => {
    const { output } = run([["add", "_T.r", ["%", 7, 3]]]);
    expect(output["_T.r"]).toBe(1);
  });

  it("abs", () => {
    const { output } = run([["add", "_T.r", ["abs", -5]]]);
    expect(output["_T.r"]).toBe(5);
  });

  it("ceil / floor / round", () => {
    const { output } = run([
      ["add", "_T.a", ["ceil", 1.2]],
      ["add", "_T.b", ["floor", 1.9]],
      ["add", "_T.c", ["round", 1.567, 2]],
    ]);
    expect(output["_T.a"]).toBe(2);
    expect(output["_T.b"]).toBe(1);
    expect(output["_T.c"]).toBe(1.57);
  });

  it("pow / sqrt", () => {
    const { output } = run([
      ["add", "_T.a", ["pow", 2, 8]],
      ["add", "_T.b", ["sqrt", 9]],
    ]);
    expect(output["_T.a"]).toBe(256);
    expect(output["_T.b"]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Expressions — lists
// ---------------------------------------------------------------------------

describe("list expressions", () => {
  it("list creates an array", () => {
    const { output } = run([["add", "_T.r", ["list", 1, 2, 3]]]);
    expect(output["_T.r"]).toEqual([1, 2, 3]);
  });

  it("map transforms each element", () => {
    const { output } = run([
      ["add", "_T.r", ["map", ["list", 1, 2, 3], ["*", "_", 2]]],
    ]);
    expect(output["_T.r"]).toEqual([2, 4, 6]);
  });

  it("filter keeps matching elements", () => {
    const { output } = run([
      ["add", "_T.r", ["filter", ["list", 1, 2, 3, 4], ["gt", "_", 2]]],
    ]);
    expect(output["_T.r"]).toEqual([3, 4]);
  });

  it("first / last", () => {
    const { output } = run([
      ["add", "_T.a", ["first", ["list", 10, 20, 30]]],
      ["add", "_T.b", ["last", ["list", 10, 20, 30]]],
    ]);
    expect(output["_T.a"]).toBe(10);
    expect(output["_T.b"]).toBe(30);
  });

  it("count", () => {
    const { output } = run([
      ["add", "_T.r", ["count", ["list", "a", "b", "c"]]],
    ]);
    expect(output["_T.r"]).toBe(3);
  });

  it("distinct removes duplicates", () => {
    const { output } = run([
      ["add", "_T.r", ["distinct", ["list", 1, 2, 1, 3, 2]]],
    ]);
    expect(output["_T.r"]).toEqual([1, 2, 3]);
  });

  it("flatten flattens one level", () => {
    const { output } = run([
      ["add", "_T.r", ["flatten", ["list", ["list", 1, 2], ["list", 3]]]],
    ]);
    expect(output["_T.r"]).toEqual([1, 2, 3]);
  });

  it("sum", () => {
    const { output } = run([["add", "_T.r", ["sum", ["list", 1, 2, 3, 4]]]]);
    expect(output["_T.r"]).toBe(10);
  });

  it("min / max", () => {
    const { output } = run([
      ["add", "_T.a", ["min", ["list", 3, 1, 4, 1, 5, 9]]],
      ["add", "_T.b", ["max", ["list", 3, 1, 4, 1, 5, 9]]],
    ]);
    expect(output["_T.a"]).toBe(1);
    expect(output["_T.b"]).toBe(9);
  });

  it("in checks membership", () => {
    const { output } = run([
      ["add", "_T.a", ["in", 2, ["list", 1, 2, 3]]],
      ["add", "_T.b", ["in", 9, ["list", 1, 2, 3]]],
    ]);
    expect(output["_T.a"]).toBe(true);
    expect(output["_T.b"]).toBe(false);
  });

  it("sorted ascending", () => {
    const { output } = run([["add", "_T.r", ["sorted", ["list", 3, 1, 2]]]]);
    expect(output["_T.r"]).toEqual([1, 2, 3]);
  });

  it("reversed", () => {
    const { output } = run([["add", "_T.r", ["reversed", ["list", 1, 2, 3]]]]);
    expect(output["_T.r"]).toEqual([3, 2, 1]);
  });
});

// ---------------------------------------------------------------------------
// Expressions — nulls / conditionals
// ---------------------------------------------------------------------------

describe("null and conditional expressions", () => {
  it("is-null / is-not-null", () => {
    const { output } = run([
      ["add", "_T.a", ["is-null", null]],
      ["add", "_T.b", ["is-not-null", "x"]],
    ]);
    expect(output["_T.a"]).toBe(true);
    expect(output["_T.b"]).toBe(true);
  });

  it("if expression selects branch", () => {
    const { output } = run([
      ["add", "_T.a", ["if", true, "yes", "no"]],
      ["add", "_T.b", ["if", false, "yes", "no"]],
    ]);
    expect(output["_T.a"]).toBe("yes");
    expect(output["_T.b"]).toBe("no");
  });

  it("if-null returns fallback when null", () => {
    const { output } = run([["add", "_T.r", ["if-null", null, "default"]]]);
    expect(output["_T.r"]).toBe("default");
  });

  it("coalesce returns first non-null", () => {
    const { output } = run([
      ["add", "_T.r", ["coalesce", null, null, "found"]],
    ]);
    expect(output["_T.r"]).toBe("found");
  });
});

// ---------------------------------------------------------------------------
// Expressions — dict
// ---------------------------------------------------------------------------

describe("dict expressions", () => {
  it("dict builds an object from key-value pairs", () => {
    const { output } = run([["add", "_T.r", ["dict", "a", 1, "b", 2]]]);
    expect(output["_T.r"]).toEqual({ a: 1, b: 2 });
  });

  it("keys / values", () => {
    const { output } = run([
      ["add", "_T.a", ["keys", ["dict", "x", 1, "y", 2]]],
      ["add", "_T.b", ["values", ["dict", "x", 1, "y", 2]]],
    ]);
    expect(output["_T.a"]).toEqual(["x", "y"]);
    expect(output["_T.b"]).toEqual([1, 2]);
  });

  it("has-key", () => {
    const { output } = run([
      ["add", "_T.r", ["has-key", ["dict", "a", 1], "a"]],
    ]);
    expect(output["_T.r"]).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Variable access (_S, _T, _)
// ---------------------------------------------------------------------------

describe("variable access", () => {
  it("_S.property reads from source", () => {
    const { output } = run([["add", "_T.x", "_S.value"]], { value: 42 });
    expect(output["_T.x"]).toBe(42);
  });

  it("_T.property reads from target properties copied via copy/merge", () => {
    // Note: ["add", "_T.x", 10] stores the literal key "_T.x" in the target
    // object, but evalStringExpr("_T.x") uses getProp(target, "x") (prefix
    // stripped), so add-then-read via _T is not supported in the mini-evaluator.
    // Properties that land in target through copy/* or merge (with un-prefixed
    // keys) can be read back via _T.
    const { output } = run(
      [
        ["copy", "*"],
        ["add", "_T.double", ["*", "_T.score", 2]],
      ],
      { score: 5 },
    );
    expect(output["_T.double"]).toBe(10);
  });

  it("_ refers to the current item inside map", () => {
    const { output } = run([
      ["add", "_T.r", ["map", ["list", 1, 2, 3], ["+", "_", 10]]],
    ]);
    expect(output["_T.r"]).toEqual([11, 12, 13]);
  });

  it("returns null for missing source property", () => {
    const { output } = run([["add", "_T.x", "_S.nonexistent"]], {});
    expect(output["_T.x"]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Overall status
// ---------------------------------------------------------------------------

describe("evaluate status", () => {
  it("returns ok for successful execution", () => {
    expect(run([]).status).toBe("ok");
  });

  it("returns discarded immediately on discard", () => {
    const result = run([
      ["discard"],
      ["add", "_T.x", 1], // never reached
    ]);
    expect(result.status).toBe("discarded");
    expect("_T.x" in result.output).toBe(false);
  });
});
