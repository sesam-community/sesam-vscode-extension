/**
 * Config Structure Validator — Phase E
 *
 * Validates that pipe and system config JSON objects contain the minimum required
 * top-level properties as defined by the Sesam service configuration docs:
 *
 *   Pipe   (_id, type = "pipe", source)
 *   System (_id, type starts with "system:")
 *
 * Handles both a single config object { ... } and an array of configs [{ ... }, ...].
 *
 * Docs:
 *   Pipes:   https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-pipes.html
 *   Systems: https://docs.sesam.io/hub/documentation/service-configuration/systems/configuration-systems.html
 */

import { Diagnostic, DiagnosticSeverity, Range, Position } from "vscode-languageserver/node";

import type { ValidatorOptions } from "../../types/dtl-validator.types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const toPos = (line: number, character: number): Position => Position.create(line, character);

const toRange = (line: number, character: number, endChar?: number): Range =>
  Range.create(toPos(line, character), toPos(line, endChar ?? character + 1));

/**
 * Find the 0-based line and character of the first occurrence of `needle`
 * in `text`, starting from `fromOffset`. Returns null when not found.
 */
const findPosition = (
  text: string,
  needle: string,
  fromOffset = 0,
): { line: number; character: number; offset: number } | null => {
  const idx = text.indexOf(needle, fromOffset);

  if (idx === -1) {
    return null;
  }

  let line = 0;
  let character = 0;

  for (let i = 0; i < idx; i++) {
    if (text[i] === "\n") {
      line++;
      character = 0;
    } else {
      character++;
    }
  }

  return { line, character, offset: idx };
};

/**
 * Return the range covering the JSON string value of a given key in `text`,
 * starting the search at `fromOffset`. Falls back to the given `fallback` range
 * when the key is not found.
 */
const keyValueRange = (text: string, key: string, fromOffset: number, fallback: Range): Range => {
  const keyHit = findPosition(text, `"${key}"`, fromOffset);

  if (!keyHit) {
    return fallback;
  }

  // Advance past  "key"  :  "
  const afterColon = text.indexOf(":", keyHit.offset + key.length + 2);

  if (afterColon === -1) {
    return fallback;
  }

  // Skip whitespace after the colon
  let valStart = afterColon + 1;

  while (valStart < text.length && " \t\r\n".includes(text[valStart])) {
    valStart++;
  }

  if (text[valStart] !== '"') {
    return fallback;
  }

  const valEnd = text.indexOf('"', valStart + 1);

  if (valEnd === -1) {
    return fallback;
  }

  const startPos = findPosition(text, text.slice(valStart, valEnd + 1), valStart);

  if (!startPos) {
    return fallback;
  }

  return Range.create(
    toPos(startPos.line, startPos.character),
    toPos(startPos.line, startPos.character + (valEnd - valStart + 1)),
  );
};

// ---------------------------------------------------------------------------
// Per-object validation
// ---------------------------------------------------------------------------

type ConfigObject = Record<string, unknown>;

/**
 * Validate a single config object and push diagnostics into `out`.
 * `fromOffset` is the text offset of the opening `{` of this object.
 */
const validateOne = (
  text: string,
  obj: ConfigObject,
  fromOffset: number,
  out: Diagnostic[],
  maxProblems: number,
): void => {
  const openBrace = findPosition(text, "{", fromOffset);
  const fallback = openBrace ? toRange(openBrace.line, openBrace.character) : toRange(0, 0);

  // --- _id ---
  if (!("_id" in obj) || typeof obj["_id"] !== "string" || obj["_id"].trim() === "") {
    out.push({
      range: fallback,
      severity: DiagnosticSeverity.Error,
      message: 'Sesam config is missing required property "_id" (must be a non-empty string).',
      source: "sesam",
      code: "missing-id",
    });

    if (out.length >= maxProblems) {
      return;
    }
  }

  // --- type ---
  const typeVal = obj["type"];

  if (typeof typeVal !== "string" || typeVal.trim() === "") {
    out.push({
      range: fallback,
      severity: DiagnosticSeverity.Error,
      message:
        'Sesam config is missing required property "type". Expected "pipe" or "system:<type>".',
      source: "sesam",
      code: "missing-type",
    });

    if (out.length >= maxProblems) {
      return;
    }

    // Nothing more to check without type
    return;
  }

  const isPipe = typeVal === "pipe";
  const isSystem = typeVal.startsWith("system:");

  if (!isPipe && !isSystem) {
    const typeRange = keyValueRange(text, "type", fromOffset, fallback);
    out.push({
      range: typeRange,
      severity: DiagnosticSeverity.Warning,
      message: `Unknown config type "${typeVal}". Expected "pipe" or "system:<type>" (e.g. "system:rest").`,
      source: "sesam",
      code: "invalid-type",
    });

    if (out.length >= maxProblems) {
      return;
    }
  }

  // --- source (pipes only) ---
  if (isPipe && !("source" in obj)) {
    // Point to the "type" value line as a helpful anchor
    const sourceRange = keyValueRange(text, "type", fromOffset, fallback);
    out.push({
      range: sourceRange,
      severity: DiagnosticSeverity.Error,
      message: 'Pipe config is missing required property "source".',
      source: "sesam",
      code: "missing-source",
    });
  }
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Validate top-level pipe/system config structure.
 * `text` must be valid JSON (call only after Phase A confirms no parse error).
 */
export const validateConfigStructure = (text: string, options: ValidatorOptions): Diagnostic[] => {
  if (!options.validateConfigStructure) {
    return [];
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(text);
  } catch {
    // Should not happen — caller already confirmed JSON is valid
    return [];
  }

  const out: Diagnostic[] = [];

  if (Array.isArray(parsedJson)) {
    let searchFrom = 0;

    for (const item of parsedJson) {
      if (out.length >= options.maxProblems) {
        break;
      }

      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        // Find the opening '{' for this config object in the remaining text
        const bracePos = text.indexOf("{", searchFrom);
        validateOne(text, item as ConfigObject, searchFrom, out, options.maxProblems);
        // Advance past this object for the next iteration
        searchFrom = bracePos + 1;
      }
    }
  } else if (typeof parsedJson === "object" && parsedJson !== null) {
    validateOne(text, parsedJson as ConfigObject, 0, out, options.maxProblems);
  }

  return out;
};
