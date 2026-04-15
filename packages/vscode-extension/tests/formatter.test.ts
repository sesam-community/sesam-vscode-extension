import { describe, it, expect } from "vitest";
import {
  sortObjectKeysRecursively,
  formatSesamJson,
  reorderConfigKeys,
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
    const result = sortObjectKeysRecursively(input) as Record<string, Record<string, number>>;
    expect(Object.keys(result)).toEqual(["a", "z"]);
    expect(Object.keys(result["a"])).toEqual(["c", "d"]);
    expect(Object.keys(result["z"])).toEqual(["a", "b"]);
  });

  it("maps over arrays without reordering elements", () => {
    const input = [
      { b: 1, a: 2 },
      { d: 3, c: 4 },
    ];
    const result = sortObjectKeysRecursively(input) as Array<Record<string, number>>;
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

// ---------------------------------------------------------------------------
// reorderConfigKeys
// ---------------------------------------------------------------------------

describe("reorderConfigKeys", () => {
  it("puts _id first and type second for a pipe config", () => {
    const obj = { source: {}, type: "pipe", _id: "my-pipe", pump: {}, transform: {} };
    const result = reorderConfigKeys(obj);
    const keys = Object.keys(result);
    expect(keys[0]).toBe("_id");
    expect(keys[1]).toBe("type");
    expect(keys[2]).toBe("source");
  });

  it("orders pipe keys: _id, type, source, sink, transform, pump", () => {
    const obj = { pump: {}, sink: {}, transform: {}, source: {}, type: "pipe", _id: "x" };
    const keys = Object.keys(reorderConfigKeys(obj));
    expect(keys.indexOf("_id")).toBeLessThan(keys.indexOf("type"));
    expect(keys.indexOf("type")).toBeLessThan(keys.indexOf("source"));
    expect(keys.indexOf("source")).toBeLessThan(keys.indexOf("sink"));
    expect(keys.indexOf("sink")).toBeLessThan(keys.indexOf("transform"));
    expect(keys.indexOf("transform")).toBeLessThan(keys.indexOf("pump"));
  });

  it("orders system keys: _id, type, name, description", () => {
    const obj = { description: "desc", name: "n", type: "system:rest", _id: "sys" };
    const keys = Object.keys(reorderConfigKeys(obj));
    expect(keys.indexOf("_id")).toBeLessThan(keys.indexOf("type"));
    expect(keys.indexOf("type")).toBeLessThan(keys.indexOf("name"));
    expect(keys.indexOf("name")).toBeLessThan(keys.indexOf("description"));
  });

  it("places unknown keys after canonical ones, sorted alphabetically", () => {
    const obj = { zebra: 1, alpha: 2, type: "pipe", _id: "x", source: {} };
    const keys = Object.keys(reorderConfigKeys(obj));
    const canonical = ["_id", "type", "source"];
    const lastCanonical = Math.max(...canonical.map((k) => keys.indexOf(k)));
    expect(keys.indexOf("alpha")).toBeGreaterThan(lastCanonical);
    expect(keys.indexOf("zebra")).toBeGreaterThan(lastCanonical);
    expect(keys.indexOf("alpha")).toBeLessThan(keys.indexOf("zebra"));
  });

  it("sorts unknown-type objects alphabetically with internal keys last", () => {
    const obj = { z: 1, a: 2 };
    const result = reorderConfigKeys(obj);
    expect(Object.keys(result)).toEqual(["a", "z"]);
  });

  it("does not recursively reorder nested objects", () => {
    const obj = { source: { dataset: "d", type: "dataset" }, type: "pipe", _id: "x" };
    const result = reorderConfigKeys(obj) as typeof obj;
    // nested source keys should remain in original insertion order
    expect(Object.keys(result.source)).toEqual(["dataset", "type"]);
  });
});

// ---------------------------------------------------------------------------
// formatSesamJson — reorderKeys option
// ---------------------------------------------------------------------------

describe("formatSesamJson — reorderKeys option", () => {
  it("reorders pipe root keys when reorderKeys is true", () => {
    const pipe = { pump: {}, source: {}, type: "pipe", _id: "my-pipe" };
    const out = formatSesamJson(pipe, 2, { reorderKeys: true });
    const idIdx = out.indexOf('"_id"');
    const typeIdx = out.indexOf('"type"');
    const sourceIdx = out.indexOf('"source"');
    const pumpIdx = out.indexOf('"pump"');
    expect(idIdx).toBeLessThan(typeIdx);
    expect(typeIdx).toBeLessThan(sourceIdx);
    expect(sourceIdx).toBeLessThan(pumpIdx);
  });

  it("does NOT reorder keys when reorderKeys is false (default)", () => {
    const pipe = { pump: {}, source: {}, type: "pipe", _id: "my-pipe" };
    const out = formatSesamJson(pipe, 2);
    const pumpIdx = out.indexOf('"pump"');
    const idIdx = out.indexOf('"_id"');
    // pump was inserted first, so appears first without reorder
    expect(pumpIdx).toBeLessThan(idIdx);
  });

  it("reorders each element in an array of configs", () => {
    const configs = [
      { type: "pipe", _id: "p1", source: {} },
      { type: "system:rest", _id: "s1" },
    ];
    const out = formatSesamJson(configs, 2, { reorderKeys: true });
    const parsed = JSON.parse(out) as Array<Record<string, unknown>>;
    expect(Object.keys(parsed[0])[0]).toBe("_id");
    expect(Object.keys(parsed[0])[1]).toBe("type");
    expect(Object.keys(parsed[1])[0]).toBe("_id");
    expect(Object.keys(parsed[1])[1]).toBe("type");
  });

  it("preserves all keys after reordering (no data loss)", () => {
    const pipe = { zebra: true, pump: {}, source: {}, type: "pipe", _id: "x", alpha: 1 };
    const out = formatSesamJson(pipe, 2, { reorderKeys: true });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toContain("zebra");
    expect(Object.keys(parsed)).toContain("alpha");
    expect(Object.keys(parsed)).toContain("source");
    expect(Object.keys(parsed)).toContain("pump");
  });
});
