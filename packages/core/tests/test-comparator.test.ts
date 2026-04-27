import { describe, expect, it } from "vitest";

import { compareTestOutput } from "../src/test-comparator.js";

import type { Entity, TestSpec } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeSpec = (overrides: Partial<TestSpec> = {}): TestSpec => ({
  pipe: "my-pipe",
  file: "my-pipe.test.json",
  endpoint: "json",
  ignore: false,
  ignore_deletes: true,
  stage: null,
  blacklist: null,
  parameters: null,
  fields_to_sort_by: [],
  ...overrides,
});

// ---------------------------------------------------------------------------
// compareTestOutput
// ---------------------------------------------------------------------------

describe("compareTestOutput — passing cases", () => {
  it("passes when actual matches expected exactly", () => {
    const entities: Entity[] = [{ _id: "a", name: "Alice" }];
    const result = compareTestOutput(entities, entities, makeSpec());
    expect(result.passed).toBe(true);
    expect(result.diff).toBeUndefined();
  });

  it("passes when both arrays are empty", () => {
    const result = compareTestOutput([], [], makeSpec());
    expect(result.passed).toBe(true);
  });

  it("passes when underscore keys are stripped before comparison", () => {
    const actual: Entity[] = [{ _id: "a", _ts: "now", name: "Alice" }];
    const expected: Entity[] = [{ _id: "a", name: "Alice" }];
    const result = compareTestOutput(actual, expected, makeSpec());
    expect(result.passed).toBe(true);
  });

  it("passes when float whole-numbers are normalised to integers", () => {
    const actual: Entity[] = [{ _id: "a", count: 3.0 }];
    const expected: Entity[] = [{ _id: "a", count: 3 }];
    const result = compareTestOutput(actual, expected, makeSpec());
    expect(result.passed).toBe(true);
  });

  it("passes when order differs but sort field is specified", () => {
    const actual: Entity[] = [
      { _id: "2", name: "Bob" },
      { _id: "1", name: "Alice" },
    ];
    const expected: Entity[] = [
      { _id: "1", name: "Alice" },
      { _id: "2", name: "Bob" },
    ];
    const result = compareTestOutput(actual, expected, makeSpec({ fields_to_sort_by: ["name"] }));
    expect(result.passed).toBe(true);
  });

  it("strips blacklisted keys before comparing", () => {
    const actual: Entity[] = [{ _id: "a", secret: "abc", name: "Alice" }];
    const expected: Entity[] = [{ _id: "a", name: "Alice" }];
    const result = compareTestOutput(actual, expected, makeSpec({ blacklist: ["secret"] }));
    expect(result.passed).toBe(true);
  });

  it("drops unexpected deleted entities when ignore_deletes is true", () => {
    const actual: Entity[] = [
      { _id: "a", name: "Alice" },
      { _id: "b", _deleted: true },
    ];
    const expected: Entity[] = [{ _id: "a", name: "Alice" }];
    const result = compareTestOutput(actual, expected, makeSpec({ ignore_deletes: true }));
    expect(result.passed).toBe(true);
  });

  it("keeps unexpected deleted entities when ignore_deletes is false", () => {
    const actual: Entity[] = [
      { _id: "a", name: "Alice" },
      { _id: "b", _deleted: true },
    ];
    const expected: Entity[] = [{ _id: "a", name: "Alice" }];
    const result = compareTestOutput(actual, expected, makeSpec({ ignore_deletes: false }));
    expect(result.passed).toBe(false);
  });
});

describe("compareTestOutput — failing cases", () => {
  it("fails when a field value differs", () => {
    const actual: Entity[] = [{ _id: "a", name: "Bob" }];
    const expected: Entity[] = [{ _id: "a", name: "Alice" }];
    const result = compareTestOutput(actual, expected, makeSpec());
    expect(result.passed).toBe(false);
    expect(result.diff).toBeDefined();
  });

  it("returns a unified diff string on failure", () => {
    const actual: Entity[] = [{ _id: "a", x: 2 }];
    const expected: Entity[] = [{ _id: "a", x: 1 }];
    const result = compareTestOutput(actual, expected, makeSpec());
    expect(result.diff).toContain("---");
    expect(result.diff).toContain("+++");
  });

  it("reports length mismatch when counts differ", () => {
    const actual: Entity[] = [{ _id: "a" }, { _id: "b" }];
    const expected: Entity[] = [{ _id: "a" }];
    const result = compareTestOutput(actual, expected, makeSpec());
    expect(result.passed).toBe(false);
    expect(result.lengthMismatch).toEqual({ actual: 2, expected: 1 });
  });

  it("does not report lengthMismatch when counts are equal", () => {
    const actual: Entity[] = [{ _id: "a", x: 1 }];
    const expected: Entity[] = [{ _id: "a", x: 2 }];
    const result = compareTestOutput(actual, expected, makeSpec());
    expect(result.lengthMismatch).toBeUndefined();
  });

  it("includes actualSerialized in the result on failure", () => {
    const actual: Entity[] = [{ _id: "a", x: 1 }];
    const expected: Entity[] = [{ _id: "a", x: 2 }];
    const result = compareTestOutput(actual, expected, makeSpec());
    expect(result.actualSerialized).toBeDefined();
    expect(result.actualSerialized).toContain('"_id"');
  });
});
