import { describe, it, expect } from "vitest";

import {
  getDtlFunction,
  getAllFunctions,
  getAllFunctionNames,
  getTransformFunctions,
  getExpressionFunctions,
  getFunctionsByCategory,
  isKnownFunction,
  DTL_VARIABLES,
  ENTITY_RESERVED_FIELDS,
} from "../src/shared/dtl-registry";

// ---------------------------------------------------------------------------
// getDtlFunction
// ---------------------------------------------------------------------------

describe("getDtlFunction", () => {
  it("returns the definition for a known function", () => {
    const fn = getDtlFunction("add");
    expect(fn).toBeDefined();
    expect(fn!.name).toBe("add");
    expect(fn!.kind).toBe("transform");
    expect(fn!.category).toBe("Transforms");
  });

  it("returns undefined for an unknown function", () => {
    expect(getDtlFunction("not-a-real-function")).toBeUndefined();
  });

  it("returns the correct signature", () => {
    const fn = getDtlFunction("concat");
    expect(fn!.signature).toBe("concat(value, ...)");
  });

  it("returns minArgs and maxArgs correctly for fixed-arg functions", () => {
    const fn = getDtlFunction("eq");
    expect(fn!.minArgs).toBe(2);
    expect(fn!.maxArgs).toBe(2);
  });

  it("returns maxArgs null for variadic functions", () => {
    const fn = getDtlFunction("and");
    expect(fn!.maxArgs).toBeNull();
  });

  it("returns params array", () => {
    const fn = getDtlFunction("add");
    expect(fn!.params).toHaveLength(2);
    expect(fn!.params[0].name).toBe("property");
    expect(fn!.params[1].name).toBe("value");
  });

  it("marks optional params correctly", () => {
    const fn = getDtlFunction("if");
    const elseParam = fn!.params.find((p) => p.name === "else");
    expect(elseParam?.optional).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isKnownFunction
// ---------------------------------------------------------------------------

describe("isKnownFunction", () => {
  it("returns true for known functions", () => {
    expect(isKnownFunction("add")).toBe(true);
    expect(isKnownFunction("hops")).toBe(true);
    expect(isKnownFunction("concat")).toBe(true);
  });

  it("returns false for unknown functions", () => {
    expect(isKnownFunction("fake-function")).toBe(false);
    expect(isKnownFunction("")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getAllFunctions
// ---------------------------------------------------------------------------

describe("getAllFunctions", () => {
  it("returns a non-empty array", () => {
    expect(getAllFunctions().length).toBeGreaterThan(0);
  });

  it("every entry has required fields", () => {
    for (const fn of getAllFunctions()) {
      expect(typeof fn.name).toBe("string");
      expect(typeof fn.signature).toBe("string");
      expect(typeof fn.description).toBe("string");
      expect(typeof fn.minArgs).toBe("number");
      expect(fn.maxArgs === null || typeof fn.maxArgs === "number").toBe(true);
      expect(Array.isArray(fn.params)).toBe(true);
      expect(typeof fn.docUrl).toBe("string");
    }
  });

  it("every entry has a valid kind", () => {
    for (const fn of getAllFunctions()) {
      expect(["transform", "expression"]).toContain(fn.kind);
    }
  });

  it("maxArgs is always >= minArgs when not null", () => {
    for (const fn of getAllFunctions()) {
      if (fn.maxArgs !== null) {
        expect(fn.maxArgs).toBeGreaterThanOrEqual(fn.minArgs);
      }
    }
  });

  it("names are unique", () => {
    const names = getAllFunctions().map((f) => f.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// getAllFunctionNames
// ---------------------------------------------------------------------------

describe("getAllFunctionNames", () => {
  it("returns all function names as strings", () => {
    const names = getAllFunctionNames();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((n) => typeof n === "string")).toBe(true);
  });

  it("includes well-known functions", () => {
    const names = getAllFunctionNames();
    expect(names).toContain("add");
    expect(names).toContain("copy");
    expect(names).toContain("hops");
    expect(names).toContain("concat");
    expect(names).toContain("eq");
  });
});

// ---------------------------------------------------------------------------
// getTransformFunctions / getExpressionFunctions
// ---------------------------------------------------------------------------

describe("getTransformFunctions", () => {
  it("returns only transform-kind functions", () => {
    const fns = getTransformFunctions();
    expect(fns.length).toBeGreaterThan(0);
    expect(fns.every((f) => f.kind === "transform")).toBe(true);
  });

  it("includes add, copy, remove, discard", () => {
    const names = getTransformFunctions().map((f) => f.name);
    expect(names).toContain("add");
    expect(names).toContain("copy");
    expect(names).toContain("remove");
    expect(names).toContain("discard");
  });

  it("filter is a known function (overloaded: transform + list expression)", () => {
    // filter is kind "expression" to avoid false positives when used nested as a list
    // expression; verify it is still registered and accessible
    const names = getExpressionFunctions().map((f) => f.name);
    expect(names).toContain("filter");
  });
});

describe("getExpressionFunctions", () => {
  it("returns only expression-kind functions", () => {
    const fns = getExpressionFunctions();
    expect(fns.length).toBeGreaterThan(0);
    expect(fns.every((f) => f.kind === "expression")).toBe(true);
  });

  it("includes concat, eq, hops, if-null", () => {
    const names = getExpressionFunctions().map((f) => f.name);
    expect(names).toContain("concat");
    expect(names).toContain("eq");
    expect(names).toContain("hops");
    expect(names).toContain("if-null");
  });

  it("transforms and expressions together equal all functions", () => {
    expect(getTransformFunctions().length + getExpressionFunctions().length).toBe(
      getAllFunctions().length,
    );
  });
});

// ---------------------------------------------------------------------------
// getFunctionsByCategory
// ---------------------------------------------------------------------------

describe("getFunctionsByCategory", () => {
  it("returns only functions in the given category", () => {
    const fns = getFunctionsByCategory("Strings");
    expect(fns.length).toBeGreaterThan(0);
    expect(fns.every((f) => f.category === "Strings")).toBe(true);
  });

  it("returns concat, join, split for Strings", () => {
    const names = getFunctionsByCategory("Strings").map((f) => f.name);
    expect(names).toContain("concat");
    expect(names).toContain("join");
    expect(names).toContain("split");
  });

  it("returns empty array for a category with no functions", () => {
    // Cast to bypass type check — simulates an unknown category at runtime
    expect(getFunctionsByCategory("NonExistent" as never)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// DTL_VARIABLES
// ---------------------------------------------------------------------------

describe("DTL_VARIABLES", () => {
  it("contains the standard pipeline variables", () => {
    expect(DTL_VARIABLES).toHaveProperty("_S");
    expect(DTL_VARIABLES).toHaveProperty("_T");
    expect(DTL_VARIABLES).toHaveProperty("_P");
    expect(DTL_VARIABLES).toHaveProperty("_R");
    expect(DTL_VARIABLES).toHaveProperty("_B");
    expect(DTL_VARIABLES).toHaveProperty("_");
  });

  it("all values are non-empty strings", () => {
    for (const [key, val] of Object.entries(DTL_VARIABLES)) {
      expect(typeof val).toBe("string");
      expect(val.length).toBeGreaterThan(0);
      expect(key.startsWith("_")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ENTITY_RESERVED_FIELDS
// ---------------------------------------------------------------------------

describe("ENTITY_RESERVED_FIELDS", () => {
  it("contains core reserved fields", () => {
    expect(ENTITY_RESERVED_FIELDS).toContain("_id");
    expect(ENTITY_RESERVED_FIELDS).toContain("_deleted");
    expect(ENTITY_RESERVED_FIELDS).toContain("$ids");
    expect(ENTITY_RESERVED_FIELDS).toContain("$children");
  });

  it("is a non-empty array of strings", () => {
    expect(ENTITY_RESERVED_FIELDS.length).toBeGreaterThan(0);
    expect(ENTITY_RESERVED_FIELDS.every((f) => typeof f === "string")).toBe(true);
  });
});
