import { describe, it, expect } from "vitest";
import { validateCalls, ValidatorOptions } from "../server/src/dtl-validator";
import type { DtlCall } from "../server/src/dtl-parser";
import { DiagnosticSeverity } from "vscode-languageserver/node";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultOptions: ValidatorOptions = {
  maxProblems: 100,
  validateUnknownFunctions: true,
  validateArgCount: true,
};

function makeCall(overrides: Partial<DtlCall>): DtlCall {
  return {
    functionName: "add",
    argCount: 2,
    isTopLevel: true,
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
    const diags = validateCalls(
      [makeCall({ functionName: "add", argCount: 2 })],
      defaultOptions,
    );
    expect(diags).toHaveLength(0);
  });

  it("skips unknown-function check when validateUnknownFunctions is false", () => {
    const diags = validateCalls(
      [makeCall({ functionName: "fantasy-function" })],
      { ...defaultOptions, validateUnknownFunctions: false },
    );
    expect(diags).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Argument count
// ---------------------------------------------------------------------------

describe("argument count diagnostics", () => {
  it("emits a warning when too few arguments are provided", () => {
    // "add" minArgs = 2; provide 0
    const diags = validateCalls(
      [makeCall({ functionName: "add", argCount: 0 })],
      defaultOptions,
    );
    const warning = diags.find((d) => d.code === "too-few-args");
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("emits a warning when too many arguments are provided", () => {
    // "copy" maxArgs = 1; provide 5
    const diags = validateCalls(
      [makeCall({ functionName: "copy", argCount: 5 })],
      defaultOptions,
    );
    const warning = diags.find((d) => d.code === "too-many-args");
    expect(warning).toBeDefined();
    expect(warning!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("skips arg-count check when validateArgCount is false", () => {
    const diags = validateCalls(
      [makeCall({ functionName: "add", argCount: 0 })],
      { ...defaultOptions, validateArgCount: false },
    );
    expect(diags.find((d) => d.code === "too-few-args")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Unknown variable prefix
// ---------------------------------------------------------------------------

describe("unknown variable prefix diagnostics", () => {
  it("emits a warning for an unknown variable prefix", () => {
    const diags = validateCalls(
      [makeCall({ functionName: "_X.field" })],
      defaultOptions,
    );
    expect(diags).toHaveLength(1);
    expect(diags[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(diags[0].code).toBe("unknown-variable");
    expect(diags[0].message).toContain("_X");
  });

  it("does not warn for known variable prefixes", () => {
    for (const prefix of ["_S", "_T", "_P", "_R", "_B", "_"]) {
      const diags = validateCalls(
        [makeCall({ functionName: `${prefix}.field` })],
        defaultOptions,
      );
      const varWarning = diags.find((d) => d.code === "unknown-variable");
      expect(
        varWarning,
        `Expected no unknown-variable warning for ${prefix}`,
      ).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// maxProblems cap
// ---------------------------------------------------------------------------

describe("maxProblems", () => {
  it("stops reporting after maxProblems is reached", () => {
    const calls = Array.from({ length: 20 }, () =>
      makeCall({ functionName: "unknown-fn-xyz" }),
    );
    const diags = validateCalls(calls, { ...defaultOptions, maxProblems: 5 });
    expect(diags.length).toBeLessThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Null function name
// ---------------------------------------------------------------------------

describe("null function name", () => {
  it("skips calls with a null function name", () => {
    const diags = validateCalls(
      [makeCall({ functionName: null })],
      defaultOptions,
    );
    expect(diags).toHaveLength(0);
  });
});
