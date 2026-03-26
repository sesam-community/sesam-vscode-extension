/**
 * Config Structure Validator — Phase E
 *
 * Validates that pipe and system config JSON objects contain the minimum required
 * top-level properties AND that `type` values on the config, source, transform,
 * and sink are drawn from the documented allowed value sets.
 *
 *   Pipe   (_id, type = "pipe", source)
 *   System (_id, type = "system:<known-type>")
 *
 * Type checks (Warning severity — unknown types may appear in connectors):
 *   pipe.type         must be "pipe"           (already Error in missing-type)
 *   system.type       must be one of SYSTEM_TYPES
 *   source.type       must be one of PIPE_SOURCE_TYPES
 *   transform[].type  must be one of TRANSFORM_TYPES
 *   sink.type         must be one of SINK_TYPES
 *
 * Handles both a single config object { ... } and an array of configs [{ ... }, ...].
 *
 * Docs:
 *   Pipes:      https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-pipes.html
 *   Systems:    https://docs.sesam.io/hub/documentation/service-configuration/systems/configuration-systems.html
 *   Sources:    https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sources.html
 *   Transforms: https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-transforms.html
 *   Sinks:      https://docs.sesam.io/hub/documentation/service-configuration/pipes/configuration-sinks.html
 */

import { Diagnostic, DiagnosticSeverity, Range, Position } from "vscode-languageserver/node";

import { SYSTEM_TYPES, PIPE_SOURCE_TYPES, TRANSFORM_TYPES, SINK_TYPES } from "./constants";

import type { ValidatorOptions } from "../../types/dtl-validator.types";

// ---------------------------------------------------------------------------
// Precomputed sets (derived from constants so they stay in sync)
// ---------------------------------------------------------------------------

const KNOWN_SYSTEM_TYPES: ReadonlySet<string> = new Set(SYSTEM_TYPES.map((s) => s.label));
const KNOWN_SOURCE_TYPES: ReadonlySet<string> = new Set(PIPE_SOURCE_TYPES.map((s) => s.label));

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
 * Return a Range covering the JSON string value of `key` within `text`,
 * searching from `fromOffset`. Falls back to `fallback` when not found.
 */
const keyValueRange = (text: string, key: string, fromOffset: number, fallback: Range): Range => {
  const keyHit = findPosition(text, `"${key}"`, fromOffset);

  if (!keyHit) {
    return fallback;
  }

  const afterColon = text.indexOf(":", keyHit.offset + key.length + 2);

  if (afterColon === -1) {
    return fallback;
  }

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
// Nested type validation helpers
// ---------------------------------------------------------------------------

/**
 * Emit a Warning diagnostic when `value` is not in `knownTypes`.
 * `searchFrom` is the approximate text offset at which to locate the key for
 * squiggle positioning — falls back to `fallback` range on miss.
 */
const checkType = (
  text: string,
  value: string,
  knownTypes: ReadonlySet<string>,
  key: string,
  searchFrom: number,
  fallback: Range,
  label: string,
  out: Diagnostic[],
): void => {
  if (knownTypes.has(value)) {
    return;
  }

  const range = keyValueRange(text, key, searchFrom, fallback);
  out.push({
    range,
    severity: DiagnosticSeverity.Warning,
    message: `Unknown ${label} type "${value}". Expected one of: ${[...knownTypes].join(", ")}.`,
    source: "sesam",
    code: "unknown-type",
  });
};

/**
 * Find the text offset of an object nested under `parentKey` inside the slice
 * starting at `fromOffset`. Returns -1 if not found.
 */
const findNestedObjectOffset = (text: string, parentKey: string, fromOffset: number): number => {
  const keyHit = text.indexOf(`"${parentKey}"`, fromOffset);

  if (keyHit === -1) {
    return -1;
  }

  const colon = text.indexOf(":", keyHit + parentKey.length + 2);

  if (colon === -1) {
    return -1;
  }

  let valStart = colon + 1;

  while (valStart < text.length && " \t\r\n".includes(text[valStart])) {
    valStart++;
  }

  return valStart;
};

// ---------------------------------------------------------------------------
// Per-object validation
// ---------------------------------------------------------------------------

type ConfigObject = Record<string, unknown>;

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

  // --- system: validate specific system subtype ---
  if (isSystem) {
    checkType(text, typeVal, KNOWN_SYSTEM_TYPES, "type", fromOffset, fallback, "system", out);

    if (out.length >= maxProblems) {
      return;
    }
  }

  // --- pipe-specific checks ---
  if (isPipe) {
    // source: required + type check
    if (!("source" in obj)) {
      const sourceRange = keyValueRange(text, "type", fromOffset, fallback);
      out.push({
        range: sourceRange,
        severity: DiagnosticSeverity.Error,
        message: 'Pipe config is missing required property "source".',
        source: "sesam",
        code: "missing-source",
      });

      if (out.length >= maxProblems) {
        return;
      }
    } else {
      const sourceObj = obj["source"];

      if (typeof sourceObj === "object" && sourceObj !== null && !Array.isArray(sourceObj)) {
        const srcType = (sourceObj as Record<string, unknown>)["type"];

        if (typeof srcType === "string" && srcType.trim() !== "") {
          const sourceOffset = findNestedObjectOffset(text, "source", fromOffset);
          checkType(
            text,
            srcType,
            KNOWN_SOURCE_TYPES,
            "type",
            sourceOffset !== -1 ? sourceOffset : fromOffset,
            fallback,
            "source",
            out,
          );

          if (out.length >= maxProblems) {
            return;
          }
        }
      }
    }

    // transform: may be an object or an array of objects
    const transforms = obj["transform"];

    if (transforms !== undefined && transforms !== null) {
      const steps = Array.isArray(transforms) ? transforms : [transforms];

      for (const step of steps) {
        if (out.length >= maxProblems) {
          break;
        }

        if (typeof step === "object" && step !== null && !Array.isArray(step)) {
          const tType = (step as Record<string, unknown>)["type"];

          if (typeof tType === "string" && tType.trim() !== "") {
            const transformOffset = findNestedObjectOffset(text, "transform", fromOffset);
            checkType(
              text,
              tType,
              TRANSFORM_TYPES,
              "type",
              transformOffset !== -1 ? transformOffset : fromOffset,
              fallback,
              "transform",
              out,
            );
          }
        }
      }
    }

    // sink: optional, type check when present
    const sinkObj = obj["sink"];

    if (typeof sinkObj === "object" && sinkObj !== null && !Array.isArray(sinkObj)) {
      const sinkType = (sinkObj as Record<string, unknown>)["type"];

      if (typeof sinkType === "string" && sinkType.trim() !== "") {
        const sinkOffset = findNestedObjectOffset(text, "sink", fromOffset);
        checkType(
          text,
          sinkType,
          SINK_TYPES,
          "type",
          sinkOffset !== -1 ? sinkOffset : fromOffset,
          fallback,
          "sink",
          out,
        );
      }
    }
  }
};

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export const validateConfigStructure = (text: string, options: ValidatorOptions): Diagnostic[] => {
  if (!options.validateConfigStructure) {
    return [];
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(text);
  } catch {
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
        const bracePos = text.indexOf("{", searchFrom);
        validateOne(text, item as ConfigObject, searchFrom, out, options.maxProblems);
        searchFrom = bracePos + 1;
      }
    }
  } else if (typeof parsedJson === "object" && parsedJson !== null) {
    validateOne(text, parsedJson as ConfigObject, 0, out, options.maxProblems);
  }

  return out;
};
