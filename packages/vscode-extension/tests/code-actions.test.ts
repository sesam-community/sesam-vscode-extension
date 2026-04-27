import { describe, expect, it } from "vitest";
import { Diagnostic, DiagnosticSeverity, Range } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

import { buildCodeActionsForDiagnostics } from "../server/src/utils/code-actions.utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const makeDocument = (content: string): TextDocument =>
  TextDocument.create("file:///test.conf.pipe", "sesam-config", 1, content);

const makeDiag = (code: string, startChar: number, endChar: number, line = 0): Diagnostic => ({
  range: Range.create(line, startChar, line, endChar),
  severity: DiagnosticSeverity.Error,
  message: `Test diagnostic for ${code}`,
  source: "sesam",
  code,
});

const URI = "file:///test.conf.pipe";

// ---------------------------------------------------------------------------
// missing-id
// ---------------------------------------------------------------------------

describe("buildCodeActionsForDiagnostics — missing-id", () => {
  it("returns a QuickFix action that inserts _id at the opening brace", () => {
    const content = '{\n  "type": "pipe"\n}';
    const doc = makeDocument(content);
    const diag = makeDiag("missing-id", 0, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(1);
    expect(actions[0].title).toContain('"_id"');
    expect(actions[0].isPreferred).toBe(true);
    const edits = Object.values(actions[0].edit!.changes!)[0];
    expect(edits[0].newText).toContain('"_id": ""');
  });

  it("returns no action when the diagnostic range does not point at a brace", () => {
    const content = '{\n  "type": "pipe"\n}';
    const doc = makeDocument(content);
    // line 1, char 2 points to `"` not `{`
    const diag = makeDiag("missing-id", 2, 8, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// missing-type
// ---------------------------------------------------------------------------

describe("buildCodeActionsForDiagnostics — missing-type", () => {
  it("returns two QuickFix actions (pipe and system:rest)", () => {
    const content = '{\n  "_id": "my-pipe"\n}';
    const doc = makeDocument(content);
    const diag = makeDiag("missing-type", 0, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(2);
    const titles = actions.map((a) => a.title);
    expect(titles).toContain('Add "type": "pipe"');
    expect(titles).toContain('Add "type": "system:rest"');
  });

  it("marks the pipe variant as preferred", () => {
    const content = '{\n  "_id": "p"\n}';
    const doc = makeDocument(content);
    const diag = makeDiag("missing-type", 0, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);
    const preferred = actions.find((a) => a.isPreferred);

    expect(preferred?.title).toBe('Add "type": "pipe"');
  });
});

// ---------------------------------------------------------------------------
// missing-source
// ---------------------------------------------------------------------------

describe("buildCodeActionsForDiagnostics — missing-source", () => {
  it("returns an action that inserts a source skeleton", () => {
    // diag range is at `"pipe"` (col 10), scan backward finds `{` at col 0
    const content = '{\n  "type": "pipe"\n}';
    const doc = makeDocument(content);
    const diag = makeDiag("missing-source", 0, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(1);
    const edits = Object.values(actions[0].edit!.changes!)[0];
    expect(edits[0].newText).toContain('"source"');
    expect(edits[0].newText).toContain('"dataset"');
  });
});

// ---------------------------------------------------------------------------
// missing-source-type
// ---------------------------------------------------------------------------

describe("buildCodeActionsForDiagnostics — missing-source-type", () => {
  it("inserts 'type' inside the source object", () => {
    const content = '{\n  "_id": "p",\n  "source": {\n    "dataset": "ds"\n  }\n}';
    const doc = makeDocument(content);
    // Diagnostic range at the config `{` (line 0, col 0)
    const diag = makeDiag("missing-source-type", 0, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Add "type" to source');
    const edits = Object.values(actions[0].edit!.changes!)[0];
    expect(edits[0].newText).toContain('"type": "dataset"');
  });
});

// ---------------------------------------------------------------------------
// missing-source-property
// ---------------------------------------------------------------------------

describe("buildCodeActionsForDiagnostics — missing-source-property", () => {
  it("inserts the property named in the diagnostic message inside source", () => {
    const content = '{\n  "source": {\n    "type": "dataset"\n  }\n}';
    const doc = makeDocument(content);
    const diag: Diagnostic = {
      range: Range.create(0, 0, 0, 1),
      severity: DiagnosticSeverity.Error,
      message: 'Source is missing required property "dataset"',
      source: "sesam",
      code: "missing-source-property",
    };

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Add "dataset" to source');
    const edits = Object.values(actions[0].edit!.changes!)[0];
    expect(edits[0].newText).toContain('"dataset": ""');
  });

  it("returns no action when the message does not contain a property name", () => {
    const content = '{\n  "source": {}\n}';
    const doc = makeDocument(content);
    const diag = makeDiag("missing-source-property", 0, 1);
    // message does not match the regex pattern
    diag.message = "Source property is missing";

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// missing-default-rule
// ---------------------------------------------------------------------------

describe("buildCodeActionsForDiagnostics — missing-default-rule", () => {
  it("inserts a default rule inside the rules object", () => {
    const content =
      '{\n  "_id": "p",\n  "transform": {\n    "type": "dtl",\n    "rules": {\n    }\n  }\n}';
    const doc = makeDocument(content);
    const diag = makeDiag("missing-default-rule", 0, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diag], URI);

    expect(actions).toHaveLength(1);
    expect(actions[0].title).toBe('Add "default" rule');
    const edits = Object.values(actions[0].edit!.changes!)[0];
    expect(edits[0].newText).toContain('"default"');
    expect(edits[0].newText).toContain('"copy"');
  });
});

// ---------------------------------------------------------------------------
// Unknown codes
// ---------------------------------------------------------------------------

describe("buildCodeActionsForDiagnostics — unknown codes", () => {
  it("silently skips unrecognised diagnostic codes", () => {
    const content = '{"_id": "p"}';
    const doc = makeDocument(content);
    const diag = makeDiag("unknown-code-xyz", 0, 1);

    expect(buildCodeActionsForDiagnostics(content, doc, [diag], URI)).toHaveLength(0);
  });

  it("handles an empty diagnostics array", () => {
    const content = '{"_id": "p"}';
    const doc = makeDocument(content);
    expect(buildCodeActionsForDiagnostics(content, doc, [], URI)).toHaveLength(0);
  });

  it("processes multiple diagnostics in one call", () => {
    const content = "{\n}";
    const doc = makeDocument(content);
    const diagId = makeDiag("missing-id", 0, 1);
    const diagType = makeDiag("missing-type", 0, 1);

    const actions = buildCodeActionsForDiagnostics(content, doc, [diagId, diagType], URI);

    // missing-id → 1, missing-type → 2
    expect(actions).toHaveLength(3);
  });
});
