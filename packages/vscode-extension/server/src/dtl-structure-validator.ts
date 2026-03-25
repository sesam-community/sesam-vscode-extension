/**
 * DTL Structure Validator
 * Phase B structural checks:
 *   - rule-not-array: an item in a rules list is not a DTL call array
 *   - missing-function-name: first element of a DTL call is not a string
 *   - undefined-rule: apply/apply-hops references a rule that does not exist
 */

import { Diagnostic, DiagnosticSeverity, Range, Position } from "vscode-languageserver/node";

import type { DtlCall, StructuralError } from "./dtl-parser";
import type { ValidatorOptions } from "../../types/dtl-validator.types";

const toRange = (
  start: { line: number; character: number },
  end: { line: number; character: number },
): Range =>
  Range.create(
    Position.create(start.line, start.character),
    Position.create(end.line, end.character),
  );

export const validateStructure = (
  calls: DtlCall[],
  structuralErrors: StructuralError[],
  options: ValidatorOptions,
): Diagnostic[] => {
  if (!options.validateDtlStructure) {
    return [];
  }

  const diagnostics: Diagnostic[] = [];

  for (const se of structuralErrors) {
    if (diagnostics.length >= options.maxProblems) {
      break;
    }

    if (se.kind === "rule-not-array") {
      diagnostics.push({
        range: toRange(se.range.start, se.range.end),
        severity: DiagnosticSeverity.Error,
        message: "Each item in a DTL rules list must be an array (a DTL call).",
        source: "dtl",
        code: "rule-not-array",
      });
    }
  }

  for (const call of calls) {
    if (diagnostics.length >= options.maxProblems) {
      break;
    }

    const { functionName, isTopLevel, nameRange, range, firstStringArg } = call;

    // missing-function-name: call array whose first element is not a string
    if (functionName === null) {
      const diagRange = toRange(range.start, range.end);

      diagnostics.push({
        range: diagRange,
        severity: DiagnosticSeverity.Error,
        message: "The first element of a DTL call must be a string (the function name).",
        source: "dtl",
        code: "missing-function-name",
      });
    }

    // undefined-rule: apply / apply-hops references a rule that was not declared
    if (
      isTopLevel &&
      (functionName === "apply" || functionName === "apply-hops") &&
      firstStringArg !== null &&
      !options.ruleNames.has(firstStringArg)
    ) {
      const diagRange = nameRange
        ? toRange(nameRange.start, nameRange.end)
        : toRange(range.start, range.end);

      diagnostics.push({
        range: diagRange,
        severity: DiagnosticSeverity.Warning,
        message: `"${functionName}" references rule "${firstStringArg}", but no such rule is declared in this transform.`,
        source: "dtl",
        code: "undefined-rule",
      });
    }
  }

  return diagnostics;
};
