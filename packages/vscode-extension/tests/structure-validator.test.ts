import { describe, it, expect } from "vitest";
import { DiagnosticSeverity } from "vscode-languageserver/node";

import { validateStructure } from "../server/src/dtl-structure-validator";
import { validateConfigStructure } from "../server/src/config-structure-validator";

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
  validateConfigStructure: false,
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

// ---------------------------------------------------------------------------
// Phase E — config structure validation (pipe / system required fields)
// ---------------------------------------------------------------------------

const configOptions = { ...defaultOptions, validateConfigStructure: true };

const pipeJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ _id: "my-pipe", type: "pipe", source: { type: "dataset" }, ...overrides });

const systemJson = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({ _id: "my-system", type: "system:rest", ...overrides });

describe("validateConfigStructure — pipe", () => {
  it("emits no diagnostics for a valid minimal pipe config", () => {
    const diags = validateConfigStructure(pipeJson(), configOptions);
    expect(diags).toHaveLength(0);
  });

  it("emits missing-id when _id is absent", () => {
    const text = JSON.stringify({ type: "pipe", source: { type: "dataset" } });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "missing-id")).toBeDefined();
    expect(diags.find((d) => d.code === "missing-id")!.severity).toBe(DiagnosticSeverity.Error);
  });

  it("emits missing-id when _id is an empty string", () => {
    const text = pipeJson({ _id: "" });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "missing-id")).toBeDefined();
  });

  it("emits missing-type when type is absent", () => {
    const text = JSON.stringify({ _id: "x", source: { type: "dataset" } });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "missing-type")).toBeDefined();
    expect(diags.find((d) => d.code === "missing-type")!.severity).toBe(DiagnosticSeverity.Error);
  });

  it("emits missing-source when source is absent from a pipe", () => {
    const text = JSON.stringify({ _id: "my-pipe", type: "pipe" });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "missing-source")).toBeDefined();
    expect(diags.find((d) => d.code === "missing-source")!.severity).toBe(DiagnosticSeverity.Error);
  });

  it("emits invalid-type for an unrecognised type value", () => {
    const text = JSON.stringify({ _id: "x", type: "unknown-thing" });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "invalid-type")).toBeDefined();
    expect(diags.find((d) => d.code === "invalid-type")!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("emits no diagnostics for a metadata config (node-metadata.conf.json)", () => {
    const text = JSON.stringify({
      _id: "node",
      type: "metadata",
      namespaced_identifiers: true,
      global_defaults: { use_signalling_internally: true },
    });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags).toHaveLength(0);
  });

  it("emits no diagnostics for a metadata config missing source (not a pipe)", () => {
    const text = JSON.stringify({ _id: "node", type: "metadata" });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags).toHaveLength(0);
  });
});

describe("validateConfigStructure — system", () => {
  it("emits no diagnostics for a valid minimal system config", () => {
    const diags = validateConfigStructure(systemJson(), configOptions);
    expect(diags).toHaveLength(0);
  });

  it("emits missing-id when _id is absent from a system config", () => {
    const text = JSON.stringify({ type: "system:rest" });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "missing-id")).toBeDefined();
  });

  it("does not emit missing-source for a valid system config", () => {
    const diags = validateConfigStructure(systemJson(), configOptions);
    expect(diags.find((d) => d.code === "missing-source")).toBeUndefined();
  });

  it("emits unknown-type warning for an unknown system subtype", () => {
    const text = JSON.stringify({ _id: "sys", type: "system:does-not-exist" });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "unknown-type")).toBeDefined();
    expect(diags.find((d) => d.code === "unknown-type")!.severity).toBe(DiagnosticSeverity.Warning);
  });

  it("emits no unknown-type for a known system type", () => {
    const diags = validateConfigStructure(
      JSON.stringify({ _id: "sys", type: "system:postgresql" }),
      configOptions,
    );
    expect(diags.find((d) => d.code === "unknown-type")).toBeUndefined();
  });
});

describe("validateConfigStructure — source type", () => {
  it("emits no unknown-type for a known source type", () => {
    const diags = validateConfigStructure(pipeJson({ source: { type: "rest" } }), configOptions);
    expect(diags.find((d) => d.code === "unknown-type")).toBeUndefined();
  });

  it("emits unknown-type warning for an unknown source type", () => {
    const text = JSON.stringify({ _id: "p", type: "pipe", source: { type: "imaginary" } });
    const diags = validateConfigStructure(text, configOptions);
    const d = diags.find((d) => d.code === "unknown-type");
    expect(d).toBeDefined();
    expect(d!.severity).toBe(DiagnosticSeverity.Warning);
    expect(d!.message).toContain("source");
  });

  it("emits no diagnostic when source.type is absent (other validators cover that)", () => {
    const text = JSON.stringify({ _id: "p", type: "pipe", source: {} });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "unknown-type")).toBeUndefined();
  });
});

describe("validateConfigStructure — transform type", () => {
  it("emits no unknown-type for a known transform type", () => {
    const text = JSON.stringify({
      _id: "p",
      type: "pipe",
      source: { type: "dataset" },
      transform: { type: "dtl", rules: { default: [] } },
    });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "unknown-type")).toBeUndefined();
  });

  it("emits unknown-type warning for an unknown transform type", () => {
    const text = JSON.stringify({
      _id: "p",
      type: "pipe",
      source: { type: "dataset" },
      transform: { type: "magic" },
    });
    const diags = validateConfigStructure(text, configOptions);
    const d = diags.find((d) => d.code === "unknown-type");
    expect(d).toBeDefined();
    expect(d!.message).toContain("transform");
  });

  it("validates each step in a transform array", () => {
    const text = JSON.stringify({
      _id: "p",
      type: "pipe",
      source: { type: "dataset" },
      transform: [{ type: "dtl" }, { type: "bogus" }],
    });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.filter((d) => d.code === "unknown-type")).toHaveLength(1);
  });
});

describe("validateConfigStructure — sink type", () => {
  it("emits no unknown-type for a known sink type", () => {
    const text = JSON.stringify({
      _id: "p",
      type: "pipe",
      source: { type: "dataset" },
      sink: { type: "dataset" },
    });
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.find((d) => d.code === "unknown-type")).toBeUndefined();
  });

  it("emits unknown-type warning for an unknown sink type", () => {
    const text = JSON.stringify({
      _id: "p",
      type: "pipe",
      source: { type: "dataset" },
      sink: { type: "void" },
    });
    const diags = validateConfigStructure(text, configOptions);
    const d = diags.find((d) => d.code === "unknown-type");
    expect(d).toBeDefined();
    expect(d!.message).toContain("sink");
  });
});

describe("validateConfigStructure — array of configs", () => {
  it("validates each config in an array independently", () => {
    const text = JSON.stringify([
      { _id: "pipe-a", type: "pipe", source: { type: "dataset" } },
      { type: "pipe", source: { type: "dataset" } }, // missing _id
      { _id: "sys-a", type: "system:rest" },
    ]);
    const diags = validateConfigStructure(text, configOptions);
    expect(diags.filter((d) => d.code === "missing-id")).toHaveLength(1);
  });

  it("emits no diagnostics for an array of valid configs", () => {
    const text = JSON.stringify([
      { _id: "pipe-a", type: "pipe", source: { type: "dataset" } },
      { _id: "sys-a", type: "system:rest" },
    ]);
    const diags = validateConfigStructure(text, configOptions);
    expect(diags).toHaveLength(0);
  });
});

describe("validateConfigStructure — disabled", () => {
  it("emits no diagnostics when validateConfigStructure is false", () => {
    const text = JSON.stringify({ type: "pipe" }); // missing _id and source
    const diags = validateConfigStructure(text, {
      ...configOptions,
      validateConfigStructure: false,
    });
    expect(diags).toHaveLength(0);
  });
});
