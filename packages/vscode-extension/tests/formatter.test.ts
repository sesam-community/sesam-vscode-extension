import { describe, it, expect } from "vitest";
import {
  sortObjectKeysRecursively,
  formatSesamJson,
} from "../src/shared/config-formatter";

// ---------------------------------------------------------------------------
// sortObjectKeysRecursively
// ---------------------------------------------------------------------------

describe("sortObjectKeysRecursively", () => {
  it("returns primitives unchanged", () => {
    expect(sortObjectKeysRecursively(42)).toBe(42);
    expect(sortObjectKeysRecursively("hello")).toBe("hello");
    expect(sortObjectKeysRecursively(null)).toBe(null);
    expect(sortObjectKeysRecursively(true)).toBe(true);
  });

  it("sorts object keys alphabetically", () => {
    const result = sortObjectKeysRecursively({ z: 1, a: 2, m: 3 });
    expect(Object.keys(result as object)).toEqual(["a", "m", "z"]);
  });

  it("sorts keys recursively in nested objects", () => {
    const input = { z: { b: 1, a: 2 }, a: { d: 3, c: 4 } };
    const result = sortObjectKeysRecursively(input) as Record<
      string,
      Record<string, number>
    >;
    expect(Object.keys(result)).toEqual(["a", "z"]);
    expect(Object.keys(result["a"])).toEqual(["c", "d"]);
    expect(Object.keys(result["z"])).toEqual(["a", "b"]);
  });

  it("maps over arrays without reordering elements", () => {
    const input = [
      { b: 1, a: 2 },
      { d: 3, c: 4 },
    ];
    const result = sortObjectKeysRecursively(input) as Array<
      Record<string, number>
    >;
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    expect(Object.keys(result[0])).toEqual(["a", "b"]);
    expect(Object.keys(result[1])).toEqual(["c", "d"]);
  });

  it("handles empty object", () => {
    expect(sortObjectKeysRecursively({})).toEqual({});
  });

  it("handles empty array", () => {
    expect(sortObjectKeysRecursively([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatSesamJson — key order
// ---------------------------------------------------------------------------

describe("formatSesamJson — key order", () => {
  it("preserves the original key insertion order", () => {
    const input = { z: "last", a: "first", m: "middle" };
    const out = formatSesamJson(input, 2);
    const zIdx = out.indexOf('"z"');
    const aIdx = out.indexOf('"a"');
    const mIdx = out.indexOf('"m"');
    // z was inserted first, so it should appear first
    expect(zIdx).toBeLessThan(aIdx);
    expect(aIdx).toBeLessThan(mIdx);
  });

  it("preserves insertion order in nested objects", () => {
    const input = { outer: { z: 1, a: 2 } };
    const out = formatSesamJson(input, 2);
    expect(out.indexOf('"z"')).toBeLessThan(out.indexOf('"a"'));
  });
});

// ---------------------------------------------------------------------------
// formatSesamJson — object formatting
// ---------------------------------------------------------------------------

describe("formatSesamJson — object multi-line layout", () => {
  it("formats an empty object on one line", () => {
    expect(formatSesamJson({}, 2)).toBe("{}");
  });

  it("puts each key on a new indented line", () => {
    const out = formatSesamJson({ a: 1, b: 2 }, 2);
    expect(out).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });

  it("uses the requested tab size for indentation", () => {
    const out = formatSesamJson({ a: 1 }, 4);
    expect(out).toBe('{\n    "a": 1\n}');
  });

  it("adds a space after colons", () => {
    const out = formatSesamJson({ key: "value" }, 2);
    expect(out).toContain('"key": "value"');
  });
});

// ---------------------------------------------------------------------------
// formatSesamJson — array formatting
// ---------------------------------------------------------------------------

describe("formatSesamJson — array formatting", () => {
  it("formats an empty array on one line", () => {
    expect(formatSesamJson([], 2)).toBe("[]");
  });

  it("puts a space after commas inside arrays (compact inline)", () => {
    const out = formatSesamJson(["add", "_T.x", 1], 2);
    expect(out).toBe('["add", "_T.x", 1]');
  });

  it("opens a nested array on a new line when inside another array", () => {
    // outer array containing one inner array
    const out = formatSesamJson([["add", "_T.x", 1]], 2);
    // The inner array should start on a new line
    expect(out).toContain("\n");
    expect(out).toContain('["add", "_T.x", 1]');
  });
});

// ---------------------------------------------------------------------------
// formatSesamJson — Sesam pipe config (real-world shape)
// ---------------------------------------------------------------------------

describe("formatSesamJson — Sesam pipe config", () => {
  const pipeConfig = {
    _id: "my-pipe",
    type: "pipe",
    add_namespaces: true,
    source: { dataset: "my-source", type: "dataset" },
    transform: {
      rules: {
        default: [
          ["copy", "*"],
          ["add", "rdf:type", ["ni", "ns", "my-pipe"]],
        ],
        type: "dtl",
      },
    },
  };

  it("produces valid JSON when round-tripped", () => {
    const out = formatSesamJson(pipeConfig, 2);
    expect(() => JSON.parse(out)).not.toThrow();
    const parsed = JSON.parse(out);
    expect(parsed._id).toBe("my-pipe");
    expect(parsed.transform.rules.default).toHaveLength(2);
  });

  it("places _id before type before transform", () => {
    const out = formatSesamJson(pipeConfig, 2);
    const idIdx = out.indexOf('"_id"');
    const typeIdx = out.indexOf('"type"');
    const transformIdx = out.indexOf('"transform"');
    expect(idIdx).toBeLessThan(typeIdx);
    expect(typeIdx).toBeLessThan(transformIdx);
  });

  it("keeps DTL rule arrays compact on one line", () => {
    const out = formatSesamJson(pipeConfig, 2);
    // Each rule should be on one line (no newline inside a single rule array)
    expect(out).toContain('["copy", "*"]');
  });

  it("is idempotent — formatting twice yields the same output", () => {
    const once = formatSesamJson(pipeConfig, 2);
    const parsedOnce = JSON.parse(once);
    const twice = formatSesamJson(parsedOnce, 2);
    expect(twice).toBe(once);
  });
});

// ---------------------------------------------------------------------------
// formatSesamJson — strings with special characters
// ---------------------------------------------------------------------------

describe("formatSesamJson — string escaping", () => {
  it("preserves strings containing colons and brackets", () => {
    const out = formatSesamJson({ key: '["add", "_T.x"]' }, 2);
    const parsed = JSON.parse(out);
    expect(parsed.key).toBe('["add", "_T.x"]');
  });

  it("preserves strings containing backslash escapes", () => {
    const out = formatSesamJson({ path: "C:\\Users\\test" }, 2);
    const parsed = JSON.parse(out);
    expect(parsed.path).toBe("C:\\Users\\test");
  });
});
