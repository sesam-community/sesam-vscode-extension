/**
 * Code-action (quick-fix) builders for sesam-config diagnostics.
 *
 * Each builder inspects the diagnostic code, locates the right insertion
 * point in the document text, and returns one or more CodeAction objects
 * that contain the necessary TextEdits.
 *
 * Fixable codes
 * ─────────────
 *  missing-id              → insert `"_id": ""`  at the start of the config object
 *  missing-type            → insert `"type": "pipe"` (or system variant) at the config start
 *  missing-source          → insert a skeleton `"source"` block after the config opens
 *  missing-source-type     → insert `"type": "dataset"` inside the existing source object
 *  missing-source-property → insert the specific missing required property inside source
 *  missing-default-rule    → insert a skeleton `"default"` rule inside the rules object
 */

import { CodeAction, CodeActionKind, Diagnostic, TextEdit } from "vscode-languageserver/node";
import { TextDocument } from "vscode-languageserver-textdocument";

// ---------------------------------------------------------------------------
// Low-level text helpers
// ---------------------------------------------------------------------------

/**
 * Scan backward from `from` (inclusive) and return the offset of the first
 * `{` character found.  Returns -1 when none exists.
 */
const findPrevOpenBrace = (text: string, from: number): number => {
  for (let i = from; i >= 0; i--) {
    if (text[i] === "{") {
      return i;
    }
  }

  return -1;
};

/**
 * Find the offset of the opening `{` of the JSON *object* that is the value
 * of `key`, starting the search at `fromOffset`.
 *
 * Also handles the case where the value is an *array* whose first element
 * is an object (e.g. `"transform": [{ … }]`).
 *
 * Returns -1 when the key or a suitable `{` cannot be located.
 */
const findNestedObjectBrace = (text: string, key: string, fromOffset: number): number => {
  const keyPos = text.indexOf(`"${key}"`, fromOffset);

  if (keyPos === -1) {
    return -1;
  }

  const colonPos = text.indexOf(":", keyPos + key.length + 2);

  if (colonPos === -1) {
    return -1;
  }

  let i = colonPos + 1;

  while (i < text.length && " \t\r\n".includes(text[i])) {
    i++;
  }

  if (text[i] === "{") {
    return i;
  }

  // Handle `"key": [ { … } ]`
  if (text[i] === "[") {
    i++;

    while (i < text.length && " \t\r\n".includes(text[i])) {
      i++;
    }

    if (text[i] === "{") {
      return i;
    }
  }

  return -1;
};

/**
 * Build a TextEdit that inserts `newProp` right after the `{` at `braceOffset`.
 *
 * - When the object currently has content the insertion gets a trailing `,`
 *   so the next existing property remains syntactically valid.
 * - When the object is empty (`{}`) no trailing comma is added.
 *
 * @param indent  Leading whitespace prepended to `newProp` (controls depth).
 */
const insertAtObjectStart = (
  text: string,
  document: TextDocument,
  braceOffset: number,
  newProp: string,
  indent: string,
): TextEdit => {
  const insertPos = document.positionAt(braceOffset + 1);

  let peek = braceOffset + 1;

  while (peek < text.length && " \t\r\n".includes(text[peek])) {
    peek++;
  }

  const isEmpty = text[peek] === "}";
  const suffix = isEmpty ? `\n${indent}${newProp}\n` : `\n${indent}${newProp},`;

  return TextEdit.insert(insertPos, suffix);
};

/**
 * Wrap a single TextEdit into a fully-formed CodeAction.
 */
const makeAction = (
  title: string,
  uri: string,
  edit: TextEdit,
  diag: Diagnostic,
  isPreferred = false,
): CodeAction => ({
  title,
  kind: CodeActionKind.QuickFix,
  diagnostics: [diag],
  edit: { changes: { [uri]: [edit] } },
  isPreferred,
});

// ---------------------------------------------------------------------------
// Per-code fixers
// ---------------------------------------------------------------------------

/**
 * missing-id
 * The diagnostic range starts at the config object's `{`.
 */
const fixMissingId = (
  text: string,
  document: TextDocument,
  diag: Diagnostic,
  uri: string,
): CodeAction | null => {
  const braceOffset = document.offsetAt(diag.range.start);

  if (text[braceOffset] !== "{") {
    return null;
  }

  const edit = insertAtObjectStart(text, document, braceOffset, '"_id": ""', "  ");

  return makeAction('Add "_id" property', uri, edit, diag, true);
};

/**
 * missing-type
 * The diagnostic range starts at the config object's `{`.
 * Two actions are offered: pipe and system starter.
 */
const fixMissingType = (
  text: string,
  document: TextDocument,
  diag: Diagnostic,
  uri: string,
): CodeAction[] => {
  const braceOffset = document.offsetAt(diag.range.start);

  if (text[braceOffset] !== "{") {
    return [];
  }

  const pipeEdit = insertAtObjectStart(text, document, braceOffset, '"type": "pipe"', "  ");
  const sysEdit = insertAtObjectStart(text, document, braceOffset, '"type": "system:rest"', "  ");

  return [
    makeAction('Add "type": "pipe"', uri, pipeEdit, diag, true),
    makeAction('Add "type": "system:rest"', uri, sysEdit, diag),
  ];
};

/**
 * missing-source
 * The diagnostic range is at the `"type"` value (e.g. `"pipe"`) — search
 * backward to find the config object's `{`.
 */
const fixMissingSource = (
  text: string,
  document: TextDocument,
  diag: Diagnostic,
  uri: string,
): CodeAction | null => {
  const startOffset = document.offsetAt(diag.range.start);
  const braceOffset = findPrevOpenBrace(text, startOffset);

  if (braceOffset === -1) {
    return null;
  }

  const sourceProp = '"source": {\n    "type": "dataset",\n    "dataset": ""\n  }';
  const edit = insertAtObjectStart(text, document, braceOffset, sourceProp, "  ");

  return makeAction('Add "source" property', uri, edit, diag, true);
};

/**
 * missing-source-type
 * The diagnostic range falls back to the config object's `{` (because the
 * source value is an object, not a string).  Locate `"source"` from there.
 */
const fixMissingSourceType = (
  text: string,
  document: TextDocument,
  diag: Diagnostic,
  uri: string,
): CodeAction | null => {
  const startOffset = document.offsetAt(diag.range.start);
  const configBrace = findPrevOpenBrace(text, startOffset);

  if (configBrace === -1) {
    return null;
  }

  const sourceBrace = findNestedObjectBrace(text, "source", configBrace);

  if (sourceBrace === -1) {
    return null;
  }

  const edit = insertAtObjectStart(text, document, sourceBrace, '"type": "dataset"', "    ");

  return makeAction('Add "type" to source', uri, edit, diag, true);
};

/**
 * missing-source-property
 * The diagnostic range is at the source's `"type"` value (e.g. `"dataset"`).
 * The property name is parsed from the diagnostic message.
 * Searching backward from that position reaches the source object's `{`.
 */
const fixMissingSourceProperty = (
  text: string,
  document: TextDocument,
  diag: Diagnostic,
  uri: string,
): CodeAction | null => {
  const match = /missing required property "([^"]+)"/.exec(diag.message);

  if (!match) {
    return null;
  }

  const propName = match[1];
  const startOffset = document.offsetAt(diag.range.start);
  const sourceBrace = findPrevOpenBrace(text, startOffset);

  if (sourceBrace === -1) {
    return null;
  }

  const edit = insertAtObjectStart(text, document, sourceBrace, `"${propName}": ""`, "    ");

  return makeAction(`Add "${propName}" to source`, uri, edit, diag, true);
};

/**
 * missing-default-rule
 * The diagnostic range is at the config object's `{`.
 * Navigate into `transform` → `rules` to find the rules object's `{`.
 */
const fixMissingDefaultRule = (
  text: string,
  document: TextDocument,
  diag: Diagnostic,
  uri: string,
): CodeAction | null => {
  const startOffset = document.offsetAt(diag.range.start);
  const configBrace = findPrevOpenBrace(text, startOffset);

  if (configBrace === -1) {
    return null;
  }

  const transformBrace = findNestedObjectBrace(text, "transform", configBrace);

  if (transformBrace === -1) {
    return null;
  }

  const rulesBrace = findNestedObjectBrace(text, "rules", transformBrace);

  if (rulesBrace === -1) {
    return null;
  }

  const edit = insertAtObjectStart(
    text,
    document,
    rulesBrace,
    '"default": [["copy", "_S"]]',
    "      ",
  );

  return makeAction('Add "default" rule', uri, edit, diag, true);
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Build all available quick-fix CodeActions for the given set of diagnostics.
 * Unrecognised or unfixable codes are silently skipped.
 */
export const buildCodeActionsForDiagnostics = (
  text: string,
  document: TextDocument,
  diagnostics: Diagnostic[],
  uri: string,
): CodeAction[] =>
  diagnostics.flatMap((diag) => {
    switch (diag.code) {
      case "missing-id": {
        const action = fixMissingId(text, document, diag, uri);
        return action ? [action] : [];
      }
      case "missing-type":
        return fixMissingType(text, document, diag, uri);
      case "missing-source": {
        const action = fixMissingSource(text, document, diag, uri);
        return action ? [action] : [];
      }
      case "missing-source-type": {
        const action = fixMissingSourceType(text, document, diag, uri);
        return action ? [action] : [];
      }
      case "missing-source-property": {
        const action = fixMissingSourceProperty(text, document, diag, uri);
        return action ? [action] : [];
      }
      case "missing-default-rule": {
        const action = fixMissingDefaultRule(text, document, diag, uri);
        return action ? [action] : [];
      }
      default:
        return [];
    }
  });
