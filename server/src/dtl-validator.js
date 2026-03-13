"use strict";
/**
 * DTL Validator
 * Runs diagnostics on a parsed set of DtlCalls and emits LSP Diagnostic objects.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateCalls = validateCalls;
const node_1 = require("vscode-languageserver/node");
const dtl_registry_1 = require("../../src/shared/dtl-registry");
const VALID_VARIABLE_PREFIXES = new Set(Object.keys(dtl_registry_1.DTL_VARIABLES));
function toRange(start, end) {
    return {
        start: node_1.Position.create(start.line, start.character),
        end: node_1.Position.create(end.line, end.character),
    };
}
function validateCalls(calls, options) {
    const diagnostics = [];
    for (const call of calls) {
        if (diagnostics.length >= options.maxProblems)
            break;
        const { functionName, nameRange, range, argCount } = call;
        if (functionName === null)
            continue;
        // --- Unknown variable prefix
        if (functionName.startsWith("_") && !functionName.includes("-")) {
            const prefix = functionName.split(".")[0]; // e.g. "_X" from "_X.foo"
            if (!VALID_VARIABLE_PREFIXES.has(prefix)) {
                const diagRange = nameRange
                    ? toRange(nameRange.start, nameRange.end)
                    : toRange(range.start, range.end);
                diagnostics.push({
                    range: diagRange,
                    severity: node_1.DiagnosticSeverity.Warning,
                    message: `Unknown variable prefix "${prefix}". Valid prefixes: ${[...VALID_VARIABLE_PREFIXES].join(", ")}.`,
                    source: "dtl",
                    code: "unknown-variable",
                });
                continue;
            }
        }
        const dtlFn = (0, dtl_registry_1.getDtlFunction)(functionName);
        // --- Unknown function
        if (options.validateUnknownFunctions && !(0, dtl_registry_1.isKnownFunction)(functionName)) {
            const diagRange = nameRange
                ? toRange(nameRange.start, nameRange.end)
                : toRange(range.start, range.end);
            diagnostics.push({
                range: diagRange,
                severity: node_1.DiagnosticSeverity.Error,
                message: `Unknown DTL function "${functionName}".`,
                source: "dtl",
                code: "unknown-function",
            });
            continue;
        }
        if (!dtlFn)
            continue;
        // --- Argument count validation
        if (options.validateArgCount) {
            if (argCount < dtlFn.minArgs) {
                const diagRange = toRange(range.start, range.end);
                diagnostics.push({
                    range: diagRange,
                    severity: node_1.DiagnosticSeverity.Warning,
                    message: `"${functionName}" expects at least ${dtlFn.minArgs} argument(s), but got ${argCount}. Signature: ${dtlFn.signature}`,
                    source: "dtl",
                    code: "too-few-args",
                });
            }
            else if (dtlFn.maxArgs !== null && argCount > dtlFn.maxArgs) {
                const diagRange = toRange(range.start, range.end);
                diagnostics.push({
                    range: diagRange,
                    severity: node_1.DiagnosticSeverity.Warning,
                    message: `"${functionName}" accepts at most ${dtlFn.maxArgs} argument(s), but got ${argCount}. Signature: ${dtlFn.signature}`,
                    source: "dtl",
                    code: "too-many-args",
                });
            }
        }
        // --- Transform used as expression (nested non-top-level)
        if (!call.isTopLevel && dtlFn.kind === "transform") {
            const diagRange = nameRange
                ? toRange(nameRange.start, nameRange.end)
                : toRange(range.start, range.end);
            diagnostics.push({
                range: diagRange,
                severity: node_1.DiagnosticSeverity.Warning,
                message: `"${functionName}" is a transform function with side-effects and should only be used at the top level of a rules list, not nested inside expressions.`,
                source: "dtl",
                code: "transform-as-expression",
            });
        }
    }
    return diagnostics;
}
//# sourceMappingURL=dtl-validator.js.map