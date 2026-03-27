import * as fs from "node:fs";
import * as path from "node:path";

import { describe, it, expect } from "vitest";

import { DiagnosticSeverity, CompletionItemKind, Position } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import {
  levelToSeverity,
  escapeRegex,
  elementsToRange,
  isSourceTypeContext,
  isSystemTypeContext,
  isVariableContext,
  isFunctionNameContext,
  isDtlRuleArrayContext,
  buildSystemTypeCompletions,
  buildSourceTypeCompletions,
  buildFunctionCompletions,
  buildVariableCompletions,
  getWordAtPosition,
  isWordChar,
  buildFunctionMarkdown,
  lspRange,
  findKeyOffset,
  buildDocumentSymbols,
} from "../server/src/utils/server.utils";

import { getDtlFunction } from "../src/shared/dtl-registry";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDoc = (content: string) =>
  TextDocument.create("file:///test.conf.pipe", "sesam-config", 1, content);

const MOCK_DIR = path.join(__dirname, "mock");
const loadMock = (rel: string): string => fs.readFileSync(path.join(MOCK_DIR, rel), "utf-8");

// ---------------------------------------------------------------------------
// levelToSeverity
// ---------------------------------------------------------------------------

describe("levelToSeverity", () => {
  it("maps 'warning' → Warning", () => {
    expect(levelToSeverity("warning")).toBe(DiagnosticSeverity.Warning);
  });

  it("maps 'info' → Information", () => {
    expect(levelToSeverity("info")).toBe(DiagnosticSeverity.Information);
  });

  it("maps 'error' → Error", () => {
    expect(levelToSeverity("error")).toBe(DiagnosticSeverity.Error);
  });

  it("maps 'critical' → Error (default)", () => {
    expect(levelToSeverity("critical")).toBe(DiagnosticSeverity.Error);
  });

  it("maps unknown → Error (default)", () => {
    expect(levelToSeverity("unknown")).toBe(DiagnosticSeverity.Error);
  });
});

// ---------------------------------------------------------------------------
// escapeRegex
// ---------------------------------------------------------------------------

describe("escapeRegex", () => {
  it("escapes special regex characters", () => {
    expect(escapeRegex("a.b*c+d?")).toBe("a\\.b\\*c\\+d\\?");
  });

  it("escapes brackets and braces", () => {
    expect(escapeRegex("[a]{b}(c)")).toBe("\\[a\\]\\{b\\}\\(c\\)");
  });

  it("returns plain strings unchanged", () => {
    expect(escapeRegex("hello")).toBe("hello");
  });

  it("escapes backslash", () => {
    expect(escapeRegex("a\\b")).toBe("a\\\\b");
  });
});

// ---------------------------------------------------------------------------
// elementsToRange
// ---------------------------------------------------------------------------

describe("elementsToRange", () => {
  it("returns range of the matched key", () => {
    const doc = makeDoc('{"transform": null}');
    const range = elementsToRange(doc, '{"transform": null}', "$['transform']");
    expect(range.start.line).toBe(0);
    expect(range.start.character).toBe(1); // position of `"transform":`
  });

  it("falls back to (0,0)→(0,MAX) when key not found", () => {
    const doc = makeDoc('{"foo": 1}');
    const range = elementsToRange(doc, '{"foo": 1}', "$['missing']");
    expect(range.start.character).toBe(0);
    // Position.create clamps values > Number.MAX_VALUE to uinteger.MAX_VALUE (2147483647)
    expect(range.end.character).toBe(2147483647);
  });

  it("falls back when elements has no bracket notation", () => {
    const doc = makeDoc("{}");
    const range = elementsToRange(doc, "{}", "$");
    expect(range.start.line).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isSourceTypeContext
// ---------------------------------------------------------------------------

describe("isSourceTypeContext", () => {
  it("returns true inside source.type value", () => {
    expect(isSourceTypeContext('{"source":{"type":"')).toBe(true);
  });

  it("returns true with spaces around colon", () => {
    expect(isSourceTypeContext('"source" : { "type" : "')).toBe(true);
  });

  it("returns false for root-level type", () => {
    expect(isSourceTypeContext('{"type":"')).toBe(false);
  });

  it("returns false when not inside a string", () => {
    expect(isSourceTypeContext('{"source":{"type":')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSystemTypeContext
// ---------------------------------------------------------------------------

describe("isSystemTypeContext", () => {
  it("returns true at root-level depth 1 type value", () => {
    expect(isSystemTypeContext('{"type":"')).toBe(true);
  });

  it("returns false when nested (depth > 1)", () => {
    expect(isSystemTypeContext('{"source":{"type":"')).toBe(false);
  });

  it("returns false when not in type value position", () => {
    expect(isSystemTypeContext('{"_id":"')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isVariableContext
// ---------------------------------------------------------------------------

describe("isVariableContext", () => {
  it("returns true for _S.", () => {
    expect(isVariableContext('"_S.')).toBe(true);
  });

  it("returns true for _T", () => {
    expect(isVariableContext('"_T')).toBe(true);
  });

  it("returns true inside a DTL expression", () => {
    expect(isVariableContext('["add", "prop", "_S.field')).toBe(true);
  });

  it("returns false for regular strings", () => {
    expect(isVariableContext('"hello')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isFunctionNameContext
// ---------------------------------------------------------------------------

describe("isFunctionNameContext", () => {
  it("returns true after opening bracket + quote", () => {
    expect(isFunctionNameContext('["add')).toBe(true);
  });

  it("returns true after bare opening bracket", () => {
    expect(isFunctionNameContext("[\n  [")).toBe(true);
  });

  it("returns true right after [", () => {
    expect(isFunctionNameContext("[")).toBe(true);
  });

  it("returns false for non-function positions", () => {
    expect(isFunctionNameContext('{"_id": "')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isDtlRuleArrayContext
// ---------------------------------------------------------------------------

describe("isDtlRuleArrayContext", () => {
  const dtlObj = (rule = '{"default":[') => `{"transform":{"type":"dtl","rules":${rule}`;

  const dtlArr = (rule = '{"default":[') => `{"transform":[{"type":"dtl","rules":${rule}`;

  it("returns true inside object-transform rule array", () => {
    expect(isDtlRuleArrayContext(dtlObj())).toBe(true);
  });

  it("returns true with a partial function quote", () => {
    expect(isDtlRuleArrayContext(dtlObj('{"default":["add'))).toBe(true);
  });

  it("returns true inside array-transform rule array", () => {
    expect(isDtlRuleArrayContext(dtlArr())).toBe(true);
  });

  it("returns true for nested array inside rule (DTL sub-expression)", () => {
    expect(isDtlRuleArrayContext(dtlObj('{"default":[['))).toBe(true);
  });

  it("returns true inside a non-default named rule", () => {
    expect(isDtlRuleArrayContext(dtlObj('{"my-rule":['))).toBe(true);
  });

  it("returns false at pipe root level", () => {
    expect(isDtlRuleArrayContext('{"_id":"p",')).toBe(false);
  });

  it("returns false inside source object", () => {
    expect(isDtlRuleArrayContext('{"source":{"entities":[')).toBe(false);
  });

  it("returns false inside transform object (not yet in rules)", () => {
    expect(isDtlRuleArrayContext('{"transform":{"type":"dtl",')).toBe(false);
  });

  it("returns false inside rules object key position", () => {
    expect(isDtlRuleArrayContext('{"transform":{"rules":{')).toBe(false);
  });

  it("returns false when not after a bracket", () => {
    expect(isDtlRuleArrayContext(dtlObj('{"default":"'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildSystemTypeCompletions
// ---------------------------------------------------------------------------

describe("buildSystemTypeCompletions", () => {
  it("returns non-empty array", () => {
    const items = buildSystemTypeCompletions();
    expect(items.length).toBeGreaterThan(0);
  });

  it("all items have EnumMember kind", () => {
    const items = buildSystemTypeCompletions();
    expect(items.every((i) => i.kind === CompletionItemKind.EnumMember)).toBe(true);
  });

  it("items have label, insertText, and documentation", () => {
    const items = buildSystemTypeCompletions();
    for (const item of items) {
      expect(typeof item.label).toBe("string");
      expect(item.insertText).toBe(item.label);
      expect(item.documentation).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// buildSourceTypeCompletions
// ---------------------------------------------------------------------------

describe("buildSourceTypeCompletions", () => {
  it("returns non-empty array", () => {
    const items = buildSourceTypeCompletions();
    expect(items.length).toBeGreaterThan(0);
  });

  it("all items have EnumMember kind", () => {
    const items = buildSourceTypeCompletions();
    expect(items.every((i) => i.kind === CompletionItemKind.EnumMember)).toBe(true);
  });

  it("items include documentation with a docs URL", () => {
    const items = buildSourceTypeCompletions();
    for (const item of items) {
      const doc = item.documentation as { value: string };
      expect(doc.value).toContain("docs.sesam.io");
    }
  });
});

// ---------------------------------------------------------------------------
// buildFunctionCompletions
// ---------------------------------------------------------------------------

describe("buildFunctionCompletions", () => {
  it("returns non-empty array", () => {
    const items = buildFunctionCompletions();
    expect(items.length).toBeGreaterThan(0);
  });

  it("transform functions have Method kind, expression functions have Function kind", () => {
    const items = buildFunctionCompletions();
    for (const item of items) {
      const isMethod = item.kind === CompletionItemKind.Method;
      const isFn = item.kind === CompletionItemKind.Function;
      expect(isMethod || isFn).toBe(true);
    }
  });

  it("sortText prefixes: transforms start with 0_, expressions with 1_", () => {
    const items = buildFunctionCompletions();
    for (const item of items) {
      expect(item.sortText?.startsWith("0_") || item.sortText?.startsWith("1_")).toBe(true);
    }
  });

  it("includes 'add' and 'concat'", () => {
    const labels = buildFunctionCompletions().map((i) => i.label);
    expect(labels).toContain("add");
    expect(labels).toContain("concat");
  });
});

// ---------------------------------------------------------------------------
// buildVariableCompletions
// ---------------------------------------------------------------------------

describe("buildVariableCompletions", () => {
  it("includes DTL variable entries (_S, _T, etc.)", () => {
    const labels = buildVariableCompletions().map((i) => i.label);
    expect(labels).toContain("_S");
    expect(labels).toContain("_T");
  });

  it("includes reserved field entries (_id, _deleted)", () => {
    const labels = buildVariableCompletions().map((i) => i.label);
    expect(labels).toContain("_id");
    expect(labels).toContain("_deleted");
  });

  it("variable items have Variable kind", () => {
    const items = buildVariableCompletions();
    const varItem = items.find((i) => i.label === "_S");
    expect(varItem?.kind).toBe(CompletionItemKind.Variable);
  });

  it("reserved field items have Field kind", () => {
    const items = buildVariableCompletions();
    const fieldItem = items.find((i) => i.label === "_id");
    expect(fieldItem?.kind).toBe(CompletionItemKind.Field);
  });
});

// ---------------------------------------------------------------------------
// isWordChar
// ---------------------------------------------------------------------------

describe("isWordChar", () => {
  it("accepts letters, digits, underscore, dollar, hyphen, bang, dot", () => {
    for (const ch of "abcXYZ09_$-.!") {
      expect(isWordChar(ch)).toBe(true);
    }
  });

  it("rejects spaces and brackets", () => {
    for (const ch of " \t\n[]{}") {
      expect(isWordChar(ch)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// getWordAtPosition
// ---------------------------------------------------------------------------

describe("getWordAtPosition", () => {
  it("returns word under cursor", () => {
    const text = '["add", "_S.foo"]';
    const doc = makeDoc(text);
    // cursor at offset 2 → "add"
    const word = getWordAtPosition(doc, Position.create(0, 2));
    expect(word).toBe("add");
  });

  it("returns _S.foo as single word (dot is a word char)", () => {
    const text = '["add", "_S.foo"]';
    const doc = makeDoc(text);
    // cursor inside "_S.foo" — offset 10
    const word = getWordAtPosition(doc, Position.create(0, 10));
    expect(word).toBe("_S.foo");
  });

  it("returns null when cursor is on leading whitespace (no preceding word)", () => {
    const doc = makeDoc(" abc");
    const word = getWordAtPosition(doc, Position.create(0, 0));
    expect(word).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// buildFunctionMarkdown
// ---------------------------------------------------------------------------

describe("buildFunctionMarkdown", () => {
  it("contains function name", () => {
    const fn = getDtlFunction("add")!;
    const md = buildFunctionMarkdown(fn);
    expect(md).toContain("`add`");
  });

  it("contains the signature in a code block", () => {
    const fn = getDtlFunction("concat")!;
    const md = buildFunctionMarkdown(fn);
    expect(md).toContain("```");
    expect(md).toContain(fn.signature);
  });

  it("contains a documentation URL", () => {
    const fn = getDtlFunction("eq")!;
    const md = buildFunctionMarkdown(fn);
    expect(md).toContain("docs.sesam.io");
  });

  it("lists parameters", () => {
    const fn = getDtlFunction("add")!;
    const md = buildFunctionMarkdown(fn);
    expect(md).toContain("property");
    expect(md).toContain("value");
  });

  it("shows '+ arguments' for variadic functions", () => {
    const fn = getDtlFunction("and")!;
    const md = buildFunctionMarkdown(fn);
    expect(md).toContain("+ arguments");
  });

  it("shows exact count for fixed-arg functions", () => {
    const fn = getDtlFunction("eq")!;
    const md = buildFunctionMarkdown(fn);
    expect(md).toContain("2 arguments");
  });
});

// ---------------------------------------------------------------------------
// lspRange
// ---------------------------------------------------------------------------

describe("lspRange", () => {
  it("converts a DtlRange to an LSP Range", () => {
    const dtlRange = {
      start: { line: 2, character: 4, offset: 50 },
      end: { line: 2, character: 10, offset: 56 },
    };
    const range = lspRange(dtlRange);
    expect(range.start.line).toBe(2);
    expect(range.start.character).toBe(4);
    expect(range.end.line).toBe(2);
    expect(range.end.character).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// findKeyOffset
// ---------------------------------------------------------------------------

describe("findKeyOffset", () => {
  it("returns the offset of a key in a JSON string", () => {
    const text = '{"_id": "test", "transform": {}}';
    const off = findKeyOffset(text, "_id");
    expect(off).toBe(1); // `"_id":` starts at index 1
  });

  it("returns -1 when key is not found", () => {
    expect(findKeyOffset('{"foo": 1}', "missing")).toBe(-1);
  });

  it("respects fromOffset", () => {
    const text = '{"rules": 1, "rules": 2}';
    const first = findKeyOffset(text, "rules", 0);
    const second = findKeyOffset(text, "rules", first + 7);
    expect(second).toBeGreaterThan(first);
  });

  it("escapes special regex chars in key names", () => {
    const text = '{"$children": []}';
    const off = findKeyOffset(text, "$children");
    expect(off).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildDocumentSymbols
// ---------------------------------------------------------------------------

describe("buildDocumentSymbols", () => {
  const pipeJson = JSON.stringify({
    _id: "my-pipe",
    transform: {
      type: "dtl",
      rules: {
        default: [
          ["copy", "*"],
          ["add", "foo", "bar"],
        ],
      },
    },
  });

  it("includes an _id symbol", () => {
    const doc = makeDoc(pipeJson);
    const symbols = buildDocumentSymbols(doc, pipeJson, JSON.parse(pipeJson));
    const idSym = symbols.find((s) => s.name.startsWith("_id:"));
    expect(idSym).toBeDefined();
    expect(idSym!.name).toBe("_id: my-pipe");
  });

  it("includes a transform symbol with children", () => {
    const doc = makeDoc(pipeJson);
    const symbols = buildDocumentSymbols(doc, pipeJson, JSON.parse(pipeJson));
    const transformSym = symbols.find((s) => s.name === "transform");
    expect(transformSym).toBeDefined();
    expect(transformSym!.children!.length).toBeGreaterThan(0);
  });

  it("returns only _id symbol when no transform", () => {
    const text = JSON.stringify({ _id: "no-transform" });
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, JSON.parse(text));
    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("_id: no-transform");
  });

  it("returns empty array for empty object", () => {
    const doc = makeDoc("{}");
    const symbols = buildDocumentSymbols(doc, "{}", {});
    expect(symbols).toHaveLength(0);
  });

  it("labels single DTL step in array transform as 'dtl'", () => {
    const obj = {
      _id: "p",
      transform: [{ type: "dtl", rules: { default: [["copy", "*"]] } }],
    };
    const text = JSON.stringify(obj);
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);
    const transformSym = symbols.find((s) => s.name === "transform");
    expect(transformSym!.children![0].name).toBe("dtl");
  });

  it("labels multiple DTL steps as 'dtl [N]'", () => {
    const obj = {
      _id: "p",
      transform: [
        { type: "dtl", rules: { default: [["copy", "*"]] } },
        { type: "dtl", rules: { second: [["add", "x", "1"]] } },
      ],
    };
    const text = JSON.stringify(obj);
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);
    const transformSym = symbols.find((s) => s.name === "transform");
    const childNames = transformSym!.children!.map((c) => c.name);
    expect(childNames).toContain("dtl [1]");
    expect(childNames).toContain("dtl [2]");
  });
});

// ---------------------------------------------------------------------------
// buildDocumentSymbols — mock file fixtures
// ---------------------------------------------------------------------------

describe("buildDocumentSymbols — mock fixtures", () => {
  it("http-endpoint.json: single transform, one rule, copy _id", () => {
    const text = loadMock("pipes/http-endpoint.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    const idSym = symbols.find((s) => s.name.startsWith("_id:"));
    expect(idSym!.name).toBe("_id: http-endpoint");

    const transformSym = symbols.find((s) => s.name === "transform");
    expect(transformSym).toBeDefined();

    // single plain-object transform → "rules" wrapper → "default" rule
    const rulesSym = transformSym!.children!.find((c) => c.name === "rules");
    expect(rulesSym).toBeDefined();

    const defaultRule = rulesSym!.children!.find((c) => c.name === "default");
    expect(defaultRule).toBeDefined();
    expect(defaultRule!.children!.some((c) => c.name === "copy")).toBe(true);
  });

  it("filter-pipe.json: single transform, multiple top-level calls", () => {
    const text = loadMock("pipes/filter-pipe.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    const transformSym = symbols.find((s) => s.name === "transform");
    const rulesSym = transformSym!.children!.find((c) => c.name === "rules");
    const defaultRule = rulesSym!.children!.find((c) => c.name === "default");
    expect(defaultRule).toBeDefined();

    const callNames = defaultRule!.children!.map((c) => c.name);
    expect(callNames).toContain("copy");
    expect(callNames).toContain("filter");
    expect(callNames).toContain("add");
  });

  it("multi-transform.json: array transform produces dtl [1] / dtl [2]", () => {
    const text = loadMock("pipes/multi-transform.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    expect(symbols.find((s) => s.name === "_id: multi-transform")).toBeDefined();

    const transformSym = symbols.find((s) => s.name === "transform");
    expect(transformSym).toBeDefined();

    const childNames = transformSym!.children!.map((c) => c.name);
    expect(childNames).toContain("dtl [1]");
    expect(childNames).toContain("dtl [2]");
  });

  it("multi-transform.json: dtl [1] has copy+add, dtl [2] has filter+add", () => {
    const text = loadMock("pipes/multi-transform.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    const transformSym = symbols.find((s) => s.name === "transform")!;
    const step1 = transformSym.children!.find((c) => c.name === "dtl [1]")!;
    const step2 = transformSym.children!.find((c) => c.name === "dtl [2]")!;

    const step1Default = step1.children!.find((c) => c.name === "default")!;
    const step1Calls = step1Default.children!.map((c) => c.name);
    expect(step1Calls).toContain("copy");
    expect(step1Calls).toContain("add");

    const step2Default = step2.children!.find((c) => c.name === "default")!;
    const step2Calls = step2Default.children!.map((c) => c.name);
    expect(step2Calls).toContain("filter");
    expect(step2Calls).toContain("add");
  });

  it("csv-source.json: pipe with no transform yields only _id symbol", () => {
    const text = loadMock("pipes/csv-source.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("_id: csv-source");
  });

  it("multi-rule.json: single transform with two named rules (default + order-ref)", () => {
    const text = loadMock("pipes/multi-rule.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    const transformSym = symbols.find((s) => s.name === "transform")!;
    const rulesSym = transformSym.children!.find((c) => c.name === "rules")!;
    const ruleNames = rulesSym.children!.map((c) => c.name);
    expect(ruleNames).toContain("default");
    expect(ruleNames).toContain("order-ref");
  });

  it("smtp.json: system file with no transform yields only _id symbol", () => {
    const text = loadMock("systems/smtp.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = TextDocument.create("file:///smtp.json", "sesam-config", 1, text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("_id: smtp");
  });

  it("microservice.json: system file with no transform yields only _id symbol", () => {
    const text = loadMock("systems/microservice.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = TextDocument.create("file:///ms.json", "sesam-config", 1, text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    expect(symbols).toHaveLength(1);
    expect(symbols[0].name).toBe("_id: my-microservice");
  });

  // ── Complex real-world pipes ─────────────────────────────────────────────

  it("difi-enhetsregisteret-classification-enrich.json: many named rules all appear", () => {
    const text = loadMock("pipes/difi-enhetsregisteret-classification-enrich.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    expect(
      symbols.find((s) => s.name === "_id: difi-enhetsregisteret-classification-enrich"),
    ).toBeDefined();

    const transformSym = symbols.find((s) => s.name === "transform")!;
    expect(transformSym).toBeDefined();

    // plain-object transform → "rules" wrapper
    const rulesSym = transformSym.children!.find((c) => c.name === "rules")!;
    expect(rulesSym).toBeDefined();

    const ruleNames = rulesSym.children!.map((c) => c.name);
    expect(ruleNames).toContain("default");
    expect(ruleNames).toContain("1-history");
    expect(ruleNames).toContain("add-P248");
    expect(ruleNames).toContain("map-nkode1");
    expect(ruleNames).toContain("strip-dates");
    // 19 total rules
    expect(ruleNames.length).toBe(19);
  });

  it("difi-enhetsregisteret-classification-enrich.json: default rule has function call symbols", () => {
    const text = loadMock("pipes/difi-enhetsregisteret-classification-enrich.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    const transformSym = symbols.find((s) => s.name === "transform")!;
    const rulesSym = transformSym.children!.find((c) => c.name === "rules")!;
    const defaultRule = rulesSym.children!.find((c) => c.name === "default")!;

    expect(defaultRule.children!.length).toBeGreaterThan(0);
    const callNames = defaultRule.children!.map((c) => c.name);
    expect(callNames).toContain("copy");
    expect(callNames).toContain("merge");
  });

  it("difi: call symbol ranges contain their cursor positions (outline follow-cursor)", () => {
    // Verify that VS Code Outline cursor tracking works: every ancestor symbol's range
    // must contain the cursor, and the leaf call symbol's range must too.
    const text = loadMock("pipes/difi-enhetsregisteret-classification-enrich.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    // Helper: does range contain pos (LSP 0-indexed)?
    const contains = (
      range: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      },
      pos: { line: number; character: number },
    ): boolean => {
      if (pos.line < range.start.line || pos.line > range.end.line) {
        return false;
      }

      if (pos.line === range.start.line && pos.character < range.start.character) {
        return false;
      }

      if (pos.line === range.end.line && pos.character > range.end.character) {
        return false;
      }

      return true;
    };

    // Line 25 (1-indexed) = line 24 (0-indexed LSP): '        ["add", "_$last-modified",'
    // [ is at character 8, cursor on "add" is at character 10.
    const cursor = { line: 24, character: 10 };

    const transformSym = symbols.find((s) => s.name === "transform")!;
    expect(contains(transformSym.range, cursor)).toBe(true);

    const rulesSym = transformSym.children!.find((c) => c.name === "rules")!;
    expect(contains(rulesSym.range, cursor)).toBe(true);

    const defaultRule = rulesSym.children!.find((c) => c.name === "default")!;
    expect(contains(defaultRule.range, cursor)).toBe(true);

    // Find the specific "add" call at line 24
    const addAtLine24 = defaultRule.children!.find(
      (c) => c.name === "add" && c.range.start.line === 24,
    );
    expect(addAtLine24).toBeDefined();
    expect(addAtLine24!.range.start.line).toBe(24);
    expect(addAtLine24!.range.start.character).toBe(8);
    expect(contains(addAtLine24!.range, cursor)).toBe(true);
  });

  it("wikidata-classification-collect.json: 3-step array transform, only DTL steps labelled", () => {
    const text = loadMock("pipes/wikidata-classification-collect.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    expect(symbols.find((s) => s.name === "_id: wikidata-classification-collect")).toBeDefined();

    const transformSym = symbols.find((s) => s.name === "transform")!;
    expect(transformSym).toBeDefined();

    // 2 DTL steps (step[1] is "rest" with no rules — skipped by buildDocumentSymbols)
    const childNames = transformSym.children!.map((c) => c.name);
    expect(childNames).toContain("dtl [1]");
    expect(childNames).toContain("dtl [2]");
    expect(childNames).not.toContain("dtl [3]");
  });

  it("wikidata-classification-collect.json: dtl [2] has both default and bnode rules", () => {
    const text = loadMock("pipes/wikidata-classification-collect.json");
    const obj = JSON.parse(text) as Record<string, unknown>;
    const doc = makeDoc(text);
    const symbols = buildDocumentSymbols(doc, text, obj);

    const transformSym = symbols.find((s) => s.name === "transform")!;
    const step2 = transformSym.children!.find((c) => c.name === "dtl [2]")!;
    expect(step2).toBeDefined();

    const ruleNames = step2.children!.map((c) => c.name);
    expect(ruleNames).toContain("default");
    expect(ruleNames).toContain("bnode");
  });
});
