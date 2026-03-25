import { describe, it, expect } from "vitest";
import { parseDtlText } from "../server/src/dtl-parser";

// ---------------------------------------------------------------------------
// .dtl files (bare array of rules)
// ---------------------------------------------------------------------------

describe("parseDtlText — dtl extension", () => {
  it("returns empty calls for empty array", () => {
    const { calls, errors } = parseDtlText("[]", "dtl");
    expect(calls).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("returns empty calls for invalid JSON", () => {
    const { calls, errors } = parseDtlText("not json", "dtl");
    expect(calls).toHaveLength(0);
    expect(errors).toHaveLength(0);
  });

  it("parses a single top-level rule", () => {
    const text = `[["add", "_T.name", "Alice"]]`;
    const { calls } = parseDtlText(text, "dtl");
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const topLevel = calls.find((c) => c.isTopLevel);
    expect(topLevel).toBeDefined();
    expect(topLevel!.functionName).toBe("add");
    expect(topLevel!.argCount).toBe(2);
  });

  it("parses multiple top-level rules", () => {
    const text = `[
      ["add", "_T.a", 1],
      ["copy", "*"],
      ["remove", "_T.b"]
    ]`;
    const { calls } = parseDtlText(text, "dtl");
    const topLevel = calls.filter((c) => c.isTopLevel);
    expect(topLevel).toHaveLength(3);
    expect(topLevel[0].functionName).toBe("add");
    expect(topLevel[1].functionName).toBe("copy");
    expect(topLevel[2].functionName).toBe("remove");
  });

  it("records arg count correctly", () => {
    const text = `[["add", "_T.x", 1, 2, 3]]`;
    const { calls } = parseDtlText(text, "dtl");
    const call = calls.find((c) => c.functionName === "add");
    expect(call?.argCount).toBe(4); // _T.x, 1, 2, 3
  });

  it("records position info — call range starts before function name", () => {
    const text = `[["add", "_T.x", 1]]`;
    const { calls } = parseDtlText(text, "dtl");
    const call = calls.find((c) => c.functionName === "add");
    expect(call?.range.start.offset).toBeLessThan(call!.nameRange!.start.offset);
  });

  it("marks top-level calls as isTopLevel = true", () => {
    const text = `[["add", "_T.x", ["concat", "a", "b"]]]`;
    const { calls } = parseDtlText(text, "dtl");
    const addCall = calls.find((c) => c.functionName === "add");
    const concatCall = calls.find((c) => c.functionName === "concat");
    expect(addCall?.isTopLevel).toBe(true);
    expect(concatCall?.isTopLevel).toBe(false);
  });

  it("handles a function name that is not a string", () => {
    const text = `[[1, "_T.x", 2]]`;
    const { calls } = parseDtlText(text, "dtl");
    const call = calls.find((c) => c.functionName === null);
    expect(call).toBeDefined();
    expect(call!.functionName).toBeNull();
  });

  it("provides nameRange for known function", () => {
    const text = `[["copy", "*"]]`;
    const { calls } = parseDtlText(text, "dtl");
    const call = calls.find((c) => c.functionName === "copy");
    expect(call?.nameRange).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// .json files (pipe configs)
// ---------------------------------------------------------------------------

describe("parseDtlText — json extension", () => {
  it("returns empty for JSON with no transform", () => {
    const text = JSON.stringify({ _id: "my-pipe", type: "pipe" });
    const { calls } = parseDtlText(text, "json");
    expect(calls).toHaveLength(0);
  });

  it("parses all rules from a standard pipe config", () => {
    const text = JSON.stringify({
      _id: "my-pipe",
      transform: {
        type: "dtl",
        rules: {
          default: [
            ["add", "_T.name", "_S.name"],
            ["copy", "*"],
          ],
        },
      },
    });
    const { calls } = parseDtlText(text, "json");
    const topLevel = calls.filter((c) => c.isTopLevel);
    expect(topLevel).toHaveLength(2);
    expect(topLevel[0].functionName).toBe("add");
    expect(topLevel[1].functionName).toBe("copy");
  });

  it("parses rules from multiple named rules blocks", () => {
    const text = JSON.stringify({
      _id: "my-pipe",
      transform: {
        type: "dtl",
        rules: {
          default: [["copy", "*"]],
          enrich: [["add", "_T.x", 1]],
        },
      },
    });
    const { calls } = parseDtlText(text, "json");
    const names = calls.filter((c) => c.isTopLevel).map((c) => c.functionName);
    expect(names).toContain("copy");
    expect(names).toContain("add");
  });

  it("parses rules when transform is an array of steps", () => {
    // Bug: transform:[{type:"dtl",rules:{...}}] (array) returned no calls
    const text = JSON.stringify({
      _id: "my-pipe",
      transform: [
        {
          type: "dtl",
          rules: {
            default: [
              ["add", "_deleted", false],
              ["copy", "*"],
            ],
          },
        },
      ],
    });
    const { calls } = parseDtlText(text, "json");
    const topLevel = calls.filter((c) => c.isTopLevel);
    expect(topLevel).toHaveLength(2);
    expect(topLevel[0].functionName).toBe("add");
    expect(topLevel[1].functionName).toBe("copy");
  });

  it("returns empty calls for invalid JSON", () => {
    const { calls } = parseDtlText("{bad json", "json");
    expect(calls).toHaveLength(0);
  });

  it("finds all top-level calls when source section contains arrays before transform", () => {
    // Bug: scanner starts at offset 0 and picks up '[' in source.datasets instead of
    // the transform rules list, causing all but the first rule to be misidentified.
    const text = JSON.stringify({
      _id: "my-pipe",
      source: {
        type: "merge",
        datasets: ["dataset-a da", "dataset-b db"],
        equality_sets: [["da.$ids", "db.$ids"]],
      },
      transform: {
        type: "dtl",
        rules: {
          default: [
            ["add", "_deleted", false],
            ["add", "_ids", ["hops", { datasets: ["lookup t"], where: [], return: "t._id" }]],
            ["add", "_url", ["concat", "http://", "_S._id"]],
            ["add", "::url", ["url-quote", "_T._url"]],
            ["add", "::operation", "sparql"],
          ],
        },
      },
    });
    const { calls } = parseDtlText(text, "json");
    const topLevel = calls.filter((c) => c.isTopLevel);
    expect(topLevel).toHaveLength(5);
    expect(topLevel.map((c) => c.functionName)).toEqual(["add", "add", "add", "add", "add"]);
  });
});

// ---------------------------------------------------------------------------
// Phase A — parseError
// ---------------------------------------------------------------------------

describe("parseDtlText — parseError (invalid JSON)", () => {
  it("returns parseError: null for valid JSON", () => {
    const { parseError } = parseDtlText('[["add", "foo", "bar"]]', "dtl");
    expect(parseError).toBeNull();
  });

  it("populates parseError for invalid JSON", () => {
    const { parseError, calls } = parseDtlText("not json", "json");
    expect(parseError).not.toBeNull();
    expect(parseError!.message).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("returns no calls when parseError is present", () => {
    const { calls, parseError } = parseDtlText('{"_id": "x" "type": "pipe"}', "json");
    expect(parseError).not.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("reports a numeric offset when JSON error position is available", () => {
    // Most Node versions can report a position; we just check it's a number >= 0 or -1
    const { parseError } = parseDtlText('{"a": 1 "b": 2}', "json");
    expect(parseError).not.toBeNull();
    expect(typeof parseError!.offset).toBe("number");
  });

  it("populates ruleNames and structuralErrors as empty on parse error", () => {
    const { ruleNames, structuralErrors } = parseDtlText("{bad}", "json");
    expect(ruleNames.size).toBe(0);
    expect(structuralErrors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Phase A/B — ParseResult new fields on valid JSON
// ---------------------------------------------------------------------------

describe("parseDtlText — ruleNames", () => {
  it("collects rule names from a standard transforms block", () => {
    const text = JSON.stringify({
      transform: {
        type: "dtl",
        rules: {
          default: [["copy", "_id"]],
          enrich: [["add", "x", 1]],
        },
      },
    });
    const { ruleNames } = parseDtlText(text, "json");
    expect(ruleNames.has("default")).toBe(true);
    expect(ruleNames.has("enrich")).toBe(true);
  });

  it("returns empty ruleNames when there is no transform", () => {
    const text = JSON.stringify({ _id: "no-transform" });
    const { ruleNames } = parseDtlText(text, "json");
    expect(ruleNames.size).toBe(0);
  });
});

describe("parseDtlText — firstStringArg and stringArgs", () => {
  it("populates firstStringArg with arr[1] when it is a string", () => {
    const text = '[["apply", "my-rule", "_S."]]';
    const { calls } = parseDtlText(text, "dtl");
    const call = calls.find((c) => c.functionName === "apply");
    expect(call?.firstStringArg).toBe("my-rule");
  });

  it("sets firstStringArg to null when arr[1] is not a string", () => {
    const text = '[["count", ["list", 1, 2]]]';
    const { calls } = parseDtlText(text, "dtl");
    const call = calls.find((c) => c.functionName === "count");
    expect(call?.firstStringArg).toBeNull();
  });

  it("populates stringArgs with all string arguments", () => {
    const text = '[["add", "name", "_S.firstname"]]';
    const { calls } = parseDtlText(text, "dtl");
    const call = calls.find((c) => c.functionName === "add");
    expect(call?.stringArgs).toContain("name");
    expect(call?.stringArgs).toContain("_S.firstname");
  });
});

describe("parseDtlText — structuralErrors (rule-not-array)", () => {
  it("records a structural error for a non-array item in a rules list", () => {
    const text = JSON.stringify({
      transform: {
        type: "dtl",
        rules: {
          default: ["just-a-string", ["copy", "_id"]],
        },
      },
    });
    const { structuralErrors, calls } = parseDtlText(text, "json");
    expect(structuralErrors.some((e) => e.kind === "rule-not-array")).toBe(true);
    // The valid array item is still parsed
    expect(calls.some((c) => c.functionName === "copy")).toBe(true);
  });

  it("returns no structural errors when all rules items are arrays", () => {
    const text = JSON.stringify({
      transform: {
        type: "dtl",
        rules: {
          default: [
            ["add", "x", 1],
            ["copy", "_id"],
          ],
        },
      },
    });
    const { structuralErrors } = parseDtlText(text, "json");
    expect(structuralErrors).toHaveLength(0);
  });
});
