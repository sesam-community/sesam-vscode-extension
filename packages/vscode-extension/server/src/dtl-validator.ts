/**
 * DTL Validator
 * Runs diagnostics on a parsed set of DtlCalls and emits LSP Diagnostic objects.
 */

import { Diagnostic, DiagnosticSeverity, Range, Position } from "vscode-languageserver/node";
import { DtlCall } from "./dtl-parser";
import { getDtlFunction, isKnownFunction, DTL_VARIABLES } from "../../src/shared/dtl-registry";

import type { ValidatorOptions } from "../../types/dtl-validator.types";

const VALID_VARIABLE_PREFIXES = new Set(Object.keys(DTL_VARIABLES));

const toRange = (
  start: { line: number; character: number },
  end: { line: number; character: number },
): Range => {
  return {
    start: Position.create(start.line, start.character),
    end: Position.create(end.line, end.character),
  };
};

export const validateCalls = (calls: DtlCall[], options: ValidatorOptions): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];

  for (const call of calls) {
    if (diagnostics.length >= options.maxProblems) {
      break;
    }

    const { functionName, nameRange, range, argCount, isTopLevel } = call;

    if (functionName === null) {
      continue;
    }

    // --- Unknown variable prefix
    if (functionName.startsWith("_") && !functionName.includes("-")) {
      const prefix = functionName.split(".")[0]; // e.g. "_X" from "_X.foo"
      if (!VALID_VARIABLE_PREFIXES.has(prefix)) {
        const diagRange = nameRange
          ? toRange(nameRange.start, nameRange.end)
          : toRange(range.start, range.end);
        diagnostics.push({
          range: diagRange,
          severity: DiagnosticSeverity.Warning,
          message: `Unknown variable prefix "${prefix}". Valid prefixes: ${[...VALID_VARIABLE_PREFIXES].join(", ")}.`,
          source: "dtl",
          code: "unknown-variable",
        });
        continue;
      }
    }

    const dtlFn = getDtlFunction(functionName);

    // --- Unknown function
    if (options.validateUnknownFunctions && !isKnownFunction(functionName)) {
      const diagRange = nameRange
        ? toRange(nameRange.start, nameRange.end)
        : toRange(range.start, range.end);
      diagnostics.push({
        range: diagRange,
        severity: DiagnosticSeverity.Error,
        message: `Unknown DTL function "${functionName}".`,
        source: "dtl",
        code: "unknown-function",
      });
      continue;
    }

    if (!dtlFn) {
      continue;
    }

    // --- Phase C: transform function used as a nested expression argument
    if (options.validateTransformInExpression && !isTopLevel && dtlFn.kind === "transform") {
      const diagRange = nameRange
        ? toRange(nameRange.start, nameRange.end)
        : toRange(range.start, range.end);
      diagnostics.push({
        range: diagRange,
        severity: DiagnosticSeverity.Error,
        message: `Transform function "${functionName}" cannot be used as an expression argument. Only expression functions are valid here.`,
        source: "dtl",
        code: "transform-in-expression",
      });
      continue;
    }

    // --- Argument count validation
    if (options.validateArgCount) {
      if (argCount < dtlFn.minArgs) {
        const diagRange = toRange(range.start, range.end);
        diagnostics.push({
          range: diagRange,
          severity: DiagnosticSeverity.Warning,
          message: `"${functionName}" expects at least ${dtlFn.minArgs} argument(s), but got ${argCount}. Signature: ${dtlFn.signature}`,
          source: "dtl",
          code: "too-few-args",
        });
      } else if (dtlFn.maxArgs !== null && argCount > dtlFn.maxArgs) {
        const diagRange = toRange(range.start, range.end);
        diagnostics.push({
          range: diagRange,
          severity: DiagnosticSeverity.Warning,
          message: `"${functionName}" accepts at most ${dtlFn.maxArgs} argument(s), but got ${argCount}. Signature: ${dtlFn.signature}`,
          source: "dtl",
          code: "too-many-args",
        });
      }
    }
  }

  return diagnostics;
};
