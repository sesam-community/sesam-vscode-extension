import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";

import { validateCalls } from "../server/src/dtl-validator";
import { DTL_VARIABLES } from "../src/shared/dtl-registry";

import type { DtlCall } from "../server/src/dtl-parser";
import type { ValidatorOptions } from "../types/dtl-validator.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultOptions: ValidatorOptions = {
  maxProblems: 100,
  validateUnknownFunctions: true,
  validateArgCount: true,
  validateJsonSyntax: true,
  validateDtlStructure: true,
  validateTransformInExpression: true,
  validatePathExpressions: false,
  ruleNames: new Set(),
};

function makeCall(overrides: Partial<DtlCall>): DtlCall {
  return {
    functionName: "add",
    argCount: 2,
    isTopLevel: true,
    firstStringArg: null,
    stringArgs: [],
    range: {
      start: { offset: 0, line: 0, character: 0 },
      end: { offset: 20, line: 0, character: 20 },
    },
    nameRange: {
      start: { offset: 1, line: 0, character: 1 },
      end: { offset: 6, line: 0, character: 6 },
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unknown functions
// ---------------------------------------------------------------------------

describe("unknown function diagnostics", () => {
  it("emits an error for a completely unknown function", () => {
    const diags = validateCalls(
      [makeCall({ functionName: "not-a-real-function" })],
      defaultOptions,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].code).toBe("unknown-function");
    expect(diags[0].message).toContain("not-a-real-function");
  });

  it("emits no diagnostic for a known function with correct args", () => {
    // "add" requires 2 args
    const diags = validateCalls([makeCall({ functionName: "add", argCount: 2 })], defaultOptions);
    expect(diags).toHaveLength(0);
  });

  it("skips unknown-function check when validateUnknownFunctions is false", () => {
    const diags = validateCalls([makeCall({ functionName: "fantasy-function" })], {
      ...defaultOptions,
      validateUnknownFunctions: false,
    });
    expect(diags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Argument count
// ---------------------------------------------------------------------------

describe("argument count diagnostics", () => {
  it("emits a warning when too few arguments are provided", () => {
    // "add" minArgs = 2; provide 0
    const diags = validateCalls([makeCall({ functionName: "add", argCount: 0 })], defaultOptions);
    const warning = diags.find((d) => d.code === "too-few-args");
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("emits a warning when too many arguments are provided", () => {
    // "copy" maxArgs = 1; provide 5
    const diags = validateCalls([makeCall({ functionName: "copy", argCount: 5 })], defaultOptions);
    const warning = diags.find((d) => d.code === "too-many-args");
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("skips arg-count check when validateArgCount is false", () => {
    const diags = validateCalls([makeCall({ functionName: "add", argCount: 0 })], {
      ...defaultOptions,
      validateArgCount: false,
    });
    expect(diags.find((d) => d.code === "too-few-args")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unknown variable prefix
// ---------------------------------------------------------------------------

describe("unknown variable prefix diagnostics", () => {
  it("emits a warning for an unknown variable prefix", () => {
    const diags = validateCalls([makeCall({ functionName: "_X.field" })], defaultOptions);
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].code).toBe("unknown-variable");
    expect(diags[0].message).toContain("_X");
  });

  it("does not warn for known variable prefixes", () => {
    for (const prefix of Object.keys(DTL_VARIABLES)) {
      const diags = validateCalls([makeCall({ functionName: `${prefix}.field` })], defaultOptions);
      const varWarning = diags.find((d) => d.code === "unknown-variable");
      expect(varWarning, `Expected no unknown-variable warning for ${prefix}`).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// maxProblems cap
// ---------------------------------------------------------------------------

describe("maxProblems", () => {
  it("stops reporting after maxProblems is reached", () => {
    const calls = Array.from({ length: 20 }, () => makeCall({ functionName: "unknown-fn-xyz" }));
    const diags = validateCalls(calls, { ...defaultOptions, maxProblems: 5 });
    expect(diags.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Null function name
// ---------------------------------------------------------------------------

describe("null function name", () => {
  it("skips calls with a null function name", () => {
    const diags = validateCalls([makeCall({ functionName: null })], defaultOptions);
    expect(diags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Diagnostic source and structure
// ---------------------------------------------------------------------------

describe("diagnostic source field", () => {
  it("sets source to 'dtl' on unknown-function diagnostics", () => {
    const diags = validateCalls([makeCall({ functionName: "no-such-fn" })], defaultOptions);
    expect(diags[0].source).toBe("dtl");
  });

  it("sets source to 'dtl' on too-few-args diagnostics", () => {
    const diags = validateCalls([makeCall({ functionName: "add", argCount: 0 })], defaultOptions);
    const diag = diags.find((d) => d.code === "too-few-args");
    expect(diag!.source).toBe("dtl");
  });
});

// ---------------------------------------------------------------------------
// nameRange vs range fallback
// ---------------------------------------------------------------------------

describe("diagnostic range — nameRange fallback", () => {
  it("uses nameRange when available for unknown-function diagnostic", () => {
    const nameRange = {
      start: { offset: 5, line: 0, character: 5 },
      end: { offset: 20, line: 0, character: 20 },
    };
    const diags = validateCalls(
      [makeCall({ functionName: "no-such-fn", nameRange })],
      defaultOptions,
    );
    expect(diags[0].range.start.character).toBe(5);
    expect(diags[0].range.end.character).toBe(20);
  });

  it("falls back to full range when nameRange is null", () => {
    const range = {
      start: { offset: 0, line: 1, character: 2 },
      end: { offset: 30, line: 1, character: 32 },
    };
    const diags = validateCalls(
      [makeCall({ functionName: "no-such-fn", nameRange: null, range })],
      defaultOptions,
    );
    expect(diags[0].range.start.line).toBe(1);
    expect(diags[0].range.start.character).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Unlimited-args (maxArgs === null) expression functions
// ---------------------------------------------------------------------------

describe("unlimited-args expression functions", () => {
  it("does not emit too-many-args for 'and' with many arguments", () => {
    // "and" has maxArgs: null — any number of args is valid
    const diags = validateCalls(
      [makeCall({ functionName: "and", argCount: 100, isTopLevel: false })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "too-many-args")).toBeUndefined();
  });

  it("still emits too-few-args for 'and' with zero arguments", () => {
    // "and" has minArgs: 1
    const diags = validateCalls(
      [makeCall({ functionName: "and", argCount: 0, isTopLevel: false })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "too-few-args")).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple calls
// ---------------------------------------------------------------------------

describe("multiple calls", () => {
  it("returns a diagnostic for each invalid call", () => {
    const calls = [
      makeCall({ functionName: "no-such-fn-1" }),
      makeCall({ functionName: "no-such-fn-2" }),
      makeCall({ functionName: "no-such-fn-3" }),
    ];
    const diags = validateCalls(calls, defaultOptions);
    expect(diags).toHaveLength(3);
    expect(diags.map((d) => d.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("no-such-fn-1"),
        expect.stringContaining("no-such-fn-2"),
        expect.stringContaining("no-such-fn-3"),
      ]),
    );
  });

  it("mixes different diagnostic codes from different calls", () => {
    const calls = [
      makeCall({ functionName: "no-such-fn" }), // unknown-function
      makeCall({ functionName: "add", argCount: 0 }), // too-few-args
    ];
    const diags = validateCalls(calls, defaultOptions);
    expect(diags.map((d) => d.code)).toEqual(
      expect.arrayContaining(["unknown-function", "too-few-args"]),
    );
  });
});

// ---------------------------------------------------------------------------
// Phase C — transform-in-expression
// ---------------------------------------------------------------------------

describe("transform-in-expression diagnostics", () => {
  it("emits an error when a transform function appears as a nested argument", () => {
    // "add" is kind: "transform" and isTopLevel is false
    const diags = validateCalls(
      [makeCall({ functionName: "add", isTopLevel: false })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "transform-in-expression")).toBeDefined();
    expect(diags.find((d) => d.code === "transform-in-expression")!.severity).toBe(
      DiagnosticSeverity.Error,
    );
  });

  it("does not emit an error when a transform function is at top level", () => {
    const diags = validateCalls(
      [makeCall({ functionName: "add", isTopLevel: true })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "transform-in-expression")).toBeUndefined();
  });

  it("does not emit an error when an expression function appears nested", () => {
    // "upper" is kind: "expression" — nesting is fine
    const diags = validateCalls(
      [makeCall({ functionName: "upper", isTopLevel: false, argCount: 1 })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "transform-in-expression")).toBeUndefined();
  });

  it("skips transform-in-expression check when validateTransformInExpression is false", () => {
    const diags = validateCalls([makeCall({ functionName: "add", isTopLevel: false })], {
      ...defaultOptions,
      validateTransformInExpression: false,
    });
    expect(diags.find((d) => d.code === "transform-in-expression")).toBeUndefined();
  });

  it("does not emit an error for 'if' nested as an expression argument", () => {
    // ["merge", ["if", cond, dict1, dict2]] — "if" produces a value here
    const diags = validateCalls(
      [makeCall({ functionName: "if", isTopLevel: false, argCount: 3 })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "transform-in-expression")).toBeUndefined();
  });

  it("does not emit an error for 'case' nested as an expression argument", () => {
    const diags = validateCalls(
      [makeCall({ functionName: "case", isTopLevel: false, argCount: 2 })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "transform-in-expression")).toBeUndefined();
  });

  it("does not emit an error for 'case-eq' nested as an expression argument", () => {
    const diags = validateCalls(
      [makeCall({ functionName: "case-eq", isTopLevel: false, argCount: 3 })],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "transform-in-expression")).toBeUndefined();
  });
});
