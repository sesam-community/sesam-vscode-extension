/**
 * DTL Path Expression Validator
 * Phase D: catch obviously malformed path strings in DTL call arguments.
 *
 * Checks:
 *   - malformed-path: path contains empty segments (e.g. "_S..foo")
 *   - malformed-path: path starts with unknown underscore variable (e.g. "_X.foo")
 */

import { Diagnostic, DiagnosticSeverity, Range, Position } from "vscode-languageserver/node";

import type { DtlCall } from "./dtl-parser";
import type { ValidatorOptions } from "../../types/dtl-validator.types";

/** Built-in variable prefixes that may start a path expression. */
const KNOWN_VARIABLE_PREFIXES = new Set(["_S", "_T", "_P", "_R", "_B", "_"]);

const toRange = (
  start: { line: number; character: number },
  end: { line: number; character: number },
): Range =>
  Range.create(
    Position.create(start.line, start.character),
    Position.create(end.line, end.character),
  );

/**
 * Returns true when a string looks like it could be a path expression that
 * should be validated (contains a `.` and begins with `_` or a lowercase letter).
 * NI literals (`~:ns:id`), URLs, format specifiers, etc. are excluded.
 */
const looksLikePath = (value: string): boolean => {
  if (!value.includes(".")) {
    return false;
  }
  if (value.startsWith("~")) {
    return false;
  } // NI literal / transit-encoded special
  if (value.startsWith("%")) {
    return false;
  } // datetime format token
  if (value.startsWith("http")) {
    return false;
  } // URL
  return /^[a-z_]/.test(value);
};

/**
 * Returns a diagnostic message when the path is malformed, or null when valid.
 */
const pathProblem = (path: string): string | null => {
  // Empty segments
  if (path.includes("..")) {
    return `Malformed path expression "${path}": consecutive dots produce an empty path segment.`;
  }

  const firstSegment = path.split(".")[0];

  // Unknown underscore variable
  if (firstSegment.startsWith("_") && !KNOWN_VARIABLE_PREFIXES.has(firstSegment)) {
    return `Malformed path expression "${path}": unknown variable prefix "${firstSegment}". Valid prefixes: ${[...KNOWN_VARIABLE_PREFIXES].join(", ")}.`;
  }

  return null;
};

export const validatePathStrings = (calls: DtlCall[], options: ValidatorOptions): Diagnostic[] => {
  if (!options.validatePathExpressions) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const call of calls) {
    if (diagnostics.length >= options.maxProblems) {
      break;
    }

    for (const arg of call.stringArgs) {
      if (!looksLikePath(arg)) {
        continue;
      }

      const msg = pathProblem(arg);

      if (msg !== null) {
        diagnostics.push({
          range: toRange(call.range.start, call.range.end),
          severity: DiagnosticSeverity.Warning,
          message: msg,
          source: "dtl",
          code: "malformed-path",
        });

        break; // one diagnostic per call is enough
      }
    }
  }

  return diagnostics;
};
