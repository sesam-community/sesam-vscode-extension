import { describe, expect, it } from "vitest";

import {
  applyIgnoreDeletes,
  filterEntity,
  normalizeDecimal,
  normalizeEntity,
  sortEntities,
} from "../src/test-entity-filter.js";

import type { Entity } from "../src/types.js";

// ---------------------------------------------------------------------------
// filterEntity
// ---------------------------------------------------------------------------

describe("filterEntity", () => {
  it("keeps regular keys", () => {
    const entity: Entity = { _id: "e1", name: "Alice", age: 30 };
    expect(filterEntity(entity)).toEqual({ _id: "e1", name: "Alice", age: 30 });
  });

  it("keeps _id", () => {
    const entity: Entity = { _id: "e1" };
    expect(filterEntity(entity)).toEqual({ _id: "e1" });
  });

  it("drops underscore-prefixed keys other than _id and _deleted:true", () => {
    const entity: Entity = { _id: "e1", _ts: "2024-01-01", _updated: 42 };
    expect(filterEntity(entity)).toEqual({ _id: "e1" });
  });

  it("keeps _deleted when it is true", () => {
    const entity: Entity = { _id: "e1", _deleted: true };
    expect(filterEntity(entity)).toEqual({ _id: "e1", _deleted: true });
  });

  it("drops _deleted when it is false", () => {
    const entity: Entity = { _id: "e1", _deleted: false };
    expect(filterEntity(entity)).toEqual({ _id: "e1" });
  });

  it("drops keys matched by a simple blacklist pattern", () => {
    const entity: Entity = { _id: "e1", secret: "password", name: "Bob" };
    expect(filterEntity(entity, ["secret"])).toEqual({ _id: "e1", name: "Bob" });
  });

  it("drops a top-level key when any sub-path matches the blacklist pattern", () => {
    // The blacklist matches the path "meta.ts" inside the meta object, which
    // causes the entire top-level "meta" key to be dropped.
    const entity: Entity = { _id: "e1", meta: { ts: "2024-01-01", label: "x" } };
    expect(filterEntity(entity, ["meta.ts"])).toEqual({ _id: "e1" });
  });

  it("supports wildcard * in blacklist patterns", () => {
    const entity: Entity = { _id: "e1", ts_created: "a", ts_modified: "b", name: "c" };
    expect(filterEntity(entity, ["ts_*"])).toEqual({ _id: "e1", name: "c" });
  });

  it("supports [] array-traversal notation via *. substitution in blacklist", () => {
    // "items.[].ts" normalises to "items.*.ts" (regex ^items\..*\.ts$).
    // collectPaths flattens arrays without indices, so the paths are
    // ["items", "items.ts", "items.label"].  The regex requires at least one
    // char between the two dots, so "items.ts" does NOT match and the key is
    // kept. Verify that no unintended filtering occurs.
    const entity: Entity = { _id: "e1", items: [{ ts: "now", label: "x" }], name: "y" };
    expect(filterEntity(entity, ["items.[].ts"])).toEqual({
      _id: "e1",
      items: [{ ts: "now", label: "x" }],
      name: "y",
    });
  });

  it("returns empty object when entity has no non-internal keys and no _id", () => {
    const entity: Entity = { _ts: "now", _updated: 1 };
    expect(filterEntity(entity)).toEqual({});
  });

  it("accepts null blacklist without error", () => {
    const entity: Entity = { _id: "e1", x: 1 };
    expect(filterEntity(entity, null)).toEqual({ _id: "e1", x: 1 });
  });
});

// ---------------------------------------------------------------------------
// applyIgnoreDeletes
// ---------------------------------------------------------------------------

describe("applyIgnoreDeletes", () => {
  it("keeps non-deleted entities regardless", () => {
    const current: Entity[] = [{ _id: "a", name: "Alice" }];
    const expected: Entity[] = [];
    expect(applyIgnoreDeletes(current, expected)).toEqual(current);
  });

  it("keeps deleted entities that appear in expected", () => {
    const current: Entity[] = [{ _id: "a", _deleted: true }];
    const expected: Entity[] = [{ _id: "a" }];
    expect(applyIgnoreDeletes(current, expected)).toEqual(current);
  });

  it("removes deleted entities that do not appear in expected", () => {
    const current: Entity[] = [
      { _id: "a", _deleted: true },
      { _id: "b", name: "Bob" },
    ];
    const expected: Entity[] = [{ _id: "b" }];

    expect(applyIgnoreDeletes(current, expected)).toEqual([{ _id: "b", name: "Bob" }]);
  });

  it("returns empty array when all entities are unexpected deletes", () => {
    const current: Entity[] = [{ _id: "x", _deleted: true }];
    expect(applyIgnoreDeletes(current, [])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// normalizeDecimal
// ---------------------------------------------------------------------------

describe("normalizeDecimal", () => {
  it("truncates float whole-numbers to integers", () => {
    expect(normalizeDecimal(1.0)).toBe(1);
    expect(normalizeDecimal(42.0)).toBe(42);
  });

  it("rounds non-whole floats (non-safe-integer path)", () => {
    // Number.isSafeInteger(1.5) is false, so the large-integer branch triggers Math.round
    expect(normalizeDecimal(1.5)).toBe(2);
    expect(normalizeDecimal(3.14)).toBe(3);
  });

  it("leaves safe integers untouched", () => {
    expect(normalizeDecimal(7)).toBe(7);
    expect(normalizeDecimal(0)).toBe(0);
  });

  it("leaves strings untouched", () => {
    expect(normalizeDecimal("hello")).toBe("hello");
  });

  it("leaves null untouched", () => {
    expect(normalizeDecimal(null)).toBeNull();
  });

  it("leaves booleans untouched", () => {
    expect(normalizeDecimal(true)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// normalizeEntity
// ---------------------------------------------------------------------------

describe("normalizeEntity", () => {
  it("normalizes numeric values inside an object", () => {
    // 1.0 is a whole number → truncated; 2.5 is a non-safe-integer float → rounded
    expect(normalizeEntity({ a: 1.0, b: 2.5 })).toEqual({ a: 1, b: 3 });
  });

  it("normalizes numeric values inside nested objects", () => {
    expect(normalizeEntity({ outer: { inner: 3.0 } })).toEqual({ outer: { inner: 3 } });
  });

  it("normalizes numeric values inside arrays", () => {
    // 1.0 and 3.0 → whole numbers truncated; 2.5 → rounded
    expect(normalizeEntity([1.0, 2.5, 3.0])).toEqual([1, 3, 3]);
  });

  it("normalizes mixed nested structure", () => {
    // 2.0 is whole → 2; 0.5 is non-safe-integer float → Math.round(0.5) = 1; 4.0 is whole → 4
    const input = { items: [{ count: 2.0 }, { count: 0.5 }], total: 4.0 };
    expect(normalizeEntity(input)).toEqual({ items: [{ count: 2 }, { count: 1 }], total: 4 });
  });

  it("passes through strings and booleans unchanged", () => {
    expect(normalizeEntity({ name: "Alice", active: true })).toEqual({
      name: "Alice",
      active: true,
    });
  });
});

// ---------------------------------------------------------------------------
// sortEntities
// ---------------------------------------------------------------------------

describe("sortEntities", () => {
  it("sorts by _id when fields_to_sort_by is empty", () => {
    const entities: Entity[] = [{ _id: "b" }, { _id: "a" }, { _id: "c" }];
    expect(sortEntities(entities, []).map((e) => e["_id"])).toEqual(["a", "b", "c"]);
  });

  it("sorts by the specified field", () => {
    const entities: Entity[] = [
      { _id: "1", name: "Charlie" },
      { _id: "2", name: "Alice" },
      { _id: "3", name: "Bob" },
    ];
    expect(sortEntities(entities, ["name"]).map((e) => e["name"])).toEqual([
      "Alice",
      "Bob",
      "Charlie",
    ]);
  });

  it("uses full JSON dump as tiebreaker when sort fields are equal", () => {
    const entities: Entity[] = [
      { _id: "2", name: "Alice", x: 2 },
      { _id: "1", name: "Alice", x: 1 },
    ];
    // Stable sort: after tiebreaker (full JSON), _id:"1" comes before _id:"2"
    const sorted = sortEntities(entities, ["name"]);
    expect(sorted[0]["_id"]).toBe("1");
    expect(sorted[1]["_id"]).toBe("2");
  });

  it("does not mutate the original array", () => {
    const entities: Entity[] = [{ _id: "b" }, { _id: "a" }];
    const copy = [...entities];
    sortEntities(entities, []);
    expect(entities).toEqual(copy);
  });
});
