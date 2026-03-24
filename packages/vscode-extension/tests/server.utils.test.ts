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
