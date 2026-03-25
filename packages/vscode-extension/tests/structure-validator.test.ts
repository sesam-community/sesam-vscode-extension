import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";

import { validateStructure } from "../server/src/dtl-structure-validator";

import type { DtlCall, StructuralError, DtlRange } from "../server/src/dtl-parser";
import type { ValidatorOptions } from "../types/dtl-validator.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const range: DtlRange = {
  start: { offset: 0, line: 0, character: 0 },
  end: { offset: 20, line: 0, character: 20 },
};

const defaultOptions: ValidatorOptions = {
  maxProblems: 100,
  validateUnknownFunctions: true,
  validateArgCount: true,
  validateJsonSyntax: true,
  validateDtlStructure: true,
  validateTransformInExpression: true,
  validatePathExpressions: false,
  ruleNames: new Set(["default", "order"]),
};

function makeCall(overrides: Partial<DtlCall>): DtlCall {
  return {
    functionName: "add",
    argCount: 2,
    isTopLevel: true,
    firstStringArg: null,
    stringArgs: [],
    range,
    nameRange: {
      start: { offset: 1, line: 0, character: 1 },
      end: { offset: 6, line: 0, character: 6 },
    },
    ...overrides,
  };
}

function makeStructuralError(kind: StructuralError["kind"]): StructuralError {
  return { kind, range };
}

// ---------------------------------------------------------------------------
// rule-not-array
// ---------------------------------------------------------------------------

describe("rule-not-array structural errors", () => {
  it("emits an Error diagnostic for each rule-not-array entry", () => {
    const diags = validateStructure([], [makeStructuralError("rule-not-array")], defaultOptions);
    expect(diags).toHaveLength(1);
    expect(diags[0].code).toBe("rule-not-array");
    expect(diags[0].severity).toBe(DiagnosticSeverity.Error);
    expect(diags[0].source).toBe("dtl");
  });

  it("emits no diagnostic when there are no structural errors", () => {
    const diags = validateStructure([], [], defaultOptions);
    expect(diags).toHaveLength(0);
  });

  it("emits multiple diagnostics for multiple structural errors", () => {
    const diags = validateStructure(
      [],
      [makeStructuralError("rule-not-array"), makeStructuralError("rule-not-array")],
      defaultOptions,
    );
    expect(diags).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// missing-function-name
// ---------------------------------------------------------------------------

describe("missing-function-name diagnostics", () => {
  it("emits an Error when a DtlCall has functionName === null", () => {
    const diags = validateStructure([makeCall({ functionName: null })], [], defaultOptions);
    expect(diags.find((d) => d.code === "missing-function-name")).toBeDefined();
    expect(diags.find((d) => d.code === "missing-function-name")!.severity).toBe(
      DiagnosticSeverity.Error,
    );
  });

  it("emits no missing-function-name diagnostic for calls with a valid function name", () => {
    const diags = validateStructure([makeCall({ functionName: "add" })], [], defaultOptions);
    expect(diags.find((d) => d.code === "missing-function-name")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// undefined-rule
// ---------------------------------------------------------------------------

describe("undefined-rule diagnostics", () => {
  it("emits a Warning when apply references a rule not in ruleNames", () => {
    const diags = validateStructure(
      [makeCall({ functionName: "apply", firstStringArg: "nonexistent", isTopLevel: true })],
      [],
      defaultOptions,
    );
    const diag = diags.find((d) => d.code === "undefined-rule");
    expect(diag).toBeDefined();
    expect(diag!.severity).toBe(DiagnosticSeverity.Warning);
    expect(diag!.message).toContain("nonexistent");
  });

  it("emits no diagnostic when apply references a known rule", () => {
    const diags = validateStructure(
      [makeCall({ functionName: "apply", firstStringArg: "order", isTopLevel: true })],
      [],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "undefined-rule")).toBeUndefined();
  });

  it("emits a Warning when apply-hops references an unknown rule", () => {
    const diags = validateStructure(
      [makeCall({ functionName: "apply-hops", firstStringArg: "typo-rule", isTopLevel: true })],
      [],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "undefined-rule")).toBeDefined();
  });

  it("emits no diagnostic when firstStringArg is null", () => {
    const diags = validateStructure(
      [makeCall({ functionName: "apply", firstStringArg: null, isTopLevel: true })],
      [],
      defaultOptions,
    );
    expect(diags.find((d) => d.code === "undefined-rule")).toBeUndefined();
  });

  it("skips all structural checks when validateDtlStructure is false", () => {
    const diags = validateStructure(
      [makeCall({ functionName: null })],
      [makeStructuralError("rule-not-array")],
      { ...defaultOptions, validateDtlStructure: false },
    );
    expect(diags).toHaveLength(0);
  });
});
