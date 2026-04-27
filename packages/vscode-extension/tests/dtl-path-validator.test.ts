import { describe, expect, it } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";

import { validatePathStrings } from "../server/src/dtl-path-validator";

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
  validatePathExpressions: true,
  validateConfigStructure: false,
  ruleNames: new Set(),
};

const makeCall = (stringArgs: string[], overrides: Partial<DtlCall> = {}): DtlCall => ({
  functionName: "add",
  argCount: 2,
  isTopLevel: true,
  firstStringArg: stringArgs[0] ?? null,
  stringArgs,
  range: {
    start: { offset: 0, line: 0, character: 0 },
    end: { offset: 30, line: 0, character: 30 },
  },
  nameRange: {
    start: { offset: 1, line: 0, character: 1 },
    end: { offset: 4, line: 0, character: 4 },
  },
  ...overrides,
});

// ---------------------------------------------------------------------------
// validatePathStrings
// ---------------------------------------------------------------------------

describe("validatePathStrings — guard", () => {
  it("returns empty array when validatePathExpressions is false", () => {
    const call = makeCall(["_S..foo"]);
    const result = validatePathStrings([call], {
      ...defaultOptions,
      validatePathExpressions: false,
    });
    expect(result).toHaveLength(0);
  });

  it("returns empty array for empty call list", () => {
    expect(validatePathStrings([], defaultOptions)).toHaveLength(0);
  });
});

describe("validatePathStrings — valid paths", () => {
  it("does not flag a well-formed _S path", () => {
    const result = validatePathStrings([makeCall(["_S.name"])], defaultOptions);
    expect(result).toHaveLength(0);
  });

  it("does not flag a well-formed _T path", () => {
    expect(validatePathStrings([makeCall(["_T.value"])], defaultOptions)).toHaveLength(0);
  });

  it("does not flag a well-formed _ path", () => {
    expect(validatePathStrings([makeCall(["_.name"])], defaultOptions)).toHaveLength(0);
  });

  it("does not flag a plain string without dots", () => {
    expect(validatePathStrings([makeCall(["nodot"])], defaultOptions)).toHaveLength(0);
  });

  it("does not flag an NI literal starting with ~", () => {
    expect(validatePathStrings([makeCall(["~:ns:id.extra"])], defaultOptions)).toHaveLength(0);
  });

  it("does not flag a URL", () => {
    expect(
      validatePathStrings([makeCall(["https://example.com/path"])], defaultOptions),
    ).toHaveLength(0);
  });

  it("does not flag a datetime format token starting with %", () => {
    expect(validatePathStrings([makeCall(["%Y.%m.%d"])], defaultOptions)).toHaveLength(0);
  });

  it("does not flag a regular (non-underscore) property path", () => {
    expect(validatePathStrings([makeCall(["foo.bar"])], defaultOptions)).toHaveLength(0);
  });
});

describe("validatePathStrings — malformed paths", () => {
  it("flags consecutive dots (empty segment)", () => {
    const result = validatePathStrings([makeCall(["_S..foo"])], defaultOptions);
    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe(DiagnosticSeverity.Warning);
    expect(result[0].code).toBe("malformed-path");
    expect(result[0].message).toContain("empty path segment");
  });

  it("flags an unknown underscore variable prefix", () => {
    const result = validatePathStrings([makeCall(["_X.foo"])], defaultOptions);
    expect(result).toHaveLength(1);
    expect(result[0].code).toBe("malformed-path");
    expect(result[0].message).toContain("unknown variable prefix");
    expect(result[0].message).toContain('"_X"');
  });

  it("emits at most one diagnostic per call even with multiple bad args", () => {
    const result = validatePathStrings([makeCall(["_S..a", "_X.b"])], defaultOptions);
    expect(result).toHaveLength(1);
  });

  it("respects maxProblems limit", () => {
    const calls = [makeCall(["_S..a"]), makeCall(["_S..b"]), makeCall(["_S..c"])];
    const result = validatePathStrings(calls, { ...defaultOptions, maxProblems: 2 });
    expect(result).toHaveLength(2);
  });

  it("uses the call range for the diagnostic", () => {
    const call = makeCall(["_S..foo"], {
      range: {
        start: { offset: 10, line: 2, character: 4 },
        end: { offset: 30, line: 2, character: 24 },
      },
    });
    const result = validatePathStrings([call], defaultOptions);
    expect(result[0].range.start).toEqual({ line: 2, character: 4 });
    expect(result[0].range.end).toEqual({ line: 2, character: 24 });
  });

  it("sets source to 'dtl'", () => {
    const result = validatePathStrings([makeCall(["_Z.foo"])], defaultOptions);
    expect(result[0].source).toBe("dtl");
  });
});
